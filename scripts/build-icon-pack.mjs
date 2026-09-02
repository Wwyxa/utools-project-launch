import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const referenceDir = process.env.ICON_PACK_REFERENCE_DIR
  ? resolve(rootDir, process.env.ICON_PACK_REFERENCE_DIR)
  : join(rootDir, "references", "vscode-icons");
const packId = "vscode-icons-derived";
const sourceDir = join(rootDir, "icon-packs", packId);
const sourceIconsDir = join(sourceDir, "icons");
const noticesDir = join(sourceDir, "LICENSES");
const releaseDir = join(sourceDir, "icon-pack-release");
const sourceManifestPath = join(sourceDir, "manifest.json");
const referencePackagePath = join(referenceDir, "package.json");
const safeEmbeddedPngPattern = /((?:href|xlink:href|src)\s*=\s*["'])data:image\/png;base64,[A-Za-z0-9+/]+={0,2}(["'])/gi;
const unsafeSvgPattern =
  /<!doctype|<!entity|<\/?(?:script|iframe|object|embed)\b|\bon[a-z][\w-]*\s*=|javascript\s*:|\b(?:href|xlink:href|src)\s*=\s*["']?(?:https?:|ftp:|file:|data:|\/\/|\\\\)|url\(\s*["']?(?:https?:|ftp:|file:|data:|\/\/|\\\\)/i;
const iconPackVersionPattern = /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/;

const fail = (message) => {
  throw new Error(`[icon-pack] ${message}`);
};

const sourceText = (filePath) => readFileSync(filePath, "utf8");
const existingPackVersion = (() => {
  if (!existsSync(sourceManifestPath)) return "";
  try {
    const manifest = JSON.parse(sourceText(sourceManifestPath));
    return typeof manifest.version === "string" ? manifest.version.trim() : "";
  } catch {
    return "";
  }
})();
const packVersion = process.env.ICON_PACK_VERSION?.trim() || existingPackVersion || "1.0.0";
if (!iconPackVersionPattern.test(packVersion)) fail(`icon-pack version '${packVersion}' is invalid`);
const sourceAssetData = (assetId, asset) => {
  if (!asset || asset.format !== "svg" || asset.encoding !== "path" || typeof asset.path !== "string") {
    fail(`source asset '${assetId}' is invalid`);
  }
  const normalizedPath = asset.path.replace(/\\/g, "/");
  if (!normalizedPath.startsWith("icons/") || normalizedPath.includes("../") || normalizedPath.endsWith("/")) {
    fail(`source asset '${assetId}' path is unsafe`);
  }
  const assetPath = join(sourceDir, normalizedPath);
  if (!existsSync(assetPath)) fail(`source asset '${assetId}' is missing`);
  const assetStat = lstatSync(assetPath);
  if (!assetStat.isFile() || assetStat.isSymbolicLink()) {
    fail(`source asset '${assetId}' must be a regular file`);
  }
  const contents = readFileSync(assetPath);
  const text = contents.toString("utf8");
  if (contents.length === 0 || !/<svg(?:\s|>)/i.test(text) || unsafeSvgPattern.test(text.replace(safeEmbeddedPngPattern, "$1$2"))) {
    fail(`source asset '${assetId}' content is invalid`);
  }
  return contents;
};

const validateCheckedInSourceManifest = (manifest) => {
  if (!manifest || manifest.schemaVersion !== 1 || manifest.id !== packId || !manifest.version || !manifest.source?.version) {
    fail(`checked-in icon-packs/${packId}/manifest.json has invalid identity`);
  }
  if (!iconPackVersionPattern.test(String(manifest.version).trim())) {
    fail(`checked-in icon-packs/${packId}/manifest.json has an invalid icon-pack version`);
  }
  if (!manifest.assets || typeof manifest.assets !== "object" || Array.isArray(manifest.assets)) {
    fail(`checked-in icon-packs/${packId}/manifest.json has no assets`);
  }
  for (const [assetId, asset] of Object.entries(manifest.assets)) sourceAssetData(assetId, asset);
  const variants = [
    ...Object.values(manifest.mappings?.fileNames || {}),
    ...Object.values(manifest.mappings?.fileSuffixes || {}),
    ...Object.values(manifest.mappings?.folderNames || {}),
    ...Object.values(manifest.mappings?.folderNamesExpanded || {}),
    manifest.mappings?.defaults?.file,
    manifest.mappings?.defaults?.folder,
    manifest.mappings?.defaults?.folderExpanded,
  ].filter(Boolean);
  for (const variant of variants) {
    for (const assetId of [variant.dark, ...(variant.light ? [variant.light] : [])]) {
      if (!manifest.assets[assetId]) fail(`mapping references unknown asset '${assetId}'`);
    }
  }
};

const sanitizeSvg = (sourcePath, contents) => {
  const text = contents.toString("utf8").replace(/<script\s*\/>|<link\s*\/>/gi, "");
  if (!/<svg(?:\s|>)/i.test(text) || unsafeSvgPattern.test(text.replace(safeEmbeddedPngPattern, "$1$2"))) {
    fail(`${sourcePath}: unsafe SVG content`);
  }
  return Buffer.from(text);
};

class StaticParser {
  constructor(filePath, text, environment = {}) {
    this.filePath = filePath;
    this.text = text;
    this.environment = environment;
    this.position = 0;
    this.tokens = this.tokenize();
    this.index = 0;
  }

  tokenize() {
    const tokens = [];
    while (this.position < this.text.length) {
      const character = this.text[this.position];
      if (/\s/.test(character)) {
        this.position += 1;
        continue;
      }
      if (character === "/" && this.text[this.position + 1] === "/") {
        this.position += 2;
        while (this.position < this.text.length && this.text[this.position] !== "\n") this.position += 1;
        continue;
      }
      if (character === "/" && this.text[this.position + 1] === "*") {
        const end = this.text.indexOf("*/", this.position + 2);
        if (end < 0) fail(`${this.filePath}: unterminated comment`);
        this.position = end + 2;
        continue;
      }
      if (character === "'" || character === '"' || character === "`") {
        tokens.push({ type: "string", value: this.readString(character) });
        continue;
      }
      const identifier = this.text.slice(this.position).match(/^[A-Za-z_$][\w$]*/);
      if (identifier) {
        tokens.push({ type: "identifier", value: identifier[0] });
        this.position += identifier[0].length;
        continue;
      }
      const number = this.text.slice(this.position).match(/^(?:\d+(?:\.\d+)?)/);
      if (number) {
        tokens.push({ type: "number", value: Number(number[0]) });
        this.position += number[0].length;
        continue;
      }
      if ("{}[]:,.=;<>".includes(character)) {
        tokens.push({ type: "punctuation", value: character });
        this.position += 1;
        continue;
      }
      fail(`${this.filePath}: unsupported character '${character}' near offset ${this.position}`);
    }
    return tokens;
  }

  readString(quote) {
    this.position += 1;
    let result = "";
    while (this.position < this.text.length) {
      const character = this.text[this.position++];
      if (character === quote) return result;
      if (character !== "\\") {
        result += character;
        continue;
      }
      const escaped = this.text[this.position++];
      const escapes = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", "0": "\0" };
      if (escaped === "u") {
        const code = this.text.slice(this.position, this.position + 4);
        if (!/^[0-9a-f]{4}$/i.test(code)) fail(`${this.filePath}: invalid unicode escape`);
        result += String.fromCharCode(Number.parseInt(code, 16));
        this.position += 4;
      } else if (escaped === "x") {
        const code = this.text.slice(this.position, this.position + 2);
        if (!/^[0-9a-f]{2}$/i.test(code)) fail(`${this.filePath}: invalid hex escape`);
        result += String.fromCharCode(Number.parseInt(code, 16));
        this.position += 2;
      } else {
        result += escapes[escaped] ?? escaped;
      }
    }
    fail(`${this.filePath}: unterminated string`);
  }

  peek(value) {
    return this.tokens[this.index]?.value === value;
  }

  consume(value) {
    if (!this.peek(value)) fail(`${this.filePath}: expected '${value}'`);
    this.index += 1;
  }

  next() {
    const token = this.tokens[this.index++];
    if (!token) fail(`${this.filePath}: unexpected end of input`);
    return token;
  }

  parseRoot() {
    while (this.index < this.tokens.length && !this.peek("=")) this.index += 1;
    this.consume("=");
    return this.parseValue();
  }

  parseValue() {
    const token = this.tokens[this.index];
    if (!token) fail(`${this.filePath}: expected a value`);
    if (token.type === "string" || token.type === "number") {
      this.index += 1;
      return token.value;
    }
    if (token.value === "true" || token.value === "false") {
      this.index += 1;
      return token.value === "true";
    }
    if (token.value === "null") {
      this.index += 1;
      return null;
    }
    if (token.value === "{") return this.parseObject();
    if (token.value === "[") return this.parseArray();
    if (token.type === "identifier") return this.parseReference();
    fail(`${this.filePath}: unsupported value '${String(token.value)}'`);
  }

  parseObject() {
    this.consume("{");
    const result = {};
    while (!this.peek("}")) {
      const keyToken = this.next();
      const key = String(keyToken.value);
      this.consume(":");
      result[key] = this.parseValue();
      if (this.peek(",")) this.index += 1;
      else if (!this.peek("}")) fail(`${this.filePath}: expected ',' or '}' after '${key}'`);
    }
    this.consume("}");
    return result;
  }

  parseArray() {
    this.consume("[");
    const result = [];
    while (!this.peek("]")) {
      result.push(this.parseValue());
      if (this.peek(",")) this.index += 1;
      else if (!this.peek("]")) fail(`${this.filePath}: expected ',' or ']' in array`);
    }
    this.consume("]");
    return result;
  }

  parseReference() {
    const first = this.next().value;
    if (!this.peek(".")) {
      if (first in this.environment) return this.environment[first];
      fail(`${this.filePath}: unknown identifier '${first}'`);
    }
    this.consume(".");
    const second = this.next().value;
    const parent = this.environment[first];
    if (!parent || !(second in parent)) fail(`${this.filePath}: unknown reference '${first}.${second}'`);
    return parent[second];
  }
}

const parseExportedValue = (filePath, environment) => new StaticParser(filePath, sourceText(filePath), environment).parseRoot();

const parseLanguages = () =>
  parseExportedValue(join(referenceDir, "src", "iconsManifest", "languages.ts"), {}) || {};

const parseCollections = (languages) => {
  const environment = { languages, FileFormat: { svg: "svg", png: "png", jpg: "jpg", gif: "gif", bmp: "bmp", tiff: "tiff", ico: "ico" } };
  return {
    files: parseExportedValue(join(referenceDir, "src", "iconsManifest", "supportedExtensions.ts"), environment),
    folders: parseExportedValue(join(referenceDir, "src", "iconsManifest", "supportedFolders.ts"), environment),
  };
};

const normalizeKey = (value) => String(value).trim().toLocaleLowerCase();
const setMapping = (target, key, value, label) => {
  const normalized = normalizeKey(key);
  if (!normalized) return;
  target[normalized] = value;
};

const activeEntries = (entries) => (Array.isArray(entries) ? entries.filter((entry) => entry && !entry.disabled && entry.icon) : []);

const assetIdFor = (prefix, icon, light = false, opened = false) => {
  const actualPrefix =
    prefix === "file_type_"
      ? light
        ? "file_type_light_"
        : "file_type_"
      : light
        ? "folder_type_light_"
        : "folder_type_";
  return `${actualPrefix}${icon}${opened ? "_opened" : ""}.svg`;
};

const defaultAssetId = (icon, opened = false) => `default_${icon}${opened ? "_opened" : ""}.svg`;

const addFileEntry = (mappings, entry, assetId, lightAssetId) => {
  const variants = { dark: assetId, ...(lightAssetId ? { light: lightAssetId } : {}) };
  const isFilename = entry.filename === true;
  for (const extension of [...(entry.extensions || []), ...combineGlobs(entry)]) {
    if (isFilename) setMapping(mappings.fileNames, extension, variants, "file name");
    else setMapping(mappings.fileSuffixes, `.${String(extension).replace(/^\./, "")}`, variants, "file suffix");
  }
};

const combineGlobs = (entry) => {
  if (!Array.isArray(entry.filenamesGlob) || !Array.isArray(entry.extensionsGlob)) return [];
  return entry.filenamesGlob.flatMap((filename) => entry.extensionsGlob.map((extension) => `${filename}.${extension}`));
};

const addLanguageMappings = (mappings, entry, variants) => {
  for (const language of entry.languages || []) {
    for (const knownExtension of language.knownExtensions || []) {
      setMapping(mappings.fileSuffixes, `.${String(knownExtension).replace(/^\./, "")}`, variants, "language suffix");
    }
    for (const knownFilename of language.knownFilenames || []) {
      setMapping(mappings.fileNames, knownFilename, variants, "language file name");
    }
  }
};

const buildManifest = () => {
  const languages = parseLanguages();
  const { files, folders } = parseCollections(languages);
  if (!files?.default?.file || !folders?.default?.folder) fail("upstream collections do not contain defaults");
  const mappings = {
    fileNames: {},
    fileSuffixes: {},
    folderNames: {},
    folderNamesExpanded: {},
    defaults: {
      file: { dark: defaultAssetId(files.default.file.icon) },
      folder: { dark: defaultAssetId(folders.default.folder.icon) },
      folderExpanded: { dark: defaultAssetId(folders.default.folder.icon, true) },
    },
  };
  for (const entry of activeEntries(files.supported).sort((left, right) => left.icon.localeCompare(right.icon))) {
    const darkAsset = assetIdFor("file_type_", entry.icon);
    const lightAsset = entry.light ? assetIdFor("file_type_", entry.icon, true) : undefined;
    const variants = { dark: darkAsset, ...(lightAsset ? { light: lightAsset } : {}) };
    addFileEntry(mappings, entry, darkAsset, lightAsset);
    addLanguageMappings(mappings, entry, variants);
  }
  for (const entry of activeEntries(folders.supported).sort((left, right) => left.icon.localeCompare(right.icon))) {
    const darkAsset = assetIdFor("folder_type_", entry.icon);
    const darkOpenAsset = assetIdFor("folder_type_", entry.icon, false, true);
    const lightAsset = entry.light ? assetIdFor("folder_type_", entry.icon, true) : undefined;
    const lightOpenAsset = entry.light ? assetIdFor("folder_type_", entry.icon, true, true) : undefined;
    const collapsed = { dark: darkAsset, ...(lightAsset ? { light: lightAsset } : {}) };
    const expanded = { dark: darkOpenAsset, ...(lightOpenAsset ? { light: lightOpenAsset } : {}) };
    for (const folderName of entry.extensions || []) {
      setMapping(mappings.folderNames, folderName, collapsed, "folder");
      setMapping(mappings.folderNamesExpanded, folderName, expanded, "expanded folder");
    }
  }
  return { mappings, files, folders };
};

const listSvgFiles = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);
  if (entry.isSymbolicLink()) fail(`reference asset '${entryPath}' must not be a symbolic link`);
  return entry.isDirectory() ? listSvgFiles(entryPath) : entry.name.endsWith(".svg") ? [entryPath] : [];
  });

