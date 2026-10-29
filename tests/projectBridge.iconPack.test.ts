import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { gzipSync } from "node:zlib";
import { createRequire } from "node:module";
import { createContext, runInContext } from "node:vm";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { IconPackManifest, ProjectBridge } from "../src/types";

const createManifest = (version: string): IconPackManifest => {
  const svg = (label: string) =>
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><title>${label}</title></svg>`).toString("base64");
  return {
    schemaVersion: 1,
    id: "vscode-icons-derived",
    name: "vscode-icons (derived)",
    version,
    source: {
      repository: "vscode-icons/vscode-icons",
      version: "12.19.0",
      url: "https://github.com/vscode-icons/vscode-icons",
    },
    mappings: {
      fileNames: { "readme.md": { dark: "file" } },
      fileSuffixes: { ".ts": { dark: "file" } },
      folderNames: { src: { dark: "folder" } },
      folderNamesExpanded: { src: { dark: "folder-open" } },
      defaults: {
        file: { dark: "file" },
        folder: { dark: "folder" },
        folderExpanded: { dark: "folder-open" },
      },
    },
    assets: {
      file: { format: "svg", encoding: "base64", data: svg("file") },
      folder: { format: "svg", encoding: "base64", data: svg("folder") },
      "folder-open": { format: "svg", encoding: "base64", data: svg("folder-open") },
    },
    notices: [
      { id: "source", license: "MIT", text: "source", appliesTo: "source code" },
      { id: "assets", license: "CC BY-SA 4.0", text: "assets", appliesTo: "icon assets" },
      { id: "branded", license: "varies", text: "branded", appliesTo: "branded icons" },
    ],
  };
};

const createReleaseResponses = (
  manifest: IconPackManifest,
  expectedHash = "",
  packageBytes = gzipSync(Buffer.from(JSON.stringify(manifest))),
) => {
  const assetName = `utools-project-launch-vscode-icons-derived-${manifest.version}.iconpack.json.gz`;
  const checksum = expectedHash || createHash("sha256").update(packageBytes).digest("hex");
  const checksumBytes = Buffer.from(`${checksum}  ${assetName}\n`);
  const baseUrl = "https://github.com/Wwyxa/utools-project-launch/releases/download/icon-pack/";
  return [
    {
      contents: Buffer.from(
        JSON.stringify([
          {
            tag_name: `icon-pack-v${manifest.version}`,
            draft: false,
            prerelease: false,
            assets: [
              { name: assetName, size: packageBytes.length, browser_download_url: `${baseUrl}${assetName}` },
              { name: "checksums.txt", size: checksumBytes.length, browser_download_url: `${baseUrl}checksums.txt` },
            ],
          },
        ]),
      ),
    },
    { contents: checksumBytes },
    { contents: packageBytes },
  ];
};

const createHttpsMock = (responses: Array<{ contents?: Buffer; location?: string; chunkSize?: number }>) => ({
  get: vi.fn((_options: unknown, callback: (response: EventEmitter) => void) => {
    const next = responses.shift();
    if (!next) throw new Error("unexpected icon-pack request");
    const request = new EventEmitter() as EventEmitter & { destroy: (error?: Error) => void };
    request.destroy = (error) => {
      if (error) queueMicrotask(() => request.emit("error", error));
    };
    queueMicrotask(() => {
      const response = new EventEmitter() as EventEmitter & {
        statusCode: number;
        headers: Record<string, string>;
        resume: () => void;
        destroy: () => void;
      };
      response.statusCode = next.location ? 302 : 200;
      response.headers = next.location
        ? { location: next.location }
        : { "content-length": String(next.contents?.length || 0) };
      response.resume = () => undefined;
      response.destroy = () => undefined;
      callback(response);
      if (next.contents) {
        const chunkSize =
          typeof next.chunkSize === "number" && Number.isInteger(next.chunkSize) && next.chunkSize > 0
            ? next.chunkSize
            : next.contents.length;
        for (let offset = 0; offset < next.contents.length; offset += chunkSize) {
          response.emit("data", next.contents.subarray(offset, offset + chunkSize));
        }
        response.emit("end");
      }
    });
    return request;
  }),
});

const loadPreloadBridge = (
  storage: Map<string, unknown>,
  httpsMock: unknown,
  environment: NodeJS.ProcessEnv = {},
  onEvent?: (detail: unknown) => void,
): ProjectBridge => {
  const nodeRequire = createRequire(import.meta.url);
  class SandboxCustomEvent {
    readonly type: string;
    readonly detail: unknown;

    constructor(type: string, init?: { detail?: unknown }) {
      this.type = type;
      this.detail = init?.detail;
    }
  }
  const sandboxWindow: {
    projectBridge?: ProjectBridge;
    utools: {
      dbStorage: {
        getItem: (key: string) => unknown;
        setItem: (key: string, value: unknown) => void;
        removeItem: (key: string) => void;
      };
    };
    dispatchEvent: (event: SandboxCustomEvent) => boolean;
  } = {
    utools: {
      dbStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: unknown) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
    },
    dispatchEvent: (event: SandboxCustomEvent) => {
      onEvent?.(event.detail);
      return true;
    },
  };
  const sandbox = {
    require: (id: string) => (id === "https" ? httpsMock : id === "electron" ? { shell: {} } : nodeRequire(id)),
    process: {
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
      env: { ...process.env, ...environment },
      kill: process.kill.bind(process),
      once: () => undefined,
      exit: () => undefined,
    },
    Buffer,
    console,
    CustomEvent: SandboxCustomEvent,
    URL,
    setTimeout,
    clearTimeout,
    window: sandboxWindow,
  };
  createContext(sandbox);
  runInContext(readFileSync(resolve("public/preload.js"), "utf8"), sandbox);
  if (!sandboxWindow.projectBridge) throw new Error("The real preload did not register projectBridge.");
  return sandboxWindow.projectBridge as ProjectBridge;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("uTools icon-pack preload", () => {

  it("preserves the previous valid package after checksum failure", async () => {
    const applicationDirectory = mkdtempSync(join(tmpdir(), "utools-icon-pack-"));
    try {
      const firstManifest = createManifest("1.0.0");
      const secondManifest = createManifest("2.0.0");
      const storage = new Map<string, unknown>();
      const bridge = loadPreloadBridge(storage, createHttpsMock(createReleaseResponses(firstManifest)), {
        UTOOLS_PROJECT_LAUNCH_LOCAL_DATA_DIR: applicationDirectory,
      });
      expect((await bridge.downloadIconPack()).ok).toBe(true);

      const secondPackage = gzipSync(Buffer.from(JSON.stringify(secondManifest)));
      const failedUpdateBridge = loadPreloadBridge(
        storage,
        createHttpsMock(createReleaseResponses(secondManifest, "0".repeat(64), secondPackage)),
        { UTOOLS_PROJECT_LAUNCH_LOCAL_DATA_DIR: applicationDirectory },
      );
      const result = await failedUpdateBridge.downloadIconPack();
      expect(result).toMatchObject({ ok: false, state: "loaded", manifest: firstManifest });
      expect(await failedUpdateBridge.loadInstalledIconPack()).toMatchObject({ ok: true, manifest: firstManifest });
    } finally {
      rmSync(applicationDirectory, { recursive: true, force: true });
    }
  });

  it("rejects a release manifest with path-bearing mapping keys", async () => {
    const applicationDirectory = mkdtempSync(join(tmpdir(), "utools-icon-pack-"));
    try {
      const manifest = createManifest("1.0.0");
      manifest.mappings.fileNames = { "nested/readme.md": { dark: "file" } };
      const bridge = loadPreloadBridge(new Map(), createHttpsMock(createReleaseResponses(manifest)), {
        UTOOLS_PROJECT_LAUNCH_LOCAL_DATA_DIR: applicationDirectory,
      });

      await expect(bridge.downloadIconPack()).resolves.toMatchObject({
        ok: false,
        state: "unavailable",
        manifest: null,
      });
      expect(existsSync(join(applicationDirectory, "icon-packs", "vscode-icons-derived"))).toBe(false);
    } finally {
      rmSync(applicationDirectory, { recursive: true, force: true });
    }
  });
});
