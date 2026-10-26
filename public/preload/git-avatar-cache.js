const gitAvatarCacheTtlMs = 14 * 24 * 60 * 60 * 1000;
const gitAvatarCacheMaxBytes = 1024 * 1024;
const gitAvatarCacheLimit = 160;
const gitAvatarImageRequests = new Map();
const gitAvatarImages = new Map();
const gitAvatarDownloads = new Map();
const gitAvatarRetryAt = new Map();
let gitAvatarCacheGeneration = 0;

function isGitAvatarImage(bytes, contentType) {
  if (contentType === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (contentType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (contentType === "image/gif") return ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString());
  return contentType === "image/webp" && bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";
}

function gitAvatarCacheDirectory() {
  const root = pluginLocalDataDirectory();
  return root ? path.join(root, "cache", "git-avatars") : "";
}

function gitAvatarCacheKey(authorKey) {
  return require("node:crypto").createHash("sha256").update(authorKey).digest("hex");
}

function emitGitAvatarCacheEvent(detail) {
  if (typeof CustomEvent === "function") {
    window.dispatchEvent(new CustomEvent("project-bridge-event", { detail }));
  }
}

function readGitAvatarImage(key) {
  const existing = gitAvatarImages.get(key);
  if (existing) return existing;
  const directory = gitAvatarCacheDirectory();
  if (!directory) return null;
  try {
    const filePath = path.join(directory, `${key}.json`);
    if (fs.statSync(filePath).size > gitAvatarCacheMaxBytes * 1.5) return null;
    const entry = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!Number.isFinite(entry.updatedAt) || entry.updatedAt > Date.now() ||
        typeof entry.image !== "string" ||
        !/^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+=*$/.test(entry.image) ||
        entry.image.length > gitAvatarCacheMaxBytes * 1.5) return null;
    const [prefix, encoded] = entry.image.split(",");
    if (!isGitAvatarImage(Buffer.from(encoded, "base64"), prefix.slice(5, -7))) return null;
    gitAvatarImages.set(key, entry);
    while (gitAvatarImages.size > gitAvatarCacheLimit) {
      gitAvatarImages.delete(gitAvatarImages.keys().next().value);
    }
    return entry;
  } catch {
    return null;
  }
}

function isAllowedGitAvatarUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password &&
      (!parsed.port || parsed.port === "443") &&
      ["avatars.githubusercontent.com", "github.com"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

async function downloadGitAvatarImage(imageUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    let nextUrl = imageUrl;
    for (let redirect = 0; redirect <= 3; redirect += 1) {
      if (!isAllowedGitAvatarUrl(nextUrl)) return null;
      const response = await fetch(nextUrl, { redirect: "manual", cache: "no-store", signal: controller.signal });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location) return null;
        nextUrl = new URL(location, nextUrl).toString();
        continue;
      }
      const contentType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      if (!response.ok || !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(contentType) ||
          Number(response.headers.get("content-length")) > gitAvatarCacheMaxBytes) {
        await response.body?.cancel();
        return null;
      }
      const reader = response.body?.getReader();
      if (!reader) return null;
      const chunks = [];
      let size = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > gitAvatarCacheMaxBytes) {
          await reader.cancel();
          return null;
        }
        chunks.push(Buffer.from(chunk.value));
      }
      if (!size) return null;
      const bytes = Buffer.concat(chunks);
      return isGitAvatarImage(bytes, contentType) ? `data:${contentType};base64,${bytes.toString("base64")}` : null;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function saveGitAvatarImage(key, entry) {
  const directory = gitAvatarCacheDirectory();
  if (!directory) return;
  fs.mkdirSync(directory, { recursive: true });
  const filePath = path.join(directory, `${key}.json`);
  const temporaryPath = `${filePath}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(entry), { mode: 0o600 });
    fs.renameSync(temporaryPath, filePath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
  const entries = fs.readdirSync(directory)
    .filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
    .map((name) => ({ name, modifiedAt: fs.statSync(path.join(directory, name)).mtimeMs }))
    .sort((left, right) => right.modifiedAt - left.modifiedAt);
  for (const entryToRemove of entries.slice(gitAvatarCacheLimit)) {
    fs.rmSync(path.join(directory, entryToRemove.name), { force: true });
    gitAvatarImages.delete(entryToRemove.name.slice(0, -5));
  }
}

async function readCachedGitAvatar(authorKey, loadUrl, identity = {}) {
  const key = gitAvatarCacheKey(authorKey);
  const existing = readGitAvatarImage(key);
  if (existing && Date.now() - existing.updatedAt < gitAvatarCacheTtlMs) return existing.image;
  if (Date.now() < (gitAvatarRetryAt.get(key) || 0)) return existing?.image || null;
  let pending = gitAvatarImageRequests.get(key);
  if (!pending) {
    const generation = gitAvatarCacheGeneration;
    pending = Promise.resolve().then(loadUrl).then(async (url) => {
      if (generation !== gitAvatarCacheGeneration) return null;
      let download = url ? gitAvatarDownloads.get(url) : null;
      if (url && (!download || Date.now() - download.startedAt >= gitAvatarCacheTtlMs)) {
        download = { startedAt: Date.now(), pending: downloadGitAvatarImage(url) };
        gitAvatarDownloads.set(url, download);
        const currentDownload = download;
        void download.pending.then((image) => {
          if (!image && gitAvatarDownloads.get(url) === currentDownload) gitAvatarDownloads.delete(url);
        });
        while (gitAvatarDownloads.size > gitAvatarCacheLimit) gitAvatarDownloads.delete(gitAvatarDownloads.keys().next().value);
      }
      const image = download ? await download.pending : null;
      if (generation !== gitAvatarCacheGeneration) return null;
      if (!image) {
        if (existing) {
          gitAvatarRetryAt.set(key, Date.now() + 5 * 60 * 1000);
          while (gitAvatarRetryAt.size > gitAvatarCacheLimit) gitAvatarRetryAt.delete(gitAvatarRetryAt.keys().next().value);
        }
        return existing?.image || null;
      }
      gitAvatarRetryAt.delete(key);
      const entry = { image, updatedAt: Date.now() };
      gitAvatarImages.set(key, entry);
      while (gitAvatarImages.size > gitAvatarCacheLimit) {
        gitAvatarImages.delete(gitAvatarImages.keys().next().value);
      }
      try {
        saveGitAvatarImage(key, entry);
      } catch {}
      return image;
    }).catch(() => existing?.image || null).finally(() => {
      if (gitAvatarImageRequests.get(key) === pending) gitAvatarImageRequests.delete(key);
    });
    gitAvatarImageRequests.set(key, pending);
  }
  if (existing) {
    void pending.then((image) => {
      if (image && image !== existing.image) {
        emitGitAvatarCacheEvent({ type: "git-avatar-updated", previousImage: existing.image, image, ...identity });
      }
    });
  }
  return existing?.image || pending;
}

function clearGitAvatarCache() {
  gitAvatarCacheGeneration += 1;
  gitAvatarImageRequests.clear();
  gitAvatarImages.clear();
  gitAvatarDownloads.clear();
  gitAvatarRetryAt.clear();
  gitCommitAvatarResults.clear();
  const directory = gitAvatarCacheDirectory();
  if (directory) fs.rmSync(directory, { recursive: true, force: true });
  emitGitAvatarCacheEvent({ type: "git-avatar-cache-cleared" });
}