export type ProjectMarkdownImageSource =
  | { kind: "external"; source: string }
  | { kind: "local"; relativePath: string }
  | { kind: "blocked" };

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const DRIVE_PATH_PATTERN = /^[a-z]:[\\/]/i;
const URL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

export const classifyProjectMarkdownImageSource = (
  source: string,
  markdownRelativePath: string,
): ProjectMarkdownImageSource => {
  const trimmedSource = source.trim();
  if (!trimmedSource) return { kind: "blocked" };
  if (trimmedSource.startsWith("#") || trimmedSource.startsWith("//")) {
    return { kind: "external", source };
  }
  if (/^(?:https?:|data:|blob:)/i.test(trimmedSource)) {
    return { kind: "external", source };
  }
  if (/^file:/i.test(trimmedSource) || trimmedSource.startsWith("\\\\")) {
    return { kind: "blocked" };
  }

  const suffixIndex = trimmedSource.search(/[?#]/);
  const pathSource = suffixIndex === -1 ? trimmedSource : trimmedSource.slice(0, suffixIndex);
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathSource);
  } catch {
    return { kind: "blocked" };
  }

  if (
    !decodedPath ||
    CONTROL_CHARACTER_PATTERN.test(decodedPath) ||
    DRIVE_PATH_PATTERN.test(decodedPath) ||
    /^file:/i.test(decodedPath) ||
    decodedPath.startsWith("\\\\")
  ) {
    return { kind: "blocked" };
  }
  if (URL_SCHEME_PATTERN.test(decodedPath)) {
    return { kind: "external", source };
  }

  const normalizedSource = decodedPath.replace(/\\/g, "/");
  const markdownParts = markdownRelativePath.replace(/\\/g, "/").split("/").filter(Boolean);
  const resolvedParts = normalizedSource.startsWith("/") ? [] : markdownParts.slice(0, -1);

  for (const part of normalizedSource.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (resolvedParts.length === 0) return { kind: "blocked" };
      resolvedParts.pop();
      continue;
    }
    resolvedParts.push(part);
  }

  return resolvedParts.length > 0 ? { kind: "local", relativePath: resolvedParts.join("/") } : { kind: "blocked" };
};
