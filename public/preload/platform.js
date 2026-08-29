function getDirectoryStatus(targetPath) {
  if (!targetPath) {
    return { exists: false, isDirectory: false };
  }

  try {
    const stats = fs.statSync(targetPath);
    return { exists: true, isDirectory: stats.isDirectory() };
  } catch (error) {
    return { exists: false, isDirectory: false };
  }
}

function isSupportedTerminalKind(kind) {
  return terminalKinds.has(kind);
}

function splitCommandLine(commandLine) {
  const tokens = [];
  let current = "";
  let quote = null;

  for (let index = 0; index < commandLine.length; index += 1) {
    const character = commandLine[index];

    if (quote) {
      if (character === quote) {
        quote = null;
        continue;
      }

      current += character;
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }

    if (/\s/.test(character)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += character;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

function formatCommandLine(executable, args) {
  return [executable, ...args].join(" ");
}

function quoteShellToken(token) {
  return `'${String(token).replace(/'/g, `'\\''`)}'`;
}

function launchDetachedProcess(executable, args, cwd, environment) {
  return new Promise((resolve) => {
    let child;

    try {
      const options = {
        cwd,
        detached: true,
        stdio: "ignore",
      };
      if (environment) options.env = environment;
      child = spawn(executable, args, options);
    } catch (error) {
      resolve({
        launched: false,
        command: formatCommandLine(executable, args),
        cwd,
        kind: "custom",
        message: error?.message || "无法启动终端。",
      });
      return;
    }

    let settled = false;

    child.once("spawn", () => {
      settled = true;
      child.unref();
      resolve({
        launched: true,
        command: formatCommandLine(executable, args),
        cwd,
      });
    });

    child.once("error", (error) => {
      if (settled) {
        return;
      }

      resolve({
        launched: false,
        command: formatCommandLine(executable, args),
        cwd,
        message: error?.message || "无法启动终端。",
      });
    });
  });
}

const macApplications = {
  "terminal-app": {
    name: "Terminal",
    paths: ["/System/Applications/Utilities/Terminal.app", "/Applications/Utilities/Terminal.app"],
  },
  iterm2: { name: "iTerm", paths: ["/Applications/iTerm.app"] },
  warp: { name: "Warp", paths: ["/Applications/Warp.app"] },
  vscode: { name: "Visual Studio Code", paths: ["/Applications/Visual Studio Code.app"] },
  cursor: { name: "Cursor", paths: ["/Applications/Cursor.app"] },
};

const windowsExecutables = {
  "windows-terminal": {
    commands: ["wt.exe", "wt"],
    paths: () => [path.join(process.env.LOCALAPPDATA || "", "Microsoft", "WindowsApps", "wt.exe")],
  },
  powershell: {
    commands: ["pwsh.exe", "powershell.exe"],
    paths: () => [
      path.join(process.env.ProgramFiles || "", "PowerShell", "7", "pwsh.exe"),
      path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    ],
  },
  cmd: {
    commands: [],
    paths: () => [process.env.ComSpec || path.join(process.env.SystemRoot || "C:\\Windows", "System32", "cmd.exe")],
  },
  vscode: {
    commands: ["Code.exe", "code.cmd", "code"],
    paths: () => [
      path.join(process.env.LOCALAPPDATA || "", "Programs", "Microsoft VS Code", "Code.exe"),
      path.join(process.env.ProgramFiles || "", "Microsoft VS Code", "Code.exe"),
      path.join(process.env["ProgramFiles(x86)"] || "", "Microsoft VS Code", "Code.exe"),
    ],
  },
  cursor: {
    commands: ["Cursor.exe", "cursor.cmd", "cursor"],
    paths: () => [
      path.join(process.env.LOCALAPPDATA || "", "Programs", "Cursor", "Cursor.exe"),
      path.join(process.env.ProgramFiles || "", "Cursor", "Cursor.exe"),
    ],
  },
};

const linuxExecutables = {
  "linux-terminal": [
    "x-terminal-emulator",
    "gnome-terminal",
    "konsole",
    "xfce4-terminal",
    "kitty",
    "alacritty",
    "xterm",
  ],
  vscode: ["code", "code-insiders"],
  cursor: ["cursor"],
};

function fileExists(targetPath) {
  try {
    return Boolean(targetPath) && fs.statSync(targetPath).isFile();
  } catch (error) {
    return false;
  }
}

function directoryExists(targetPath) {
  try {
    return Boolean(targetPath) && fs.statSync(targetPath).isDirectory();
  } catch (error) {
    return false;
  }
}

function isWindowsAppExecutionAlias(targetPath) {
  return /(?:^|[\\/])Microsoft[\\/]WindowsApps[\\/].+\.(?:exe|cmd)$/i.test(String(targetPath || ""));
}

function findMacApplication(kind) {
  const candidate = macApplications[kind];
  if (!candidate) return "";
  const directPaths = [...candidate.paths, path.join(os.homedir(), "Applications", `${candidate.name}.app`)];
  const direct = directPaths.find(directoryExists);
  if (direct) return direct;
  try {
    const query = `kMDItemContentType == 'com.apple.application-bundle' && kMDItemDisplayName == '${candidate.name.replace(/'/g, "\\'")}'`;
    const output = execFileSync("/usr/bin/mdfind", [query], { encoding: "utf8", timeout: 1500 });
    return (
      output
        .split(/\r?\n/)
        .map((item) => item.trim())
        .find(directoryExists) || ""
    );
  } catch (error) {
    return "";
  }
}

