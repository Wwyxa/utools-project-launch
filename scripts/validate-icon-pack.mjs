import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { compileIconPackSource } from "./icon-pack-source.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packsDir = join(rootDir, "icon-packs");
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
const safeEmbeddedPngPattern =
  /((?:href|xlink:href|src)\s*=\s*["'])data:image\/png;base64,[A-Za-z0-9+/]+={0,2}(["'])/gi;
const svgPattern = /<svg(?:\s|>)/i;

const fail = (message) => {
  throw new Error(`[icon-pack] ${message}`);
};
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const sortRecord = (record) =>
  Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)));
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

const assertSourceAsset = (packDir, assetId, asset) => {
  if (!isRecord(asset) || asset.format !== "svg" || asset.encoding !== "path" || typeof asset.path !== "string") {
    fail(`source asset '${assetId}' is invalid`);
  }
  const normalizedPath = asset.path.replace(/\\/g, "/");
  if (normalizedPath !== `icons/${assetId}` || normalizedPath.includes("../"))
    fail(`source asset '${assetId}' path is invalid`);
  const assetPath = join(packDir, normalizedPath);
  if (!existsSync(assetPath)) fail(`source asset '${assetId}' is missing`);
  const assetStat = lstatSync(assetPath);
  if (!assetStat.isFile() || assetStat.isSymbolicLink()) fail(`source asset '${assetId}' must be a regular file`);
  const contents = readFileSync(assetPath);
  const text = contents.toString("utf8");
  if (contents.length === 0 || contents.length > assetLimitBytes || !svgPattern.test(text)) {
    fail(`source asset '${assetId}' content is invalid`);
  }
  if (unsafeSvgPattern.test(text.replace(safeEmbeddedPngPattern, "$1$2"))) {
    fail(`source asset '${assetId}' contains unsafe SVG content`);
  }
  return contents.length;
};
const assertReleaseAsset = (assetId, asset) => {
  if (!isRecord(asset) || asset.format !== "svg" || asset.encoding !== "base64") {
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
  const contents = bytes.toString("utf8");
  if (
    bytes.length === 0 ||
    !svgPattern.test(contents) ||
    unsafeSvgPattern.test(contents.replace(safeEmbeddedPngPattern, "$1$2"))
  ) {
    fail(`release asset '${assetId}' contains unsafe SVG`);
  }
  return bytes.length;
};
const assertManifest = (packDir, packId, manifest, { release }) => {
  if (!isRecord(manifest) || manifest.schemaVersion !== 1 || manifest.id !== packId) {
    fail(`${packId} ${release ? "release" : "source"} manifest identity is invalid`);
  }
  assertString(manifest.name, "manifest name");
  const version = assertString(manifest.version, "manifest version");
  if (!iconPackVersionPattern.test(version)) fail("manifest version is invalid");
  if (!isRecord(manifest.source)) fail("source metadata is incomplete");
  assertString(manifest.source.repository, "source repository");
  assertString(manifest.source.version, "source version");
  assertSourceUrl(assertString(manifest.source.url, "source URL"));
  assertMappings(manifest);
  if (!Array.isArray(manifest.notices) || manifest.notices.length === 0 || manifest.notices.length > 256) {
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
    if (release) totalAssetBytes += assertReleaseAsset(assetId, manifest.assets[assetId]);
    else totalAssetBytes += assertSourceAsset(packDir, assetId, manifest.assets[assetId]);
    if (totalAssetBytes > totalAssetLimitBytes) fail("total asset size exceeds the allowed limit");
  }
  for (const assetId of mappingReferences(manifest)) {
    if (!manifest.assets[assetId]) fail(`mapping references unknown asset '${assetId}'`);
  }
  return version;
};

const validatePack = (packDir) => {
  const packId = basename(packDir);
  const sourcePath = join(packDir, "source.json");
  const manifestPath = join(packDir, "manifest.json");
  const releaseDir = join(packDir, "icon-pack-release");
  if (!existsSync(manifestPath)) fail(`${packId} manifest is missing; run npm run icon-pack:build first`);
  const source = JSON.parse(readFileSync(sourcePath, "utf8"));
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (source.assets !== undefined) fail(`${packId} source.json must not contain generated assets`);
  const sourceVersion = assertManifest(packDir, packId, manifest, { release: false });
  const compiledSource = compileIconPackSource(source, packId, manifest.version);
  const expectedManifest = {
    ...compiledSource,
    mappings: {
      ...compiledSource.mappings,
      fileNames: sortRecord(compiledSource.mappings.fileNames),
      fileSuffixes: sortRecord(compiledSource.mappings.fileSuffixes),
      folderNames: sortRecord(compiledSource.mappings.folderNames),
      folderNamesExpanded: sortRecord(compiledSource.mappings.folderNamesExpanded),
    },
  };
  if (JSON.stringify(expectedManifest) !== JSON.stringify({ ...manifest, assets: undefined })) {
    fail(`${packId} manifest metadata does not match source.json; run npm run icon-pack:build`);
  }

  const licensesDir = join(packDir, "LICENSES");
  const licenseFiles = existsSync(licensesDir)
    ? readdirSync(licensesDir, { withFileTypes: true }).filter((entry) => entry.isFile() && !entry.isSymbolicLink())
    : [];
  if (licenseFiles.length === 0) fail(`${packId} has no license files`);
  const releaseLicensePath = join(releaseDir, `LICENSES-${packId}.txt`);
  if (!existsSync(releaseLicensePath)) fail(`${packId} release license notice is missing`);
  const releaseLicenseText = readFileSync(releaseLicensePath, "utf8");
  for (const entry of licenseFiles) {
    if (!releaseLicenseText.includes(readFileSync(join(licensesDir, entry.name), "utf8"))) {
      fail(`${packId} release license notice omits '${entry.name}'`);
    }
  }

  const releaseFiles = existsSync(releaseDir)
    ? readdirSync(releaseDir).filter((name) => name.endsWith(".iconpack.json.gz"))
    : [];
  if (releaseFiles.length !== 1) fail(`${packId} must have exactly one compressed release asset`);
  const expectedAssetName = `utools-project-launch-${packId}-${sourceVersion}.iconpack.json.gz`;
  if (releaseFiles[0] !== expectedAssetName) fail(`${packId} release asset name does not match its version`);
  const releaseBytes = readFileSync(join(releaseDir, releaseFiles[0]));
  if (releaseBytes.length === 0 || releaseBytes.length > compressedLimitBytes)
    fail(`${packId} compressed release exceeds the limit`);
  const checksumMatch = readFileSync(join(releaseDir, "checksums.txt"), "utf8")
    .trim()
    .match(/^([0-9a-f]{64})\s+(.+)$/i);
  if (!checksumMatch || checksumMatch[2] !== releaseFiles[0]) fail(`${packId} checksums.txt is invalid`);
  if (createHash("sha256").update(releaseBytes).digest("hex") !== checksumMatch[1].toLowerCase()) {
    fail(`${packId} release checksum mismatch`);
  }
  let decompressedBytes;
  try {
    decompressedBytes = gunzipSync(releaseBytes);
  } catch {
    fail(`${packId} release asset is not valid gzip data`);
  }
  if (decompressedBytes.length === 0 || decompressedBytes.length > decompressedLimitBytes) {
    fail(`${packId} decompressed release exceeds the limit`);
  }
  const releaseManifest = JSON.parse(decompressedBytes.toString("utf8"));
  const releaseVersion = assertManifest(packDir, packId, releaseManifest, { release: true });
  if (releaseVersion !== sourceVersion) fail(`${packId} source and release versions do not match`);
  if (JSON.stringify({ ...manifest, assets: {} }) !== JSON.stringify({ ...releaseManifest, assets: {} })) {
    fail(`${packId} release metadata does not match the source manifest`);
  }
  if (JSON.stringify(releaseManifest).includes("references/"))
    fail(`${packId} release manifest leaks references paths`);
  console.info(`[icon-pack] ${packId}: valid ${Object.keys(manifest.assets).length} source and release assets`);
};

const packDirectories = readdirSync(packsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(packsDir, entry.name, "source.json")))
  .map((entry) => join(packsDir, entry.name));
if (packDirectories.length === 0) fail("no icon-packs/*/source.json files found");
for (const packDir of packDirectories) validatePack(packDir);
