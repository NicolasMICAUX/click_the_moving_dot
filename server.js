// Load environment variables
require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const compression = require('compression');
const crypto = require('crypto');

// Parse command line arguments
const args = process.argv.slice(2);
const onnxFileArg = args.find(arg => arg.startsWith('--onnx'));
const customOnnxFile = onnxFileArg ? onnxFileArg.split('=')[1] : null;

// Check if cloud services should be disabled
const DISABLE_CLOUD = process.env.DISABLE_CLOUD === 'true' || process.env.NODE_ENV === 'development';

// Only import cloud services if not disabled
let BigQuery, Storage, ParquetWriter, ParquetSchema, Table, Schema, Field, Float64, Int32, Int64, Utf8, TimestampMillisecond, tableToIPC, RecordBatch, tableFromJSON, vectorFromArray, tableFromIPC, RecordBatchFileWriter, Firestore;
let bigquery, storage, firestore;

if (!DISABLE_CLOUD) {
    try {
        ({ BigQuery } = require('@google-cloud/bigquery'));
        ({ Storage } = require('@google-cloud/storage'));
        ({ Firestore } = require('@google-cloud/firestore'));
        ({ ParquetWriter, ParquetSchema } = require('parquetjs-lite'));
        ({ Table, Schema, Field, Float64, Int32, Int64, Utf8, TimestampMillisecond, tableToIPC, RecordBatch, tableFromJSON, vectorFromArray, tableFromIPC, RecordBatchFileWriter } = require('apache-arrow'));
        
        console.log('✅ Cloud services dependencies loaded');
    } catch (error) {
        console.log('⚠️ Cloud services not available:', error.message);
        console.log('Running in local mode without cloud storage');
        DISABLE_CLOUD = true;
    }
}

const app = express();
const server = http.createServer(app);

// Middleware
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Allow larger payloads for game data
app.use(express.static('public'));

// Google Cloud configuration
const projectId = process.env.GOOGLE_CLOUD_PROJECT || 'clickthemovingdot';

// Initialize BigQuery and Storage only if cloud services are enabled
if (!DISABLE_CLOUD) {
    // Initialize BigQuery with explicit configuration
    bigquery = new BigQuery({
        projectId: projectId,
        keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS
    });

    // Initialize Cloud Storage with explicit configuration
    storage = new Storage({
        projectId: projectId,
        keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS
    });

    // Initialize Firestore with explicit configuration
    firestore = new Firestore({
        projectId: projectId,
        keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS
    });
} else {
    console.log('🔧 Running in local mode - cloud services disabled');
}

// Cloud Storage bucket for dataset exports
const EXPORT_BUCKET_NAME = 'clickthemovingdot-exports';

// Firestore collection for ONNX models
const MODELS_COLLECTION = 'onnx_models';

// Generate UID from model URL hash to avoid duplicates
function generateModelUID(modelUrl) {
    // Create SHA-256 hash of the model URL
    const hash = crypto.createHash('sha256').update(modelUrl).digest('hex');
    // Take first 8 characters for a shorter, still unique identifier
    return hash.substring(0, 8);
}

// Validate ONNX model URL
function validateModelUrl(url) {
    try {
        const parsed = new URL(url);
        
        // Must be HTTPS
        if (parsed.protocol !== 'https:') {
            return { valid: false, error: 'URL must use HTTPS protocol' };
        }
        
        // Must end with .onnx
        if (!parsed.pathname.toLowerCase().endsWith('.onnx')) {
            return { valid: false, error: 'URL must point to an .onnx file' };
        }
        
        // Check for common safe domains (you can expand this list)
        // const safeDomains = [
        //     'raw.githubusercontent.com',
        //     'github.com',
        //     'huggingface.co',
        //     'cdn.jsdelivr.net',
        //     'unpkg.com'
        // ];
        
        // const isKnownSafe = safeDomains.some(domain => 
        //     parsed.hostname === domain || parsed.hostname.endsWith('.' + domain)
        // );
        
        // if (!isKnownSafe) {
        //     console.log(`⚠️ Unknown domain for model URL: ${parsed.hostname}`);
        //     // Allow but log for monitoring
        // }
        
        return { valid: true };
    } catch (error) {
        return { valid: false, error: 'Invalid URL format' };
    }
}

