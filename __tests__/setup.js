/**
 * Jest测试环境配置
 */

// 模拟Canvas API（node 测试环境无 DOM，跳过）
if (typeof HTMLCanvasElement !== 'undefined') {
HTMLCanvasElement.prototype.getContext = function (type) {
  if (type === '2d') {
    return {
      fillRect: jest.fn(),
      clearRect: jest.fn(),
      getImageData: jest.fn(() => ({ data: [] })),
      putImageData: jest.fn(),
      createImageData: jest.fn(() => []),
      setTransform: jest.fn(),
      drawImage: jest.fn(),
      save: jest.fn(),
      fillText: jest.fn(),
      restore: jest.fn(),
      beginPath: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      closePath: jest.fn(),
      stroke: jest.fn(),
      translate: jest.fn(),
      scale: jest.fn(),
      rotate: jest.fn(),
      arc: jest.fn(),
      fill: jest.fn(),
      measureText: jest.fn(() => ({ width: 0 })),
      transform: jest.fn(),
      rect: jest.fn(),
      clip: jest.fn(),
      strokeRect: jest.fn(),
      strokeText: jest.fn(),
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      font: '',
      textAlign: '',
      textBaseline: '',
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      canvas: this,
    };
  }
  return null;
};
}

// 模拟requestAnimationFrame
global.requestAnimationFrame = (callback) => setTimeout(callback, 16);
global.cancelAnimationFrame = (id) => clearTimeout(id);

// 模拟performance.now
if (!global.performance) {
  global.performance = {};
}
if (!global.performance.now) {
  global.performance.now = () => Date.now();
}

// structuredClone polyfill（fake-indexeddb 需要，但 jsdom 不带）
if (!global.structuredClone) {
  global.structuredClone = (val) => JSON.parse(JSON.stringify(val));
}

// jsdom 环境无全局 fetch（CI 的 Node 下 `fetch is not defined`）。
// 测试不应打真实网络——提供一个立即拒绝的兜底，让 AI 调用走本地兜底叙事而非抛错。
// 需要验证 AI 成功路径的用例自行 mock global.fetch（会覆盖此兜底）。
if (!global.fetch) {
  global.fetch = () => Promise.reject(new Error('fetch is disabled in tests'));
}
