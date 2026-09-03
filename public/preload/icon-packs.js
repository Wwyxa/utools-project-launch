const iconPackSchemaVersion = 1;
const iconPackHostVersion = 1;
const iconPackBuiltinId = "builtin";
const iconPackId = "vscode-icons-derived";
const iconPackSourceRepository = "vscode-icons/vscode-icons";
const iconPackSourceUrl = "https://github.com/vscode-icons/vscode-icons";
const iconPackReleaseTagPrefix = "icon-pack-v";
const iconPackReleaseApiUrl = "https://api.github.com/repos/Wwyxa/utools-project-launch/releases?per_page=30";
const iconPackDownloadHosts = new Set([
  "api.github.com",
  "github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
  "github-releases.githubusercontent.com",
]);
const iconPackCompressedLimitBytes = 32 * 1024 * 1024;
const iconPackDecompressedLimitBytes = 128 * 1024 * 1024;
const iconPackAssetLimitBytes = 4 * 1024 * 1024;
const iconPackTotalAssetLimitBytes = 64 * 1024 * 1024;
const iconPackAssetCountLimit = 20_000;
const iconPackDownloadTimeoutMs = 30_000;
const iconPackDownloadRedirectLimit = 3;
const iconPackInstallDirectoryName = "icon-packs";
const iconPackInstallName = "vscode-icons-derived";
const iconPackPackageName = "pack.json.gz";
const iconPackInstallMetadataName = "install.json";
const iconPackReleaseUrl = "https://github.com/Wwyxa/utools-project-launch/releases";
function iconPackExpectedAssetName(version) {
  return `utools-project-launch-${iconPackId}-${version}.iconpack.json.gz`;
}
const iconPackCreateGunzip = require("zlib").createGunzip;
const iconPackBase64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const iconPackAssetIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/;
const iconPackIdPattern = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
const iconPackSvgPattern = /<svg(?:\s|>)/i;
const iconPackUnsafeSvgPattern =
  /<!doctype|<!entity|<\/?(?:script|iframe|object|embed)\b|\bon[a-z][\w-]*\s*=|javascript\s*:|\b(?:href|xlink:href|src)\s*=\s*["']?(?:https?:|ftp:|file:|data:|\/\/|\\\\)|url\(\s*["']?(?:https?:|ftp:|file:|data:|\/\/|\\\\)/i;
const iconPackSafeEmbeddedPngPattern =
  /((?:href|xlink:href|src)\s*=\s*["'])data:image\/png;base64,[A-Za-z0-9+/]+={0,2}(["'])/gi;
let iconPackDownloadPromise = null;

function iconPackError(message, code) {
  const error = new Error(message);
  if (code) error.code = code;
  return error;
}

function iconPackIsRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function iconPackNormalizeVariant(value) {
  if (!iconPackIsRecord(value) || typeof value.dark !== "string" || !value.dark.trim()) return null;
  if (value.light !== undefined && (typeof value.light !== "string" || !value.light.trim())) return null;
  return {
    dark: value.dark.trim(),
    ...(typeof value.light === "string" ? { light: value.light.trim() } : {}),
  };
}

function iconPackNormalizeMapping(value, keyValidator = (key) => Boolean(key) && !/[\\/]/.test(key)) {
  if (!iconPackIsRecord(value)) return null;
  const result = Object.create(null);
  for (const [rawKey, rawVariant] of Object.entries(value)) {
    const key = rawKey.trim().toLocaleLowerCase();
    if (!key || key.length > 256 || !keyValidator(key) || result[key] || !iconPackNormalizeVariant(rawVariant)) {
      return null;
    }
    result[key] = iconPackNormalizeVariant(rawVariant);
  }
  return result;
}

function iconPackNormalizeNotices(value) {
  if (!Array.isArray(value) || value.length < 3 || value.length > 256) return null;
  const notices = [];
  for (const item of value) {
    if (
      !iconPackIsRecord(item) ||
      typeof item.id !== "string" ||
      typeof item.license !== "string" ||
      typeof item.text !== "string" ||
      typeof item.appliesTo !== "string" ||
      !item.id.trim() ||
      !item.license.trim() ||
      !item.text.trim() ||
      !item.appliesTo.trim()
    ) {
      return null;
    }
    notices.push({
      id: item.id.trim(),
      license: item.license.trim(),
      text: item.text,
      appliesTo: item.appliesTo.trim(),
    });
  }
  return notices;
}

function iconPackIsSafeAsset(value) {
  if (!iconPackIsRecord(value) || (value.format !== "svg" && value.format !== "png") || value.encoding !== "base64") {
    return false;
  }
  if (
    typeof value.data !== "string" ||
    value.data.length === 0 ||
    value.data.length > iconPackAssetLimitBytes ||
    value.data.length % 4 !== 0 ||
    !iconPackBase64Pattern.test(value.data)
  ) {
    return false;
  }
  let bytes;
  try {
    bytes = Buffer.from(value.data, "base64");
  } catch (error) {
    return false;
  }
  if (bytes.length === 0) return false;
  if (value.format === "png") {
    return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from("\x89PNG\r\n\x1a\n", "binary"));
  }
  const text = bytes.toString("utf8");
  const sanitized = text.replace(iconPackSafeEmbeddedPngPattern, "$1$2");
  return iconPackSvgPattern.test(text) && !iconPackUnsafeSvgPattern.test(sanitized);
}

function iconPackNormalizeMappings(value) {
  if (!iconPackIsRecord(value) || !iconPackIsRecord(value.defaults)) return null;
  const fileNames = iconPackNormalizeMapping(value.fileNames);
  const fileSuffixes = iconPackNormalizeMapping(value.fileSuffixes, (key) => key.startsWith(".") && !/[\\/]/.test(key));
  const folderNames = iconPackNormalizeMapping(value.folderNames);
  const folderNamesExpanded = iconPackNormalizeMapping(value.folderNamesExpanded);
  const file = iconPackNormalizeVariant(value.defaults.file);
  const folder = iconPackNormalizeVariant(value.defaults.folder);
  const folderExpanded = iconPackNormalizeVariant(value.defaults.folderExpanded);
  if (!fileNames || !fileSuffixes || !folderNames || !folderNamesExpanded || !file || !folder || !folderExpanded) {
    return null;
  }
  return { fileNames, fileSuffixes, folderNames, folderNamesExpanded, defaults: { file, folder, folderExpanded } };
}

function iconPackSourceUrlIsSafe(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch (error) {
    return false;
  }
}

function iconPackMappingReferences(mappings) {
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
}

function normalizeIconPackManifest(value) {
  if (!iconPackIsRecord(value) || value.schemaVersion !== iconPackSchemaVersion) return null;
  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.version !== "string" ||
    !value.id.trim() ||
    !value.name.trim() ||
    !value.version.trim() ||
    !iconPackIdPattern.test(value.id.trim()) ||
    value.id.trim() === iconPackBuiltinId ||
    !iconPackIsRecord(value.source) ||
    typeof value.source.repository !== "string" ||
    typeof value.source.version !== "string" ||
    typeof value.source.url !== "string" ||
    !value.source.repository.trim() ||
    !value.source.version.trim() ||
    !iconPackSourceUrlIsSafe(value.source.url.trim())
  ) {
    return null;
  }
  const minHostVersion =
    value.minHostVersion === undefined
      ? undefined
      : typeof value.minHostVersion === "string" && /^\d+$/.test(value.minHostVersion.trim())
        ? value.minHostVersion.trim()
        : null;
  if (minHostVersion === null) return null;
  const mappings = iconPackNormalizeMappings(value.mappings);
  const notices = iconPackNormalizeNotices(value.notices);
  if (!mappings || !notices || !iconPackIsRecord(value.assets)) return null;

  const assets = Object.create(null);
  let totalDataLength = 0;
  for (const [assetId, rawAsset] of Object.entries(value.assets)) {
    if (!iconPackAssetIdPattern.test(assetId) || assets[assetId] || !iconPackIsSafeAsset(rawAsset)) return null;
    totalDataLength += rawAsset.data.length;
    if (totalDataLength > iconPackTotalAssetLimitBytes) return null;
    assets[assetId] = {
      format: rawAsset.format,
      encoding: "base64",
      data: rawAsset.data,
    };
  }
  const references = iconPackMappingReferences(mappings);
  if (
    Object.keys(assets).length === 0 ||
    Object.keys(assets).length > iconPackAssetCountLimit ||
    references.some((assetId) => !assets[assetId])
  ) {
    return null;
  }
  return {
    schemaVersion: iconPackSchemaVersion,
    id: value.id.trim(),
    name: value.name.trim(),
    version: value.version.trim(),
    ...(minHostVersion ? { minHostVersion } : {}),
    source: {
      repository: value.source.repository.trim(),
      version: value.source.version.trim(),
      url: value.source.url.trim(),
    },
    mappings,
    assets,
    notices,
  };
}

function iconPackManifestIsCompatible(manifest) {
  if (!manifest.minHostVersion) return true;
  const minimum = Number(manifest.minHostVersion);
  return Number.isSafeInteger(minimum) && minimum <= iconPackHostVersion;
}

function iconPackManifestIsOfficial(manifest, version = "") {
  return Boolean(
    manifest &&
    manifest.id === iconPackId &&
    manifest.source.repository === iconPackSourceRepository &&
    manifest.source.url === iconPackSourceUrl &&
    (!version || manifest.version === version) &&
    iconPackManifestIsCompatible(manifest),
  );
}

function iconPackRootDirectory() {
  return path.join(path.dirname(getDeviceIdFilePath()), iconPackInstallDirectoryName);
}

function iconPackDirectory() {
  return path.join(iconPackRootDirectory(), iconPackInstallName);
}

function iconPackPackagePath() {
  return path.join(iconPackDirectory(), iconPackPackageName);
}

function iconPackInstallMetadataPath() {
  return path.join(iconPackDirectory(), iconPackInstallMetadataName);
}

function iconPackPathIsWithin(parentPath, childPath) {
  const parent = path.resolve(parentPath);
  const child = path.resolve(childPath);
  return child === parent || child.startsWith(`${parent}${path.sep}`);
}

function iconPackAssertPaths() {
  const root = iconPackRootDirectory();
  const directory = iconPackDirectory();
  const packagePath = iconPackPackagePath();
  const metadataPath = iconPackInstallMetadataPath();
  if (![directory, packagePath, metadataPath].every((candidate) => iconPackPathIsWithin(root, candidate))) {
    throw iconPackError("外部图标包安装路径无效。", "invalid-install-path");
  }
  for (const directoryPath of [root, directory]) {
    if (!fs.existsSync(directoryPath)) continue;
    const stats = fs.lstatSync(directoryPath);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw iconPackError("外部图标包安装目录无效。", "invalid-install-path");
    }
  }
  return { root, directory, packagePath, metadataPath };
}

