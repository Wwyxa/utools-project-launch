function projectLaunchServiceTarget() {
  const architecture =
    process.arch === "x64" ? "amd64" : process.arch === "arm64" ? "arm64" : process.arch || "unknown";
  const platform = process.platform === "win32" ? "windows" : process.platform;
  const supported =
    (platform === "windows" || platform === "linux" || platform === "darwin") &&
    (architecture === "amd64" || architecture === "arm64");
  const assetName = supported
    ? `project-launch-service-${platform}-${architecture}${platform === "windows" ? ".exe" : ""}`
    : "";
  return { platform, architecture, supported, assetName };
}

function projectLaunchServiceDirectoryPath() {
  return path.join(path.dirname(getDeviceIdFilePath()), "service");
}

function projectLaunchServiceExecutablePath() {
  return path.join(
    projectLaunchServiceDirectoryPath(),
    `project-launch-service${process.platform === "win32" ? ".exe" : ""}`,
  );
}

function projectLaunchServiceDiscoveryPath() {
  return path.join(projectLaunchServiceDirectoryPath(), "discovery.json");
}

function projectLaunchServiceInstallMetadataPath() {
  return path.join(projectLaunchServiceDirectoryPath(), "install.json");
}

function projectLaunchServiceTokenPath() {
  return path.join(projectLaunchServiceDirectoryPath(), "token");
}

function projectLaunchServiceReleaseUrl() {
  return "https://github.com/Wwyxa/utools-project-launch/releases";
}

function projectLaunchServiceBaseStatus() {
  const target = projectLaunchServiceTarget();
  const directoryPath = projectLaunchServiceDirectoryPath();
  return {
    state: target.supported ? "not-installed" : "unavailable",
    installed: false,
    running: false,
    platform: target.platform,
    architecture: target.architecture,
    expectedAssetName: target.assetName,
    directoryPath,
    executablePath: projectLaunchServiceExecutablePath(),
    releaseUrl: projectLaunchServiceReleaseUrl(),
    message: target.supported ? "项目启动服务尚未安装。" : "当前系统或 CPU 架构暂不支持项目启动服务。",
  };
}

function isAllowedProjectLaunchServiceUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && projectLaunchServiceAllowedDownloadHosts.has(parsed.hostname.toLowerCase());
  } catch (error) {
    return false;
  }
}

function fetchProjectLaunchServiceBytes(url, options = {}, redirectCount = 0) {
  const maxBytes = Number.isFinite(options.maxBytes) ? options.maxBytes : projectLaunchServiceMetadataLimitBytes;
  if (!isAllowedProjectLaunchServiceUrl(url)) {
    const error = new Error("项目启动服务下载地址不受支持。");
    error.code = "invalid-download-url";
    return Promise.reject(error);
  }
  if (redirectCount > projectLaunchServiceDownloadRedirectLimit) {
    const error = new Error("项目启动服务下载重定向次数过多。");
    error.code = "too-many-redirects";
    return Promise.reject(error);
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
      finish(reject, error);
      return;
    }

    const request = https.get(
      {
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        timeout: projectLaunchServiceDownloadTimeoutMs,
        headers: {
          Accept: "application/octet-stream, application/json",
          "User-Agent": "utools-project-launch",
        },
      },
      (response) => {
        const statusCode = response.statusCode || 0;
        if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
          const nextUrl = new URL(response.headers.location, url).toString();
          response.resume();
          fetchProjectLaunchServiceBytes(nextUrl, options, redirectCount + 1).then(
            (value) => finish(resolve, value),
            (error) => finish(reject, error),
          );
          return;
        }
        if (statusCode < 200 || statusCode >= 300) {
          response.resume();
          const error = new Error(`项目启动服务下载请求失败（HTTP ${statusCode}）。`);
          error.code = `http-${statusCode}`;
          finish(reject, error);
          return;
        }

        const contentLength = Number(response.headers["content-length"]);
        if (Number.isFinite(contentLength) && contentLength > maxBytes) {
          response.resume();
          const error = new Error("项目启动服务响应超过大小限制。");
          error.code = "response-too-large";
          finish(reject, error);
          return;
        }

        const chunks = [];
        let totalBytes = 0;
        response.on("data", (chunk) => {
          totalBytes += Buffer.byteLength(chunk);
          if (totalBytes > maxBytes) {
            response.destroy();
            const error = new Error("项目启动服务响应超过大小限制。");
            error.code = "response-too-large";
            finish(reject, error);
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => finish(resolve, Buffer.concat(chunks)));
        response.on("error", (error) => finish(reject, error));
      },
    );
    request.on("timeout", () => {
      const error = new Error("项目启动服务下载超时。");
      error.code = "download-timeout";
      request.destroy(error);
    });
    request.on("error", (error) => finish(reject, error));
  });
}

function projectLaunchServiceReleaseAsset(release, assetName) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const asset = assets.find((candidate) => candidate?.name === assetName);
  if (
    !asset ||
    typeof asset.browser_download_url !== "string" ||
    !isAllowedProjectLaunchServiceUrl(asset.browser_download_url)
  ) {
    const error = new Error(`当前发布未提供兼容的项目启动服务文件：${assetName}`);
    error.code = "asset-not-found";
    throw error;
  }
  if (Number.isFinite(asset.size) && asset.size > projectLaunchServiceExecutableLimitBytes) {
    const error = new Error("项目启动服务文件超过 12 MiB 大小限制。");
    error.code = "asset-too-large";
    throw error;
  }
  return asset;
}

