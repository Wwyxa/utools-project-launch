// GitHub credential layer.
//
// Single token resolution entry for all GitHub API access (commit author
// avatars today, pull request features later). Sources are layered: the
// manual PAT saved in plugin settings wins, then GitHub CLI credentials
// (GH_TOKEN/GITHUB_TOKEN environment variables, then the gh hosts.yml file
// across its documented config directories), then anonymous access.
//
// The manual PAT lives in the device-local local-state.v1.json next to the
// other device-scoped preferences and never enters the syncing utools
// database. Tokens are only attached to outgoing GitHub API requests and are
// never returned to the renderer through status endpoints.

const githubAuthTokenPattern = /^(gh[pousr]_[A-Za-z0-9]{20,255}|github_pat_[A-Za-z0-9_]{20,255}|[A-Fa-f0-9]{40})$/;
const githubAuthStatusTimeoutMs = 8000;
const githubAuthTokenCacheTtlMs = 30 * 1000;
const githubCliHostsFileName = "hosts.yml";
const githubCliHostsFileLimitBytes = 64 * 1024;
const githubCliHostKey = "github.com";
const githubCliDetectTimeoutMs = 3000;

function getDefaultGithubAuthPreferences() {
  return { schemaVersion: 1, personalAccessToken: "" };
}

function normalizeGithubAuthPreferences(value) {
  const defaults = getDefaultGithubAuthPreferences();
  if (!value || typeof value !== "object" || value.schemaVersion !== 1) return defaults;
  const token = typeof value.personalAccessToken === "string" ? value.personalAccessToken.trim() : "";
  return { schemaVersion: 1, personalAccessToken: token };
}

function readGithubAuthPreferences() {
  return readLocalStatePreference("githubAuth", normalizeGithubAuthPreferences, getDefaultGithubAuthPreferences);
}

function saveGithubAuthPreferences(preferences) {
  const result = saveLocalStatePreference("githubAuth", preferences, normalizeGithubAuthPreferences);
  if (result.ok) {
    invalidateGithubTokenCache(true);
  }
  return result;
}

// gh resolves config per its environment manual: GH_CONFIG_DIR overrides
// everything, then XDG_CONFIG_HOME/gh, then AppData on Windows, then
// ~/.config/gh.
function githubCliConfigDirectoryCandidates() {
  const candidates = [];
  const configDir = process.env?.GH_CONFIG_DIR;
  if (typeof configDir === "string" && path.isAbsolute(configDir)) {
    candidates.push(configDir);
  }
  const xdgConfigHome = process.env?.XDG_CONFIG_HOME;
  if (typeof xdgConfigHome === "string" && path.isAbsolute(xdgConfigHome)) {
    candidates.push(path.join(xdgConfigHome, "gh"));
  }
  if (process.platform === "win32" && process.env?.APPDATA) {
    candidates.push(path.join(process.env.APPDATA, "GitHub CLI"));
  }
  candidates.push(path.join(os.homedir(), ".config", "gh"));
  return [...new Set(candidates)];
}

// gh stores per-host credentials in hosts.yml. Two layouts exist: a flat
// `github.com: oauth_token:` entry and the multi-account layout that nests
// tokens under `users:`. Take the shallowest valid token inside the
// github.com block; an oauth_expiry at or above its level that already
// passed disqualifies it.
function parseGithubCliHostsToken(content) {
  const lines = String(content).split(/\r?\n/);
  const hostLineIndex = lines.findIndex((line) => line.trim() === `${githubCliHostKey}:`);
  if (hostLineIndex === -1) return null;

  const tokens = [];
  const expiries = [];
  for (let index = hostLineIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.length > 0 && !/\s/.test(line[0])) break;
    const depth = line.length - line.trimStart().length;
    const tokenMatch = /^\s*oauth_token:\s*"?([^\s"]+)"?\s*$/.exec(line);
    if (tokenMatch && githubAuthTokenPattern.test(tokenMatch[1])) {
      tokens.push({ token: tokenMatch[1], depth });
      continue;
    }
    const expiryMatch = /^\s*oauth_expiry:\s*"?([0-9]{4}-[0-9]{2}-[0-9]{2}[^"\s]*)"?\s*$/.exec(line);
    if (expiryMatch) {
      expiries.push({ expiry: Date.parse(expiryMatch[1]), depth });
    }
  }

  tokens.sort((left, right) => left.depth - right.depth);
  const chosen = tokens[0];
  if (!chosen) return null;
  const governingExpiry = expiries
    .filter((entry) => entry.depth <= chosen.depth && Number.isFinite(entry.expiry))
    .sort((left, right) => right.depth - left.depth || right.expiry - left.expiry)[0];
  if (governingExpiry && governingExpiry.expiry <= Date.now()) {
    return null;
  }
  return chosen.token;
}

