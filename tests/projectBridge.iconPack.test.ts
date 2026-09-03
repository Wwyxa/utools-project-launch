import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { gzipSync } from "node:zlib";
import { createRequire } from "node:module";
import { createContext, runInContext } from "node:vm";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { getProjectBridge } from "../src/lib/projectBridge";
import type { IconPackManifest, ProjectBridge, UiPreferences } from "../src/types";

const uiPreferencesKey = "utools-project-launch.ui-preferences.v1";
const defaultUiPreferences: UiPreferences = {
  schemaVersion: 1,
  iconPackId: "builtin",
  projectDetails: { tabOrder: ["info", "scripts", "automation", "files", "git", "memo"], defaultTab: "scripts" },
  dashboard: { tinyCardActionTrigger: "hover" },
  coachMarks: { projectDetailsTabReorder: 0, projectDetailsTabDefault: 0 },
};

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
          Number.isInteger(next.chunkSize) && next.chunkSize > 0 ? next.chunkSize : next.contents.length;
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

describe("icon-pack browser fallback", () => {
  it("reports unavailable and never reports a successful installation", async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("window", {
      navigator: { platform: "", userAgent: "vitest" },
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
    });

    const bridge = getProjectBridge();
    expect(await bridge.loadInstalledIconPack()).toMatchObject({ ok: false, state: "unavailable", manifest: null });
    expect(await bridge.downloadIconPack()).toMatchObject({ ok: false, state: "unavailable", manifest: null });
    expect(await bridge.removeIconPack()).toMatchObject({ ok: false, status: { active: false } });
  });
});

