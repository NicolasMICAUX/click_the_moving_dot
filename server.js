// Load environment variables
require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const compression = require('compression');
const { v4: uuidv4 } = require('uuid');
const { BigQuery } = require('@google-cloud/bigquery');
const { Storage } = require('@google-cloud/storage');
const { ParquetWriter, ParquetSchema } = require('parquetjs-lite');
const { Table, Schema, Field, Float64, Int32, Int64, Utf8, TimestampMillisecond, tableToIPC, RecordBatch, tableFromJSON, vectorFromArray, tableFromIPC, RecordBatchFileWriter } = require('apache-arrow');

const app = express();
const server = http.createServer(app);

// Middleware
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Allow larger payloads for game data
app.use(express.static('public'));

// Google Cloud configuration
const projectId = process.env.GOOGLE_CLOUD_PROJECT || 'clickthemovingdot';

// Initialize BigQuery with explicit configuration
const bigquery = new BigQuery({
    projectId: projectId,
    keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS
});

// Initialize Cloud Storage with explicit configuration
const storage = new Storage({
    projectId: projectId,
    keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS
});

// Cloud Storage bucket for dataset exports
const EXPORT_BUCKET_NAME = 'clickthemovingdot-exports';

// In-memory cache for dataset
let datasetCache = null;
let lastCacheUpdate = null;
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

// BigQuery dataset and table configuration
const DATASET_ID = 'game_analytics';
const TABLE_ID = 'mouse_tracking';

// Initialize Google Cloud services
async function initializeCloudServices() {
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
    }
}

// Stream session data to BigQuery
async function streamToBigQuery(sessionData) {
    try {
        const table = bigquery.dataset(DATASET_ID).table(TABLE_ID);
        
        // Transform data for BigQuery
        const rows = sessionData.mouseTrackingData.map(trackingPoint => ({
            sessionUid: sessionData.sessionUid,
            userUid: sessionData.userUid,
            level: sessionData.level,
            maxSpeed: sessionData.maxSpeed,
            sessionStartTime: new Date(sessionData.sessionStartTime),
            sessionEndTime: sessionData.sessionEndTime ? new Date(sessionData.sessionEndTime) : null,
            timestamp: new Date(trackingPoint.timestamp),
            dotX: trackingPoint.dotX,
            dotY: trackingPoint.dotY,
            mouseX: trackingPoint.mouseX,
            mouseY: trackingPoint.mouseY,
        }));
        
        await table.insert(rows);
        console.log(`Streamed ${rows.length} tracking points to BigQuery`);
        
    } catch (error) {
        console.error('Error streaming to BigQuery:', error);
        throw error; // We want to fail the session save if BigQuery fails since it's our only storage
    }
}

// Generate and cache dataset export to Cloud Storage
async function generateAndCacheDataset() {
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
        const forceRegenerate = true;
        
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
                mouseY
            FROM \`${projectId}.${DATASET_ID}.${TABLE_ID}\`
            ORDER BY timestamp DESC
        `;
        
        const [rows] = await bigquery.query({ query });
        
        // Apply anonymization for privacy protection
        const anonymizedRows = anonymizeData(rows);
        
        // Generate CSV (without sessionStartTime, sessionEndTime, and level)
        const csvHeader = 'sessionUid,userUid,maxSpeed,timestamp,dotX,dotY,mouseX,mouseY\n';
        const csvRows = anonymizedRows.map(row => 
            `${row.sessionUid},${row.userUid},${row.maxSpeed},${row.timestamp},${row.dotX},${row.dotY},${row.mouseX},${row.mouseY}`
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
        
        // Clean up old exports (keep only last 7 days)
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
            mouseY: { type: 'DOUBLE' }
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
                mouseY: row.mouseY
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
        const tempPath = path.join(__dirname, 'temp_dataset.arrow');

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
            mouseY: parseFloat(row.mouseY) || 0.0
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
        
        // Stream directly to BigQuery (our only storage now)
        await streamToBigQuery(sessionData);
        
        console.log(`Session ${sessionData.sessionUid} saved for user ${sessionData.userUid} with ${sessionData.mouseTrackingData.length} tracking points`);
        
        res.status(200).json({ success: true, message: 'Session data saved successfully' });
        
    } catch (error) {
        console.error('Error saving session data:', error);
        res.status(500).json({ error: 'Failed to save session data' });
    }
});

app.get('/api/download-dataset', async (req, res) => {
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
    
    // Initialize Google Cloud services
    await initializeCloudServices();
});