function readGithubCliHostsToken() {
  for (const directory of githubCliConfigDirectoryCandidates()) {
    const hostsPath = path.join(directory, githubCliHostsFileName);
    try {
      const stats = fs.statSync(hostsPath);
      if (!stats.isFile() || stats.size > githubCliHostsFileLimitBytes) continue;
      const token = parseGithubCliHostsToken(fs.readFileSync(hostsPath, "utf8"));
      if (token) return token;
    } catch (error) {
      // Missing or unreadable gh config directories are normal; keep probing.
    }
  }
  return null;
}

// gh-layer probe only: GH_TOKEN/GITHUB_TOKEN environment variables, then the
// hosts.yml file, then `gh auth token`. The command fallback is required
// because gh >= 2.35 stores the token in the system credential store by
// default; hosts.yml only carries it with --insecure-storage or when no
// credential store is available. Used both by resolveGithubToken() (after the
// manual PAT) and by the settings status card to report whether gh
// credentials exist independently of the active source.
async function discoverGithubCliToken() {
  const envToken = [process.env?.GH_TOKEN, process.env?.GITHUB_TOKEN]
    .map((candidate) => (typeof candidate === "string" ? candidate.trim() : ""))
    .find((candidate) => candidate && githubAuthTokenPattern.test(candidate));
  if (envToken) return envToken;
  const hostsToken = readGithubCliHostsToken();
  if (hostsToken) return hostsToken;
  return readGithubCliKeyringToken();
}

// Ask gh itself for the token; it resolves every storage backend it supports
// (credential store, hosts.yml, GH_CONFIG_DIR). Not-logged-in exits non-zero,
// which maps to null. Never rejects so callers stay simple.
function readGithubCliKeyringToken() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (token) => {
      if (!settled) {
        settled = true;
        resolve(token);
      }
    };
    try {
      execFile("gh", ["auth", "token"], { timeout: githubCliDetectTimeoutMs, windowsHide: true }, (error, stdout) => {
        if (error) {
          finish(null);
          return;
        }
        const token = String(stdout || "").trim();
        finish(githubAuthTokenPattern.test(token) ? token : null);
      });
    } catch (error) {
      finish(null);
    }
  });
}

// Settings-only probe: whether the GitHub CLI is on PATH and which version it
// reports. Never resolves with a rejection so status rendering stays simple.
function detectGithubCliInstalled() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    try {
      execFile("gh", ["--version"], { timeout: githubCliDetectTimeoutMs, windowsHide: true }, (error, stdout) => {
        if (error) {
          finish({ installed: false, version: null });
          return;
        }
        const match = /gh version (\S+)/.exec(String(stdout));
        finish({ installed: true, version: match ? match[1] : null });
      });
    } catch (error) {
      finish({ installed: false, version: null });
    }
  });
}

const resolvedGithubTokenCache = { promise: null, expiresAt: 0 };
const rejectedGithubTokens = new Set();

function invalidateGithubTokenCache(clearRejectedTokens) {
  resolvedGithubTokenCache.promise = null;
  resolvedGithubTokenCache.expiresAt = 0;
  if (clearRejectedTokens) {
    rejectedGithubTokens.clear();
  }
}

// Called when GitHub answers 401: the token is dead or revoked, so skip it
// until the cache is invalidated by a settings change (gh re-login is picked
// up on the next TTL refresh).
function markGithubTokenRejected(token) {
  if (typeof token === "string" && token) {
    rejectedGithubTokens.add(token);
  }
  invalidateGithubTokenCache(false);
}

