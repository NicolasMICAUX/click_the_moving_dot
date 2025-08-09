#!/usr/bin/env python3
"""
Create a very simple ONNX model with explicit version control.
"""

import onnx
from onnx import TensorProto, helper


def main():
    # Define inputs
    input_history = helper.make_tensor_value_info("history", TensorProto.FLOAT, [1, 25])
    input_config = helper.make_tensor_value_info("config", TensorProto.FLOAT, [1])

    # Define outputs
    output_vx = helper.make_tensor_value_info("targetVx", TensorProto.FLOAT, [1])
    output_vy = helper.make_tensor_value_info("targetVy", TensorProto.FLOAT, [1])

    # Create constant outputs (30.0, -30.0)
    vx_node = helper.make_node(
        "Constant",
        inputs=[],
        outputs=["targetVx"],
        value=helper.make_tensor(
            name="vx_value", data_type=TensorProto.FLOAT, dims=[1], vals=[30.0]
        ),
    )

    vy_node = helper.make_node(
        "Constant",
        inputs=[],
        outputs=["targetVy"],
        value=helper.make_tensor(
            name="vy_value", data_type=TensorProto.FLOAT, dims=[1], vals=[-30.0]
        ),
    )

    # Create the graph
    graph = helper.make_graph(
        nodes=[vx_node, vy_node],
        name="SimpleDotBehavior",
        inputs=[input_history, input_config],
        outputs=[output_vx, output_vy],
    )

    # Create the model with explicit version settings
    model = helper.make_model(graph, producer_name="click-the-dot")

    # Force IR version to be compatible with ONNX Runtime Web 1.14.0
    model.ir_version = 6  # This is critical!
    model.opset_import[0].version = 8

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
    print(f"✅ Saved model to: {output_path}")


if __name__ == "__main__":
    main()
