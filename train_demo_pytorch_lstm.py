#!/usr/bin/env python3
"""
Train a PyTorch LSTM model to maximize distance between dot and user.
Load data from parquet, train model, and export to ONNX.
"""

import os

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import torch
import torch.nn as nn
import torch.optim as optim
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from torch.utils.data import DataLoader, Dataset
from tqdm import tqdm

# Set random seeds for reproducibility
torch.manual_seed(42)
np.random.seed(42)


class DotBehaviorDataset(Dataset):
    """Dataset for training dot behavior model"""

    def __init__(
        self, sequences, targets, scaler_X=None, scaler_y=None, fit_scalers=True
    ):
        self.sequences = sequences
        self.targets = targets

        # Initialize scalers
        if scaler_X is None:
            self.scaler_X = StandardScaler()
        else:
            self.scaler_X = scaler_X

        if scaler_y is None:
            self.scaler_y = StandardScaler()
        else:
            self.scaler_y = scaler_y

        # Fit scalers if needed
        if fit_scalers and scaler_X is None:
            # Reshape sequences for scaling: (n_samples * seq_len, n_features)
            seq_reshaped = sequences.reshape(-1, sequences.shape[-1])
            self.scaler_X.fit(seq_reshaped)

        if fit_scalers and scaler_y is None:
            self.scaler_y.fit(targets)

        # Scale the data
        self.sequences_scaled = self._scale_sequences(sequences)
        self.targets_scaled = self.scaler_y.transform(targets)

    def _scale_sequences(self, sequences):
        """Scale sequences while preserving shape"""
        original_shape = sequences.shape
        seq_reshaped = sequences.reshape(-1, sequences.shape[-1])
        seq_scaled = self.scaler_X.transform(seq_reshaped)
        return seq_scaled.reshape(original_shape)

    def __len__(self):
        return len(self.sequences)

    def __getitem__(self, idx):
        return (
            torch.FloatTensor(self.sequences_scaled[idx]),
            torch.FloatTensor(self.targets_scaled[idx]),  # type: ignore
        )


class DotBehaviorLSTM(nn.Module):
    """Simple 1-layer LSTM for dot behavior prediction"""

    def __init__(self, input_size=4, hidden_size=64, output_size=2, dropout=0.2):
        super(DotBehaviorLSTM, self).__init__()

        self.hidden_size = hidden_size
        # Remove dropout from LSTM since we only have 1 layer
        self.lstm = nn.LSTM(input_size, hidden_size, batch_first=True)
        self.fc = nn.Linear(hidden_size + 1, output_size)  # +1 for config
        self.dropout = nn.Dropout(dropout)

    def forward(self, history, config):
        # history: [batch_size, seq_len, 4]
        # config: [batch_size, 1]

        # LSTM forward pass
        lstm_out, (hidden, cell) = self.lstm(history)

        # Take the last output
        last_output = lstm_out[:, -1, :]  # [batch_size, hidden_size]

        # Apply dropout
        last_output = self.dropout(last_output)

        # Concatenate with config
        combined = torch.cat([last_output, config], dim=1)

        # Final prediction
        output = self.fc(combined)

        # Split into targetVx and targetVy
        targetVx = output[:, 0:1]
        targetVy = output[:, 1:2]

        return targetVx, targetVy


def load_and_prepare_data(data_path, sequence_length=10, min_session_length=20):
    """Load parquet data and prepare sequences for training"""

    print(f"Loading data from {data_path}...")
    df = pd.read_parquet(data_path)

    print(f"Loaded {len(df)} records")
    print(f"Columns: {df.columns.tolist()}")
    print(f"Sample data:\n{df.head()}")

    # Group by session
    sessions = df.groupby("sessionUid")

    sequences = []
    targets = []
    configs = []

    print("Preparing sequences...")

    for session_uid, session_data in tqdm(sessions):
        if len(session_data) < min_session_length:
            continue

        # Sort by timestamp
        session_data = session_data.sort_values("timestamp")

        # Extract features: [dotX, dotY, mouseX, mouseY]
        features = session_data[["dotX", "dotY", "mouseX", "mouseY"]].values

        # Normalize timestamps relative to start
        # (Skip timestamp normalization since we're not using timestamps)

        # Get max speed for this session
        max_speed = session_data["maxSpeed"].iloc[0]

        # Create sequences
        for i in range(sequence_length, len(features)):
            # Input sequence
            seq = features[i - sequence_length : i].copy()

            # Current state
            current_dot_x = features[i, 0]
            current_dot_y = features[i, 1]
            current_mouse_x = features[i, 2]
            current_mouse_y = features[i, 3]

            # Calculate ideal escape velocity to maximize distance
            # Direction away from mouse
            dx = current_dot_x - current_mouse_x
            dy = current_dot_y - current_mouse_y
            distance = np.sqrt(dx**2 + dy**2)

            if distance > 0:
                # Normalize direction and scale by max speed
                escape_vx = (
                    (dx / distance) * max_speed * 100
                )  # Convert to pixels/second
                escape_vy = (dy / distance) * max_speed * 100
            else:
                # If mouse is exactly on dot, move randomly
                angle = np.random.uniform(0, 2 * np.pi)
                escape_vx = np.cos(angle) * max_speed * 100
                escape_vy = np.sin(angle) * max_speed * 100

            # Add some randomness to make the behavior more interesting
            noise_factor = 0.3
            escape_vx += np.random.normal(0, noise_factor * max_speed * 100)
            escape_vy += np.random.normal(0, noise_factor * max_speed * 100)

            sequences.append(seq)
            targets.append([escape_vx, escape_vy])
            configs.append([max_speed])

    print(f"Created {len(sequences)} training sequences")

    return np.array(sequences), np.array(targets), np.array(configs)