// In-memory cache for dataset

// BigQuery dataset and table configuration
const DATASET_ID = 'game_analytics';
const TABLE_ID = 'mouse_tracking';

// Initialize Google Cloud services
async function initializeCloudServices() {
    if (DISABLE_CLOUD) {
        console.log('🔧 Cloud services disabled - running in local mode');
        return;
    }

    try {
        // Initialize BigQuery
        const dataset = bigquery.dataset(DATASET_ID);
        const [datasetExists] = await dataset.exists();
        
        if (!datasetExists) {
            await bigquery.createDataset(DATASET_ID);
            console.log(`Created BigQuery dataset: ${DATASET_ID}`);
        }
        
        const table = dataset.table(TABLE_ID);
        const [tableExists] = await table.exists();
        
        if (!tableExists) {
            const schema = [
                { name: 'sessionUid', type: 'STRING', mode: 'REQUIRED' },
                { name: 'userUid', type: 'STRING', mode: 'REQUIRED' },
                { name: 'level', type: 'INTEGER', mode: 'REQUIRED' },
                { name: 'maxSpeed', type: 'FLOAT', mode: 'REQUIRED' },
                { name: 'sessionStartTime', type: 'TIMESTAMP', mode: 'REQUIRED' },
                { name: 'sessionEndTime', type: 'TIMESTAMP', mode: 'NULLABLE' },
                { name: 'timestamp', type: 'TIMESTAMP', mode: 'REQUIRED' },
                { name: 'dotX', type: 'FLOAT', mode: 'REQUIRED' },
                { name: 'dotY', type: 'FLOAT', mode: 'REQUIRED' },
                { name: 'mouseX', type: 'FLOAT', mode: 'REQUIRED' },
                { name: 'mouseY', type: 'FLOAT', mode: 'REQUIRED' },
                { name: 'mouseDown', type: 'BOOLEAN', mode: 'REQUIRED' },
            ];
            
            await table.create({ schema });
            console.log(`Created BigQuery table: ${TABLE_ID}`);
        }
        
        // Initialize Cloud Storage bucket
        const bucket = storage.bucket(EXPORT_BUCKET_NAME);
        const [bucketExists] = await bucket.exists();
        
        if (!bucketExists) {
            await storage.createBucket(EXPORT_BUCKET_NAME, {
                location: 'US',
                storageClass: 'STANDARD',
            });
            console.log(`Created Cloud Storage bucket: ${EXPORT_BUCKET_NAME}`);
        }
        
        console.log('✅ Google Cloud services initialized successfully');
    } catch (error) {
        console.error('❌ Google Cloud services initialization failed:', error);
        console.log('⚠️ Continuing without cloud services - game will work but data won\'t be saved');
    }
}

