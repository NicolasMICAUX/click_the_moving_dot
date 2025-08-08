// Load environment variables
require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const compression = require('compression');
const { v4: uuidv4 } = require('uuid');
const { Firestore } = require('@google-cloud/firestore');
const { BigQuery } = require('@google-cloud/bigquery');

const app = express();
const server = http.createServer(app);

// Middleware
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Allow larger payloads for game data
app.use(express.static('public'));

// Google Cloud configuration
const projectId = process.env.GOOGLE_CLOUD_PROJECT || 'clickthemovingdot';

// Initialize Firestore with explicit configuration
const firestore = new Firestore({
    projectId: projectId,
    keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS
});

// Initialize BigQuery with explicit configuration
const bigquery = new BigQuery({
    projectId: projectId,
    keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS
});

// In-memory cache for dataset
let datasetCache = null;
let lastCacheUpdate = null;
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

// Test Firestore connection on startup
async function testFirestoreConnection() {
    try {
        console.log('Testing Firestore connection...');
        const testDoc = await firestore.collection('_test').doc('connection').get();
        console.log('✅ Firestore connection successful');
        return true;
    } catch (error) {
        console.error('❌ Firestore connection failed:', error.message);
        if (error.code === 'UNAUTHENTICATED') {
            console.error('   → Check your service account key and permissions');
        }
        return false;
    }
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
        
        // Save to Firestore for real-time queries
        await firestore.collection('game_sessions').doc(sessionData.sessionUid).set(sessionData);
        
        console.log(`Session ${sessionData.sessionUid} saved for user ${sessionData.userUid} with ${sessionData.mouseTrackingData.length} tracking points`);
        
        res.status(200).json({ success: true, message: 'Session data saved successfully' });
        
    } catch (error) {
        console.error('Error saving session data:', error);
        res.status(500).json({ error: 'Failed to save session data' });
    }
});

app.get('/api/download-dataset', async (req, res) => {
    try {
        const now = Date.now();
        
        // Check if we need to refresh cache
        if (!datasetCache || !lastCacheUpdate || (now - lastCacheUpdate) > CACHE_DURATION) {
            console.log('Refreshing dataset cache...');
            await refreshDatasetCache();
            lastCacheUpdate = now;
        }
        
        const format = req.query.format || 'csv';
        
        if (format === 'csv') {
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename="game_dataset.csv"');
            res.send(datasetCache.csv);
        } else if (format === 'json') {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', 'attachment; filename="game_dataset.json"');
            res.send(JSON.stringify(datasetCache.json, null, 2));
        } else {
            res.status(400).json({ error: 'Unsupported format. Use csv or json.' });
        }
        
    } catch (error) {
        console.error('Error generating dataset:', error);
        res.status(500).json({ error: 'Failed to generate dataset' });
    }
});

async function refreshDatasetCache() {
    try {
        // Query all sessions from Firestore
        const sessionsSnapshot = await firestore.collection('game_sessions').get();
        const sessions = [];
        
        sessionsSnapshot.forEach(doc => {
            const sessionData = doc.data();
            sessions.push(sessionData);
        });
        
        // Flatten mouse tracking data
        const flattenedData = [];
        sessions.forEach(session => {
            session.mouseTrackingData.forEach(trackingPoint => {
                flattenedData.push({
                    sessionUid: session.sessionUid,
                    userUid: session.userUid,
                    level: session.level,
                    maxSpeed: session.maxSpeed,
                    sessionStartTime: session.sessionStartTime,
                    sessionEndTime: session.sessionEndTime,
                    timestamp: trackingPoint.timestamp,
                    dotX: trackingPoint.dotX,
                    dotY: trackingPoint.dotY,
                    mouseX: trackingPoint.mouseX,
                    mouseY: trackingPoint.mouseY
                });
            });
        });
        
        // Generate CSV
        const csvHeader = 'sessionUid,userUid,level,maxSpeed,sessionStartTime,sessionEndTime,timestamp,dotX,dotY,mouseX,mouseY\n';
        const csvRows = flattenedData.map(row => 
            `${row.sessionUid},${row.userUid},${row.level},${row.maxSpeed},${row.sessionStartTime},${row.sessionEndTime},${row.timestamp},${row.dotX},${row.dotY},${row.mouseX},${row.mouseY}`
        ).join('\n');
        const csv = csvHeader + csvRows;
        
        datasetCache = {
            csv: csv,
            json: flattenedData
        };
        
        console.log(`Dataset cache refreshed with ${flattenedData.length} records`);
        
    } catch (error) {
        console.error('Error refreshing dataset cache:', error);
        throw error;
    }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🎮 Game available at: http://localhost:${PORT}`);
    console.log(`📊 Dataset page at: http://localhost:${PORT}/dataset`);
    
    // Test database connection
    await testFirestoreConnection();
});