const copyAssets = () => {
  mkdirSync(sourceIconsDir, { recursive: true });
  mkdirSync(noticesDir, { recursive: true });
  const assets = {};
  for (const sourcePath of listSvgFiles(join(referenceDir, "icons"))) {
    const assetName = basename(sourcePath);
    const targetPath = join(sourceIconsDir, assetName);
  const sourceStat = lstatSync(sourcePath);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
    fail(`reference asset '${sourcePath}' must be a regular file`);
  }
  const contents = sanitizeSvg(sourcePath, readFileSync(sourcePath));
    writeFileSync(targetPath, contents);
    assets[assetName] = { format: "svg", encoding: "path", path: `icons/${assetName}` };
  }
  return assets;
};

const notices = () => {
  const upstreamLicense = sourceText(join(referenceDir, "LICENSE"));
  const upstreamReadme = sourceText(join(referenceDir, "README.md"));
  const attribution = [
    "vscode-icons derived icon pack",
    "",
    "Source repository: https://github.com/vscode-icons/vscode-icons",
    `Source version: ${upstreamVersion}`,
    "",
    "The vscode-icons source code is licensed under MIT.",
    "The icon assets are licensed under Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0).",
    "Branded icons may be subject to their own copyright or trademark licenses.",
    "This pack includes the complete referenced icon set without selectively excluding branded icons.",
    "",
    "The upstream README is included below for attribution context:",
    "",
    upstreamReadme,
  ].join("\n");
  writeFileSync(join(noticesDir, "LICENSE-MIT.txt"), upstreamLicense);
  writeFileSync(join(noticesDir, "NOTICE-ICON-ASSETS-CC-BY-SA-4.0.txt"), attribution);
  writeFileSync(join(noticesDir, "UPSTREAM-README.md"), upstreamReadme);
};

