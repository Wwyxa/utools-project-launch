import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packDir = join(rootDir, "icon-packs", "vscode-icons-derived");

describe("icon-pack release generation", () => {
  it("rebuilds and validates the independent release assets", () => {
    const configuredPackVersion = (
      JSON.parse(readFileSync(join(packDir, "manifest.json"), "utf8")) as { version: string }
    ).version;
    expect(() => {
      execFileSync(process.execPath, ["scripts/build-icon-pack.mjs"], { cwd: rootDir, stdio: "pipe" });
      execFileSync(process.execPath, ["scripts/validate-icon-pack.mjs"], { cwd: rootDir, stdio: "pipe" });
    }).not.toThrow();

    const sourceManifest = JSON.parse(
      readFileSync(join(packDir, "manifest.json"), "utf8"),
    ) as { assets: Record<string, unknown>; source: { version: string }; version: string };
    const releaseDir = join(packDir, "icon-pack-release");
    const releaseFiles = readdirSync(releaseDir);
    expect(Object.keys(sourceManifest.assets).length).toBeGreaterThan(1000);
    expect(sourceManifest.version).toBe(configuredPackVersion);
    expect(sourceManifest.version).not.toBe(sourceManifest.source.version);
    const upstreamPackagePath = join(rootDir, "references", "vscode-icons", "package.json");
    if (existsSync(upstreamPackagePath)) {
      const upstreamPackage = JSON.parse(readFileSync(upstreamPackagePath, "utf8")) as { version: string };
      expect(sourceManifest.source.version).toBe(upstreamPackage.version);
    }
    expect(releaseFiles.filter((fileName) => fileName.endsWith(".iconpack.json.gz"))).toHaveLength(1);
    expect(readFileSync(join(releaseDir, "LICENSES-vscode-icons.txt"), "utf8")).toContain(
      "CC BY-SA 4.0",
    );
    expect(existsSync(join(rootDir, ".icon-pack-release"))).toBe(false);
    expect(existsSync(join(rootDir, "vscode-icons-derived"))).toBe(false);
    expect(existsSync(join(rootDir, "icon-packs", "manifest.json"))).toBe(false);
    expect(existsSync(join(rootDir, "icon-packs", ".icon-pack-release"))).toBe(false);
    expect(existsSync(join(rootDir, "dist", "icon-packs"))).toBe(false);

    execFileSync(process.execPath, ["scripts/build-icon-pack.mjs"], {
      cwd: rootDir,
      stdio: "pipe",
      env: { ...process.env, ICON_PACK_REFERENCE_DIR: ".missing-icon-pack-reference" },
    });
    execFileSync(process.execPath, ["scripts/validate-icon-pack.mjs"], { cwd: rootDir, stdio: "pipe" });
  }, 15_000);
});