function projectLaunchServiceChecksum(checksumContents, assetName) {
  const match = String(checksumContents)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => line.match(/^([0-9a-f]{64})\s+\*?(.+)$/i))
    .find((candidate) => candidate && candidate[2].replace(/^\.\//, "") === assetName);
  if (!match) {
    const error = new Error(`checksums.txt 中缺少 ${assetName} 的校验值。`);
    error.code = "checksum-not-found";
    throw error;
  }
  return match[1].toLowerCase();
}

function projectLaunchServiceInstallVerificationError(message) {
  const error = new Error(message);
  error.code = "unverified-install";
  return error;
}

function projectLaunchServiceInstallMetadata(expectedHash) {
  const target = projectLaunchServiceTarget();
  if (!target.supported || !/^[0-9a-f]{64}$/i.test(expectedHash)) {
    throw projectLaunchServiceInstallVerificationError("项目启动服务安装元数据无效。");
  }
  return {
    schemaVersion: 1,
    assetName: target.assetName,
    sha256: expectedHash.toLowerCase(),
  };
}

function readProjectLaunchServiceInstallMetadata() {
  const directoryPath = projectLaunchServiceDirectoryPath();
  const metadataPath = projectLaunchServiceInstallMetadataPath();
  if (!isPathWithin(directoryPath, metadataPath)) {
    throw projectLaunchServiceInstallVerificationError("项目启动服务安装元数据路径无效。");
  }

  let metadata;
  try {
    metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  } catch (error) {
    throw projectLaunchServiceInstallVerificationError("项目启动服务缺少可信安装记录。请重新下载或手动验证后再启用。");
  }

  const target = projectLaunchServiceTarget();
  if (
    !metadata ||
    metadata.schemaVersion !== 1 ||
    metadata.assetName !== target.assetName ||
    typeof metadata.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/i.test(metadata.sha256)
  ) {
    throw projectLaunchServiceInstallVerificationError("项目启动服务安装记录无效。请重新下载或手动验证后再启用。");
  }
  return metadata;
}

function verifyProjectLaunchServiceInstalledExecutable() {
  const metadata = readProjectLaunchServiceInstallMetadata();
  let contents;
  try {
    contents = fs.readFileSync(projectLaunchServiceExecutablePath());
  } catch (error) {
    throw projectLaunchServiceInstallVerificationError("无法读取项目启动服务文件。请重新下载或手动验证后再启用。");
  }
  const actualHash = crypto.createHash("sha256").update(contents).digest("hex");
  if (actualHash !== metadata.sha256) {
    throw projectLaunchServiceInstallVerificationError(
      "项目启动服务文件已变更，无法自动启动。请重新下载或手动验证后再启用。",
    );
  }
}

function verifyProjectLaunchServiceManually() {
  const directoryPath = projectLaunchServiceDirectoryPath();
  const metadataPath = projectLaunchServiceInstallMetadataPath();
  const metadataPartialPath = `${metadataPath}.partial`;
  if (
    !isPathWithin(directoryPath, metadataPath) ||
    !isPathWithin(directoryPath, metadataPartialPath) ||
    !isPathWithin(directoryPath, projectLaunchServiceExecutablePath())
  ) {
    throw new Error("项目启动服务安装路径无效。");
  }

  let contents;
  try {
    contents = fs.readFileSync(projectLaunchServiceExecutablePath());
  } catch (error) {
    throw projectLaunchServiceInstallVerificationError("无法读取项目启动服务文件。请先放置可执行文件后重试。");
  }
  if (contents.length > projectLaunchServiceExecutableLimitBytes) {
    const error = new Error("项目启动服务文件超过 12 MiB 大小限制。");
    error.code = "asset-too-large";
    throw error;
  }

  const installMetadata = projectLaunchServiceInstallMetadata(
    crypto.createHash("sha256").update(contents).digest("hex"),
  );
  try {
    fs.mkdirSync(directoryPath, { recursive: true });
    fs.writeFileSync(metadataPartialPath, `${JSON.stringify(installMetadata)}\n`, { mode: 0o600 });
    fs.renameSync(metadataPartialPath, metadataPath);
  } catch (error) {
    try {
      fs.unlinkSync(metadataPartialPath);
    } catch (cleanupError) {
      if (cleanupError?.code !== "ENOENT")
        console.warn("[utools-project-launch] failed to clean service metadata partial file");
    }
    throw error;
  }
}

function installProjectLaunchServiceExecutable(contents, expectedHash) {
  const directoryPath = projectLaunchServiceDirectoryPath();
  const downloadsPath = path.join(directoryPath, "downloads");
  const executablePath = projectLaunchServiceExecutablePath();
  const installMetadataPath = projectLaunchServiceInstallMetadataPath();
  const backupPath = path.join(directoryPath, "update.backup");
  const partialPath = path.join(downloadsPath, `${path.basename(executablePath)}.partial`);
  const metadataPartialPath = `${installMetadataPath}.partial`;
  if (
    !isPathWithin(directoryPath, downloadsPath) ||
    !isPathWithin(directoryPath, executablePath) ||
    !isPathWithin(directoryPath, installMetadataPath) ||
    !isPathWithin(directoryPath, metadataPartialPath)
  ) {
    throw new Error("项目启动服务安装路径无效。");
  }

  let backupCreated = false;
  let executableInstalled = false;
  try {
    fs.mkdirSync(downloadsPath, { recursive: true });
    fs.writeFileSync(partialPath, contents, { mode: process.platform === "win32" ? 0o700 : 0o755 });
    const actualHash = crypto.createHash("sha256").update(contents).digest("hex");
    if (actualHash !== expectedHash) {
      const error = new Error("项目启动服务校验失败，文件未安装。");
      error.code = "checksum-mismatch";
      throw error;
    }
    if (contents.length > projectLaunchServiceExecutableLimitBytes) {
      const error = new Error("项目启动服务文件超过 12 MiB 大小限制。");
      error.code = "asset-too-large";
      throw error;
    }
    const installMetadata = projectLaunchServiceInstallMetadata(expectedHash);

    try {
      fs.unlinkSync(backupPath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    try {
      fs.renameSync(executablePath, backupPath);
      backupCreated = true;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    fs.renameSync(partialPath, executablePath);
    executableInstalled = true;
    const installedHash = crypto.createHash("sha256").update(fs.readFileSync(executablePath)).digest("hex");
    if (installedHash !== installMetadata.sha256) {
      const error = new Error("项目启动服务校验失败，文件未安装。");
      error.code = "checksum-mismatch";
      throw error;
    }
    if (process.platform !== "win32") {
      fs.chmodSync(executablePath, 0o755);
    }
    fs.writeFileSync(metadataPartialPath, `${JSON.stringify(installMetadata)}\n`, { mode: 0o600 });
    fs.renameSync(metadataPartialPath, installMetadataPath);
    if (backupCreated) {
      fs.unlinkSync(backupPath);
    }
  } catch (error) {
    [partialPath, metadataPartialPath].forEach((candidatePath) => {
      try {
        fs.unlinkSync(candidatePath);
      } catch (cleanupError) {
        if (cleanupError?.code !== "ENOENT")
          console.warn("[utools-project-launch] failed to clean service partial file");
      }
    });
    if (backupCreated) {
      try {
        if (executableInstalled) fs.unlinkSync(executablePath);
        fs.renameSync(backupPath, executablePath);
      } catch (restoreError) {
        console.warn("[utools-project-launch] failed to restore service executable backup");
      }
    } else if (executableInstalled) {
      try {
        fs.unlinkSync(executablePath);
      } catch (cleanupError) {
        if (cleanupError?.code !== "ENOENT")
          console.warn("[utools-project-launch] failed to remove unverified service executable");
      }
    }
    throw error;
  }
}

async function downloadProjectLaunchService() {
  const target = projectLaunchServiceTarget();
  if (!target.supported) {
    const error = new Error("当前系统或 CPU 架构暂不支持项目启动服务。");
    error.code = "unsupported-platform";
    throw error;
  }
  const current = await readProjectLaunchServiceStatus();
  if (current.running) {
    const error = new Error("请先停止项目启动服务，再更新服务文件。");
    error.code = "service-running";
    throw error;
  }

  const releaseContents = await fetchProjectLaunchServiceBytes(projectLaunchServiceReleaseApiUrl, {
    maxBytes: projectLaunchServiceMetadataLimitBytes,
  });
  let release;
  try {
    release = JSON.parse(releaseContents.toString("utf8"));
  } catch (error) {
    const parseError = new Error("GitHub Release 响应不是有效 JSON。");
    parseError.code = "invalid-release-metadata";
    throw parseError;
  }
  const binaryAsset = projectLaunchServiceReleaseAsset(release, target.assetName);
  const checksumAsset = projectLaunchServiceReleaseAsset(release, "checksums.txt");
  const checksumContents = await fetchProjectLaunchServiceBytes(checksumAsset.browser_download_url, {
    maxBytes: projectLaunchServiceMetadataLimitBytes,
  });
  const expectedHash = projectLaunchServiceChecksum(checksumContents.toString("utf8"), target.assetName);
  const binaryContents = await fetchProjectLaunchServiceBytes(binaryAsset.browser_download_url, {
    maxBytes: projectLaunchServiceExecutableLimitBytes,
  });
  installProjectLaunchServiceExecutable(binaryContents, expectedHash);
  return readProjectLaunchServiceStatus();
}

async function verifyProjectLaunchServiceInstall() {
  const status = await readProjectLaunchServiceStatus();
  if (status.running) {
    return serviceStatusWithError(status, new Error("请先停止项目启动服务，再验证服务文件。"));
  }
  try {
    verifyProjectLaunchServiceManually();
    return readProjectLaunchServiceStatus();
  } catch (error) {
    return serviceStatusWithError(status, error);
  }
}

function isPathWithin(parentPath, childPath) {
  const parent = path.resolve(parentPath) + path.sep;
  const child = path.resolve(childPath);
  return child === path.resolve(parentPath) || child.startsWith(parent);
}

function readProjectLaunchServiceDiscovery() {
  const discoveryPath = projectLaunchServiceDiscoveryPath();
  if (!isPathWithin(projectLaunchServiceDirectoryPath(), discoveryPath)) {
    throw new Error("服务发现路径无效。");
  }
  const discovery = JSON.parse(fs.readFileSync(discoveryPath, "utf8"));
  if (
    !discovery ||
    discovery.protocolVersion !== projectLaunchServiceProtocolVersion ||
    typeof discovery.serviceVersion !== "string" ||
    !discovery.serviceVersion.trim() ||
    typeof discovery.instanceId !== "string" ||
    !discovery.instanceId.trim() ||
    typeof discovery.processIdentity !== "string" ||
    !discovery.processIdentity.trim() ||
    !Number.isInteger(discovery.pid) ||
    discovery.pid <= 0 ||
    typeof discovery.startedAt !== "string" ||
    !Number.isFinite(Date.parse(discovery.startedAt)) ||
    discovery.host !== "127.0.0.1" ||
    !Number.isInteger(discovery.port) ||
    discovery.port < 1 ||
    discovery.port > 65535 ||
    typeof discovery.tokenPath !== "string" ||
    path.resolve(discovery.tokenPath) !== path.resolve(projectLaunchServiceTokenPath())
  ) {
    const error = new Error("服务发现信息无效或协议不兼容。");
    error.code =
      discovery?.protocolVersion && discovery.protocolVersion !== projectLaunchServiceProtocolVersion
        ? "protocol-mismatch"
        : "invalid-discovery";
    throw error;
  }
  return discovery;
}

function readProjectLaunchServiceToken() {
  const tokenPath = projectLaunchServiceTokenPath();
  if (!isPathWithin(projectLaunchServiceDirectoryPath(), tokenPath)) {
    throw new Error("服务令牌路径无效。");
  }
  const token = fs.readFileSync(tokenPath, "utf8").trim();
  if (!/^[0-9a-f]{64}$/i.test(token)) {
    throw new Error("服务令牌无效。");
  }
  return token;
}

function projectLaunchServiceProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || typeof process.kill !== "function") {
    return null;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "ESRCH" ? false : null;
  }
}

function projectLaunchServiceProcessIdentity(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return null;
  }
  try {
    if (process.platform === "win32") {
      const result = spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "$process = Get-Process -Id $env:UTOOLS_PROJECT_LAUNCH_SERVICE_PROCESS_ID -ErrorAction Stop; [Console]::Out.Write($process.StartTime.ToUniversalTime().ToFileTimeUtc())",
        ],
        {
          encoding: "utf8",
          env: { ...process.env, UTOOLS_PROJECT_LAUNCH_SERVICE_PROCESS_ID: String(pid) },
          timeout: projectLaunchServiceRequestTimeoutMs,
          windowsHide: true,
        },
      );
      const startTicks = String(result.stdout || "").trim();
      return /^\d+$/.test(startTicks) ? `windows:${startTicks}` : null;
    }
    if (process.platform === "linux") {
      const bootId = fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
      const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
      const closingName = stat.lastIndexOf(")");
      if (!bootId || closingName < 0) return null;
      const startTicks = stat
        .slice(closingName + 1)
        .trim()
        .split(/\s+/)[19];
      return /^\d+$/.test(startTicks || "") ? `linux:${bootId}:${startTicks}` : null;
    }
    if (process.platform === "darwin") {
      const result = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], {
        encoding: "utf8",
        timeout: projectLaunchServiceRequestTimeoutMs,
        windowsHide: true,
      });
      const startedAt = String(result.stdout || "").trim();
      return result.status === 0 && startedAt ? `darwin:${startedAt}` : null;
    }
  } catch (error) {
    return null;
  }
  return null;
}