const sortRecord = (record) => Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)));
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

let sourceManifest;
let sourceAssets;
let upstreamVersion;
if (existsSync(referencePackagePath)) {
  const packageJson = JSON.parse(sourceText(referencePackagePath));
  upstreamVersion = String(packageJson.version || "").trim();
  if (!upstreamVersion) fail("upstream package version is missing");
  const { mappings } = buildManifest();
  sourceAssets = copyAssets();
  notices();
  sourceManifest = sortManifest({
    schemaVersion: 1,
    id: packId,
    name: "vscode-icons (derived)",
    version: packVersion,
    minHostVersion: "1",
    source: {
      repository: "vscode-icons/vscode-icons",
      version: upstreamVersion,
      url: "https://github.com/vscode-icons/vscode-icons",
    },
    mappings,
    assets: sourceAssets,
    notices: [
      {
        id: "vscode-icons-source",
        license: "MIT",
        text: "See LICENSES/LICENSE-MIT.txt for the complete upstream source license.",
        appliesTo: "vscode-icons source code and project derivation",
      },
      {
        id: "vscode-icons-assets",
        license: "CC BY-SA 4.0",
        text: "See LICENSES/NOTICE-ICON-ASSETS-CC-BY-SA-4.0.txt for attribution and asset licensing context.",
        appliesTo: "icon assets",
      },
      {
        id: "vscode-icons-branded-assets",
        license: "varies",
        text: "Branded icons may have their own copyright or trademark licenses.",
        appliesTo: "branded icon assets",
      },
    ],
  });
  writeFileSync(sourceManifestPath, `${JSON.stringify(sourceManifest, null, 2)}\n`);
} else {
  if (!existsSync(sourceManifestPath)) {
    fail(`icon-packs/${packId}/manifest.json is missing and no local upstream source is available`);
  }
  try {
    sourceManifest = JSON.parse(sourceText(sourceManifestPath));
  } catch {
    fail(`icon-packs/${packId}/manifest.json is not valid JSON`);
  }
  validateCheckedInSourceManifest(sourceManifest);
  sourceManifest = sortManifest({ ...sourceManifest, version: packVersion });
  sourceAssets = sourceManifest.assets;
  writeFileSync(sourceManifestPath, `${JSON.stringify(sourceManifest, null, 2)}\n`);
  upstreamVersion = String(sourceManifest.source.version).trim();
}