function iconPackUnavailableResult(message = "尚未安装外部图标包。") {
  return { ok: false, manifest: null, state: "unavailable", message };
}

function iconPackInvalidResult(message = "已安装的外部图标包无效，请重新安装。") {
  return { ok: false, manifest: null, state: "invalid", message };
}

async function iconPackDecompress(bytes) {
  return new Promise((resolve, reject) => {
    const decoder = iconPackCreateGunzip();
    const chunks = [];
    let totalBytes = 0;
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };
    decoder.on("data", (chunk) => {
      totalBytes += Buffer.byteLength(chunk);
      if (totalBytes > iconPackDecompressedLimitBytes) {
        const error = iconPackError("外部图标包解压后超过大小限制。", "decompressed-too-large");
        finish(reject, error);
        decoder.destroy(error);
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    decoder.on("error", (error) => finish(reject, error));
    decoder.on("end", () => finish(resolve, Buffer.concat(chunks, totalBytes)));
    decoder.end(bytes);
  });
}

function iconPackReadInstallMetadata(metadataPath) {
  let metadata;
  try {
    const stats = fs.lstatSync(metadataPath);
    if (!stats.isFile() || stats.isSymbolicLink()) throw new Error("metadata is not a regular file");
    metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  } catch (error) {
    throw iconPackError("外部图标包缺少可信安装记录。", "invalid-install-metadata");
  }
  if (
    !iconPackIsRecord(metadata) ||
    metadata.schemaVersion !== iconPackSchemaVersion ||
    metadata.packId !== iconPackId ||
    typeof metadata.version !== "string" ||
    !metadata.version.trim() ||
    typeof metadata.assetName !== "string" ||
    !metadata.assetName.trim() ||
    metadata.assetName !== iconPackExpectedAssetName(metadata.version.trim()) ||
    typeof metadata.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/i.test(metadata.sha256)
  ) {
    throw iconPackError("外部图标包安装记录无效。", "invalid-install-metadata");
  }
  return {
    schemaVersion: iconPackSchemaVersion,
    packId: iconPackId,
    version: metadata.version.trim(),
    assetName: metadata.assetName.trim(),
    sha256: metadata.sha256.toLowerCase(),
  };
}

async function loadInstalledIconPack() {
  let paths;
  try {
    paths = iconPackAssertPaths();
    const packageExists = fs.existsSync(paths.packagePath);
    const metadataExists = fs.existsSync(paths.metadataPath);
    if (!packageExists && !metadataExists) return iconPackUnavailableResult();
    if (!packageExists || !metadataExists) return iconPackInvalidResult("外部图标包安装不完整，请重新安装。");

    const metadata = iconPackReadInstallMetadata(paths.metadataPath);
    const packageStats = fs.lstatSync(paths.packagePath);
    if (
      !packageStats.isFile() ||
      packageStats.isSymbolicLink() ||
      packageStats.size <= 0 ||
      packageStats.size > iconPackCompressedLimitBytes
    ) {
      return iconPackInvalidResult("外部图标包压缩文件超过大小限制或不是普通文件。");
    }
    const compressed = fs.readFileSync(paths.packagePath);
    const actualHash = crypto.createHash("sha256").update(compressed).digest("hex");
    if (actualHash !== metadata.sha256) return iconPackInvalidResult("外部图标包校验失败，请重新安装。");
    const manifestValue = JSON.parse((await iconPackDecompress(compressed)).toString("utf8"));
    const manifest = normalizeIconPackManifest(manifestValue);
    if (!manifest || !iconPackManifestIsOfficial(manifest, metadata.version)) {
      return iconPackInvalidResult("外部图标包内容与安装记录不匹配。");
    }
    return { ok: true, manifest, state: "loaded" };
  } catch (error) {
    if (error?.code === "decompressed-too-large") return iconPackInvalidResult(error.message);
    if (error?.code === "invalid-install-metadata") return iconPackInvalidResult(error.message);
    return iconPackInvalidResult("外部图标包无法读取或解析，请重新安装。");
  }
}

function iconPackSelectedId() {
  try {
    return readUiPreferences().iconPackId || iconPackBuiltinId;
  } catch (error) {
    return iconPackBuiltinId;
  }
}

async function getIconPackStatus() {
  const selectedPackId = iconPackSelectedId();
  const loadResult = await loadInstalledIconPack();
  if (loadResult.ok && loadResult.manifest) {
    const active = selectedPackId === loadResult.manifest.id;
    return {
      selectedPackId,
      installedPackId: loadResult.manifest.id,
      installedVersion: loadResult.manifest.version,
      state: "installed",
      active,
      ...(active ? {} : { message: "外部图标包已安装，但当前使用内置图标。" }),
    };
  }
  return {
    selectedPackId,
    installedPackId: null,
    installedVersion: null,
    state: loadResult.state,
    active: false,
    message: loadResult.message,
  };
}

function iconPackUrlIsAllowed(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && iconPackDownloadHosts.has(parsed.hostname.toLowerCase());
  } catch (error) {
    return false;
  }
}

function fetchIconPackBytes(url, options = {}, redirectCount = 0) {
  const maxBytes = Number.isFinite(options.maxBytes) ? Math.floor(options.maxBytes) : iconPackCompressedLimitBytes;
  const expectedTotalBytes =
    Number.isFinite(options.totalBytes) && options.totalBytes > 0 ? Math.floor(options.totalBytes) : undefined;
  if (!iconPackUrlIsAllowed(url)) {
    return Promise.reject(iconPackError("外部图标包下载地址不受支持。", "invalid-download-url"));
  }
  if (redirectCount > iconPackDownloadRedirectLimit) {
    return Promise.reject(iconPackError("外部图标包下载重定向次数过多。", "too-many-redirects"));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch (error) {
      finish(reject, iconPackError("外部图标包下载地址无效。", "invalid-download-url"));
      return;
    }
    const request = https.get(
      {
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        timeout: iconPackDownloadTimeoutMs,
        headers: {
          Accept: "application/octet-stream, application/json",
          "User-Agent": "utools-project-launch",
        },
      },
      (response) => {
        const statusCode = response.statusCode || 0;
        if (statusCode >= 300 && statusCode < 400 && response.headers?.location) {
          let nextUrl;
          try {
            nextUrl = new URL(response.headers.location, url).toString();
          } catch (error) {
            response.resume();
            finish(reject, iconPackError("外部图标包重定向地址无效。", "invalid-download-url"));
            return;
          }
          response.resume();
          fetchIconPackBytes(nextUrl, options, redirectCount + 1).then(
            (value) => finish(resolve, value),
            (error) => finish(reject, error),
          );
          return;
        }
        if (statusCode < 200 || statusCode >= 300) {
          response.resume();
          finish(reject, iconPackError(`外部图标包下载请求失败（HTTP ${statusCode}）。`, `http-${statusCode}`));
          return;
        }
        const contentLength = Number(response.headers?.["content-length"]);
        if (Number.isFinite(contentLength) && contentLength > maxBytes) {
          response.resume();
          finish(reject, iconPackError("外部图标包响应超过大小限制。", "response-too-large"));
          return;
        }
        const progressTotalBytes =
          Number.isFinite(contentLength) && contentLength > 0 ? contentLength : expectedTotalBytes;
        const chunks = [];
        let totalBytes = 0;
        response.on("data", (chunk) => {
          const buffer = Buffer.from(chunk);
          totalBytes += buffer.length;
          if (totalBytes > maxBytes) {
            response.destroy();
            finish(reject, iconPackError("外部图标包响应超过大小限制。", "response-too-large"));
            return;
          }
          chunks.push(buffer);
          if (
            typeof options.onProgress === "function" &&
            Number.isFinite(progressTotalBytes) &&
            progressTotalBytes > 0
          ) {
            options.onProgress(totalBytes, progressTotalBytes);
          }
        });
        response.on("aborted", () => finish(reject, iconPackError("外部图标包下载中断。", "download-aborted")));
        response.on("error", (error) => finish(reject, error));
        response.on("end", () => finish(resolve, Buffer.concat(chunks, totalBytes)));
      },
    );
    request.on("timeout", () => {
      const error = iconPackError("外部图标包下载超时。", "download-timeout");
      request.destroy(error);
    });
    request.on("error", (error) => finish(reject, error));
  });
}