function projectLaunchServiceProcessMatches(discovery) {
  const alive = projectLaunchServiceProcessAlive(discovery.pid);
  if (alive !== true) {
    return alive;
  }
  const identity = projectLaunchServiceProcessIdentity(discovery.pid);
  if (!identity) {
    return null;
  }
  return identity === discovery.processIdentity;
}

function removeStaleProjectLaunchServiceDiscovery(discovery) {
  if (projectLaunchServiceProcessMatches(discovery) !== false) {
    return;
  }
  try {
    const current = readProjectLaunchServiceDiscovery();
    if (
      current.instanceId === discovery.instanceId &&
      current.pid === discovery.pid &&
      current.processIdentity === discovery.processIdentity
    ) {
      fs.unlinkSync(projectLaunchServiceDiscoveryPath());
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      return;
    }
  }
}

function requestProjectLaunchService(discovery, token, method, requestPath, body, options = {}) {
  return new Promise((resolve, reject) => {
    const requestBody = body === undefined ? "" : JSON.stringify(body);
    const maxResponseBytes = Number.isFinite(options.maxResponseBytes)
      ? Math.max(1, Math.floor(options.maxResponseBytes))
      : 256 * 1024;
    const request = http.request(
      {
        host: "127.0.0.1",
        port: discovery.port,
        method,
        path: requestPath,
        timeout: projectLaunchServiceRequestTimeoutMs,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          "X-Protocol-Version": String(projectLaunchServiceProtocolVersion),
          ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
          ...(body === undefined
            ? {}
            : {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(requestBody),
              }),
        },
      },
      (response) => {
        const chunks = [];
        let responseBytes = 0;
        response.on("data", (chunk) => {
          responseBytes += Buffer.byteLength(chunk);
          if (responseBytes <= maxResponseBytes) {
            chunks.push(chunk);
          }
        });
        response.on("end", () => {
          if (responseBytes > maxResponseBytes) {
            const error = new Error("服务响应超过大小限制。");
            error.code = "response-too-large";
            reject(error);
            return;
          }
          const text = Buffer.concat(chunks).toString("utf8");
          let payload = null;
          try {
            payload = text ? JSON.parse(text) : null;
          } catch (error) {
            const parseError = new Error("服务响应不是有效 JSON。");
            parseError.code = "invalid-response";
            reject(parseError);
            return;
          }
          resolve({ statusCode: response.statusCode || 0, payload });
        });
      },
    );
    request.on("timeout", () => request.destroy(new Error("服务请求超时。")));
    request.on("error", (error) => reject(error));
    if (body !== undefined) {
      request.write(requestBody);
    }
    request.end();
  });
}