// Stream session data to BigQuery
async function streamToBigQuery(sessionData) {
    if (DISABLE_CLOUD) {
        console.log(`[LOCAL MODE] Session ${sessionData.sessionUid} for user ${sessionData.userUid} with ${sessionData.mouseTrackingData.length} tracking points - data not saved`);
        return;
    }

    try {
        const table = bigquery.dataset(DATASET_ID).table(TABLE_ID);
        
        // Transform data for BigQuery
        const rows = sessionData.mouseTrackingData.map((trackingPoint, index) => {
            // Validate required numeric fields
            const validateNumber = (value, fieldName) => {
                if (typeof value !== 'number' || isNaN(value) || !isFinite(value)) {
                    console.warn(`Invalid ${fieldName} at tracking point ${index}: ${value}`);
                    return 0; // Default to 0 for invalid numeric values
                }
                return value;
            };
            
            // Validate timestamps
            const validateTimestamp = (value, fieldName) => {
                if (!value) return null;
                const date = new Date(value);
                if (isNaN(date.getTime())) {
                    console.warn(`Invalid ${fieldName} at tracking point ${index}: ${value}`);
                    return new Date(); // Default to current time
                }
                return date;
            };
            
            return {
                sessionUid: String(sessionData.sessionUid || ''),
                userUid: String(sessionData.userUid || ''),
                level: validateNumber(sessionData.level, 'level'),
                maxSpeed: validateNumber(sessionData.maxSpeed, 'maxSpeed'),
                sessionStartTime: validateTimestamp(sessionData.sessionStartTime, 'sessionStartTime'),
                sessionEndTime: sessionData.sessionEndTime ? validateTimestamp(sessionData.sessionEndTime, 'sessionEndTime') : null,
                timestamp: validateTimestamp(trackingPoint.timestamp, 'timestamp'),
                dotX: validateNumber(trackingPoint.dotX, 'dotX'),
                dotY: validateNumber(trackingPoint.dotY, 'dotY'),
                mouseX: validateNumber(trackingPoint.mouseX, 'mouseX'),
                mouseY: validateNumber(trackingPoint.mouseY, 'mouseY'),
                mouseDown: Boolean(trackingPoint.mouseDown),
            };
        });
        
        await table.insert(rows);
        console.log(`Streamed ${rows.length} tracking points to BigQuery`);
        
    } catch (error) {
        console.error('Error streaming to BigQuery:', error);
        
        // Log detailed error information for PartialFailureError
        if (error.name === 'PartialFailureError' && error.errors) {
            console.error('Detailed BigQuery insertion errors:');
            error.errors.forEach((errorDetail, index) => {
                console.error(`Row ${index}:`, {
                    errors: errorDetail.errors,
                    rowData: errorDetail.row
                });
            });
        }
        
        throw error; // We want to fail the session save if BigQuery fails since it's our only storage
    }
}

// Generate and cache dataset export to Cloud Storage
async function generateAndCacheDataset() {
    if (DISABLE_CLOUD) {
        throw new Error('Dataset generation requires cloud services. Run with cloud access to generate datasets.');
    }

    try {
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
        const bucket = storage.bucket(EXPORT_BUCKET_NAME);
        
        // Check if today's export already exists
        const csvFile = bucket.file(`datasets/game_dataset_${today}.csv`);
        const parquetFile = bucket.file(`datasets/game_dataset_${today}.parquet`);
        const featherFile = bucket.file(`datasets/game_dataset_${today}.feather`);
        
        const [csvExists] = await csvFile.exists();
        const [parquetExists] = await parquetFile.exists();
        const [featherExists] = await featherFile.exists();
        
        // Force regeneration for debugging - remove this line later
        const forceRegenerate = false;
        
        if (csvExists && parquetExists && featherExists && !forceRegenerate) {
            console.log(`Using cached dataset for ${today}`);
            return { csvFile, parquetFile, featherFile };
        }
        
        console.log(`Generating new dataset export for ${today}...`);
        
        // Export from BigQuery
        const query = `
            SELECT 
                sessionUid,
                userUid,
                level,
                maxSpeed,
                UNIX_MILLIS(sessionStartTime) as sessionStartTime,
                UNIX_MILLIS(sessionEndTime) as sessionEndTime,
                UNIX_MILLIS(timestamp) as timestamp,
                dotX,
                dotY,
                mouseX,
                mouseY,
                mouseDown
            FROM \`${projectId}.${DATASET_ID}.${TABLE_ID}\`
            ORDER BY timestamp DESC
        `;
        
        const [rows] = await bigquery.query({ query });
        
        // Apply anonymization for privacy protection
        const anonymizedRows = anonymizeData(rows);
        
        // Generate CSV (without sessionStartTime, sessionEndTime, and level)
        const csvHeader = 'sessionUid,userUid,maxSpeed,timestamp,dotX,dotY,mouseX,mouseY,mouseDown\n';
        const csvRows = anonymizedRows.map(row => 
            `${row.sessionUid},${row.userUid},${row.maxSpeed},${row.timestamp},${row.dotX},${row.dotY},${row.mouseX},${row.mouseY},${row.mouseDown}`
        ).join('\n');
        const csv = csvHeader + csvRows;
        
        // Generate Parquet (with all fields)
        const parquetBuffer = await generateParquetBuffer(anonymizedRows);
        
        // Generate Feather (with all fields)
        const featherBuffer = await generateFeatherBuffer(anonymizedRows);
        
        // Save to Cloud Storage
        await csvFile.save(csv, {
            metadata: {
                contentType: 'text/csv',
                cacheControl: 'public, max-age=86400', // Cache for 24 hours
            }
        });
        
        await parquetFile.save(parquetBuffer, {
            metadata: {
                contentType: 'application/octet-stream',
                cacheControl: 'public, max-age=86400', // Cache for 24 hours
            }
        });
        
        await featherFile.save(featherBuffer, {
            metadata: {
                contentType: 'application/octet-stream',
                cacheControl: 'public, max-age=86400', // Cache for 24 hours
            }
        });
        
        console.log(`Dataset cached to Cloud Storage: ${rows.length} records`);
        
        // Clean up old exports (keep only last 2 days)
        await cleanupOldExports(bucket);
        
        return { csvFile, parquetFile, featherFile };
        
    } catch (error) {
        console.error('Error generating dataset:', error);
        throw error;
    }
}

