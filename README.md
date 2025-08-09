# Click the Moving Dot Game

A real-time HTML5 game where players try to click a moving dot that attempts to escape from their mouse cursor.  
The dataset of all user games is publicly available: **you can train your own AI model to escape user mouse**.

## Game Mechanics

- **Arena**: 800x800 pixel playing field
- **Objective**: Click the red dot to advance levels
- **Speed Progression**: Each level increases max speed by 0.2 units

## API Endpoints

- `GET /` - Game interface
- `GET /dataset` - Dataset download page  
- `GET /api/download-dataset?format=csv` - Download CSV dataset
- `GET /api/download-dataset?format=json` - Download JSON dataset

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

## Deploy

### App Engine Deployment
```bash
# Deploy to Google App Engine
gcloud app deploy
```

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
└── .github/
    └── copilot-instructions.md
```

## License

MIT License
