let renderCallback = null;

/**
 * Register the main render scheduler callback (from main.js).
 * @param {() => void} cb
 */
export function setRenderCallback(cb) {
  renderCallback = cb;
}

/**
 * Request an on-demand WebGL render on the next animation frame.
 */
export function requestRender() {
  if (renderCallback) renderCallback();
}