// Clean up old dataset exports
async function cleanupOldExports(bucket) {
    try {
        const [files] = await bucket.getFiles({ prefix: 'datasets/' });
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - 7); // Keep last 7 days
        
        for (const file of files) {
            // Extract date from filename (game_dataset_YYYY-MM-DD.extension)
            const match = file.name.match(/game_dataset_(\d{4}-\d{2}-\d{2})\.(csv|parquet|feather)$/);
            if (match) {
                const fileDate = new Date(match[1]);
                if (fileDate < cutoffDate) {
                    await file.delete();
                    console.log(`Deleted old export: ${file.name}`);
                }
            }
        }
    } catch (error) {
        console.error('Error cleaning up old exports:', error);
        // Don't throw - cleanup failure shouldn't break the export
    }
}

// Generate Parquet buffer from rows data
async function generateParquetBuffer(rows) {
    try {
        // Define Parquet schema
        const schema = new ParquetSchema({
            sessionUid: { type: 'INT32' },
            userUid: { type: 'INT32' },
            level: { type: 'INT32' },
            maxSpeed: { type: 'DOUBLE' },
            sessionStartTime: { type: 'INT64', optional: true },
            sessionEndTime: { type: 'INT64', optional: true },
            timestamp: { type: 'INT64', optional: true },
            dotX: { type: 'DOUBLE' },
            dotY: { type: 'DOUBLE' },
            mouseX: { type: 'DOUBLE' },
            mouseY: { type: 'DOUBLE' },
            mouseDown: { type: 'BOOLEAN' }
        });

        // Create a temporary file path for parquet generation
        const tempPath = path.join(__dirname, 'temp_dataset.parquet');
        const writer = await ParquetWriter.openFile(schema, tempPath);

        // Write rows to parquet file
        for (const row of rows) {
            await writer.appendRow({
                sessionUid: row.sessionUid,
                userUid: row.userUid,
                level: row.level,
                maxSpeed: row.maxSpeed,
                sessionStartTime: row.sessionStartTime || null,
                sessionEndTime: row.sessionEndTime || null,
                timestamp: row.timestamp || null,
                dotX: row.dotX,
                dotY: row.dotY,
                mouseX: row.mouseX,
                mouseY: row.mouseY,
                mouseDown: row.mouseDown || false
            });
        }

        await writer.close();

        // Read the file back as buffer
        const buffer = fs.readFileSync(tempPath);
        
        // Clean up temp file
        fs.unlinkSync(tempPath);
        
        return buffer;
    } catch (error) {
        console.error('Error generating Parquet buffer:', error);
        throw error;
    }
}

