# 🎯 Click the Moving Dot Game

A real-time HTML5 game where players try to click a moving dot that attempts to escape from their mouse cursor.  
The dataset of all user games is publicly available: **you can train your own AI model to escape user mouse** 🤖

🎮 **[Play the Game](https://clickthemovingdot.uc.r.appspot.com/)** | 📊 **[Download Dataset](https://clickthemovingdot.uc.r.appspot.com/dataset/)**

## 🚀 Quick Start

### 💻 Local Mode

```bash
# Clone the repository
git clone https://github.com/NicolasMICAUX/click_the_moving_dot.git
cd click_the_moving_dot_code

# Install dependencies
npm install

# Run in local mode (no data saving)
npm run start:local

# Or run with custom ONNX model
npm run start:local-onnx -- --onnx=path/to/your/model.onnx
```

The game will run at `http://localhost:3000` - **no Google Cloud setup required!** 🎉

See [**ML MODEL GUIDE**](ML_MODEL_GUIDE.md) 🧠 on how to train and export your own models.


### ☁️ For Admins With Google Cloud Access (Full Mode)

```bash
# Set up Google Cloud credentials
export GOOGLE_APPLICATION_CREDENTIALS=path/to/service-account-key.json
export GOOGLE_CLOUD_PROJECT=your-project-id

# Run with data saving enabled
npm start

# Or with custom ONNX model
npm run start:onnx -- --onnx=path/to/your/model.onnx
```

#### ☁️ App Engine Deployment (Cloud Mode)
```bash
# Deploy to Google App Engine
gcloud app deploy
```

#### 💻 Local Development
```bash
# Development with hot reload
npm run dev

# Development in local mode (without Google Cloud)
npm run dev:local
```

## 🎮 Game Mechanics

- 🏟️ **Arena**: 800x800 pixel playing field
- 🎯 **Objective**: Click the red dot to advance levels
- ⚡ **Speed Progression**: Each level increases max speed by 0.2 units

## 🔗 API Endpoints

- `GET /` - Game interface
- `GET /dataset` - Dataset download page (cloud mode only) 📊
- `GET /api/onnx-model` - Serves the ONNX model (default or custom) 🤖
- `GET /api/onnx-info` - Information about current ONNX model
- `GET /api/download-dataset?format=csv` - Download CSV dataset (cloud mode only) 📁
- `POST /api/save-session` - Save game session data (cloud mode only) 💾

## 📋 Data Schema

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
| mouseDown | Boolean | Whether mouse button was pressed |

## ⚙️ Environment Configuration

Copy `.env.example` to `.env` and configure:

```bash
# Run without Google Cloud
DISABLE_CLOUD=true

# Google Cloud settings (only if cloud mode)
GOOGLE_CLOUD_PROJECT=your-project-id
GOOGLE_APPLICATION_CREDENTIALS=path/to/service-account-key.json
```

## 📦 Available Scripts

- `npm start` - Production server (cloud mode)
- `npm run start:local` - Production server (local mode)
- `npm run start:onnx` - Production with custom ONNX model (cloud mode)
- `npm run start:local-onnx` - Production with custom ONNX model (local mode)
- `npm run dev` - Development server (cloud mode)
- `npm run dev:local` - Development server (local mode)

## 📁 Project Structure
```
├── server.js              # Main server file
├── public/
│   ├── index.html         # Game interface
│   ├── dataset.html       # Dataset download page
│   └── dummy_dot_behavior.onnx # Default AI model
├── .env.example           # Environment configuration template
└── package.json           # Dependencies and scripts
```

## 📄 License

MIT License