function findWindowsExecutable(kind) {
  const candidate = windowsExecutables[kind];
  if (!candidate) return "";
  const direct = candidate.paths().find(fileExists);
  if (direct) return direct;
  for (const command of candidate.commands) {
    try {
      const decode = createProcessOutputDecoder();
      const output = decode(execFileSync("where.exe", [command], { encoding: "buffer", timeout: 1500 })) + decode();
      const executable = output
        .split(/\r?\n/)
        .map((item) => item.trim())
        .find((targetPath) => fileExists(targetPath) || isWindowsAppExecutionAlias(targetPath));
      if (executable) return executable;
    } catch (error) {
      // Try the next known executable without exposing a shell to the user path.
    }
  }
  return "";
}

function findLinuxExecutable(kind) {
  for (const command of linuxExecutables[kind] || []) {
    try {
      const decode = createProcessOutputDecoder();
      const output = decode(execFileSync("which", [command], { encoding: "buffer", timeout: 1500 })) + decode();
      const executable = output
        .split(/\r?\n/)
        .map((item) => item.trim())
        .find(fileExists);
      if (executable) return executable;
    } catch (error) {
      // Try the next common Linux launcher without exposing a shell to the user path.
    }
  }
  return "";
}

function getHostPlatform() {
  if (process.platform === "darwin") return "darwin";
  if (process.platform === "win32") return "win32";
  if (process.platform === "linux") return "linux";
  return "unsupported";
}

function isSupportedExternalApplicationKind(kind) {
  return editorKinds.has(kind);
}

function isWindowsApplicationCommand(kind, executable) {
  if (getHostPlatform() !== "win32" || !executable || /[\\/]/.test(executable)) return false;
  const candidate = windowsExecutables[kind];
  if (!candidate) return false;
  const normalizedExecutable = executable.toLocaleLowerCase();
  return candidate.commands.some((commandName) => commandName.toLocaleLowerCase() === normalizedExecutable);
}

function launchCommandExecutable(executable, args, cwd) {
  if (getHostPlatform() === "win32" && /\.(?:cmd|bat)$/i.test(executable)) {
    const commandInterpreter =
      process.env.ComSpec || path.join(process.env.SystemRoot || "C:\\Windows", "System32", "cmd.exe");
    const commandVariable = "UTOOLS_PROJECT_LAUNCH_COMMAND";
    const argumentPrefix = "UTOOLS_PROJECT_LAUNCH_ARGUMENT_";
    const environment = { ...process.env, [commandVariable]: executable };
    const commandParts = [`"%${commandVariable}%"`];
    for (const [index, argument] of args.entries()) {
      const argumentVariable = `${argumentPrefix}${index}`;
      environment[argumentVariable] = argument;
      commandParts.push(`"%${argumentVariable}%"`);
    }
    return launchDetachedProcess(
      commandInterpreter,
      ["/d", "/v:off", "/s", "/c", commandParts.join(" ")],
      cwd,
      environment,
    );
  }
  return launchDetachedProcess(executable, args, cwd);
}

function launchCustomCommand(command, resolvedPath, kind) {
  const commandTokens = splitCommandLine(command).map((token) =>
    token.replace(/\{path\}|\{projectPath\}/g, () => resolvedPath),
  );
  const [executable, ...args] = commandTokens;
  if (!executable) return Promise.resolve(null);
  const resolvedExecutable = isWindowsApplicationCommand(kind, executable)
    ? findWindowsExecutable(kind) || executable
    : executable;
  return launchCommandExecutable(resolvedExecutable, args, resolvedPath);
}

