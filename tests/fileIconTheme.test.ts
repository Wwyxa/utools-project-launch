import { describe, expect, it } from "vitest";
import {
  BUILTIN_ICON_PACK_ID,
  normalizeIconPackManifest,
  resolveFileIcon,
  type FileIconResolveInput,
} from "../src/lib/fileIconTheme";
import type { IconPackManifest } from "../src/types";

const svg = (label: string) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><title>${label}</title></svg>`).toString("base64");

const createManifest = (): IconPackManifest => ({
  schemaVersion: 1,
  id: "test-pack",
  name: "Test pack",
  version: "1.0.0",
  source: { repository: "test/repo", version: "1.0.0", url: "https://example.com/test" },
  mappings: {
    fileNames: { "readme.md": { dark: "readme-dark", light: "readme-light" } },
    fileSuffixes: {
      ".component.ts": { dark: "component" },
      ".ts": { dark: "typescript" },
    },
    folderNames: { src: { dark: "folder" } },
    folderNamesExpanded: { src: { dark: "folder-open" } },
    defaults: {
      file: { dark: "file" },
      folder: { dark: "folder" },
      folderExpanded: { dark: "folder-open" },
    },
  },
  assets: Object.fromEntries(
    ["readme-dark", "readme-light", "component", "typescript", "folder", "folder-open", "file"].map((id) => [
      id,
      { format: "svg", encoding: "base64", data: svg(id) },
    ]),
  ),
  notices: [
    { id: "source", license: "MIT", text: "Source notice", appliesTo: "source" },
    { id: "assets", license: "CC BY-SA 4.0", text: "Asset notice", appliesTo: "assets" },
    { id: "branded", license: "varies", text: "Branded notice", appliesTo: "branded assets" },
  ],
});

const input = (overrides: Partial<FileIconResolveInput>): FileIconResolveInput => ({
  name: "main.ts",
  path: "src/main.ts",
  kind: "file",
  colorMode: "dark",
  ...overrides,
});

describe("file icon theme resolver", () => {
  it("validates a manifest and rejects the builtin id", () => {
    const manifest = createManifest();
    expect(normalizeIconPackManifest(manifest)).toEqual(manifest);
    expect(normalizeIconPackManifest({ ...manifest, id: BUILTIN_ICON_PACK_ID })).toBeNull();
  });

  it("uses exact names before the longest compound suffix", () => {
    const pack = createManifest();
    expect(resolveFileIcon(pack, input({ name: "README.md", path: "README.md" }))).toMatchObject({
      kind: "external",
      assetId: "readme-dark",
    });
    expect(resolveFileIcon(pack, input({ name: "card.component.ts", path: "src/card.component.ts" }))).toMatchObject({
      kind: "external",
      assetId: "component",
    });
  });

  it("normalizes Windows separators and selects expanded folder variants", () => {
    const pack = createManifest();
    expect(
      resolveFileIcon(pack, {
        name: "src",
        path: "src\\nested\\src\\",
        kind: "directory",
        expanded: true,
        colorMode: "dark",
      }),
    ).toMatchObject({ kind: "external", assetId: "folder-open" });
  });

  it("uses the light asset and dark fallback when light is absent", () => {
    const pack = createManifest();
    expect(resolveFileIcon(pack, input({ name: "README.md", colorMode: "light" }))).toMatchObject({
      kind: "external",
      assetId: "readme-light",
    });
    expect(resolveFileIcon(pack, input({ name: "main.ts", colorMode: "light" }))).toMatchObject({
      kind: "external",
      assetId: "typescript",
    });
  });

  it("normalizes mapping keys and rejects unsafe asset content", () => {
    const manifest = createManifest();
    const normalized = normalizeIconPackManifest({
      ...manifest,
      mappings: { ...manifest.mappings, fileNames: { " README.MD ": manifest.mappings.fileNames["readme.md"]! } },
    });
    expect(normalized?.mappings.fileNames).toHaveProperty("readme.md");

    const unsafeAsset = {
      ...manifest,
      assets: {
        ...manifest.assets,
        file: { format: "svg", encoding: "base64", data: svg("<script>alert(1)</script>") },
      },
    };
    expect(normalizeIconPackManifest(unsafeAsset)).toBeNull();
    expect(normalizeIconPackManifest({ ...manifest, notices: manifest.notices.slice(0, 2) })).toBeNull();
    expect(
      normalizeIconPackManifest({
        ...manifest,
        mappings: { ...manifest.mappings, fileNames: { "path/to/file": manifest.mappings.fileNames["readme.md"]! } },
      }),
    ).toBeNull();
  });

  it("falls back safely for missing packs and missing assets", () => {
    expect(resolveFileIcon(null, input({ name: "package.json" }))).toEqual({ kind: "fallback", fallbackKey: "package" });
    expect(resolveFileIcon(null, input({ name: "styles.css" }))).toEqual({ kind: "fallback", fallbackKey: "braces" });
    const pack = createManifest();
    pack.mappings.defaults.file = { dark: "missing" };
    expect(resolveFileIcon(pack, input({ name: "unknown.xyz" }))).toEqual({ kind: "fallback", fallbackKey: "file" });
    expect(resolveFileIcon({} as unknown as IconPackManifest, input({ name: "main.ts" }))).toEqual({
      kind: "fallback",
      fallbackKey: "code",
    });
  });
});