import type {
  IconPackAsset,
  IconPackColorMode,
  IconPackId,
  IconPackIconVariant,
  IconPackManifest,
  IconPackMappings,
  IconPackNotice,
} from "../types";

export const BUILTIN_ICON_PACK_ID = "builtin";
export const VSCODE_ICON_PACK_ID = "vscode-icons-derived";
export const ICON_PACK_SCHEMA_VERSION = 1;
export const ICON_PACK_HOST_VERSION = 1;
export const ICON_PACK_MAX_ASSET_DATA_LENGTH = 4 * 1024 * 1024;
export const ICON_PACK_MAX_TOTAL_ASSET_DATA_LENGTH = 64 * 1024 * 1024;
export const ICON_PACK_MAX_ASSET_COUNT = 20_000;

type FileIconKind = "file" | "directory";

export interface FileIconResolveInput {
  name: string;
  path: string;
  kind: FileIconKind;
  expanded?: boolean;
  colorMode?: IconPackColorMode;
}

export type FileIconResolution =
  | { kind: "external"; assetId: string; src: string }
  | { kind: "fallback"; fallbackKey: FileIconFallbackKey };

export type FileIconFallbackKey =
  | "file"
  | "folder"
  | "package"
  | "json"
  | "text"
  | "image"
  | "terminal"
  | "binary"
  | "braces"
  | "code";

