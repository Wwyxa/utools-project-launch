function runCommand(payload) {
  if (readProjectLaunchServicePreferences().enabled) {
    return runProjectLaunchServiceCommand(payload);
  }

  const runId = createPreloadRunId();
  const runtimeOwner = "preload";
  const resolvedCwd = expandPath(payload.cwd);
  const decodeStdout = createProcessOutputDecoder();
  const decodeStderr = createProcessOutputDecoder();
  const invocation = shellCommandInvocation(payload.command);
  const child = spawn(invocation.executable, invocation.args, {
    cwd: resolvedCwd,
    env: { ...process.env, ...payload.env },
    shell: false,
    // On Unix, this makes the command shell the leader of a process group so
    // Stop can terminate make, package managers, and their descendants.
    detached: process.platform !== "win32",
    windowsHide: true,
  });
  const childPid = typeof child.pid === "number" ? child.pid : -1;
  let processSettled = false;

  if (childPid > 0) {
    activeProcesses.set(childPid, child);
    activeProcessMetadata.set(childPid, {
      projectId: payload.projectId,
      scriptId: payload.scriptId,
      automationRunId: payload.automationRunId,
      runId,
      runtimeOwner,
    });
    launchedProcessIds.add(childPid);
  }

  const cleanupProcess = () => {
    if (childPid > 0) {
      const escalationTimer = processStopEscalationTimers.get(childPid);
      if (escalationTimer) {
        clearTimeout(escalationTimer);
        processStopEscalationTimers.delete(childPid);
      }
      activeProcesses.delete(childPid);
      activeProcessMetadata.delete(childPid);
      launchedProcessIds.delete(childPid);
      automationExitMatchedProcesses.delete(childPid);
    }
  };

  const rememberCompletedProcessResult = (result) => {
    if (childPid <= 0) {
      return;
    }
    const resultWithEndedAt = {
      ...result,
      endedAt: new Date().toISOString(),
      automationRunId: payload.automationRunId,
      runId,
      runtimeOwner,
    };
    completedProcessResults.set(childPid, resultWithEndedAt);
    if (payload.automationRunId) {
      completedAutomationProcessResults.set(
        automationProcessKey(payload.projectId, payload.scriptId, payload.automationRunId),
        resultWithEndedAt,
      );
    }
    while (completedProcessResults.size > completedProcessResultLimit) {
      const oldestPid = completedProcessResults.keys().next().value;
      completedProcessResults.delete(oldestPid);
    }
    while (completedAutomationProcessResults.size > completedProcessResultLimit) {
      const oldestKey = completedAutomationProcessResults.keys().next().value;
      completedAutomationProcessResults.delete(oldestKey);
    }
  };

  emit({
    type: "started",
    projectId: payload.projectId,
    scriptId: payload.scriptId,
    pid: childPid,
    runId,
    runtimeOwner,
    automationRunId: payload.automationRunId,
    message: payload.command,
    cwd: resolvedCwd,
  });

  child.stdout?.on("data", (chunk) => {
    emit({
      type: "stdout",
      projectId: payload.projectId,
      scriptId: payload.scriptId,
      pid: childPid,
      runId,
      runtimeOwner,
      automationRunId: payload.automationRunId,
      message: decodeStdout(chunk),
    });
  });

  child.stderr?.on("data", (chunk) => {
    emit({
      type: "stderr",
      projectId: payload.projectId,
      scriptId: payload.scriptId,
      pid: childPid,
      runId,
      runtimeOwner,
      automationRunId: payload.automationRunId,
      message: decodeStderr(chunk),
    });
  });

  child.on("error", (error) => {
    if (processSettled) {
      return;
    }

    processSettled = true;
    const automationExitMatched = childPid > 0 && automationExitMatchedProcesses.has(childPid);
    rememberCompletedProcessResult({
      error: error?.message || "command failed",
      ...(automationExitMatched ? { automationExitMatched: true } : {}),
    });
    cleanupProcess();
    if (childPid > 0) {
      userStoppedProcesses.delete(childPid);
    }
    emit({
      type: "error",
      projectId: payload.projectId,
      scriptId: payload.scriptId,
      pid: childPid,
      runId,
      runtimeOwner,
      automationRunId: payload.automationRunId,
      ...(automationExitMatched ? { automationExitMatched: true } : {}),
      message: error?.message || "command failed",
    });
  });

  child.on("close", (code, signal) => {
    if (processSettled) {
      return;
    }

    processSettled = true;
    const stoppedByUser = childPid > 0 ? userStoppedProcesses.delete(childPid) : false;
    const automationExitMatched = childPid > 0 && automationExitMatchedProcesses.has(childPid);
    rememberCompletedProcessResult({
      code,
      signal,
      stoppedByUser,
      ...(automationExitMatched ? { automationExitMatched: true } : {}),
    });
    cleanupProcess();
    emit({
      type: "exit",
      projectId: payload.projectId,
      scriptId: payload.scriptId,
      pid: childPid,
      runId,
      runtimeOwner,
      automationRunId: payload.automationRunId,
      ...(automationExitMatched ? { automationExitMatched: true } : {}),
      code,
      signal,
      stoppedByUser,
    });
  });

  return {
    pid: childPid,
    startedAt: new Date().toISOString(),
    command: payload.command,
    cwd: resolvedCwd,
    runId,
    runtimeOwner,
  };
}