function projectLaunchServiceIdempotencyKey(prefix = "request") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}-${process.pid}`;
}

function createPreloadRunId() {
  return (
    globalThis.crypto?.randomUUID?.() ||
    crypto.randomUUID?.() ||
    `preload-${Date.now()}-${Math.random().toString(36).slice(2)}-${process.pid}`
  );
}

function projectLaunchServiceResponseError(response, fallbackMessage) {
  const error = new Error(response?.payload?.message || fallbackMessage);
  error.code = response?.payload?.code || `http-${response?.statusCode || 0}`;
  return error;
}

async function projectLaunchServiceConnection() {
  const discovery = readProjectLaunchServiceDiscovery();
  const token = readProjectLaunchServiceToken();
  return { discovery, token };
}

async function requestProjectLaunchServiceHealth(connection) {
  const response = await requestProjectLaunchService(connection.discovery, connection.token, "GET", "/v1/health");
  if (response.statusCode !== 200) {
    throw projectLaunchServiceResponseError(response, "项目启动服务健康检查失败。");
  }
  const health = response.payload;
  if (
    !health ||
    health.protocolVersion !== projectLaunchServiceProtocolVersion ||
    health.instanceId !== connection.discovery.instanceId ||
    health.pid !== connection.discovery.pid ||
    health.processIdentity !== connection.discovery.processIdentity
  ) {
    const error = new Error("项目启动服务身份或协议校验失败。");
    error.code =
      health?.protocolVersion !== projectLaunchServiceProtocolVersion ? "protocol-mismatch" : "identity-mismatch";
    throw error;
  }
  return health;
}

async function requestProjectLaunchServiceState(connection) {
  const response = await requestProjectLaunchService(connection.discovery, connection.token, "GET", "/v1/state");
  if (response.statusCode !== 200) {
    throw projectLaunchServiceResponseError(response, "项目启动服务状态读取失败。");
  }
  return response.payload || { runs: [], latestCursor: 0, earliestCursor: 0 };
}

async function requestProjectLaunchServiceEvents(connection, after) {
  const response = await requestProjectLaunchService(
    connection.discovery,
    connection.token,
    "GET",
    `/v1/events?after=${encodeURIComponent(String(after))}`,
  );
  if (response.statusCode !== 200) {
    throw projectLaunchServiceResponseError(response, "项目启动服务事件读取失败。");
  }
  return (
    response.payload || {
      events: [],
      latestCursor: after,
      earliestCursor: 0,
      truncated: false,
      nextCursor: after,
      hasMore: false,
    }
  );
}

async function getProjectLaunchServiceRunLog(runId) {
  if (!/^[0-9a-f]{32}$/.test(String(runId || ""))) {
    const error = new Error("运行日志标识无效。");
    error.code = "invalid-run-id";
    throw error;
  }
  const connection = await projectLaunchServiceConnection();
  const response = await requestProjectLaunchService(
    connection.discovery,
    connection.token,
    "GET",
    `/v1/runs/${runId}/log`,
    undefined,
    { maxResponseBytes: projectLaunchServiceRunLogResponseLimitBytes },
  );
  if (response.statusCode !== 200) {
    throw projectLaunchServiceResponseError(response, "运行日志读取失败。");
  }
  return response.payload || { runId, events: [], truncated: false, sizeBytes: 0 };
}

function advanceProjectLaunchServiceEventCursor(batch) {
  const nextCursor = Number(batch?.nextCursor);
  const latestCursor = Number(batch?.latestCursor);
  const deliveredCursor = Number.isSafeInteger(nextCursor) ? nextCursor : latestCursor;
  if (Number.isSafeInteger(deliveredCursor) && deliveredCursor >= 0) {
    projectLaunchServiceEventCursor = Math.max(projectLaunchServiceEventCursor, deliveredCursor);
  }
}

async function syncProjectLaunchServiceAutomation(config) {
  if (!config || !Number.isInteger(config.revision) || config.revision < 1) {
    const error = new Error("项目启动服务自动化配置 revision 无效。");
    error.code = "invalid-automation-revision";
    throw error;
  }

  const status = await readProjectLaunchServiceStatus({ includeState: true });
  if (status.state !== "healthy" || !status.running) {
    const error = new Error(status.message || "项目启动服务不可用，无法同步自动化配置。");
    error.code = "service-unavailable";
    throw error;
  }

  const connection = await projectLaunchServiceConnection();
  const response = await requestProjectLaunchService(
    connection.discovery,
    connection.token,
    "PUT",
    "/v1/automation/config",
    { revision: config.revision, config },
  );
  if (response.statusCode !== 200) {
    throw projectLaunchServiceResponseError(response, "项目启动服务拒绝了自动化配置。");
  }

  const revision = Number(response.payload?.revision);
  if (!Number.isInteger(revision) || revision !== config.revision) {
    const error = new Error("项目启动服务返回了无效的自动化 revision。");
    error.code = "invalid-automation-response";
    throw error;
  }

  return {
    accepted: true,
    revision,
    message: response.payload?.message,
  };
}

function serviceRunCount(runs) {
  return Array.isArray(runs)
    ? runs.filter((run) => ["starting", "running", "stopping"].includes(run.status)).length
    : 0;
}

function projectLaunchServiceEventToBridgeEvent(event) {
  return {
    type: event.type,
    projectId: event.projectId || "",
    scriptId: event.scriptId || "",
    pid: Number.isInteger(event.pid) ? event.pid : 0,
    ...(Number.isSafeInteger(event.cursor) && event.cursor >= 0 ? { cursor: event.cursor } : {}),
    runId: event.runId,
    runtimeOwner: "service",
    timestamp: event.timestamp,
    message: event.message,
    cwd: event.cwd,
    code: event.code,
    signal: event.signal,
    stoppedByUser: event.stoppedByUser,
    automationExitMatched: event.automationExitMatched === true,
    automationRunId: event.automationRunId,
  };
}

function projectLaunchServiceAutomationSnapshot(automation) {
  const revision = Number(automation?.revision);
  return {
    revision: Number.isSafeInteger(revision) && revision >= 0 ? revision : 0,
    ...(Array.isArray(automation?.executions) ? { executions: automation.executions } : {}),
  };
}

function projectLaunchServiceSchedulerSnapshot(scheduler) {
  if (!scheduler || typeof scheduler !== "object") return undefined;
  if (scheduler.state !== "running" && scheduler.state !== "degraded") return undefined;
  return {
    state: scheduler.state,
    ...(typeof scheduler.lastRunAt === "string" ? { lastRunAt: scheduler.lastRunAt } : {}),
    ...(typeof scheduler.lastSuccessAt === "string" ? { lastSuccessAt: scheduler.lastSuccessAt } : {}),
    ...(typeof scheduler.lastError === "string" ? { lastError: scheduler.lastError } : {}),
  };
}

async function readProjectLaunchServiceStatus(options = {}) {
  const status = projectLaunchServiceBaseStatus();
  if (!status.installed) {
    try {
      status.installed = fs.statSync(status.executablePath).isFile();
      if (status.installed) {
        status.state = "installed";
        status.message = "项目启动服务已安装，尚未运行。";
      }
    } catch (error) {
      return status;
    }
  }

  let connection;
  try {
    connection = await projectLaunchServiceConnection();
  } catch (error) {
    if (error?.code === "ENOENT") return status;
    if (error?.code === "protocol-mismatch") status.state = "incompatible";
    else status.state = readProjectLaunchServicePreferences().enabled ? "unavailable" : "installed";
    status.message = error instanceof Error ? error.message : "项目启动服务发现失败。";
    return status;
  }

  try {
    const health = await requestProjectLaunchServiceHealth(connection);
    const state = await requestProjectLaunchServiceState(connection);
    status.state = "healthy";
    status.running = true;
    status.message = "";
    status.protocolVersion = health.protocolVersion;
    status.serviceVersion = health.serviceVersion;
    status.activeRunCount = serviceRunCount(state.runs);
    if (options.includeState === true) {
      const automation = projectLaunchServiceAutomationSnapshot(state.automation);
      const scheduler = projectLaunchServiceSchedulerSnapshot(state.scheduler);
      status.runs = Array.isArray(state.runs) ? state.runs : [];
      status.latestCursor = state.latestCursor || 0;
      status.earliestCursor = state.earliestCursor || 0;
      status.automationRevision = automation.revision;
      status.automation = automation;
      if (scheduler) status.scheduler = scheduler;
    }
    return status;
  } catch (error) {
    if (error?.code === "protocol-mismatch") status.state = "incompatible";
    else status.state = "unavailable";
    status.message = error instanceof Error ? error.message : "项目启动服务不可用。";
    try {
      removeStaleProjectLaunchServiceDiscovery(connection.discovery);
    } catch (cleanupError) {
      // Keep the original service failure visible.
    }
    return status;
  }
}

function serviceStatusWithError(status, error, state = "unavailable") {
  return {
    ...status,
    state,
    message: error instanceof Error ? error.message : String(error || "项目启动服务不可用。"),
  };
}

function waitForProjectLaunchService() {
  const deadline = Date.now() + projectLaunchServiceStartupTimeoutMs;
  return new Promise((resolve) => {
    const check = async () => {
      const status = await readProjectLaunchServiceStatus();
      if (status.running && status.state === "healthy") {
        resolve(status);
        return;
      }
      if (Date.now() >= deadline) {
        resolve(status);
        return;
      }
      setTimeout(check, 100);
    };
    void check();
  });
}

async function startProjectLaunchService(options = {}) {
  const initial = projectLaunchServiceBaseStatus();
  try {
    initial.installed = fs.statSync(initial.executablePath).isFile();
  } catch (error) {
    return initial;
  }
  if (!initial.installed) return initial;

  if (options.requireVerifiedInstall !== false) {
    try {
      verifyProjectLaunchServiceInstalledExecutable();
    } catch (error) {
      return serviceStatusWithError(initial, error);
    }
  }

  const current = await readProjectLaunchServiceStatus();
  if (current.state === "healthy" && current.running) return current;
  if (current.state === "incompatible") return current;

  try {
    fs.mkdirSync(initial.directoryPath, { recursive: true });
    const child = spawn(initial.executablePath, ["--state-dir", initial.directoryPath], {
      cwd: initial.directoryPath,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    projectLaunchServiceProcess = child;
    child.once("exit", () => {
      if (projectLaunchServiceProcess === child) projectLaunchServiceProcess = null;
    });
    child.once("error", () => {
      if (projectLaunchServiceProcess === child) projectLaunchServiceProcess = null;
    });
    child.unref?.();
  } catch (error) {
    return serviceStatusWithError(initial, error);
  }

  return waitForProjectLaunchService();
}

async function stopProjectLaunchService() {
  const status = await readProjectLaunchServiceStatus();
  if (!status.running) return status;
  try {
    const connection = await projectLaunchServiceConnection();
    const response = await requestProjectLaunchService(
      connection.discovery,
      connection.token,
      "POST",
      "/v1/shutdown",
      {},
    );
    if (response.statusCode !== 202 && response.statusCode !== 200) {
      return serviceStatusWithError(status, projectLaunchServiceResponseError(response, "项目启动服务停止失败。"));
    }
    const deadline = Date.now() + projectLaunchServiceStartupTimeoutMs;
    while (Date.now() < deadline) {
      const next = await readProjectLaunchServiceStatus();
      if (!next.running) {
        projectLaunchServiceProcess = null;
        return next;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return serviceStatusWithError(status, new Error("项目启动服务停止超时。"));
  } catch (error) {
    return serviceStatusWithError(status, error);
  }
}

async function reconcileProjectLaunchService() {
  const preferences = readProjectLaunchServicePreferences();
  if (!preferences.enabled) {
    return readProjectLaunchServiceStatus({ includeState: true });
  }

  let status = await readProjectLaunchServiceStatus();
  if (status.state !== "healthy" || !status.running) {
    status = await startProjectLaunchService({ requireVerifiedInstall: true });
  }
  if (status.state !== "healthy" || !status.running) return status;

  try {
    const connection = await projectLaunchServiceConnection();
    const batch = await requestProjectLaunchServiceEvents(connection, projectLaunchServiceEventCursor);
    const latestState = await requestProjectLaunchServiceState(connection);
    const automation = projectLaunchServiceAutomationSnapshot(latestState.automation);
    const scheduler = projectLaunchServiceSchedulerSnapshot(latestState.scheduler);
    advanceProjectLaunchServiceEventCursor(batch);
    status = {
      ...status,
      runs: Array.isArray(latestState.runs) ? latestState.runs : [],
      activeRunCount: serviceRunCount(latestState.runs),
      latestCursor: batch.latestCursor || latestState.latestCursor || 0,
      earliestCursor: batch.earliestCursor || latestState.earliestCursor || 0,
      events: Array.isArray(batch.events) ? batch.events : [],
      eventsTruncated: batch.truncated === true,
      automationRevision: automation.revision,
      automation,
      ...(scheduler ? { scheduler } : {}),
    };
    scheduleProjectLaunchServiceEventPoll(batch.hasMore === true ? 0 : projectLaunchServiceEventPollIntervalMs);
    return status;
  } catch (error) {
    return serviceStatusWithError(status, error);
  }
}

function openProjectLaunchServiceDirectory() {
  const directoryPath = projectLaunchServiceDirectoryPath();
  fs.mkdirSync(directoryPath, { recursive: true });
  return shell.openPath(directoryPath);
}

async function pollProjectLaunchServiceEvents(emitEvents = true) {
  if (projectLaunchServiceEventPollInFlight || !readProjectLaunchServicePreferences().enabled) return false;
  projectLaunchServiceEventPollInFlight = true;
  let status = projectLaunchServiceBaseStatus();
  try {
    status = await readProjectLaunchServiceStatus({ includeState: true });
    if (status.state !== "healthy" || !status.running) {
      if (emitEvents) {
        emit({ type: "service-state", status, timestamp: new Date().toISOString() });
      }
      return false;
    }
    const connection = await projectLaunchServiceConnection();
    const batch = await requestProjectLaunchServiceEvents(connection, projectLaunchServiceEventCursor);
    const latestState = await requestProjectLaunchServiceState(connection);
    const automation = projectLaunchServiceAutomationSnapshot(latestState.automation);
    const scheduler = projectLaunchServiceSchedulerSnapshot(latestState.scheduler);
    status = {
      ...status,
      runs: Array.isArray(latestState.runs) ? latestState.runs : [],
      activeRunCount: serviceRunCount(latestState.runs),
      automationRevision: automation.revision,
      automation,
      ...(scheduler ? { scheduler } : {}),
    };
    advanceProjectLaunchServiceEventCursor(batch);
    const snapshot = {
      ...status,
      events: emitEvents ? [] : Array.isArray(batch.events) ? batch.events : [],
      latestCursor: batch.latestCursor || latestState.latestCursor || status.latestCursor || 0,
      earliestCursor: batch.earliestCursor || latestState.earliestCursor || status.earliestCursor || 0,
      eventsTruncated: batch.truncated === true,
    };
    if (emitEvents && Array.isArray(batch.events)) {
      batch.events.forEach((event) => emit(projectLaunchServiceEventToBridgeEvent(event)));
    }
    if (emitEvents) {
      emit({ type: "service-state", status: snapshot, timestamp: new Date().toISOString() });
    }
    return batch.hasMore === true;
  } catch (error) {
    if (emitEvents) {
      emit({
        type: "service-state",
        status: serviceStatusWithError(status, error),
        timestamp: new Date().toISOString(),
      });
    }
    return false;
  } finally {
    projectLaunchServiceEventPollInFlight = false;
  }
}

function scheduleProjectLaunchServiceEventPoll(delay = projectLaunchServiceEventPollIntervalMs) {
  if (projectLaunchServiceEventPollTimer) clearTimeout(projectLaunchServiceEventPollTimer);
  if (!readProjectLaunchServicePreferences().enabled) return;
  projectLaunchServiceEventPollTimer = setTimeout(async () => {
    projectLaunchServiceEventPollTimer = null;
    const hasMore = await pollProjectLaunchServiceEvents(true);
    scheduleProjectLaunchServiceEventPoll(hasMore ? 0 : projectLaunchServiceEventPollIntervalMs);
  }, delay);
}

async function runProjectLaunchServiceCommand(payload) {
  const status = await reconcileProjectLaunchService();
  if (status.state !== "healthy" || !status.running) {
    throw new Error(status.message || "项目启动服务不可用。请修复服务或在设置中关闭服务模式。");
  }
  const connection = await projectLaunchServiceConnection();
  const idempotencyKey =
    globalThis.crypto?.randomUUID?.() || `launch-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const response = await requestProjectLaunchService(
    connection.discovery,
    connection.token,
    "POST",
    "/v1/runs",
    {
      projectId: payload.projectId,
      scriptId: payload.scriptId,
      command: payload.command,
      cwd: expandPath(payload.cwd),
      env: payload.env || {},
      label: payload.label,
      automationRunId: payload.automationRunId,
    },
    { idempotencyKey: projectLaunchServiceIdempotencyKey("run") },
  );
  if (response.statusCode !== 200 && response.statusCode !== 201) {
    throw projectLaunchServiceResponseError(response, "项目启动服务无法启动脚本。");
  }
  const run = response.payload?.run;
  if (!run || typeof run.id !== "string" || !run.id.trim()) {
    throw new Error("项目启动服务返回了无效的运行记录。");
  }
  await pollProjectLaunchServiceEvents(true);
  return {
    pid: Number.isInteger(run.pid) && run.pid > 0 ? run.pid : 0,
    startedAt: run.startedAt,
    command: run.command,
    cwd: run.cwd,
    runId: run.id,
    runtimeOwner: "service",
  };
}