def train_model(model, train_loader, val_loader, num_epochs=50, learning_rate=0.001):
    """Train the LSTM model"""

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Training on device: {device}")

    model.to(device)

    criterion = nn.MSELoss()
    optimizer = optim.Adam(model.parameters(), lr=learning_rate, weight_decay=1e-5)
    scheduler = optim.lr_scheduler.ReduceLROnPlateau(optimizer, patience=5, factor=0.5)

    train_losses = []
    val_losses = []

    print("Starting training...")

    for epoch in range(num_epochs):
        # Training phase
        model.train()
        train_loss = 0.0

        for sequences, targets in train_loader:
            sequences = sequences.to(device)
            targets = targets.to(device)

            # Create config tensor (max speed normalized)
            batch_size = sequences.shape[0]
            config = torch.ones(batch_size, 1, device=device)  # Placeholder config

            optimizer.zero_grad()

            # Forward pass
            pred_vx, pred_vy = model(sequences, config)
            pred = torch.cat([pred_vx, pred_vy], dim=1)

            # Calculate loss
            loss = criterion(pred, targets)

            # Backward pass
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
            optimizer.step()

            train_loss += loss.item()

        # Validation phase
        model.eval()
        val_loss = 0.0

        with torch.no_grad():
            for sequences, targets in val_loader:
                sequences = sequences.to(device)
                targets = targets.to(device)

                batch_size = sequences.shape[0]
                config = torch.ones(batch_size, 1, device=device)

                pred_vx, pred_vy = model(sequences, config)
                pred = torch.cat([pred_vx, pred_vy], dim=1)

                loss = criterion(pred, targets)
                val_loss += loss.item()

        # Calculate average losses
        avg_train_loss = train_loss / len(train_loader)
        avg_val_loss = val_loss / len(val_loader)

        train_losses.append(avg_train_loss)
        val_losses.append(avg_val_loss)

        # Update learning rate
        scheduler.step(avg_val_loss)

        if epoch % 5 == 0:
            print(
                f"Epoch [{epoch + 1}/{num_epochs}], Train Loss: {avg_train_loss:.4f}, Val Loss: {avg_val_loss:.4f}"
            )

    return train_losses, val_losses


def export_to_onnx(model, output_path, sequence_length=10):
    """Export trained model to ONNX format"""

    print(f"Exporting model to {output_path}...")

    # Move model to CPU for ONNX export
    model.cpu()
    model.eval()

    # Create dummy inputs on CPU
    dummy_history = torch.randn(1, sequence_length, 4)
    dummy_config = torch.randn(1, 1)

    # Export to ONNX
    torch.onnx.export(
        model,
        (dummy_history, dummy_config),
        output_path,
        input_names=["history", "config"],
        output_names=["targetVx", "targetVy"],
        dynamic_axes={
            "history": {1: "seq_len"},  # Dynamic sequence length
        },
        opset_version=14,
        do_constant_folding=True,
        verbose=False,
    )

    print(f"✅ Model exported to {output_path}")


def main():
    # Configuration
    data_path = "data/game_dataset.parquet"
    model_path = "public/pytorch_dot_behavior.onnx"
    sequence_length = 10
    batch_size = 64
    num_epochs = 30
    learning_rate = 0.001

    # Check if data exists
    if not os.path.exists(data_path):
        print(f"❌ Data file not found: {data_path}")
        print("Please make sure the game dataset exists.")
        return

    # Load and prepare data
    sequences, targets, configs = load_and_prepare_data(
        data_path, sequence_length=sequence_length
    )

    if len(sequences) == 0:
        print("❌ No training data could be prepared")
        return

    # Split data
    X_train, X_val, y_train, y_val = train_test_split(
        sequences, targets, test_size=0.2, random_state=42
    )

    print(f"Training set: {len(X_train)} samples")
    print(f"Validation set: {len(X_val)} samples")

    # Create datasets
    train_dataset = DotBehaviorDataset(X_train, y_train, fit_scalers=True)
    val_dataset = DotBehaviorDataset(
        X_val,
        y_val,
        scaler_X=train_dataset.scaler_X,
        scaler_y=train_dataset.scaler_y,
        fit_scalers=False,
    )

    # Create data loaders
    train_loader = DataLoader(train_dataset, batch_size=batch_size, shuffle=True)
    val_loader = DataLoader(val_dataset, batch_size=batch_size, shuffle=False)

    # Create model
    model = DotBehaviorLSTM(input_size=4, hidden_size=64, output_size=2, dropout=0.2)

    print(f"Model architecture:\n{model}")

    # Train model
    train_losses, val_losses = train_model(
        model,
        train_loader,
        val_loader,
        num_epochs=num_epochs,
        learning_rate=learning_rate,
    )

    # Plot training curves
    plt.figure(figsize=(10, 6))
    plt.plot(train_losses, label="Training Loss")
    plt.plot(val_losses, label="Validation Loss")
    plt.xlabel("Epoch")
    plt.ylabel("Loss")
    plt.title("Training and Validation Loss")
    plt.legend()
    plt.grid(True)
    plt.show()

    # Export to ONNX
    export_to_onnx(model, model_path, sequence_length)

    print("✅ Training completed successfully!")
    print(f"🎯 ONNX model saved to: {model_path}")
    print("🚀 Ready to start server with custom ONNX model!")


if __name__ == "__main__":
    main()
