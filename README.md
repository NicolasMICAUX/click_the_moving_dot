# Click the Moving Dot Game

A real-time HTML5 game where players try to click a moving dot that attempts to escape from their mouse cursor. Built with Node.js, WebSockets, and Google Cloud services for efficient data collection and analysis.

## Features

- **Real-time Gameplay**: Smooth WebSocket-based communication between client and server
- **Progressive Difficulty**: Dot speed increases with each successful click
- **Mouse Tracking**: Records all mouse movements with precise timestamps
- **Data Collection**: Stores millions of game sessions efficiently using Google Cloud
- **Dataset Export**: Download game data in CSV or JSON format for analysis
- **AI-Ready**: Prepared for future AI integration to control dot movement

## Game Mechanics

- **Arena**: 800x800 pixel playing field
- **Objective**: Click the red dot to advance levels
- **Dot Behavior**: Moves away from mouse cursor with random noise
- **Speed Progression**: Each level increases max speed by 0.2 units
- **User Persistence**: Each browser gets a permanent user ID

## Technical Architecture

### Frontend
- HTML5 Canvas for smooth graphics
- WebSocket for real-time communication
- Responsive design with visual feedback
- Graceful reconnection handling

### Backend
- Express.js server with WebSocket support
- Google Cloud Firestore for real-time data storage
- BigQuery integration for analytics (ready)
- Efficient data caching (24-hour refresh cycle)

### Data Collection
Each mouse movement records:
- Timestamp
- Dot position (x, y)
- Mouse position (x, y)
- Session metadata (level, speed, user ID)

## Setup Instructions

### Prerequisites
- Node.js 14+ 
- Google Cloud Project (ID: `clickthemovingdot`)
- Google Cloud credentials configured

### Installation

1. **Clone and install dependencies:**
```bash
npm install
```

3. **Run the server:**
```bash
npm start
```

4. **Access the game:**
   - Game: http://localhost:3000
   - Dataset: http://localhost:3000/dataset

## Google Cloud Deployment

### App Engine Deployment
```bash
# Deploy to Google App Engine
gcloud app deploy

# View logs
gcloud app logs tail -s default
```

## API Endpoints

- `GET /` - Game interface
- `GET /dataset` - Dataset download page  
- `GET /api/download-dataset?format=csv` - Download CSV dataset
- `GET /api/download-dataset?format=json` - Download JSON dataset
- `WebSocket /` - Real-time game communication

## Data Schema

| Field | Type | Description |
|-------|------|-------------|
| sessionUid | String | Unique session identifier |
| userUid | String | Persistent user identifier |
| level | Integer | Game level |
| maxSpeed | Float | Maximum dot speed |
| sessionStartTime | Timestamp | Session start |
| sessionEndTime | Timestamp | Session end |
| timestamp | Timestamp | Mouse tracking timestamp |
| dotX, dotY | Float | Dot coordinates (0-800) |
| mouseX, mouseY | Float | Mouse coordinates (0-800) |

## Performance Considerations

- **WebSocket Efficiency**: Minimal message overhead
- **Data Batching**: Efficient database writes
- **Memory Management**: Optimized for thousands of concurrent users
- **Caching Strategy**: Dataset cached for 24 hours
- **Scalable Architecture**: Ready for horizontal scaling

## Future AI Integration

The codebase is prepared for AI-driven dot movement:
- Historical position data collected
- Contextual information (speed, level) tracked
- Modular game logic for easy AI integration
- Real-time prediction capability ready

## Development

### Local Development
```bash
npm run dev
```

### Project Structure
```
├── server.js              # Main server file
├── public/
│   ├── index.html         # Game interface
│   └── dataset.html       # Dataset download page
├── src/                   # Future source files
└── .github/
    └── copilot-instructions.md
```

## License

MIT License