// Generate Feather (Arrow IPC) buffer from rows data
async function generateFeatherBuffer(rows) {
    try {
        if (rows.length === 0) {
            return Buffer.alloc(0);
        }

        // Create a temporary file path for arrow generation

        // Prepare data for tableFromJSON - ensure all fields are present and properly typed
        const data = rows.map(row => ({
            sessionUid: parseInt(row.sessionUid) || 0,
            userUid: parseInt(row.userUid) || 0,
            level: parseInt(row.level) || 0,
            maxSpeed: parseFloat(row.maxSpeed) || 0.0,
            sessionStartTime: row.sessionStartTime || null,
            sessionEndTime: row.sessionEndTime || null,
            timestamp: row.timestamp || null,
            dotX: parseFloat(row.dotX) || 0.0,
            dotY: parseFloat(row.dotY) || 0.0,
            mouseX: parseFloat(row.mouseX) || 0.0,
            mouseY: parseFloat(row.mouseY) || 0.0,
            mouseDown: Boolean(row.mouseDown)
        }));

        console.log(`Creating Feather file with ${data.length} rows`);
        
        // Create Arrow table from JSON data
        const table = tableFromJSON(data);
        
        console.log(`Table created with ${table.numRows} rows and ${table.numCols} columns`);
        
        // Convert table to IPC buffer format
        const ipcBuffer = tableToIPC(table, 'file');
        
        console.log(`IPC buffer created with size: ${ipcBuffer.length} bytes`);
        
        return ipcBuffer;
    } catch (error) {
        console.error('Error generating Feather buffer:', error);
        console.error('Error details:', error.message);
        console.error('Stack trace:', error.stack);
        throw error;
    }
}

// Anonymize UIDs for privacy protection
function anonymizeData(rows) {
    const sessionUidMap = new Map();
    const userUidMap = new Map();
    let sessionCounter = 0;
    let userCounter = 0;
    
    return rows.map(row => {
        // Anonymize sessionUid
        if (!sessionUidMap.has(row.sessionUid)) {
            sessionUidMap.set(row.sessionUid, sessionCounter++);
        }
        
        // Anonymize userUid
        if (!userUidMap.has(row.userUid)) {
            userUidMap.set(row.userUid, userCounter++);
        }
        
        return {
            ...row,
            sessionUid: sessionUidMap.get(row.sessionUid),
            userUid: userUidMap.get(row.userUid)
        };
    });
}

// HTTP Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/dataset', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dataset.html'));
});

app.get('/submit', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'submit_model.html'));
});

// Serve custom ONNX model if specified
app.get('/api/onnx-model', async (req, res) => {
    let onnxPath;
    const sharedModelUid = req.query.r; // Check for shared model UID
    
    try {
        if (sharedModelUid) {
            // Try to load shared model from Firestore
            if (DISABLE_CLOUD) {
                return res.status(503).json({ 
                    error: 'Shared models require cloud services', 
                    message: 'Shared model feature is only available when running with Firestore access'
                });
            }
            
            const modelDoc = await firestore.collection(MODELS_COLLECTION).doc(sharedModelUid).get();
            
            if (!modelDoc.exists) {
                return res.status(404).json({ 
                    error: 'Shared model not found',
                    uid: sharedModelUid
                });
            }
            
            const modelData = modelDoc.data();
            const modelUrl = modelData.modelUrl;
            
            console.log(`Proxying shared ONNX model ${sharedModelUid}: ${modelUrl}`);
            
            // Fetch the model from the URL and proxy it
            const fetch = require('node-fetch');
            const modelResponse = await fetch(modelUrl);
            
            if (!modelResponse.ok) {
                return res.status(502).json({ 
                    error: 'Failed to fetch shared model',
                    uid: sharedModelUid,
                    status: modelResponse.status
                });
            }
            
            // Set appropriate headers and pipe the response
            res.setHeader('Content-Type', 'application/octet-stream');
            res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
            modelResponse.body.pipe(res);
            return;
        }
        
        // Original logic for custom/default models
        if (customOnnxFile) {
            // Custom ONNX file specified via command line
            if (path.isAbsolute(customOnnxFile)) {
                onnxPath = customOnnxFile;
            } else {
                onnxPath = path.join(__dirname, customOnnxFile);
            }
        } else {
            // Default ONNX file
            onnxPath = path.join(__dirname, 'public', 'dummy_dot_behavior.onnx');
        }
        
        // Check if file exists
        if (!fs.existsSync(onnxPath)) {
            return res.status(404).json({ 
                error: 'ONNX model not found',
                path: onnxPath,
                customFile: !!customOnnxFile
            });
        }
        
        console.log(`Serving ONNX model: ${onnxPath}`);
        res.setHeader('Content-Type', 'application/octet-stream');
        res.sendFile(onnxPath);
        
    } catch (error) {
        console.error('Error serving ONNX model:', error);
        res.status(500).json({ 
            error: 'Internal server error while fetching model',
            message: error.message
        });
    }
});

