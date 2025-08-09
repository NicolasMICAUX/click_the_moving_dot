# 🎯 Machine Learning Model Guide for "Click the Moving Dot"

This guide will help you create your own AI model to control the dot's behavior in the "Click the Moving Dot" game.

## 🎮 Game Overview

The game tracks mouse movements and the dot's position in real-time. Your ML model will receive this data and output velocity commands to make the dot move intelligently, avoiding the player's mouse cursor.

## 📊 Data Format and Model Interface

### Input Data Structure

Your model receives two inputs:

1. **`history`** - A dynamic sequence tensor `[seq_len, 5]` containing recent game state:
   - `history[i][0]` - Timestamp (milliseconds)
   - `history[i][1]` - Dot X position (0-800 pixels)
   - `history[i][2]` - Dot Y position (0-800 pixels) 
   - `history[i][3]` - Mouse X position (0-800 pixels)
   - `history[i][4]` - Mouse Y position (0-800 pixels)

History is ordered chronologically: history[0] is the oldest (earliest timestamp) and history[seq_len-1] is the most recent sample.

2. **`config`** - A single float `[1]` containing the maximum allowed speed for current level. Probably the AI behavior to escape the user would be different if it can move fast or only slow.

### Output Requirements

Your model must output exactly two values:

- **`targetVx`** - Target velocity in X direction (pixels/second) `[1]`
- **`targetVy`** - Target velocity in Y direction (pixels/second) `[1]`

### Key Constraints

- **Dynamic sequence length**: The `seq_len` dimension varies
- **Coordinate system**: Origin (0,0) is top-left, arena is 800x800 pixels
- **Speed limits**: Output velocities will be clipped to respect `config.maxSpeed * 100` pixels/second
- **ONNX compatibility**: Model must use ONNX opset 8+ for browser compatibility

## 🚀 Getting Started

### 1. Download Training Data

Visit `http://localhost:3000/dataset.html` (when game server is running) to download the dataset in CSV, Parquet, or Feather format. The dataset contains real player interaction data with the following fields:

```
sessionUid, userUid, level, maxSpeed, sessionStartTime, sessionEndTime,
timestamp, dotX, dotY, mouseX, mouseY
```

Each row represents a single mouse tracking event.

### 2. Model Architecture Ideas

- **CNN1D**: Process mouse movement history as a 1D sequence
- **LSTM/GRU**: Learn temporal patterns in mouse movement
- **Transformer**: Attention-based sequence modeling

- **Reinforcement Learning**: Train an agent to maximize "escape time"

## 🔧 Implementation Examples

### PyTorch Implementation

```python
import torch
import torch.nn as nn
import torch.onnx

class DotBehaviorModel(nn.Module):
    def __init__(self, hidden_size=64):
        super().__init__()
        self.lstm = nn.LSTM(5, hidden_size, batch_first=True)
        self.velocity_head = nn.Linear(hidden_size + 1, 2)  # +1 for config
        
    def forward(self, history, config):
        # history: [batch_size, seq_len, 5]
        # config: [batch_size, 1]
        
        lstm_out, _ = self.lstm(history)
        last_hidden = lstm_out[:, -1, :]  # Take last timestep
        
        # Concatenate with config
        combined = torch.cat([last_hidden, config], dim=1)
        velocity = self.velocity_head(combined)
        
        return velocity[:, 0:1], velocity[:, 1:2]  # targetVx, targetVy

# Training setup
model = DotBehaviorModel()
optimizer = torch.optim.Adam(model.parameters())
criterion = nn.MSELoss()

# ... training loop ...

# Export to ONNX
dummy_history = torch.randn(1, 10, 5)  # Example sequence
dummy_config = torch.randn(1, 1)

torch.onnx.export(
    model,
    (dummy_history, dummy_config),
    "dot_behavior.onnx",
    input_names=["history", "config"],
    output_names=["targetVx", "targetVy"],
    dynamic_axes={
        "history": {1: "seq_len"},  # Dynamic sequence length
    },
    opset_version=11
)
```

### TensorFlow/Keras Implementation

```python
import tensorflow as tf
import tf2onnx

# Create model
def create_model():
    # Define inputs
    history_input = tf.keras.Input(shape=(None, 5), name="history")  # Dynamic sequence
    config_input = tf.keras.Input(shape=(1,), name="config")
    
    # LSTM processing
    lstm_out = tf.keras.layers.LSTM(64, return_sequences=False)(history_input)
    
    # Combine with config
    combined = tf.keras.layers.Concatenate()([lstm_out, config_input])
    
    # Output velocities
    velocity = tf.keras.layers.Dense(2, activation='tanh')(combined)
    
    # Split outputs
    targetVx = tf.keras.layers.Lambda(lambda x: x[:, 0:1], name="targetVx")(velocity)
    targetVy = tf.keras.layers.Lambda(lambda x: x[:, 1:2], name="targetVy")(velocity)
    
    model = tf.keras.Model(
        inputs=[history_input, config_input],
        outputs=[targetVx, targetVy]
    )
    return model

model = create_model()
model.compile(optimizer='adam', loss='mse')

# ... training ...

# Export to ONNX
spec = (
    tf.TensorSpec((None, None, 5), tf.float32, name="history"),
    tf.TensorSpec((None, 1), tf.float32, name="config")
)

model_proto, _ = tf2onnx.convert.from_keras(
    model,
    input_signature=spec,
    opset=11,
    output_path="dot_behavior.onnx"
)
```

