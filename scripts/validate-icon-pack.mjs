import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schemaVersion = 1;
const packId = "vscode-icons-derived";
const sourceDir = join(rootDir, "icon-packs", packId);
const releaseDir = join(sourceDir, "icon-pack-release");
const sourceManifestPath = join(sourceDir, "manifest.json");
const compressedLimitBytes = 32 * 1024 * 1024;
const decompressedLimitBytes = 128 * 1024 * 1024;
const assetLimitBytes = 4 * 1024 * 1024;
const totalAssetLimitBytes = 64 * 1024 * 1024;
const assetCountLimit = 20_000;
const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const assetIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/;
const iconPackVersionPattern = /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/;
const unsafeSvgPattern =
  /<!doctype|<!entity|<\/?(?:script|iframe|object|embed)\b|\bon[a-z][\w-]*\s*=|javascript\s*:|\b(?:href|xlink:href|src)\s*=\s*["']?(?:https?:|ftp:|file:|data:|\/\/|\\\\)|url\(\s*["']?(?:https?:|ftp:|file:|data:|\/\/|\\\\)/i;
const safeEmbeddedPngPattern = /((?:href|xlink:href|src)\s*=\s*["'])data:image\/png;base64,[A-Za-z0-9+/]+={0,2}(["'])/gi;
const svgPattern = /<svg(?:\s|>)/i;
const fail = (message) => {
  throw new Error(`[icon-pack] ${message}`);
};

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const assertString = (value, label) => {
  if (typeof value !== "string" || !value.trim()) fail(`${label} is missing`);
  return value.trim();
};
const assertSourceUrl = (value) => {
  try {
    if (new URL(value).protocol !== "https:") fail("source URL must use HTTPS");
  } catch {
    fail("source URL is invalid");
  }
};
const assertVariant = (value, label) => {
  if (!isRecord(value)) fail(`${label} is invalid`);
  const dark = assertString(value.dark, `${label}.dark`);
  if (!assetIdPattern.test(dark)) fail(`${label}.dark references an invalid asset`);
  if (value.light !== undefined) {
    const light = assertString(value.light, `${label}.light`);
    if (!assetIdPattern.test(light)) fail(`${label}.light references an invalid asset`);
  }
};
const assertMapping = (value, label, keyValidator = () => true) => {
  if (!isRecord(value)) fail(`${label} is invalid`);
  for (const [key, variant] of Object.entries(value)) {
    if (!key || key !== key.trim() || key !== key.toLocaleLowerCase() || key.length > 256 || !keyValidator(key)) {
      fail(`${label} contains an invalid key`);
    }
    assertVariant(variant, `${label}.${key}`);
  }
};
const assertMappings = (manifest) => {
  const mappings = manifest.mappings;
  if (!isRecord(mappings) || !isRecord(mappings.defaults)) fail("mappings are invalid");
  assertMapping(mappings.fileNames, "fileNames", (key) => !/[\\/]/.test(key));
  assertMapping(mappings.fileSuffixes, "fileSuffixes", (key) => key.startsWith(".") && !/[\\/]/.test(key));
  assertMapping(mappings.folderNames, "folderNames", (key) => !/[\\/]/.test(key));
  assertMapping(mappings.folderNamesExpanded, "folderNamesExpanded", (key) => !/[\\/]/.test(key));
  assertVariant(mappings.defaults.file, "defaults.file");
  assertVariant(mappings.defaults.folder, "defaults.folder");
  assertVariant(mappings.defaults.folderExpanded, "defaults.folderExpanded");
};
const mappingReferences = (manifest) => {
  const mappings = manifest.mappings;
  const variants = [
    ...Object.values(mappings.fileNames),
    ...Object.values(mappings.fileSuffixes),
    ...Object.values(mappings.folderNames),
    ...Object.values(mappings.folderNamesExpanded),
    mappings.defaults.file,
    mappings.defaults.folder,
    mappings.defaults.folderExpanded,
  ];
  return variants.flatMap((variant) => [variant.dark, ...(variant.light ? [variant.light] : [])]);
};
const assertSourceAsset = (assetId, asset) => {
  if (!isRecord(asset) || asset.format !== "svg" || asset.encoding !== "path" || typeof asset.path !== "string") {
    fail(`source asset '${assetId}' is invalid`);
  }
  const normalizedPath = asset.path.replace(/\\/g, "/");
  if (!normalizedPath.startsWith("icons/") || normalizedPath.includes("../") || normalizedPath.endsWith("/")) {
    fail(`source asset '${assetId}' path is unsafe`);
  }
  const assetPath = join(sourceDir, normalizedPath);
  const assetStat = lstatSync(assetPath);
  if (!assetStat.isFile() || assetStat.isSymbolicLink()) {
    fail(`source asset '${assetId}' must be a regular file`);
  }
  const contents = readFileSync(assetPath);
  if (contents.length === 0 || contents.length > assetLimitBytes || !svgPattern.test(contents.toString("utf8"))) {
    fail(`source asset '${assetId}' content is invalid`);
  }
  const svgText = contents.toString("utf8");
  if (unsafeSvgPattern.test(svgText.replace(safeEmbeddedPngPattern, "$1$2"))) {
    fail(`source asset '${assetId}' contains unsafe SVG content`);
  }
};
const assertReleaseAsset = (assetId, asset) => {
  if (!isRecord(asset) || (asset.format !== "svg" && asset.format !== "png") || asset.encoding !== "base64") {
    fail(`release asset '${assetId}' is invalid`);
  }
  if (
    typeof asset.data !== "string" ||
    asset.data.length === 0 ||
    asset.data.length > assetLimitBytes ||
    asset.data.length % 4 !== 0 ||
    !base64Pattern.test(asset.data)
  ) {
    fail(`release asset '${assetId}' data is invalid`);
  }
  const bytes = Buffer.from(asset.data, "base64");
  if (bytes.length === 0) fail(`release asset '${assetId}' is empty`);
  if (asset.format === "png") {
    if (!bytes.subarray(0, 8).equals(Buffer.from("\x89PNG\r\n\x1a\n", "binary"))) {
      fail(`release asset '${assetId}' is not a PNG`);
    }
    return;
  }
  const contents = bytes.toString("utf8");
  if (!svgPattern.test(contents) || unsafeSvgPattern.test(contents.replace(safeEmbeddedPngPattern, "$1$2"))) {
    fail(`release asset '${assetId}' contains unsafe SVG`);
  }
};
const assertManifest = (manifest, { release }) => {
  if (!isRecord(manifest) || manifest.schemaVersion !== schemaVersion || manifest.id !== packId) {
    fail(`${release ? "release" : "source"} manifest identity is invalid`);
  }
  assertString(manifest.name, "manifest name");
  const version = assertString(manifest.version, "manifest version");
  if (!iconPackVersionPattern.test(version)) fail("manifest version is invalid");
  if (!isRecord(manifest.source)) fail("source metadata is incomplete");
  assertString(manifest.source.repository, "source repository");
  assertString(manifest.source.version, "source version");
  assertSourceUrl(assertString(manifest.source.url, "source URL"));
  assertMappings(manifest);
  if (!Array.isArray(manifest.notices) || manifest.notices.length < 3 || manifest.notices.length > 256) {
    fail("license notices are incomplete");
  }
  for (const notice of manifest.notices) {
    if (!isRecord(notice)) fail("license notice is invalid");
    assertString(notice.id, "license notice id");
    assertString(notice.license, "license notice license");
    assertString(notice.text, "license notice text");
    assertString(notice.appliesTo, "license notice scope");
  }
  if (!isRecord(manifest.assets)) fail("assets are missing");
  const assetIds = Object.keys(manifest.assets);
  if (assetIds.length === 0 || assetIds.length > assetCountLimit) fail("asset count is outside the allowed limit");
  let totalAssetBytes = 0;
  for (const assetId of assetIds) {
    if (!assetIdPattern.test(assetId)) fail(`asset '${assetId}' has an invalid id`);
    if (release) {
      assertReleaseAsset(assetId, manifest.assets[assetId]);
      totalAssetBytes += manifest.assets[assetId].data.length;
    } else {
      assertSourceAsset(assetId, manifest.assets[assetId]);
      totalAssetBytes += readFileSync(join(sourceDir, manifest.assets[assetId].path)).length;
    }
    if (totalAssetBytes > totalAssetLimitBytes) fail("total asset size exceeds the allowed limit");
  }
  for (const assetId of mappingReferences(manifest)) {
    if (!manifest.assets[assetId]) fail(`mapping references unknown asset '${assetId}'`);
  }
  return version;
};

if (!existsSync(sourceManifestPath)) fail("source manifest is missing; run npm run icon-pack:build first");
const sourceManifest = JSON.parse(readFileSync(sourceManifestPath, "utf8"));
const sourceVersion = assertManifest(sourceManifest, { release: false });
if (new Set(Object.keys(sourceManifest.assets || {})).size < 1000) {
  fail(`expected the complete icon set, found only ${Object.keys(sourceManifest.assets).length} assets`);
}
for (const noticeFile of ["LICENSE-MIT.txt", "NOTICE-ICON-ASSETS-CC-BY-SA-4.0.txt", "UPSTREAM-README.md"]) {
  if (!existsSync(join(sourceDir, "LICENSES", noticeFile))) fail(`notice file '${noticeFile}' is missing`);
}
const noticeText = readFileSync(join(sourceDir, "LICENSES", "NOTICE-ICON-ASSETS-CC-BY-SA-4.0.txt"), "utf8");
if (!/vscode-icons|MIT|CC BY-SA 4\.0|branded/i.test(noticeText)) fail("icon asset attribution is incomplete");
const releaseLicensePath = join(releaseDir, "LICENSES-vscode-icons.txt");
if (!existsSync(releaseLicensePath)) fail("release license notice is missing");
const releaseLicenseText = readFileSync(releaseLicensePath, "utf8");
for (const noticeFile of ["LICENSE-MIT.txt", "NOTICE-ICON-ASSETS-CC-BY-SA-4.0.txt", "UPSTREAM-README.md"]) {
  const noticeContents = readFileSync(join(sourceDir, "LICENSES", noticeFile), "utf8");
  if (!releaseLicenseText.includes(noticeContents)) fail(`release license notice omits '${noticeFile}'`);
}
const releaseFiles = existsSync(releaseDir) ? readdirSync(releaseDir).filter((name) => name.endsWith(".iconpack.json.gz")) : [];
if (releaseFiles.length !== 1) fail("expected exactly one compressed release asset");
const releasePath = join(releaseDir, releaseFiles[0]);
const releaseBytes = readFileSync(releasePath);
if (releaseBytes.length === 0 || releaseBytes.length > compressedLimitBytes) fail("compressed release exceeds the allowed limit");
const checksumLine = readFileSync(join(releaseDir, "checksums.txt"), "utf8").trim();
const checksumMatch = checksumLine.match(/^([0-9a-f]{64})\s+(.+)$/i);
if (!checksumMatch || checksumMatch[2] !== releaseFiles[0]) fail("checksums.txt is invalid");
if (createHash("sha256").update(releaseBytes).digest("hex") !== checksumMatch[1].toLowerCase()) fail("release checksum mismatch");
let decompressedBytes;
try {
  decompressedBytes = gunzipSync(releaseBytes);
} catch {
  fail("release asset is not valid gzip data");
}
if (decompressedBytes.length === 0 || decompressedBytes.length > decompressedLimitBytes) {
  fail("decompressed release exceeds the allowed limit");
}
let releaseManifest;
try {
  releaseManifest = JSON.parse(decompressedBytes.toString("utf8"));
} catch {
  fail("release asset does not contain valid JSON");
}
const releaseVersion = assertManifest(releaseManifest, { release: true });
if (releaseVersion !== sourceVersion) fail("source and release versions do not match");
const expectedAssetName = `utools-project-launch-${packId}-${sourceVersion}.iconpack.json.gz`;
if (releaseFiles[0] !== expectedAssetName) fail("release asset name does not match the manifest version");
const sourceMetadata = JSON.stringify({ ...sourceManifest, assets: {} });
const releaseMetadata = JSON.stringify({ ...releaseManifest, assets: {} });
if (sourceMetadata !== releaseMetadata) fail("release metadata does not match the source manifest");
if (JSON.stringify(releaseManifest).includes("references/")) fail("release manifest leaks references/ paths");
console.info(
  `[icon-pack] valid: ${Object.keys(sourceManifest.assets).length} source assets, ${Object.keys(releaseManifest.assets).length} release assets`,
);