// Get ONNX model info
app.get('/api/onnx-info', (req, res) => {
    let onnxPath;
    let isCustom = false;
    
    if (customOnnxFile) {
        if (path.isAbsolute(customOnnxFile)) {
            onnxPath = customOnnxFile;
        } else {
            onnxPath = path.join(__dirname, customOnnxFile);
        }
        isCustom = true;
    } else {
        onnxPath = path.join(__dirname, 'public', 'dummy_dot_behavior.onnx');
    }
    
    const exists = fs.existsSync(onnxPath);
    const stats = exists ? fs.statSync(onnxPath) : null;
    
    res.json({
        path: onnxPath,
        filename: path.basename(onnxPath),
        isCustom: isCustom,
        exists: exists,
        size: stats ? stats.size : null,
        modified: stats ? stats.mtime : null
    });
});

// Submit ONNX model endpoint
app.post('/api/submit-model', async (req, res) => {
    if (DISABLE_CLOUD) {
        return res.status(503).json({ 
            error: 'Model submission requires cloud services', 
            message: 'This feature is only available when running with Firestore access'
        });
    }

    try {
        const { modelUrl, description } = req.body;
        
        // Validate required fields
        if (!modelUrl) {
            return res.status(400).json({ error: 'Model URL is required' });
        }
        
        // Validate URL format and safety
        const validation = validateModelUrl(modelUrl);
        if (!validation.valid) {
            return res.status(400).json({ error: validation.error });
        }
        
        // Test if the URL is accessible and returns a valid ONNX file
        try {
            const fetch = require('node-fetch');
            const testResponse = await fetch(modelUrl, { method: 'HEAD', timeout: 10000 });
            
            if (!testResponse.ok) {
                return res.status(400).json({ 
                    error: 'Model URL is not accessible',
                    status: testResponse.status 
                });
            }
            
            // Check content type if available
            const contentType = testResponse.headers.get('content-type');
            if (contentType && !contentType.includes('application/octet-stream') && !contentType.includes('application/x-onnx')) {
                console.log(`⚠️ Unexpected content type for ONNX model: ${contentType}`);
                // Allow but log for monitoring
            }
            
        } catch (fetchError) {
            return res.status(400).json({ 
                error: 'Failed to verify model URL accessibility',
                details: fetchError.message 
            });
        }
        
        // Generate UID from model URL hash
        const uid = generateModelUID(modelUrl);
        
        // Check if model already exists
        const existingDoc = await firestore.collection(MODELS_COLLECTION).doc(uid).get();
        if (existingDoc.exists) {
            const existingData = existingDoc.data();
            return res.status(200).json({ 
                success: true, 
                uid: uid,
                shareUrl: `${req.protocol}://${req.get('host')}/?r=${uid}`,
                message: 'Model already exists',
                existing: true,
                submittedAt: existingData.submittedAt,
                description: existingData.description
            });
        }
        
        // Store in Firestore
        const modelData = {
            uid: uid,
            modelUrl: modelUrl,
            description: description || '',
            submittedAt: new Date(),
            submitterIP: req.ip || req.connection.remoteAddress, // For abuse monitoring
            accessCount: 0,
            lastAccessed: null
        };
        
        await firestore.collection(MODELS_COLLECTION).doc(uid).set(modelData);
        
        console.log(`📤 New model submitted with UID ${uid}: ${modelUrl}`);
        
        res.status(200).json({ 
            success: true, 
            uid: uid,
            shareUrl: `${req.protocol}://${req.get('host')}/?r=${uid}`,
            message: 'Model submitted successfully' 
        });
        
    } catch (error) {
        console.error('Error submitting model:', error);
        res.status(500).json({ error: 'Failed to submit model' });
    }
});