function launchNativeTarget(kind, resolvedPath) {
  const platform = getHostPlatform();
  if (platform === "darwin") {
    const appPath = findMacApplication(kind);
    if (!appPath) return Promise.resolve(null);
    return launchDetachedProcess("/usr/bin/open", ["-a", macApplications[kind].name, resolvedPath], resolvedPath);
  }
  if (platform === "linux") {
    const executable = findLinuxExecutable(kind);
    if (!executable) return Promise.resolve(null);
    return launchDetachedProcess(executable, kind === "linux-terminal" ? [] : [resolvedPath], resolvedPath);
  }
  if (platform !== "win32") return Promise.resolve(null);
  const executable = findWindowsExecutable(kind);
  if (!executable) return Promise.resolve(null);
  if (kind === "windows-terminal") return launchDetachedProcess(executable, ["-d", resolvedPath], resolvedPath);
  if (kind === "powershell") return launchDetachedProcess(executable, ["-NoExit"], resolvedPath);
  if (kind === "cmd") return launchDetachedProcess(executable, ["/d", "/k"], resolvedPath);
  return launchDetachedProcess(executable, [resolvedPath], resolvedPath);
}

async function openTerminal(payload) {
  const resolvedPath = expandPath(typeof payload?.projectPath === "string" ? payload.projectPath : "");
  const terminal = normalizeTerminalPreferences(payload?.terminal);
  const directoryStatus = getDirectoryStatus(resolvedPath);
  const kind = terminal.kind;
  if (!directoryStatus.exists) return { launched: false, command: "", cwd: resolvedPath, kind, code: "path-not-found" };
  if (!directoryStatus.isDirectory)
    return { launched: false, command: "", cwd: resolvedPath, kind, code: "path-not-directory" };
  if (getHostPlatform() === "unsupported")
    return { launched: false, command: "", cwd: resolvedPath, kind, code: "preview-unsupported" };
  if (terminal.kind === "custom") {
    if (!terminal.customCommand.trim())
      return { launched: false, command: "", cwd: resolvedPath, kind, code: "invalid-custom-command" };
    const result = await launchCustomCommand(terminal.customCommand.trim(), resolvedPath);
    return {
      ...(result || { launched: false, command: terminal.customCommand, cwd: resolvedPath }),
      kind,
      code: result?.launched ? "launched" : "launch-failed",
    };
  }
  const result = await launchNativeTarget(kind, resolvedPath);
  if (result?.launched) return { ...result, kind, code: "launched" };
  return { launched: false, command: "", cwd: resolvedPath, kind, code: "application-unavailable" };
}

async function openExternalApplication(payload) {
  const resolvedPath = expandPath(typeof payload?.projectPath === "string" ? payload.projectPath : "");
  const application = payload?.application;
  const applicationId = typeof application?.id === "string" ? application.id.trim() : "";
  const directoryStatus = getDirectoryStatus(resolvedPath);
  const requestedKind = isSupportedExternalApplicationKind(application?.kind) ? application.kind : "vscode";
  if (
    !applicationId ||
    !application?.name ||
    !application?.enabled ||
    !isSupportedExternalApplicationKind(application?.kind) ||
    (application.kind === "custom"
      ? builtinExternalApplications.some((builtin) => builtin.id === applicationId)
      : applicationId !== application.kind)
  ) {
    return {
      launched: false,
      command: "",
      cwd: resolvedPath,
      applicationId,
      kind: requestedKind,
      requestedApplicationId: applicationId,
      code: "invalid-preference",
    };
  }
  if (!directoryStatus.exists)
    return {
      launched: false,
      command: "",
      cwd: resolvedPath,
      applicationId,
      kind: requestedKind,
      requestedApplicationId: applicationId,
      code: "path-not-found",
    };
  if (!directoryStatus.isDirectory)
    return {
      launched: false,
      command: "",
      cwd: resolvedPath,
      applicationId,
      kind: requestedKind,
      requestedApplicationId: applicationId,
      code: "path-not-directory",
    };
  if (getHostPlatform() === "unsupported")
    return {
      launched: false,
      command: "",
      cwd: resolvedPath,
      applicationId,
      kind: requestedKind,
      requestedApplicationId: applicationId,
      code: "preview-unsupported",
    };
  const attempts = [applicationId];
  const builtin = builtinExternalApplications.find((candidate) => candidate.id === applicationId);
  const useNative = application.kind !== "custom" && application.command === builtin?.command;
  const result = useNative
    ? await launchNativeTarget(application.kind, resolvedPath)
    : await launchCustomCommand(application.command || "", resolvedPath, application.kind);
  if (result?.launched) {
    return {
      ...result,
      applicationId,
      kind: application.kind,
      requestedApplicationId: applicationId,
      resolvedApplicationId: applicationId,
      attempts,
      code: "launched",
    };
  }
  return {
    launched: false,
    command: "",
    cwd: resolvedPath,
    applicationId,
    kind: requestedKind,
    requestedApplicationId: applicationId,
    attempts,
    code: !useNative && !application?.command?.trim() ? "invalid-custom-command" : "application-unavailable",
  };
}