describe("uTools icon-pack preload", () => {
  it("verifies a manually placed release asset and creates the trusted install record", async () => {
    const applicationDirectory = mkdtempSync(join(tmpdir(), "utools-icon-pack-"));
    try {
      const manifest = createManifest("1.0.0");
      const responses = createReleaseResponses(manifest);
      const packageBytes = responses[2]?.contents;
      if (!packageBytes) throw new Error("missing test package bytes");
      const assetName = `utools-project-launch-vscode-icons-derived-${manifest.version}.iconpack.json.gz`;
      const installDirectory = join(applicationDirectory, "icon-packs", "vscode-icons-derived");
      mkdirSync(installDirectory, { recursive: true });
      writeFileSync(join(installDirectory, assetName), packageBytes);

      const bridge = loadPreloadBridge(new Map(), createHttpsMock([]), {
        UTOOLS_PROJECT_LAUNCH_DEVICE_ID_DIR: applicationDirectory,
      });

      expect(await bridge.verifyIconPackInstall()).toMatchObject({ ok: true, state: "loaded", manifest });
      expect(existsSync(join(installDirectory, "pack.json.gz"))).toBe(true);
      expect(existsSync(join(installDirectory, "install.json"))).toBe(true);
      expect(existsSync(join(installDirectory, assetName))).toBe(false);
    } finally {
      rmSync(applicationDirectory, { recursive: true, force: true });
    }
  });

  it("installs the official package, reloads it, and removes an active package safely", async () => {
    const applicationDirectory = mkdtempSync(join(tmpdir(), "utools-icon-pack-"));
    try {
      const manifest = createManifest("1.0.0");
      const bridge = loadPreloadBridge(new Map(), createHttpsMock(createReleaseResponses(manifest)), {
        UTOOLS_PROJECT_LAUNCH_DEVICE_ID_DIR: applicationDirectory,
      });

      expect(await bridge.getIconPackStatus()).toMatchObject({ state: "unavailable", active: false });
      expect(await bridge.downloadIconPack()).toMatchObject({ ok: true, state: "loaded", manifest });
      expect(await bridge.loadInstalledIconPack()).toMatchObject({ ok: true, manifest });

      const storage = new Map<string, unknown>([[uiPreferencesKey, defaultUiPreferences]]);
      const activeBridge = loadPreloadBridge(storage, createHttpsMock([]), {
        UTOOLS_PROJECT_LAUNCH_DEVICE_ID_DIR: applicationDirectory,
      });
      activeBridge.saveUiPreferences({ ...defaultUiPreferences, iconPackId: "vscode-icons-derived" });
      expect(await activeBridge.getIconPackStatus()).toMatchObject({
        state: "installed",
        installedPackId: manifest.id,
        active: true,
      });
      const removeResult = await activeBridge.removeIconPack();
      expect(removeResult).toMatchObject({ ok: true, status: { state: "unavailable", active: false } });
      expect(activeBridge.loadUiPreferences().iconPackId).toBe("builtin");
      expect(existsSync(join(applicationDirectory, "icon-packs", "vscode-icons-derived"))).toBe(false);
    } finally {
      rmSync(applicationDirectory, { recursive: true, force: true });
    }
  });

  it("emits percentage progress while downloading the icon pack", async () => {
    const applicationDirectory = mkdtempSync(join(tmpdir(), "utools-icon-pack-"));
    try {
      const manifest = createManifest("1.0.0");
      const responses = createReleaseResponses(manifest);
      const packageBytes = responses[2]?.contents;
      if (!packageBytes) throw new Error("missing test package bytes");
      const downloadResponses = responses.map((response, index) =>
        index === 2 ? { ...response, chunkSize: Math.ceil(packageBytes.length / 2) } : response,
      );
      const progressEvents: Array<{
        type?: string;
        percent?: number;
        receivedBytes?: number;
        totalBytes?: number;
      }> = [];
      const bridge = loadPreloadBridge(
        new Map(),
        createHttpsMock(downloadResponses),
        { UTOOLS_PROJECT_LAUNCH_DEVICE_ID_DIR: applicationDirectory },
        (detail) => {
          if (detail && typeof detail === "object") {
            progressEvents.push(
              detail as { type?: string; percent?: number; receivedBytes?: number; totalBytes?: number },
            );
          }
        },
      );

      await bridge.downloadIconPack();

      expect(progressEvents.filter((event) => event.type === "icon-pack-download-progress")).toEqual([
        {
          type: "icon-pack-download-progress",
          receivedBytes: 0,
          totalBytes: packageBytes.length,
          percent: 0,
          timestamp: expect.any(String),
        },
        {
          type: "icon-pack-download-progress",
          receivedBytes: Math.ceil(packageBytes.length / 2),
          totalBytes: packageBytes.length,
          percent: Math.floor((Math.ceil(packageBytes.length / 2) / packageBytes.length) * 100),
          timestamp: expect.any(String),
        },
        {
          type: "icon-pack-download-progress",
          receivedBytes: packageBytes.length,
          totalBytes: packageBytes.length,
          percent: 100,
          timestamp: expect.any(String),
        },
      ]);
    } finally {
      rmSync(applicationDirectory, { recursive: true, force: true });
    }
  });

  it("reports an available official release without downloading the package", async () => {
    const applicationDirectory = mkdtempSync(join(tmpdir(), "utools-icon-pack-"));
    try {
      const manifest = createManifest("2.0.0");
      const bridge = loadPreloadBridge(new Map(), createHttpsMock(createReleaseResponses(manifest)), {
        UTOOLS_PROJECT_LAUNCH_DEVICE_ID_DIR: applicationDirectory,
      });

      await expect(bridge.checkIconPackUpdate()).resolves.toMatchObject({
        ok: true,
        updateAvailable: true,
        latestVersion: manifest.version,
      });
    } finally {
      rmSync(applicationDirectory, { recursive: true, force: true });
    }
  });

  it("normalizes an unsupported selected pack to builtin", () => {
    const storage = new Map<string, unknown>([
      [uiPreferencesKey, { ...defaultUiPreferences, iconPackId: "../external-icon-pack" }],
    ]);
    const applicationDirectory = mkdtempSync(join(tmpdir(), "utools-icon-pack-"));
    try {
      const bridge = loadPreloadBridge(storage, createHttpsMock([]), {
        UTOOLS_PROJECT_LAUNCH_DEVICE_ID_DIR: applicationDirectory,
      });
      expect(bridge.loadUiPreferences().iconPackId).toBe("builtin");
    } finally {
      rmSync(applicationDirectory, { recursive: true, force: true });
    }
  });

  it("preserves the previous valid package after checksum failure", async () => {
    const applicationDirectory = mkdtempSync(join(tmpdir(), "utools-icon-pack-"));
    try {
      const firstManifest = createManifest("1.0.0");
      const secondManifest = createManifest("2.0.0");
      const storage = new Map<string, unknown>();
      const bridge = loadPreloadBridge(storage, createHttpsMock(createReleaseResponses(firstManifest)), {
        UTOOLS_PROJECT_LAUNCH_DEVICE_ID_DIR: applicationDirectory,
      });
      expect((await bridge.downloadIconPack()).ok).toBe(true);

      const secondPackage = gzipSync(Buffer.from(JSON.stringify(secondManifest)));
      const failedUpdateBridge = loadPreloadBridge(
        storage,
        createHttpsMock(createReleaseResponses(secondManifest, "0".repeat(64), secondPackage)),
        { UTOOLS_PROJECT_LAUNCH_DEVICE_ID_DIR: applicationDirectory },
      );
      const result = await failedUpdateBridge.downloadIconPack();
      expect(result).toMatchObject({ ok: false, state: "loaded", manifest: firstManifest });
      expect(await failedUpdateBridge.loadInstalledIconPack()).toMatchObject({ ok: true, manifest: firstManifest });
    } finally {
      rmSync(applicationDirectory, { recursive: true, force: true });
    }
  });

  it("preserves the previous valid package when the candidate manifest is invalid", async () => {
    const applicationDirectory = mkdtempSync(join(tmpdir(), "utools-icon-pack-"));
    try {
      const firstManifest = createManifest("1.0.0");
      const secondManifest = createManifest("2.0.0");
      const storage = new Map<string, unknown>();
      const bridge = loadPreloadBridge(storage, createHttpsMock(createReleaseResponses(firstManifest)), {
        UTOOLS_PROJECT_LAUNCH_DEVICE_ID_DIR: applicationDirectory,
      });
      expect((await bridge.downloadIconPack()).ok).toBe(true);

      const invalidPackage = gzipSync(Buffer.from("not-json"));
      const failedUpdateBridge = loadPreloadBridge(
        storage,
        createHttpsMock(createReleaseResponses(secondManifest, "", invalidPackage)),
        { UTOOLS_PROJECT_LAUNCH_DEVICE_ID_DIR: applicationDirectory },
      );
      expect(await failedUpdateBridge.downloadIconPack()).toMatchObject({
        ok: false,
        state: "loaded",
        manifest: firstManifest,
      });
      expect(await failedUpdateBridge.loadInstalledIconPack()).toMatchObject({ ok: true, manifest: firstManifest });
    } finally {
      rmSync(applicationDirectory, { recursive: true, force: true });
    }
  });

  it("rejects an install record with a mismatched release asset name", async () => {
    const applicationDirectory = mkdtempSync(join(tmpdir(), "utools-icon-pack-"));
    try {
      const manifest = createManifest("1.0.0");
      const bridge = loadPreloadBridge(new Map(), createHttpsMock(createReleaseResponses(manifest)), {
        UTOOLS_PROJECT_LAUNCH_DEVICE_ID_DIR: applicationDirectory,
      });
      expect((await bridge.downloadIconPack()).ok).toBe(true);

      const metadataPath = join(applicationDirectory, "icon-packs", "vscode-icons-derived", "install.json");
      const metadata = JSON.parse(readFileSync(metadataPath, "utf8")) as { assetName: string };
      metadata.assetName = "unexpected.iconpack.json.gz";
      writeFileSync(metadataPath, `${JSON.stringify(metadata)}\n`);

      await expect(bridge.loadInstalledIconPack()).resolves.toMatchObject({
        ok: false,
        state: "invalid",
        manifest: null,
      });
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
        UTOOLS_PROJECT_LAUNCH_DEVICE_ID_DIR: applicationDirectory,
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

  it("fails closed when the icon-pack root is not a directory", async () => {
    const applicationDirectory = mkdtempSync(join(tmpdir(), "utools-icon-pack-"));
    try {
      writeFileSync(join(applicationDirectory, "icon-packs"), "not a directory");
      const bridge = loadPreloadBridge(new Map(), createHttpsMock([]), {
        UTOOLS_PROJECT_LAUNCH_DEVICE_ID_DIR: applicationDirectory,
      });

      await expect(bridge.getIconPackStatus()).resolves.toMatchObject({
        state: "invalid",
        active: false,
      });
    } finally {
      rmSync(applicationDirectory, { recursive: true, force: true });
    }
  });
});
