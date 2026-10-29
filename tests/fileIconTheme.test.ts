import { describe, expect, it } from "vitest";
import {
  normalizeIconPackManifest,
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

describe("file icon theme resolver", () => {

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
});