async function computeGithubToken() {
  const manualToken = readGithubAuthPreferences().personalAccessToken;
  if (manualToken && githubAuthTokenPattern.test(manualToken) && !rejectedGithubTokens.has(manualToken)) {
    return { token: manualToken, source: "manual" };
  }
  const cliToken = await discoverGithubCliToken();
  if (cliToken && !rejectedGithubTokens.has(cliToken)) {
    return { token: cliToken, source: "gh" };
  }
  return null;
}

// The cached promise is shared across concurrent callers (avatar prefetch
// bursts) so the gh command fallback runs at most once per TTL window.
async function resolveGithubToken() {
  const now = Date.now();
  if (resolvedGithubTokenCache.promise && resolvedGithubTokenCache.expiresAt > now) {
    const cached = await resolvedGithubTokenCache.promise;
    if (!cached || !rejectedGithubTokens.has(cached.token)) {
      return cached;
    }
  }
  const promise = computeGithubToken().catch(() => null);
  resolvedGithubTokenCache.promise = promise;
  resolvedGithubTokenCache.expiresAt = now + githubAuthTokenCacheTtlMs;
  return promise;
}

function normalizeGithubAvatarUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch (error) {
    return null;
  }
}

async function fetchGithubAuthenticatedUser(token) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), githubAuthStatusTimeoutMs);
  try {
    const response = await fetch("https://api.github.com/user", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      if (response.status === 401) {
        return { ok: false, reason: "invalid-token", message: "GitHub 返回 401，令牌无效或已过期。" };
      }
      if (
        (response.status === 403 || response.status === 429) &&
        response.headers.get("x-ratelimit-remaining") === "0"
      ) {
        return { ok: false, reason: "rate-limited", message: "GitHub API 已限流，请稍后重试。" };
      }
      return { ok: false, reason: "http-error", message: `GitHub 返回 HTTP ${response.status}。` };
    }
    const user = await response.json();
    const login = typeof user?.login === "string" ? user.login.trim() : "";
    if (!login) {
      return { ok: false, reason: "malformed-response", message: "GitHub 响应缺少账号信息。" };
    }
    return { ok: true, login, avatarUrl: normalizeGithubAvatarUrl(user?.avatar_url) };
  } catch (error) {
    return { ok: false, reason: "network-error", message: "无法连接 GitHub，请检查网络后重试。" };
  } finally {
    clearTimeout(timeout);
  }
}

// Settings status card payload. `source` tells the UI whether the working
// credential comes from the manual PAT or gh auto-discovery, and `gh` reports
// the GitHub CLI detection result so the UI can guide the next step; the
// token value itself stays in the preload layer.
async function readGithubAuthStatus() {
  const [cliDetection, resolved, cliCredential] = await Promise.all([
    detectGithubCliInstalled(),
    resolveGithubToken(),
    discoverGithubCliToken(),
  ]);
  const gh = {
    installed: cliDetection.installed,
    version: cliDetection.version,
    credentialFound: Boolean(cliCredential),
  };
  if (!resolved) {
    return {
      configured: false,
      source: null,
      verified: false,
      login: null,
      avatarUrl: null,
      error: null,
      gh,
    };
  }
  const verification = await fetchGithubAuthenticatedUser(resolved.token);
  if (!verification.ok) {
    if (verification.reason === "invalid-token") {
      markGithubTokenRejected(resolved.token);
    }
    return {
      configured: true,
      source: resolved.source,
      verified: false,
      login: null,
      avatarUrl: null,
      error: verification.message,
      gh,
    };
  }
  return {
    configured: true,
    source: resolved.source,
    verified: true,
    login: verification.login,
    avatarUrl: verification.avatarUrl,
    error: null,
    gh,
  };
}

// Verify a candidate PAT from the settings page before it is saved.
async function verifyGithubAuthToken(token) {
  const trimmed = typeof token === "string" ? token.trim() : "";
  if (!githubAuthTokenPattern.test(trimmed)) {
    return { ok: false, message: "令牌格式不符合 GitHub 令牌特征（ghp_… / github_pat_… / 40 位十六进制）。" };
  }
  const verification = await fetchGithubAuthenticatedUser(trimmed);
  if (!verification.ok) {
    return { ok: false, message: verification.message };
  }
  return {
    ok: true,
    login: verification.login,
    avatarUrl: verification.avatarUrl,
    message: `令牌有效，属于 ${verification.login}。`,
  };
}