function projectLaunchServiceRunToProcessStatus(run) {
  if (!run) {
    return { active: false };
  }
  return {
    active: ["starting", "running", "stopping"].includes(run.status),
    runId: run.id,
    runtimeOwner: "service",
    code: run.code,
    signal: run.signal,
    stoppedByUser: run.stoppedByUser,
    error: run.error,
    endedAt: run.endedAt,
    automationExitMatched: run.automationExitMatched === true,
    automationRunId: run.automationRunId,
  };
}

function shouldUseProjectLaunchServiceRuntime(options = {}) {
  if (options.runtimeOwner === "preload") {
    return false;
  }
  return options.runtimeOwner === "service" || (readProjectLaunchServicePreferences().enabled && options.runId);
}

async function getProjectLaunchServiceRunStatus(runId) {
  if (typeof runId !== "string" || !runId) {
    return { active: false, error: "服务运行记录缺少 runId。" };
  }
  const status = await readProjectLaunchServiceStatus({ includeState: true });
  if (status.state !== "healthy" || !status.running) {
    return {
      active: false,
      serviceState: status.state,
      error: status.message || "项目启动服务不可用。",
    };
  }
  return projectLaunchServiceRunToProcessStatus(status.runs?.find((run) => run.id === runId));
}

async function stopProjectLaunchServiceRun(runId) {
  const connection = await projectLaunchServiceConnection();
  const response = await requestProjectLaunchService(
    connection.discovery,
    connection.token,
    "POST",
    `/v1/runs/${encodeURIComponent(runId)}/stop`,
    {},
  );
  if (response.statusCode !== 202 && response.statusCode !== 200) {
    throw projectLaunchServiceResponseError(response, "项目启动服务停止脚本失败。");
  }
  await pollProjectLaunchServiceEvents(true);
}

async function sendProjectLaunchServiceRunInput(runId, input) {
  const connection = await projectLaunchServiceConnection();
  const response = await requestProjectLaunchService(
    connection.discovery,
    connection.token,
    "POST",
    `/v1/runs/${encodeURIComponent(runId)}/input`,
    { input: String(input ?? "") },
  );
  if (response.statusCode !== 200) {
    throw projectLaunchServiceResponseError(response, "项目启动服务发送输入失败。");
  }
  await pollProjectLaunchServiceEvents(true);
  return response.payload || { sent: false, message: "项目启动服务没有返回输入结果。" };
}