const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const unsafeSvgPattern =
  /<!doctype|<!entity|<\/?(?:script|iframe|object|embed)\b|\bon[a-z][\w-]*\s*=|javascript\s*:|\b(?:href|xlink:href|src)\s*=\s*["']?(?:https?:|ftp:|file:|data:|\/\/|\\\\)|url\(\s*["']?(?:https?:|ftp:|file:|data:|\/\/|\\\\)/i;
const safeEmbeddedPngPattern = /((?:href|xlink:href|src)\s*=\s*["'])data:image\/png;base64,[A-Za-z0-9+/]+={0,2}(["'])/gi;
const svgPattern = /<svg(?:\s|>)/i;
const iconPackIdPattern = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
const iconPackAssetIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const decodeBase64 = (data: string): string | null => {
  try {
    if (typeof globalThis.atob !== "function") return null;
    return globalThis.atob(data);
  } catch {
    return null;
  }
};

const isSafeAsset = (asset: unknown): asset is IconPackAsset => {
  if (!isRecord(asset) || (asset.format !== "svg" && asset.format !== "png") || asset.encoding !== "base64") {
    return false;
  }
  if (
    typeof asset.data !== "string" ||
    asset.data.length === 0 ||
    asset.data.length > ICON_PACK_MAX_ASSET_DATA_LENGTH ||
    asset.data.length % 4 !== 0 ||
    !base64Pattern.test(asset.data)
  ) {
    return false;
  }
  const decoded = decodeBase64(asset.data);
  if (decoded === null) return false;
  if (asset.format === "svg") {
    const sanitized = decoded.replace(safeEmbeddedPngPattern, "$1$2");
    return svgPattern.test(decoded) && !unsafeSvgPattern.test(sanitized);
  }
  return decoded.length >= 8 && decoded.slice(0, 8) === "\x89PNG\r\n\x1a\n";
};

const normalizeVariant = (value: unknown): IconPackIconVariant | null => {
  if (!isRecord(value) || typeof value.dark !== "string" || !value.dark.trim()) return null;
  if (value.light !== undefined && (typeof value.light !== "string" || !value.light.trim())) return null;
  return {
    dark: value.dark.trim(),
    ...(typeof value.light === "string" ? { light: value.light.trim() } : {}),
  };
};

const isValidSourceUrl = (value: string) => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
};

const normalizeMapping = (
  value: unknown,
  keyValidator: (key: string) => boolean = (key) => Boolean(key) && !/[\\/]/.test(key),
): Record<string, IconPackIconVariant> | null => {
  if (!isRecord(value)) return null;
  const result: Record<string, IconPackIconVariant> = {};
  for (const [rawKey, rawVariant] of Object.entries(value)) {
    const key = rawKey.trim().toLocaleLowerCase();
    const variant = normalizeVariant(rawVariant);
    if (!key || key.length > 256 || !keyValidator(key) || !variant || result[key]) return null;
    result[key] = variant;
  }
  return result;
};

const normalizeNotices = (value: unknown): IconPackNotice[] | null => {
  if (!Array.isArray(value) || value.length < 3 || value.length > 256) return null;
  const notices: IconPackNotice[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
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
};

const mappingReferences = (mappings: IconPackMappings): string[] => {
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

const normalizeMappings = (value: unknown): IconPackMappings | null => {
  if (!isRecord(value) || !isRecord(value.defaults)) return null;
  const fileNames = normalizeMapping(value.fileNames);
  const fileSuffixes = normalizeMapping(value.fileSuffixes, (key) => key.startsWith(".") && !/[\\/]/.test(key));
  const folderNames = normalizeMapping(value.folderNames);
  const folderNamesExpanded = normalizeMapping(value.folderNamesExpanded);
  const file = normalizeVariant(value.defaults.file);
  const folder = normalizeVariant(value.defaults.folder);
  const folderExpanded = normalizeVariant(value.defaults.folderExpanded);
  if (!fileNames || !fileSuffixes || !folderNames || !folderNamesExpanded || !file || !folder || !folderExpanded) {
    return null;
  }
  return { fileNames, fileSuffixes, folderNames, folderNamesExpanded, defaults: { file, folder, folderExpanded } };
};

export const normalizeIconPackManifest = (value: unknown): IconPackManifest | null => {
  if (!isRecord(value) || value.schemaVersion !== ICON_PACK_SCHEMA_VERSION) return null;
  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.version !== "string" ||
    !value.id.trim() ||
    !value.name.trim() ||
    !value.version.trim() ||
    !iconPackIdPattern.test(value.id.trim()) ||
    value.id.trim() === BUILTIN_ICON_PACK_ID ||
    !isRecord(value.source) ||
    typeof value.source.repository !== "string" ||
    typeof value.source.version !== "string" ||
    typeof value.source.url !== "string" ||
    !value.source.repository.trim() ||
    !value.source.version.trim() ||
    !isValidSourceUrl(value.source.url.trim())
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
  const mappings = normalizeMappings(value.mappings);
  const notices = normalizeNotices(value.notices);
  if (!mappings || !notices || !isRecord(value.assets)) return null;

  const assets: Record<string, IconPackAsset> = {};
  let totalDataLength = 0;
  for (const [assetId, rawAsset] of Object.entries(value.assets)) {
    if (!iconPackAssetIdPattern.test(assetId) || assets[assetId] || !isSafeAsset(rawAsset)) return null;
    totalDataLength += rawAsset.data.length;
    if (totalDataLength > ICON_PACK_MAX_TOTAL_ASSET_DATA_LENGTH) return null;
    assets[assetId] = rawAsset;
  }
  const references = mappingReferences(mappings);
  if (
    Object.keys(assets).length === 0 ||
    Object.keys(assets).length > ICON_PACK_MAX_ASSET_COUNT ||
    references.some((assetId) => !assets[assetId])
  ) {
    return null;
  }
  return {
    schemaVersion: 1,
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
};

export const isIconPackManifestCompatible = (manifest: Pick<IconPackManifest, "minHostVersion">): boolean => {
  if (!manifest.minHostVersion) return true;
  const minimum = Number(manifest.minHostVersion);
  return Number.isSafeInteger(minimum) && minimum <= ICON_PACK_HOST_VERSION;
};

export const isIconPackManifest = (value: unknown): value is IconPackManifest =>
  normalizeIconPackManifest(value) !== null;

const normalizePath = (value: string) => value.replace(/\\/g, "/").replace(/\/+$/, "");

const basename = (value: string) => normalizePath(value).split("/").filter(Boolean).pop() || "";

const fallbackIconKey = (input: FileIconResolveInput): FileIconFallbackKey => {
  if (input.kind === "directory") return "folder";
  const name = basename(input.name || input.path).toLocaleLowerCase();
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  if (["package.json", "pnpm-lock.yaml", "package-lock.json", "yarn.lock"].includes(name)) return "package";
  if (["json", "jsonc"].includes(extension)) return "json";
  if (["md", "markdown", "txt", "log"].includes(extension)) return "text";
  if (["png", "jpg", "jpeg", "gif", "svg", "webp", "ico"].includes(extension)) return "image";
  if (["sh", "bash", "ps1", "bat", "cmd"].includes(extension)) return "terminal";
  if (["lock", "bin", "exe", "dll"].includes(extension)) return "binary";
  if (["css", "scss", "less", "html", "xml", "vue"].includes(extension)) return "braces";
  if (["js", "jsx", "ts", "tsx", "mjs", "cjs", "py", "go", "rs", "java", "c", "cpp", "h", "hpp"].includes(extension)) {
    return "code";
  }
  return "file";
};

const variantAssetId = (variant: IconPackIconVariant, colorMode: IconPackColorMode) =>
  colorMode === "light" ? variant.light || variant.dark : variant.dark;

const externalResolution = (
  pack: IconPackManifest,
  variant: IconPackIconVariant,
  colorMode: IconPackColorMode,
): FileIconResolution | null => {
  const assetId = variantAssetId(variant, colorMode);
  const asset = pack.assets[assetId];
  if (!asset) return null;
  return { kind: "external", assetId, src: `data:image/${asset.format === "svg" ? "svg+xml" : "png"};base64,${asset.data}` };
};

export const resolveFileIcon = (
  pack: IconPackManifest | null | undefined,
  input: FileIconResolveInput,
): FileIconResolution => {
  const fallback = { kind: "fallback", fallbackKey: fallbackIconKey(input) } as const;
  if (!pack) return fallback;
  try {
    const colorMode = input.colorMode || "dark";
    const name = basename(input.name || input.path).toLocaleLowerCase();
    const normalizedPath = normalizePath(input.path || input.name).toLocaleLowerCase();
    const mappings = pack.mappings;
    let variant: IconPackIconVariant | undefined;

    if (input.kind === "file") {
      variant = mappings.fileNames[name];
      if (!variant) {
        const suffixes = Object.keys(mappings.fileSuffixes)
          .filter((suffix) => name.endsWith(suffix))
          .sort((left, right) => right.length - left.length);
        variant = suffixes.length > 0 ? mappings.fileSuffixes[suffixes[0]!] : undefined;
      }
      variant ||= mappings.defaults.file;
    } else {
      const directoryName = basename(normalizedPath || name);
      variant = input.expanded ? mappings.folderNamesExpanded[directoryName] : mappings.folderNames[directoryName];
      if (!variant && input.expanded) variant = mappings.folderNames[directoryName];
      variant ||= input.expanded ? mappings.defaults.folderExpanded : mappings.defaults.folder;
    }

    return externalResolution(pack, variant, colorMode) || fallback;
  } catch {
    return fallback;
  }
};

export const fileIconAsset = (pack: IconPackManifest | null | undefined, resolution: FileIconResolution): IconPackAsset | null => {
  if (!pack || resolution.kind !== "external") return null;
  return pack.assets[resolution.assetId] || null;
};

export const normalizeIconPackId = (value: unknown): IconPackId =>
  value === VSCODE_ICON_PACK_ID ? VSCODE_ICON_PACK_ID : BUILTIN_ICON_PACK_ID;