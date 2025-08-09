#!/usr/bin/env python3
"""
Create a simple dummy ONNX model with dynamic sequence length [seq_len, 5].
This is a minimal example that demonstrates variable-length input sequences
with basic mathematical operations - perfect for swapping in more sophisticated AI models.
"""

import onnx
from onnx import TensorProto, helper


def create_dummy_model():
    """Create a simple dummy model that handles variable sequence lengths - easy to replace with real AI!"""

    # Define inputs with dynamic sequence length
    # history: [seq_len, 6] where seq_len can vary
    # Field order: timestamp, dotX, dotY, mouseX, mouseY, mouseDown
    input_history = helper.make_tensor_value_info(
        "history", TensorProto.FLOAT, [None, 6]
    )
    input_config = helper.make_tensor_value_info("config", TensorProto.FLOAT, [1])

    # Define outputs
    output_vx = helper.make_tensor_value_info("targetVx", TensorProto.FLOAT, [1])
    output_vy = helper.make_tensor_value_info("targetVy", TensorProto.FLOAT, [1])

    # Simple dummy approach: Just sum all history and use basic math
    # This is intentionally simple - replace with your own AI logic!

    # Step 1: Create axes tensor for ReduceSum (needed for opset 13+)
    axes_tensor = helper.make_tensor(
        "axes",
        TensorProto.INT64,
        [1],
        [0],  # Sum across sequence dimension
    )

    # Step 1: Sum all values in the history (shape: [seq_len, 6] -> [6])
    sum_node = helper.make_node(
        "ReduceSum",
        inputs=["history", "axes"],
        outputs=["sum_history"],
    )

    # Step 2: Create a simple behavior based on the sums
    # Use mathematical operations that work well in opset 8

    # Extract some values by multiplying with weights (updated for 6 features)
    weight_dot_x = helper.make_tensor(
        "weight_dot_x", TensorProto.FLOAT, [6], [0.0, 0.1, 0.0, -0.1, 0.0, 0.05]
    )
    weight_dot_y = helper.make_tensor(
        "weight_dot_y", TensorProto.FLOAT, [6], [0.0, 0.0, 0.1, 0.0, -0.1, 0.05]
    )

    # Calculate weighted sums (this simulates extracting relevant features)
    dot_influence_x = helper.make_node(
        "MatMul", inputs=["sum_history", "weight_dot_x"], outputs=["influence_x"]
    )
    dot_influence_y = helper.make_node(
        "MatMul", inputs=["sum_history", "weight_dot_y"], outputs=["influence_y"]
    )

    # Scale by config and add some simple dynamics
    config_mult_x = helper.make_tensor("config_mult_x", TensorProto.FLOAT, [], [30.0])
    config_mult_y = helper.make_tensor("config_mult_y", TensorProto.FLOAT, [], [25.0])

    # Apply config scaling
    scale_x_node = helper.make_node(
        "Mul", inputs=["config", "config_mult_x"], outputs=["scale_x"]
    )
    scale_y_node = helper.make_node(
        "Mul", inputs=["config", "config_mult_y"], outputs=["scale_y"]
    )

    # Final velocities with scaling
    vx_node = helper.make_node(
        "Mul", inputs=["influence_x", "scale_x"], outputs=["targetVx"]
    )
    vy_node = helper.make_node(
        "Mul", inputs=["influence_y", "scale_y"], outputs=["targetVy"]
    )

    # Create the graph
    graph = helper.make_graph(
        nodes=[
            sum_node,
            dot_influence_x,
            dot_influence_y,
            scale_x_node,
            scale_y_node,
            vx_node,
            vy_node,
        ],
        name="DummyDotBehavior",
        inputs=[input_history, input_config],
        outputs=[output_vx, output_vy],
        initializer=[
            axes_tensor,
            weight_dot_x,
            weight_dot_y,
            config_mult_x,
            config_mult_y,
        ],
    )

    # Create model with compatible versions
    model = helper.make_model(graph, producer_name="dynamic-dot-behavior")
    model.ir_version = 9  # Compatible with ONNX Runtime Web 1.22.0
    model.opset_import[0].version = 14  # Well-tested opset version

    return model


def main():
    print("Creating simple dummy ONNX model with dynamic sequence length...")

    model = create_dummy_model()

    print(f"Model IR version: {model.ir_version}")
    print(f"Model opset version: {model.opset_import[0].version}")

    # Validate
    try:
        onnx.checker.check_model(model)
        print("✅ Model validation passed")
    except Exception as e:
        print(f"❌ Model validation failed: {e}")
        return

    # Save
    output_path = "public/dummy_dot_behavior.onnx"
    onnx.save(model, output_path)
    print(f"✅ Saved dummy model to: {output_path}")
    print("\nThis dummy model accepts variable sequence lengths [seq_len, 6]")
    print("Field order: timestamp, dotX, dotY, mouseX, mouseY, mouseDown")
    print("Replace this file with your own AI model to change dot behavior!")


if __name__ == "__main__":
    main()
