// src/dot_behavior.js
// Default dot behavior logic and ONNX.js integration

// Default behavior: simple escape logic
function defaultDotBehavior(history, config) {
    const latest = history[history.length - 1];
    if (!latest) return { targetVx: 0, targetVy: 0 };
    const dx = latest.dotX - latest.mouseX;
    const dy = latest.dotY - latest.mouseY;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const speed = config.maxSpeed || 1;
    return {
        targetVx: (dx / dist) * speed,
        targetVy: (dy / dist) * speed
    };
}

// ONNX.js browser integration (onnxruntime-web)
// Usage: see public/index.html for browser code
// This file only provides the default behavior for Node/server

// Dummy browser API for documentation
// In browser, use:
//   <script src="https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.min.js"></script>
//   const session = await ort.InferenceSession.create('/dummy_dot_behavior.onnx');
//   const input = { history: new ort.Tensor('float32', [...], [1,5]), config: new ort.Tensor('float32', [...], [1]) };
//   const output = await session.run(input);
//   output.targetVx.data[0], output.targetVy.data[0]

module.exports = {
    defaultDotBehavior
};