function getProcessStatus(pid, options = {}) {
  if (shouldUseProjectLaunchServiceRuntime(options)) {
    return getProjectLaunchServiceRunStatus(options.runId);
  }

  const metadata = activeProcessMetadata.get(pid);
  if (activeProcesses.has(pid) && (!options.runId || metadata?.runId === options.runId)) {
    return {
      active: true,
      runId: metadata?.runId,
      runtimeOwner: metadata?.runtimeOwner,
    };
  }

  const result = completedProcessResults.get(pid);
  if (result && (!options.runId || result.runId === options.runId)) {
    return { active: false, ...result };
  }

  return { active: false };
}

function getAutomationProcessResult(projectId, scriptId, automationRunId) {
  const result = completedAutomationProcessResults.get(automationProcessKey(projectId, scriptId, automationRunId));
  return result ? { active: false, ...result } : null;
}

function stopWindowsProcessTree(pid) {
  const script = [
    "$root = [int]$env:UTOOLS_STOP_PID",
    "$seen = New-Object 'System.Collections.Generic.HashSet[int]'",
    "$queue = New-Object 'System.Collections.Generic.Queue[int]'",
    "$queue.Enqueue($root) | Out-Null",
    "while ($queue.Count -gt 0) {",
    "  $current = $queue.Dequeue()",
    '  Get-CimInstance Win32_Process -Filter "ParentProcessId = $current" | ForEach-Object {',
    "    $processId = [int]$_.ProcessId",
    "    if ($seen.Add($processId)) {",
    "      $queue.Enqueue($processId) | Out-Null",
    "    }",
    "  }",
    "}",
    "$seen | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }",
    "Stop-Process -Id $root -Force -ErrorAction SilentlyContinue",
  ].join("\n");

  return new Promise((resolve) => {
    let killer;
    try {
      killer = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
        env: { ...process.env, UTOOLS_STOP_PID: String(pid) },
        stdio: "ignore",
        windowsHide: true,
      });
    } catch (error) {
      resolve();
      return;
    }

    killer.once("error", () => resolve());
    killer.once("close", () => resolve());
  });
}

function signalUnixProcessTree(pid, child, signal) {
  try {
    // A negative pid targets the detached command process group.
    process.kill(-pid, signal);
    return;
  } catch (error) {
    // Fall back for commands started before process groups were enabled.
  }

  try {
    process.kill(pid, signal);
    return;
  } catch (error) {
    // Some test or host runtimes may not expose process.kill.
  }

  try {
    child?.kill?.(signal);
  } catch (error) {
    // Stopping is best-effort; the child exit event remains the source of truth.
  }
}

function stopUnixProcessTree(pid, child) {
  signalUnixProcessTree(pid, child, "SIGTERM");
  if (processStopEscalationTimers.has(pid)) {
    return;
  }

  const escalationTimer = setTimeout(() => {
    processStopEscalationTimers.delete(pid);
    if (activeProcesses.has(pid)) {
      signalUnixProcessTree(pid, activeProcesses.get(pid), "SIGKILL");
    }
  }, processStopGracePeriodMs);
  processStopEscalationTimers.set(pid, escalationTimer);
}

async function stopProcess(pid, options) {
  if (shouldUseProjectLaunchServiceRuntime(options)) {
    await stopProjectLaunchServiceRun(options?.runId);
    return;
  }

  const child = activeProcesses.get(pid);
  const metadata = activeProcessMetadata.get(pid);

  if (options?.runId && metadata?.runId !== options.runId) {
    return;
  }

  if (
    child &&
    options?.automationExitMatched === true &&
    typeof options.automationRunId === "string" &&
    options.automationRunId === metadata?.automationRunId
  ) {
    automationExitMatchedProcesses.add(pid);
  }

  if (child) {
    userStoppedProcesses.add(pid);
    if (process.platform === "win32") {
      await stopWindowsProcessTree(pid);
    } else {
      stopUnixProcessTree(pid, child);
    }
  }

  if (!child) {
    userStoppedProcesses.delete(pid);
    if (process.platform === "win32" && launchedProcessIds.has(pid)) {
      await stopWindowsProcessTree(pid);
    }
  }
}

async function sendProcessInput(pid, input, options = {}) {
  if (shouldUseProjectLaunchServiceRuntime(options)) {
    return sendProjectLaunchServiceRunInput(options.runId, input);
  }

  const child = activeProcesses.get(pid);
  const metadata = activeProcessMetadata.get(pid);
  if (!child || !child.stdin || child.stdin.destroyed || child.stdin.writableEnded) {
    return { sent: false, message: "当前进程不可输入。" };
  }
  if (!metadata) {
    return { sent: false, message: "当前进程缺少日志上下文。" };
  }
  if (options.runId && metadata.runId !== options.runId) {
    return { sent: false, message: "当前进程运行身份已变更。" };
  }

  const line = `${String(input ?? "")}\n`;
  return new Promise((resolve) => {
    child.stdin.write(line, (error) => {
      if (error) {
        resolve({ sent: false, message: error.message || "输入发送失败。" });
        return;
      }

      emit({
        type: "stdin",
        projectId: metadata.projectId,
        scriptId: metadata.scriptId,
        pid,
        runId: metadata.runId,
        runtimeOwner: metadata.runtimeOwner,
        automationRunId: metadata.automationRunId,
        message: String(input ?? ""),
      });
      resolve({ sent: true });
    });
  });
}

function stopAllProcesses() {
  Array.from(launchedProcessIds.values()).forEach((pid) => stopProcess(pid));
}