// Save game session data (called when game ends)
app.post('/api/save-session', async (req, res) => {
    try {
        const sessionData = req.body;
        
        // Validate required fields
        if (!sessionData.sessionUid || !sessionData.userUid || !sessionData.mouseTrackingData) {
            return res.status(400).json({ error: 'Missing required session data' });
        }
        
        // Add server timestamp
        sessionData.serverTimestamp = Date.now();
        
        if (DISABLE_CLOUD) {
            // In local mode, just log the session and return success
            console.log(`[LOCAL MODE] Session ${sessionData.sessionUid} received for user ${sessionData.userUid} with ${sessionData.mouseTrackingData.length} tracking points`);
            res.status(200).json({ 
                success: true, 
                message: 'Session data received (not saved - running in local mode)',
                localMode: true
            });
        } else {
            // Stream directly to BigQuery (our only storage now)
            await streamToBigQuery(sessionData);
            
            console.log(`Session ${sessionData.sessionUid} saved for user ${sessionData.userUid} with ${sessionData.mouseTrackingData.length} tracking points`);
            
            res.status(200).json({ success: true, message: 'Session data saved successfully' });
        }
        
    } catch (error) {
        console.error('Error saving session data:', error);
        res.status(500).json({ error: 'Failed to save session data' });
    }
});

app.get('/api/download-dataset', async (req, res) => {
    if (DISABLE_CLOUD) {
        return res.status(503).json({ 
            error: 'Dataset download requires cloud services', 
            message: 'This feature is only available when running with Google Cloud access',
            localMode: true
        });
    }

    try {
        const format = req.query.format || 'csv';
        const getUrl = req.query.url === 'true'; // Add ?url=true to get signed URL instead of direct download
        
        if (!['csv', 'parquet', 'feather'].includes(format)) {
            return res.status(400).json({ error: 'Unsupported format. Use csv, parquet, or feather.' });
        }
        
        // Generate/get cached dataset from Cloud Storage
        const { csvFile, parquetFile, featherFile } = await generateAndCacheDataset();
        
        let file, contentType, filename;
        
        switch (format) {
            case 'csv':
                file = csvFile;
                contentType = 'text/csv';
                filename = 'game_dataset.csv';
                break;
            case 'parquet':
                file = parquetFile;
                contentType = 'application/octet-stream';
                filename = 'game_dataset.parquet';
                break;
            case 'feather':
                file = featherFile;
                contentType = 'application/octet-stream';
                filename = 'game_dataset.feather';
                break;
        }
        
        // If user wants a signed URL for curl/wget access
        if (getUrl) {
            const options = {
                version: 'v4',
                action: 'read',
                expires: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
                responseDisposition: `attachment; filename="${filename}"`,
                responseType: contentType,
            };
            
            const [signedUrl] = await file.getSignedUrl(options);
            
            return res.json({
                signedUrl: signedUrl,
                filename: filename,
                format: format,
                expires: new Date(options.expires).toISOString(),
                curlExample: `curl -o "${filename}" "${signedUrl}"`
            });
        }
        
        // Otherwise, stream the file directly from Cloud Storage to the client
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        
        const stream = file.createReadStream();
        stream.pipe(res);
        
        stream.on('error', (error) => {
            console.error('Error streaming file:', error);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Failed to stream dataset' });
            }
        });
        
        stream.on('end', () => {
            console.log(`Dataset streamed successfully: ${format} format`);
        });
        
    } catch (error) {
        console.error('Error generating dataset:', error);
        res.status(500).json({ error: 'Failed to generate dataset' });
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🎮 Game available at: http://localhost:${PORT}`);
    console.log(`📊 Dataset page at: http://localhost:${PORT}/dataset`);
    console.log(`📤 Submit your own AI model at: http://localhost:${PORT}/submit`);
    
    // Show configuration
    if (DISABLE_CLOUD) {
        console.log('🔧 Running in LOCAL MODE - data will not be saved');
        console.log('   To enable cloud services, remove DISABLE_CLOUD environment variable');
    } else {
        console.log('☁️ Running with CLOUD SERVICES enabled');
    }
    
    if (customOnnxFile) {
        console.log(`🤖 Using custom ONNX model: ${customOnnxFile}`);
    } else {
        console.log('🤖 Using default ONNX model');
    }
    
    console.log(`🔗 ONNX model info: http://localhost:${PORT}/api/onnx-info`);
    
    // Initialize Google Cloud services
    await initializeCloudServices();
});