function iconPackReleaseVersion(tagName) {
  if (typeof tagName !== "string" || !tagName.startsWith(iconPackReleaseTagPrefix)) return "";
  const version = tagName.slice(iconPackReleaseTagPrefix.length).trim();
  return /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version) ? version : "";
}

function iconPackReleaseAsset(release, assetName, maxBytes) {
  const asset = Array.isArray(release?.assets)
    ? release.assets.find((candidate) => candidate?.name === assetName)
    : null;
  if (
    !asset ||
    typeof asset.browser_download_url !== "string" ||
    !iconPackUrlIsAllowed(asset.browser_download_url) ||
    (Number.isFinite(asset.size) && asset.size <= 0) ||
    (Number.isFinite(asset.size) && asset.size > maxBytes)
  ) {
    return null;
  }
  return asset;
}

function iconPackChecksum(contents, assetName) {
  const match = String(contents)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => line.match(/^([0-9a-f]{64})\s+\*?(.+)$/i))
    .find((candidate) => candidate && candidate[2].replace(/^\.\//, "") === assetName);
  if (!match) throw iconPackError(`checksums.txt 中缺少 ${assetName} 的校验值。`, "checksum-not-found");
  return match[1].toLowerCase();
}

async function fetchIconPackRelease() {
  const response = await fetchIconPackBytes(iconPackReleaseApiUrl, { maxBytes: 2 * 1024 * 1024 });
  let releases;
  try {
    releases = JSON.parse(response.toString("utf8"));
  } catch (error) {
    throw iconPackError("GitHub 图标包 Release 响应不是有效 JSON。", "invalid-release-metadata");
  }
  if (!Array.isArray(releases)) throw iconPackError("GitHub 图标包 Release 响应格式无效。", "invalid-release-metadata");
  const candidates = releases
    .filter((release) => !release?.draft && !release?.prerelease)
    .map((release) => ({ release, version: iconPackReleaseVersion(release?.tag_name) }))
    .filter(({ version }) => Boolean(version));
  candidates.sort((left, right) => {
    const leftDate = Date.parse(left.release.published_at || left.release.created_at || "");
    const rightDate = Date.parse(right.release.published_at || right.release.created_at || "");
    return (Number.isFinite(rightDate) ? rightDate : 0) - (Number.isFinite(leftDate) ? leftDate : 0);
  });
  for (const candidate of candidates) {
    const assetName = `utools-project-launch-${iconPackId}-${candidate.version}.iconpack.json.gz`;
    const packageAsset = iconPackReleaseAsset(candidate.release, assetName, iconPackCompressedLimitBytes);
    const checksumAsset = iconPackReleaseAsset(candidate.release, "checksums.txt", 2 * 1024 * 1024);
    if (!packageAsset || !checksumAsset) continue;
    const checksumContents = await fetchIconPackBytes(checksumAsset.browser_download_url, {
      maxBytes: 2 * 1024 * 1024,
    });
    return {
      release: candidate.release,
      version: candidate.version,
      assetName,
      packageAsset,
      expectedHash: iconPackChecksum(checksumContents.toString("utf8"), assetName),
    };
  }
  throw iconPackError("当前发布未提供兼容的外部图标包资源。", "asset-not-found");
}

function iconPackVersionParts(version) {
  const match = String(version).match(/^(\d+)\.(\d+)\.(\d+)(?:-.*?\.(\d+))?$/);
  return match ? match.slice(1).map((value) => Number(value || 0)) : [0, 0, 0, 0];
}

function iconPackVersionIsNewer(candidate, current) {
  const candidateParts = iconPackVersionParts(candidate);
  const currentParts = iconPackVersionParts(current);
  for (let index = 0; index < candidateParts.length; index += 1) {
    if (candidateParts[index] !== currentParts[index]) return candidateParts[index] > currentParts[index];
  }
  return candidate !== current;
}

async function checkIconPackUpdate() {
  try {
    const current = await loadInstalledIconPack();
    const release = await fetchIconPackRelease();
    const currentVersion = current.ok && current.manifest ? current.manifest.version : "";
    return {
      ok: true,
      updateAvailable: !currentVersion || iconPackVersionIsNewer(release.version, currentVersion),
      latestVersion: release.version,
      assetName: release.assetName,
      ...(currentVersion && !iconPackVersionIsNewer(release.version, currentVersion)
        ? { message: "外部图标包已是最新版本。" }
        : {}),
    };
  } catch (error) {
    return { ok: false, updateAvailable: false, message: "外部图标包更新检查失败，请稍后重试。" };
  }
}

function iconPackInstallMetadata(version, assetName, sha256) {
  if (!version || assetName !== iconPackExpectedAssetName(version) || !/^[0-9a-f]{64}$/i.test(sha256)) {
    throw iconPackError("外部图标包安装元数据无效。", "invalid-install-metadata");
  }
  return { schemaVersion: iconPackSchemaVersion, packId: iconPackId, version, assetName, sha256: sha256.toLowerCase() };
}

function iconPackUnlink(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function iconPackCleanupBackup(filePath) {
  try {
    iconPackUnlink(filePath);
  } catch (error) {
    console.warn("[utools-project-launch] failed to remove previous icon pack backup");
  }
}

function installIconPackBytes(contents, expectedHash, manifest, assetName) {
  const paths = iconPackAssertPaths();
  if (!Buffer.isBuffer(contents) || contents.length === 0 || contents.length > iconPackCompressedLimitBytes) {
    throw iconPackError("外部图标包压缩文件超过大小限制。", "response-too-large");
  }
  const actualHash = crypto.createHash("sha256").update(contents).digest("hex");
  if (actualHash !== expectedHash.toLowerCase())
    throw iconPackError("外部图标包校验失败，文件未安装。", "checksum-mismatch");
  if (!manifest || manifest.id !== iconPackId || !assetName) {
    throw iconPackError("外部图标包内容无效，文件未安装。", "invalid-manifest");
  }
  const transactionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const packagePartialPath = path.join(paths.directory, `.${iconPackPackageName}.${transactionId}.partial`);
  const metadataPartialPath = path.join(paths.directory, `.${iconPackInstallMetadataName}.${transactionId}.partial`);
  const packageBackupPath = path.join(paths.directory, `.${iconPackPackageName}.${transactionId}.backup`);
  const metadataBackupPath = path.join(paths.directory, `.${iconPackInstallMetadataName}.${transactionId}.backup`);
  let packageBackupCreated = false;
  let metadataBackupCreated = false;
  let packageInstalled = false;
  let metadataInstalled = false;
  try {
    fs.mkdirSync(paths.directory, { recursive: true });
    fs.writeFileSync(packagePartialPath, contents, { mode: 0o600 });
    const metadata = iconPackInstallMetadata(manifest.version, assetName, expectedHash);
    fs.writeFileSync(metadataPartialPath, `${JSON.stringify(metadata)}\n`, { mode: 0o600 });
    if (fs.existsSync(paths.packagePath)) {
      fs.renameSync(paths.packagePath, packageBackupPath);
      packageBackupCreated = true;
    }
    if (fs.existsSync(paths.metadataPath)) {
      fs.renameSync(paths.metadataPath, metadataBackupPath);
      metadataBackupCreated = true;
    }
    fs.renameSync(packagePartialPath, paths.packagePath);
    packageInstalled = true;
    fs.renameSync(metadataPartialPath, paths.metadataPath);
    metadataInstalled = true;
    const installedHash = crypto.createHash("sha256").update(fs.readFileSync(paths.packagePath)).digest("hex");
    if (installedHash !== metadata.sha256) throw iconPackError("外部图标包安装后校验失败。", "checksum-mismatch");
    if (packageBackupCreated) iconPackCleanupBackup(packageBackupPath);
    if (metadataBackupCreated) iconPackCleanupBackup(metadataBackupPath);
  } catch (error) {
    try {
      iconPackUnlink(packagePartialPath);
      iconPackUnlink(metadataPartialPath);
      if (metadataInstalled) iconPackUnlink(paths.metadataPath);
      if (packageInstalled) iconPackUnlink(paths.packagePath);
      if (metadataBackupCreated) fs.renameSync(metadataBackupPath, paths.metadataPath);
      if (packageBackupCreated) fs.renameSync(packageBackupPath, paths.packagePath);
    } catch (restoreError) {
      console.warn("[utools-project-launch] failed to restore previous icon pack");
    }
    throw error;
  }
}

function iconPackDownloadFailureResult(current, error) {
  return {
    ok: false,
    manifest: current.ok ? current.manifest : null,
    state: current.state,
    message:
      error?.code === "checksum-mismatch"
        ? "外部图标包校验失败，已保留原有安装。"
        : error?.code === "invalid-manifest"
          ? "外部图标包内容无效，已保留原有安装。"
          : "外部图标包下载或安装失败，已保留原有安装。",
  };
}

async function downloadIconPackInternal() {
  const current = await loadInstalledIconPack();
  try {
    const release = await fetchIconPackRelease();
    let lastProgress = -1;
    const reportProgress = (receivedBytes, totalBytes) => {
      if (!Number.isFinite(totalBytes) || totalBytes <= 0) return;
      const percent = Math.max(0, Math.min(100, Math.floor((receivedBytes / totalBytes) * 100)));
      if (percent === lastProgress) return;
      lastProgress = percent;
      window.dispatchEvent(
        new CustomEvent("project-bridge-event", {
          detail: {
            type: "icon-pack-download-progress",
            receivedBytes: Math.max(0, Math.floor(receivedBytes)),
            totalBytes: Math.floor(totalBytes),
            percent,
            timestamp: new Date().toISOString(),
          },
        }),
      );
    };
    reportProgress(0, release.packageAsset.size);
    const contents = await fetchIconPackBytes(release.packageAsset.browser_download_url, {
      maxBytes: iconPackCompressedLimitBytes,
      totalBytes: release.packageAsset.size,
      onProgress: reportProgress,
    });
    if (crypto.createHash("sha256").update(contents).digest("hex") !== release.expectedHash) {
      throw iconPackError("外部图标包校验失败，文件未安装。", "checksum-mismatch");
    }
    const manifestValue = JSON.parse((await iconPackDecompress(contents)).toString("utf8"));
    const manifest = normalizeIconPackManifest(manifestValue);
    if (!manifest || !iconPackManifestIsOfficial(manifest, release.version)) {
      throw iconPackError("外部图标包内容与发布版本不匹配。", "invalid-manifest");
    }
    installIconPackBytes(contents, release.expectedHash, manifest, release.assetName);
    const installed = await loadInstalledIconPack();
    return installed.ok ? installed : iconPackInvalidResult("外部图标包安装后无法读取。");
  } catch (error) {
    return iconPackDownloadFailureResult(current, error);
  }
}

async function downloadIconPack() {
  if (!iconPackDownloadPromise) {
    iconPackDownloadPromise = downloadIconPackInternal().finally(() => {
      iconPackDownloadPromise = null;
    });
  }
  return iconPackDownloadPromise;
}

function iconPackManualAssetCandidates(paths) {
  if (!fs.existsSync(paths.directory)) return [];
  return fs
    .readdirSync(paths.directory, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        !entry.isSymbolicLink() &&
        (entry.name === iconPackPackageName || entry.name.endsWith(".iconpack.json.gz")),
    )
    .map((entry) => path.join(paths.directory, entry.name));
}

async function verifyIconPackInstall() {
  try {
    const paths = iconPackAssertPaths();
    if (!fs.existsSync(paths.directory)) return iconPackUnavailableResult("尚未找到可验证的外部图标包。");
    const candidates = iconPackManualAssetCandidates(paths);
    for (const candidatePath of candidates) {
      try {
        const stats = fs.lstatSync(candidatePath);
        if (stats.size <= 0 || stats.size > iconPackCompressedLimitBytes) continue;
        const contents = fs.readFileSync(candidatePath);
        const manifestValue = JSON.parse((await iconPackDecompress(contents)).toString("utf8"));
        const manifest = normalizeIconPackManifest(manifestValue);
        if (!manifest || !iconPackManifestIsOfficial(manifest)) continue;
        const assetName = iconPackExpectedAssetName(manifest.version);
        const candidateName = path.basename(candidatePath);
        if (candidateName !== iconPackPackageName && candidateName !== assetName) continue;
        const expectedHash = crypto.createHash("sha256").update(contents).digest("hex");
        installIconPackBytes(contents, expectedHash, manifest, assetName);
        if (candidatePath !== paths.packagePath) iconPackUnlink(candidatePath);
        return { ok: true, manifest, state: "loaded" };
      } catch (error) {
        continue;
      }
    }
    return iconPackUnavailableResult("未找到可验证的外部图标包，请先下载并放入图标包目录。");
  } catch (error) {
    if (error?.code === "invalid-install-path") return iconPackInvalidResult(error.message);
    return iconPackUnavailableResult("尚未找到可验证的外部图标包。");
  }
}

function openIconPackDirectory() {
  const paths = iconPackAssertPaths();
  fs.mkdirSync(paths.directory, { recursive: true });
  return shell.openPath(paths.directory);
}

function openIconPackReleases() {
  return shell.openExternal(iconPackReleaseUrl);
}

async function removeIconPack() {
  const before = await getIconPackStatus();
  try {
    if (iconPackSelectedId() !== iconPackBuiltinId) {
      const currentPreferences = readUiPreferences();
      const nextPreferences = normalizeUiPreferences({ ...currentPreferences, iconPackId: iconPackBuiltinId });
      writeStoredValue(uiPreferencesStorageKey, nextPreferences);
      const confirmedPreferences = normalizeUiPreferences(readStoredValue(uiPreferencesStorageKey));
      if (confirmedPreferences.iconPackId !== iconPackBuiltinId) {
        throw iconPackError("无法先切换回内置图标，已保留外部图标包。", "preference-write-failed");
      }
    }
    const paths = iconPackAssertPaths();
    fs.rmSync(paths.directory, { recursive: true, force: true });
    return { ok: true, status: await getIconPackStatus() };
  } catch (error) {
    return {
      ok: false,
      status: before,
      message: error?.code === "preference-write-failed" ? error.message : "外部图标包移除失败，已保留现有安装。",
    };
  }
}
