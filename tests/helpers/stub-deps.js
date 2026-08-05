/**
 * 测试桩：通过 require.cache 注入 scanner / player-server / player-browser 桩，
 * 避免 player-manager 加载时触发真实 player-server 的 pkill / 声卡副作用。
 * 每个 node --test worker 独立，互不污染。
 */
const Module = require('module');
const path = require('path');

const svcDir = path.join(__dirname, '..', '..', 'services');

function installStubs() {
  const scannerStub = { toAbsPath: (p) => p };
  const playerServerStub = {
    play: () => {}, stop: () => {}, pause: () => {}, resume: () => {},
    getVolume: () => 50, setVolume: () => 50,
  };
  const playerBrowserStub = { streamUrl: (f) => '/api/stream?f=' + encodeURIComponent(f) };

  const inject = (rel, stub) => {
    const fakePath = path.join(svcDir, rel + '.js');
    const m = new Module(fakePath, module);
    m.filename = fakePath;
    m.loaded = true;
    m.paths = Module._nodeModulePaths(path.dirname(fakePath));
    m.exports = stub;
    require.cache[fakePath] = m;
  };
  inject('scanner', scannerStub);
  inject('player-server', playerServerStub);
  inject('player-browser', playerBrowserStub);
  return { scannerStub, playerServerStub, playerBrowserStub };
}

module.exports = { installStubs };