### Scikit-learn Implementation

```python
import numpy as np
from sklearn.ensemble import RandomForestRegressor
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
import skl2onnx
from skl2onnx import convert_sklearn
from skl2onnx.common.data_types import FloatTensorType

# Feature engineering function
def extract_features(history_seq, config_val):
    """Convert sequence to fixed-size features"""
    if len(history_seq) == 0:
        return np.zeros(15)  # 15 features + config
    
    recent = history_seq[-5:]  # Last 5 points
    
    features = []
    features.append(config_val)  # Config value
    
    # Distance and direction features
    last_point = recent[-1]
    features.extend([
        last_point[1] - last_point[3],  # dx (dot - mouse)
        last_point[2] - last_point[4],  # dy (dot - mouse)
        np.sqrt((last_point[1] - last_point[3])**2 + (last_point[2] - last_point[4])**2)  # distance
    ])
    
    # Movement features
    if len(recent) > 1:
        mouse_vx = recent[-1][3] - recent[-2][3]
        mouse_vy = recent[-1][4] - recent[-2][4]
        features.extend([mouse_vx, mouse_vy])
    else:
        features.extend([0, 0])
    
    # Statistical features
    mouse_positions = np.array([[p[3], p[4]] for p in recent])
    features.extend([
        np.mean(mouse_positions[:, 0]),  # mean mouse x
        np.mean(mouse_positions[:, 1]),  # mean mouse y
        np.std(mouse_positions[:, 0]),   # std mouse x
        np.std(mouse_positions[:, 1]),   # std mouse y
    ])
    
    # Pad to 15 features
    while len(features) < 15:
        features.append(0)
    
    return np.array(features[:15])

# Create pipeline
pipeline = Pipeline([
    ('scaler', StandardScaler()),
    ('regressor', RandomForestRegressor(n_estimators=100, random_state=42))
])

# Train (assuming you have processed training data)
# X_train should be 2D array of features, y_train should be [vx, vy] pairs
# pipeline.fit(X_train, y_train)

# Convert to ONNX
initial_type = [('float_input', FloatTensorType([None, 15]))]
onnx_model = convert_sklearn(
    pipeline, 
    initial_types=initial_type,
    target_opset=11
)

with open("dot_behavior.onnx", "wb") as f:
    f.write(onnx_model.SerializeToString())
```

## 📋 Export Instructions by Framework

### PyTorch → ONNX

```bash
pip install torch onnx
```

```python
# Key considerations:
torch.onnx.export(
    model,
    (dummy_history, dummy_config),
    "model.onnx",
    input_names=["history", "config"],
    output_names=["targetVx", "targetVy"],
    dynamic_axes={"history": {1: "seq_len"}},  # Critical for variable length!
    opset_version=11,  # Use 11+ for better compatibility
    do_constant_folding=True,  # Optimize the model
)
```

### TensorFlow → ONNX

```bash
pip install tensorflow tf2onnx
```

```python
# Method 1: Direct conversion
python -m tf2onnx.convert --saved-model model_dir --output model.onnx --opset 11

# Method 2: Programmatic
import tf2onnx
model_proto, _ = tf2onnx.convert.from_keras(model, opset=11, output_path="model.onnx")
```

### Scikit-learn → ONNX

```bash
pip install scikit-learn skl2onnx
```

```python
from skl2onnx import convert_sklearn
from skl2onnx.common.data_types import FloatTensorType

initial_type = [('float_input', FloatTensorType([None, num_features]))]
onnx_model = convert_sklearn(model, initial_types=initial_type, target_opset=11)
```

### JAX → ONNX

```bash
pip install jax jaxlib onnx
```

```python
# Convert JAX function to ONNX (more complex, requires custom implementation)
# Consider using jax2tf then tf2onnx as intermediate step
```

### XGBoost → ONNX

```bash
pip install xgboost onnxmltools
```

```python
from onnxmltools import convert_xgboost
from onnxmltools.convert.common.data_types import FloatTensorType

initial_types = [('float_input', FloatTensorType([None, num_features]))]
onnx_model = convert_xgboost(xgb_model, initial_types=initial_types, target_opset=11)
```

### ONNX Model Validation

After creating your ONNX model, validate it:

```python
import onnx
import onnxruntime as ort

# Load and check model
model = onnx.load("your_model.onnx")
onnx.checker.check_model(model)

# Test with ONNX Runtime
session = ort.InferenceSession("your_model.onnx")
print("Input names:", [input.name for input in session.get_inputs()])
print("Output names:", [output.name for output in session.get_outputs()])

# Test with dummy data
import numpy as np
dummy_history = np.random.randn(1, 10, 5).astype(np.float32)
dummy_config = np.array([[1.0]], dtype=np.float32)

result = session.run(None, {
    "history": dummy_history,
    "config": dummy_config
})
print("Output shapes:", [r.shape for r in result])
```

## 🎯 Deployment

1. **Replace the model**: Copy your `model.onnx` to `public/dummy_dot_behavior.onnx`
2. **Start the server**: Run `npm start` 
3. **Test in browser**: Visit `http://localhost:3000` and watch your AI in action!
4. **Debug**: Check browser console for AI status and error messages

Happy training! 🚀 Create the most challenging dot behavior possible!
