import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const preloadSource = readFileSync(new URL('../../public/preload.js', import.meta.url), 'utf8');

export function createPreloadSandbox(moduleOverrides = {}) {
  const sandbox = {
    Buffer,
    CustomEvent: class {
      constructor(type, options = {}) {
        this.type = type;
        this.detail = options.detail;
      }
    },
    TextDecoder,
    clearTimeout,
    console: { warn() {}, error() {}, log() {} },
    process: { env: { ...process.env }, execPath: process.execPath, platform: process.platform, once() {}, exit() {} },
    require(moduleName) {
      if (Object.hasOwn(moduleOverrides, moduleName)) return moduleOverrides[moduleName];
      if (moduleName === 'electron') {
        return {
          shell: { openExternal: () => Promise.resolve(), openPath: () => Promise.resolve(), showItemInFolder() {} },
        };
      }
      return require(moduleName);
    },
    setTimeout,
    window: {
      dispatchEvent() {},
      localStorage: { getItem: () => null, setItem() {} },
      utools: { onPluginOut() {} },
    },
  };
  sandbox.globalThis = sandbox;
  runInNewContext(preloadSource, sandbox, { filename: 'public/preload.js' });
  return sandbox;
}