rmSync(releaseDir, { recursive: true, force: true });
mkdirSync(releaseDir, { recursive: true });
const releaseManifest = {
  ...sourceManifest,
  assets: Object.fromEntries(
    Object.entries(sourceAssets).map(([assetId, asset]) => {
      const data = readFileSync(join(sourceDir, asset.path)).toString("base64");
      return [assetId, { format: asset.format, encoding: "base64", data }];
    }),
  ),
};
const releaseAssetName = `utools-project-launch-${packId}-${sourceManifest.version}.iconpack.json.gz`;
const releaseBytes = gzipSync(Buffer.from(`${JSON.stringify(sortManifest(releaseManifest))}\n`), { level: 9 });
const releasePath = join(releaseDir, releaseAssetName);
writeFileSync(releasePath, releaseBytes);
const checksum = createHash("sha256").update(releaseBytes).digest("hex");
writeFileSync(join(releaseDir, "checksums.txt"), `${checksum}  ${releaseAssetName}\n`);
const releaseLicenseText = [
  "vscode-icons derived icon pack",
  "",
  `Source repository: https://github.com/vscode-icons/vscode-icons`,
  `Source version: ${upstreamVersion}`,
  "",
  "This pack includes the complete referenced icon set without selectively excluding branded icons.",
  "The vscode-icons source code is licensed under MIT.",
  "The icon assets are licensed under Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0).",
  "Branded icons may be subject to their own copyright or trademark licenses.",
  "",
  "===== LICENSE-MIT.txt =====",
  sourceText(join(noticesDir, "LICENSE-MIT.txt")),
  "",
  "===== NOTICE-ICON-ASSETS-CC-BY-SA-4.0.txt =====",
  sourceText(join(noticesDir, "NOTICE-ICON-ASSETS-CC-BY-SA-4.0.txt")),
  "",
  "===== UPSTREAM-README.md =====",
  sourceText(join(noticesDir, "UPSTREAM-README.md")),
].join("\n");
writeFileSync(join(releaseDir, "LICENSES-vscode-icons.txt"), releaseLicenseText);

console.info(
  `[icon-pack] generated ${Object.keys(sourceAssets).length} assets and ${Object.keys(sourceManifest.mappings.fileNames).length} file-name mappings`,
);
console.info(`[icon-pack] source: ${relative(rootDir, sourceDir)}`);
console.info(`[icon-pack] release: ${relative(rootDir, releasePath)}`);