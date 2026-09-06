import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { compileIconPackSource } from "./icon-pack-source.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packsDir = join(rootDir, "icon-packs");
const safeEmbeddedPngPattern =
  /((?:href|xlink:href|src)\s*=\s*["'])data:image\/png;base64,[A-Za-z0-9+/]+={0,2}(["'])/gi;
const unsafeSvgPattern =
  /<!doctype|<!entity|<\/?(?:script|iframe|object|embed)\b|\bon[a-z][\w-]*\s*=|javascript\s*:|\b(?:href|xlink:href|src)\s*=\s*["']?(?:https?:|ftp:|file:|data:|\/\/|\\\\)|url\(\s*["']?(?:https?:|ftp:|file:|data:|\/\/|\\\\)/i;
const iconPackVersionPattern = /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/;

const fail = (message) => {
  throw new Error(`[icon-pack] ${message}`);
};

const readText = (filePath) => readFileSync(filePath, "utf8");
const sortRecord = (record) =>
  Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)));
const sortManifest = (manifest) => ({
  ...manifest,
  mappings: {
    ...manifest.mappings,
    fileNames: sortRecord(manifest.mappings.fileNames),
    fileSuffixes: sortRecord(manifest.mappings.fileSuffixes),
    folderNames: sortRecord(manifest.mappings.folderNames),
    folderNamesExpanded: sortRecord(manifest.mappings.folderNamesExpanded),
  },
  assets: sortRecord(manifest.assets),
});

const assertSvg = (filePath) => {
  const fileStat = lstatSync(filePath);
  if (!fileStat.isFile() || fileStat.isSymbolicLink()) fail(`${relative(rootDir, filePath)} must be a regular file`);
  const contents = readFileSync(filePath);
  const text = contents.toString("utf8");
  if (
    contents.length === 0 ||
    !/<svg(?:\s|>)/i.test(text) ||
    unsafeSvgPattern.test(text.replace(safeEmbeddedPngPattern, "$1$2"))
  ) {
    fail(`${relative(rootDir, filePath)} contains invalid or unsafe SVG`);
  }
  return contents;
};

const loadSource = (sourcePath, packId) => {
  let source;
  try {
    source = JSON.parse(readText(sourcePath));
  } catch {
    fail(`${relative(rootDir, sourcePath)} is not valid JSON`);
  }
  if (
    !source ||
    source.schemaVersion !== 1 ||
    source.id !== packId ||
    typeof source.name !== "string" ||
    !source.name.trim() ||
    source.assets !== undefined
  ) {
    fail(`${relative(rootDir, sourcePath)} has invalid identity or structure`);
  }
  const version = process.env.ICON_PACK_VERSION?.trim() || String(source.version || "").trim();
  if (!iconPackVersionPattern.test(version)) fail(`${packId} version '${version}' is invalid`);
  return compileIconPackSource(source, packId, version);
};

const scanAssets = (packDir) => {
  const iconsDir = join(packDir, "icons");
  if (!existsSync(iconsDir)) fail(`${relative(rootDir, iconsDir)} is missing`);
  const assets = {};
  for (const entry of readdirSync(iconsDir, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const iconPath = join(iconsDir, entry.name);
    if (entry.isSymbolicLink() || !entry.isFile()) fail(`${relative(rootDir, iconPath)} must be a regular file`);
    if (!entry.name.endsWith(".svg")) continue;
    assertSvg(iconPath);
    assets[entry.name] = { format: "svg", encoding: "path", path: `icons/${entry.name}` };
  }
  if (Object.keys(assets).length === 0) fail(`${relative(rootDir, iconsDir)} contains no SVG icons`);
  return assets;
};

const mappingReferences = (manifest) => {
  const mappings = manifest.mappings;
  const variants = [
    ...Object.values(mappings.fileNames || {}),
    ...Object.values(mappings.fileSuffixes || {}),
    ...Object.values(mappings.folderNames || {}),
    ...Object.values(mappings.folderNamesExpanded || {}),
    mappings.defaults?.file,
    mappings.defaults?.folder,
    mappings.defaults?.folderExpanded,
  ].filter(Boolean);
  return variants.flatMap((variant) => [variant.dark, ...(variant.light ? [variant.light] : [])]);
};

const buildLicenseBundle = (packDir, source) => {
  const licensesDir = join(packDir, "LICENSES");
  if (!existsSync(licensesDir)) fail(`${relative(rootDir, licensesDir)} is missing`);
  const licenseFiles = readdirSync(licensesDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.isSymbolicLink())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  if (licenseFiles.length === 0) fail(`${relative(rootDir, licensesDir)} contains no license files`);
  return [
    source.name,
    "",
    `Source repository: ${source.source.repository}`,
    `Source version: ${source.source.version}`,
    `Source URL: ${source.source.url}`,
    ...licenseFiles.flatMap((fileName) => ["", `===== ${fileName} =====`, readText(join(licensesDir, fileName))]),
  ].join("\n");
};

const buildPack = (packDir) => {
  const packId = relative(packsDir, packDir).replace(/\\/g, "/");
  const manifestSource = loadSource(join(packDir, "source.json"), packId);
  const assets = scanAssets(packDir);
  const manifest = sortManifest({ ...manifestSource, assets });
  for (const assetId of mappingReferences(manifest)) {
    if (!manifest.assets[assetId]) fail(`${packId} mapping references unknown asset '${assetId}'`);
  }
  writeFileSync(join(packDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  const releaseDir = join(packDir, "icon-pack-release");
  rmSync(releaseDir, { recursive: true, force: true });
  mkdirSync(releaseDir, { recursive: true });
  const releaseManifest = sortManifest({
    ...manifest,
    assets: Object.fromEntries(
      Object.entries(manifest.assets).map(([assetId, asset]) => [
        assetId,
        { format: asset.format, encoding: "base64", data: readFileSync(join(packDir, asset.path)).toString("base64") },
      ]),
    ),
  });
  const releaseAssetName = `utools-project-launch-${packId}-${manifest.version}.iconpack.json.gz`;
  const releaseBytes = gzipSync(Buffer.from(`${JSON.stringify(releaseManifest)}\n`), { level: 9 });
  writeFileSync(join(releaseDir, releaseAssetName), releaseBytes);
  writeFileSync(
    join(releaseDir, "checksums.txt"),
    `${createHash("sha256").update(releaseBytes).digest("hex")}  ${releaseAssetName}\n`,
  );
  writeFileSync(join(releaseDir, `LICENSES-${packId}.txt`), buildLicenseBundle(packDir, manifestSource));
  console.info(`[icon-pack] ${packId}: generated ${Object.keys(manifest.assets).length} assets`);
  console.info(`[icon-pack] ${packId}: release ${relative(rootDir, join(releaseDir, releaseAssetName))}`);
};

const packDirectories = readdirSync(packsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(packsDir, entry.name, "source.json")))
  .map((entry) => join(packsDir, entry.name));
if (packDirectories.length === 0) fail("no icon-packs/*/source.json files found");
for (const packDir of packDirectories) buildPack(packDir);
