const windowsNativeCommandPattern = /\.(?:com|exe)$/i;
const windowsCommandShimPattern = /\.(?:bat|cmd)$/i;
const windowsCommandShimUnsafePattern = /["&|<>^%!()\r\n]/;
const makeTargetPattern = /^[A-Za-z0-9][A-Za-z0-9_.@/+-]*$/;

function shellCommandInvocation(command) {
  if (process.platform === "win32") {
    return {
      executable: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", command],
    };
  }

  const shellPath = process.env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/sh");
  const shellName = path.basename(shellPath);
  return {
    executable: shellPath,
    args: [shellName === "sh" ? "-lc" : "-ilc", command],
  };
}

function resolveWindowsDirectCommand(command) {
  if (process.platform !== "win32" || path.extname(command)) return Promise.resolve(command);
  return new Promise((resolve) => {
    execFile("where.exe", [command], { encoding: "buffer", windowsHide: true, timeout: 5000 }, (error, stdout) => {
      if (error) {
        resolve(command);
        return;
      }
      const decode = createProcessOutputDecoder();
      const output = Buffer.isBuffer(stdout) ? decode(stdout) + decode() : String(stdout || "");
      const candidates = output
        .split(/\r?\n/)
        .map((candidate) => candidate.trim())
        .filter(Boolean);
      resolve(
        candidates.find((candidate) => windowsNativeCommandPattern.test(candidate)) ||
          candidates.find((candidate) => windowsCommandShimPattern.test(candidate)) ||
          command,
      );
    });
  });
}

function firstExecutablePath(output) {
  const candidates = String(output || "")
    .split(/\r?\n/)
    .map((candidate) => candidate.trim())
    .filter(Boolean);
  if (process.platform !== "win32") return candidates[0] || "";
  return (
    candidates.find((candidate) => windowsNativeCommandPattern.test(candidate)) ||
    candidates.find((candidate) => windowsCommandShimPattern.test(candidate)) ||
    candidates[0] ||
    ""
  );
}

function runToolCommand(command, args, direct = false) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timeout = null;
    let timedOut = false;
    let settled = false;
    const decodeStdout = createProcessOutputDecoder();
    const decodeStderr = createProcessOutputDecoder();

    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      resolve(result);
    };

    const flushOutput = () => {
      stdout += decodeStdout();
      stderr += decodeStderr();
    };

    const start = async () => {
      try {
        const resolvedCommand = direct ? await resolveWindowsDirectCommand(command) : command;
        const commandLine =
          process.platform === "win32"
            ? [command, ...args].join(" ")
            : [command, ...args].map(quoteShellToken).join(" ");
        const spawnOptions = { stdio: ["ignore", "pipe", "pipe"], windowsHide: true };
        const usesWindowsShim =
          direct && process.platform === "win32" && windowsCommandShimPattern.test(resolvedCommand);
        if (
          usesWindowsShim &&
          [resolvedCommand, ...args].some((token) => windowsCommandShimUnsafePattern.test(token))
        ) {
          finish({ error: new Error("Windows command shim contains unsupported shell characters."), stdout, stderr });
          return;
        }
        const child = usesWindowsShim
          ? spawn(process.env.ComSpec || "cmd.exe", ["/d", "/c", resolvedCommand, ...args], spawnOptions)
          : direct && process.platform === "win32"
            ? spawn(resolvedCommand, args, spawnOptions)
            : (() => {
                const invocation = shellCommandInvocation(commandLine);
                return spawn(invocation.executable, invocation.args, spawnOptions);
              })();
        timeout = setTimeout(() => {
          timedOut = true;
          child.kill();
        }, 5000);

        child.stdout?.on("data", (chunk) => {
          stdout += decodeStdout(chunk);
        });
        child.stderr?.on("data", (chunk) => {
          stderr += decodeStderr(chunk);
        });
        child.on("error", (error) => {
          flushOutput();
          finish({ error, stdout, stderr });
        });
        child.on("close", (status) => {
          flushOutput();
          finish({
            status,
            stdout,
            stderr,
            error: timedOut ? new Error(`Command timed out after 5000ms: ${command}`) : undefined,
          });
        });
      } catch (error) {
        finish({ error, stdout, stderr });
      }
    };
    void start();
  });
}

async function detectEnvironmentTool(request) {
  const custom = request?.kind === "custom" ? normalizeCustomEnvironmentTool({ ...request, enabled: true }) : null;
  const override = request?.kind === "builtin-override" ? normalizeBuiltinEnvironmentToolOverride(request) : null;
  const builtin =
    request?.kind === "builtin" && Object.prototype.hasOwnProperty.call(environmentTools, request.key)
      ? environmentTools[request.key]
      : null;
  const builtinDefinition = builtin || (override ? environmentTools[override.key] : null);
  const key = builtinDefinition ? request.key : custom?.id || String(request?.id || request?.key || "invalid");
  const name = builtinDefinition?.name || custom?.name || String(request?.name || key);
  const checkedAt = new Date().toISOString();
  if (!builtinDefinition && !custom) {
    return {
      key,
      name,
      status: "error",
      version: "",
      executablePath: "",
      checkedAt,
      error: "Invalid environment tool configuration.",
    };
  }
  const command = override?.command || builtin?.command || custom.command;
  const versionArgs = override?.versionArgs || builtin?.versionArgs || custom.versionArgs;
  const direct = Boolean(override || custom);
  const versionResult = await runToolCommand(command, versionArgs, direct);
  if (versionResult.error || versionResult.status !== 0) {
    return {
      key,
      name,
      status: "missing",
      version: "",
      executablePath: "",
      checkedAt,
      error: versionResult.error?.message || String(versionResult.stderr || "Command not found").trim(),
    };
  }
  const [pathCommand, ...pathArgs] = builtin?.pathArgs || [process.platform === "win32" ? "where" : "which", command];
  const pathResult = await runToolCommand(pathCommand, pathArgs, direct);
  return {
    key,
    name,
    status: "available",
    version:
      String(versionResult.stdout || versionResult.stderr || "")
        .trim()
        .split(/\r?\n/)[0] || "OK",
    executablePath: pathResult.status === 0 ? firstExecutablePath(pathResult.stdout) : "",
    checkedAt,
  };
}
