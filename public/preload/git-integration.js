let gitIntegrationEnvironmentPromise = null;

async function resolveGitIntegrationEnvironment() {
  if (gitExecutionEnvironment) return gitExecutionEnvironment;
  if (!gitIntegrationEnvironmentPromise) {
    gitIntegrationEnvironmentPromise = (async () => {
      const baseEnvironment = { ...process.env };
      const readEnvironment = (command, args) => new Promise((resolve) => {
        execFile(command, args, {
          encoding: 'buffer', timeout: gitEnvironmentBootstrapTimeoutMs,
          maxBuffer: 1024 * 1024, windowsHide: true,
        }, (error, stdout) => resolve(error ? null : stdout));
      });
      let environment;
      if (process.platform === 'win32') {
        const registryPaths = [
          'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment',
          'HKCU\\Environment',
        ];
        const sources = await Promise.all(registryPaths.map(async (registryPath) => {
          const output = await readEnvironment('reg.exe', ['query', registryPath]);
          const values = {};
          commandOutputText(output).split(/\r?\n/).forEach((line) => {
            const match = /^\s*(.*?)\s+REG_(?:SZ|EXPAND_SZ)\s+(.*)$/i.exec(line);
            if (match && match[1].trim()) values[match[1].trim()] = match[2].trim();
          });
          return values;
        }));
        environment = { ...baseEnvironment };
        sources.forEach((source) => Object.entries(source).forEach(([name, value]) => {
          if (name.toLocaleLowerCase() !== 'path') {
            setEnvironmentValue(environment, name, expandWindowsEnvironmentVariables(value, environment));
          }
        }));
        const mergedPath = mergePathEntries([
          expandWindowsEnvironmentVariables(environmentValue(sources[1], 'Path'), environment),
          environmentValue(baseEnvironment, 'Path'),
          expandWindowsEnvironmentVariables(environmentValue(sources[0], 'Path'), environment),
        ], ';', true);
        if (mergedPath) setEnvironmentValue(environment, 'PATH', mergedPath);
      } else {
        const configuredShell = String(process.env.SHELL || '').trim();
        const fallbackShell = process.platform === 'darwin' ? '/bin/zsh' : '/bin/sh';
        const shellPath = configuredShell.startsWith('/') ? configuredShell : fallbackShell;
        const output = await readEnvironment(shellPath, [
          path.basename(shellPath) === 'sh' ? '-lc' : '-ilc',
          `printf '\\000${gitEnvironmentMarker}\\000'; env -0`,
        ]);
        const shellEnvironment = output ? parseNullDelimitedEnvironment(output) : {};
        environment = { ...baseEnvironment, ...shellEnvironment };
        const mergedPath = mergePathEntries([shellEnvironment.PATH, environmentValue(baseEnvironment, 'PATH')], ':');
        if (mergedPath) setEnvironmentValue(environment, 'PATH', mergedPath);
      }
      if (!gitExecutionEnvironment) gitExecutionEnvironment = environment;
      return gitExecutionEnvironment;
    })();
  }
  return gitIntegrationEnvironmentPromise;
}

async function runGitIntegrationCommand(repositoryPath, args, options = {}) {
  const gitEnvironment = await resolveGitIntegrationEnvironment();
  return new Promise((resolve) => {
    const environment = {
      ...gitEnvironment,
      GIT_EDITOR: ':',
      GIT_SEQUENCE_EDITOR: ':',
      GIT_TERMINAL_PROMPT: '0',
      GCM_INTERACTIVE: 'Never',
    };
    if (options.readOnly) setEnvironmentValue(environment, 'GIT_OPTIONAL_LOCKS', '0');
    if (options.replay) setEnvironmentValue(environment, 'GIT_REPLAY_UPDATE_REFS', '0');
    const child = execFile(
      'git',
      ['-C', expandPath(repositoryPath), ...args],
      {
        encoding: 'utf8',
        env: environment,
        timeout: 120000,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout, stderr) => resolve({
        status: error ? (!error.killed && !error.signal && typeof error.code === 'number' ? error.code : -1) : 0,
        stdout: String(stdout || ''),
        stderr: String(stderr || error?.message || ''),
      }),
    );
    child.stdin?.end();
  });
}

function readGitRebasePresence(repositoryPath) {
  for (const name of ['rebase-merge', 'rebase-apply']) {
    const result = runGitResult(repositoryPath, ['rev-parse', '--git-path', name]);
    if (result.status !== 0 || !result.stdout.trim()) {
      return { ok: false, message: firstGitError(result, '无法检查变基状态。') };
    }
    const statePath = path.resolve(repositoryPath, result.stdout.trim());
    if (fs.existsSync(name === 'rebase-apply' ? path.join(statePath, 'rebasing') : statePath)) {
      return { ok: true, inProgress: true };
    }
  }
  return { ok: true, inProgress: false };
}

async function readGitIntegrationHead(repositoryPath) {
  const [headRef, headCommit] = await Promise.all([
    runGitIntegrationCommand(repositoryPath, ['symbolic-ref', '-q', 'HEAD']),
    runGitIntegrationCommand(repositoryPath, ['rev-parse', '--verify', 'HEAD^{commit}']),
  ]);
  const ref = headRef.stdout.trim();
  if (headRef.status !== 0 || !ref) {
    return { ok: false, message: '当前 HEAD 处于 detached 状态，请使用外部 Git 工具处理。' };
  }
  const localBranchPrefix = 'refs/heads/';
  if (!ref.startsWith(localBranchPrefix) || ref.length === localBranchPrefix.length) {
    return { ok: false, message: '当前 HEAD 未指向本地分支，请使用外部 Git 工具处理。' };
  }
  const commitHash = headCommit.stdout.trim();
  if (headCommit.status !== 0 || !commitHash) {
    return { ok: false, message: '当前分支没有可操作的提交。' };
  }
  return { ok: true, branch: ref.slice(localBranchPrefix.length), commitHash };
}

async function readGitIntegrationOperationState(repositoryPath) {
  const refs = ['CHERRY_PICK_HEAD', 'REVERT_HEAD', 'MERGE_HEAD', 'REBASE_HEAD'];
  const names = [...refs, 'rebase-apply', 'rebase-merge', 'sequencer', 'BISECT_LOG', 'index.lock'];
  const [result, ...resolvedRefs] = await Promise.all([
    runGitIntegrationCommand(repositoryPath, ['rev-parse', ...names.flatMap((name) => ['--git-path', name])]),
    ...refs.map((ref) => runGitIntegrationCommand(repositoryPath, ['rev-parse', '--verify', '--quiet', ref])),
  ]);
  if (resolvedRefs.some((ref) => ref.status === 0)) {
    return { ok: false, message: '检测到其他未完成的 Git 操作，请先使用专业 Git 工具处理。' };
  }
  const refFailure = resolvedRefs.find((ref) => ref.status !== 1);
  if (refFailure) return { ok: false, message: firstGitError(refFailure, '无法检查 Git 操作状态。') };
  const paths = result.stdout.trimEnd().split(/\r?\n/);
  if (result.status !== 0 || paths.length !== names.length || paths.some((statePath) => !statePath)) {
    return { ok: false, message: firstGitError(result, '无法检查 Git 操作状态。') };
  }
  try {
    const present = await Promise.all(paths.map(async (statePath) => {
      try {
        await fs.promises.access(path.resolve(repositoryPath, statePath));
        return true;
      } catch (error) {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
        throw error;
      }
    }));
    if (present.some(Boolean)) {
      return { ok: false, message: '检测到其他未完成的 Git 操作，请先使用专业 Git 工具处理。' };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, message: `无法检查 Git 操作状态：${error.message}` };
  }
}

async function resolveGitIntegrationTarget(repositoryPath, targetRef) {
  const isHash = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(targetRef);
  const isBranchRef = /^(?:refs\/heads\/|refs\/remotes\/)/.test(targetRef);
  if (!isHash && (!isBranchRef || (await runGitIntegrationCommand(repositoryPath, ['check-ref-format', targetRef])).status !== 0)) {
    return { ok: false, message: '请选择完整提交 hash 或明确的本地、远程分支引用。' };
  }
  const [resolved, stashes] = await Promise.all([
    runGitIntegrationCommand(repositoryPath, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${targetRef}^{commit}`]),
    runGitIntegrationCommand(repositoryPath, ['stash', 'list', '--format=%H']),
  ]);
  const targetHash = resolved.stdout.trim().toLowerCase();
  if (resolved.status !== 0 || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(targetHash) ||
      (isHash && targetHash !== targetRef.toLowerCase())) {
    return { ok: false, message: '目标引用不存在或不是有效的提交。' };
  }
  if (stashes.status !== 0) return { ok: false, message: firstGitError(stashes, '无法检查 stash 提交。') };
  if (stashes.stdout.split(/\r?\n/).some((hash) => hash.trim().toLowerCase() === targetHash)) {
    return { ok: false, message: 'stash 提交不能作为合并或变基目标。' };
  }
  return { ok: true, targetHash };
}

async function prepareGitIntegration(projectPath, kind, targetRef, targetLabel) {
  const root = await runGitIntegrationCommand(projectPath, ['rev-parse', '--show-toplevel'], { readOnly: true });
  const repositoryPath = root.status === 0 && root.stdout.trim();
  if (!repositoryPath) return { ok: false, message: '未检测到 Git 仓库。' };
  if ((kind !== 'merge' && kind !== 'rebase') || typeof targetRef !== 'string' ||
      typeof targetLabel !== 'string' || !targetLabel.trim()) {
    return { ok: false, message: '合并或变基参数无效。' };
  }
  const ref = targetRef.trim();
  const head = await readGitIntegrationHead(repositoryPath);
  if (!head.ok) return head;
  const [operation, status, target] = await Promise.all([
    readGitIntegrationOperationState(repositoryPath),
    runGitIntegrationCommand(repositoryPath, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none'], { readOnly: true }),
    resolveGitIntegrationTarget(repositoryPath, ref),
  ]);
  if (!operation.ok) return operation;
  if (status.status !== 0) return { ok: false, message: firstGitError(status, '无法检查工作区状态。') };
  if (status.stdout) return { ok: false, blockReason: 'dirty-worktree', message: '工作区存在未提交或未跟踪的变更。' };
  if (!target.ok) return target;
  let hasMergeCommits = false;
  if (kind === 'rebase') {
    const merges = await runGitIntegrationCommand(repositoryPath, ['rev-list', '--merges', '--max-count=1', `${target.targetHash}..${head.commitHash}`]);
    if (merges.status !== 0) return { ok: false, message: firstGitError(merges, '无法检查分支中的合并提交。') };
    hasMergeCommits = Boolean(merges.stdout.trim());
  }
  return {
    ok: true,
    message: '已检查合并或变基目标。',
    plan: {
      kind,
      branch: head.branch,
      headHash: head.commitHash,
      targetHash: target.targetHash,
      targetRef: ref,
      targetLabel: targetLabel.trim(),
      hasMergeCommits,
    },
  };
}

async function predictGitIntegrationConflicts(projectPath, plan) {
  const unknown = (message) => ({ state: 'unknown', message });
  if (typeof projectPath !== 'string' || !projectPath.trim() || !plan || typeof plan !== 'object' ||
      (plan.kind !== 'merge' && plan.kind !== 'rebase') || typeof plan.branch !== 'string' || !plan.branch ||
      typeof plan.headHash !== 'string' || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(plan.headHash) ||
      typeof plan.targetHash !== 'string' || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(plan.targetHash) ||
      typeof plan.targetRef !== 'string' || plan.targetRef !== plan.targetRef.trim() ||
      typeof plan.targetLabel !== 'string' || !plan.targetLabel || plan.targetLabel !== plan.targetLabel.trim() ||
      typeof plan.hasMergeCommits !== 'boolean' || (plan.kind === 'merge' && plan.hasMergeCommits)) {
    return unknown('合并或变基计划无效，请重新检查。');
  }
  const root = await runGitIntegrationCommand(projectPath, ['rev-parse', '--show-toplevel'], { readOnly: true });
  const repositoryPath = root.status === 0 && root.stdout.trim();
  if (!repositoryPath) return unknown('未检测到 Git 仓库。');
  const [head, target, version] = await Promise.all([
    readGitIntegrationHead(repositoryPath),
    resolveGitIntegrationTarget(repositoryPath, plan.targetRef),
    runGitIntegrationCommand(repositoryPath, ['--version'], { readOnly: true }),
  ]);
  if (!head.ok || !target.ok || head.branch !== plan.branch || head.commitHash !== plan.headHash ||
      target.targetHash !== plan.targetHash) {
    return unknown('分支或目标提交已变化，请重新检查并确认。');
  }
  const match = version.status === 0 && /^git version (\d+)\.(\d+)(?:\.|\s|$)/i.exec(version.stdout.trim());
  if (!match) return unknown('无法确定 Git 版本，无法预测冲突。');
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const requiredMinor = plan.kind === 'merge' ? 38 : 44;
  if (major < 2 || (major === 2 && minor < requiredMinor)) {
    return { state: 'unsupported', message: `预测${plan.kind === 'merge' ? '合并' : '变基'}冲突需要 Git 2.${requiredMinor} 或更新版本。` };
  }

  let args;
  let options = { readOnly: true };
  if (plan.kind === 'merge') {
    args = ['merge-tree', '--write-tree', plan.headHash, plan.targetHash];
  } else {
    const [base, help] = await Promise.all([
      runGitIntegrationCommand(repositoryPath, ['merge-base', plan.headHash, plan.targetHash], { readOnly: true }),
      runGitIntegrationCommand(repositoryPath, ['replay', '-h'], { readOnly: true }),
    ]);
    if (base.status !== 0) return unknown('无法检查变基的共同祖先。');
    const mergeBase = base.stdout.trim();
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(mergeBase)) return unknown('无法确定变基的共同祖先。');
    const merges = await runGitIntegrationCommand(repositoryPath, ['rev-list', '--merges', '--max-count=1', `${mergeBase}..${plan.headHash}`], { readOnly: true });
    if (merges.status !== 0) return unknown('无法检查变基范围中的合并提交。');
    if (Boolean(merges.stdout.trim()) !== plan.hasMergeCommits) return unknown('变基计划已变化，请重新检查并确认。');
    if (mergeBase === plan.headHash) return { state: 'clean', message: '预计变基不会产生冲突。' };
    const helpText = `${help.stdout}\n${help.stderr}`;
    if (![0, 129].includes(help.status) || !helpText.includes('--onto')) return unknown('无法确认 Git replay 的引用更新行为。');
    args = ['-c', 'replay.refAction=print', 'replay', ...(helpText.includes('--ref-action') ? ['--ref-action=print'] : []),
      ...(helpText.includes('--linearize') ? ['--linearize'] : []),
      '--onto', plan.targetHash, `${mergeBase}..${plan.headHash}`];
    options = { readOnly: true, replay: true };
  }
  const result = await runGitIntegrationCommand(repositoryPath, args, options);
  if (result.status === 0) return { state: 'clean', message: `预计${plan.kind === 'merge' ? '合并' : '变基'}不会产生冲突。` };
  if (result.status === 1) return { state: 'conflicts', message: `检测到${plan.kind === 'merge' ? '合并' : '变基'}冲突。` };
  return unknown(firstGitError(result, '无法预测 Git 冲突。'));
}

async function gitIntegrationResult(repositoryPath, result, successMessage, failureMessage) {
  const rebase = await readGitRebaseStateResult(repositoryPath);
  if (result.status === 0) {
    if (!rebase.ok) return { ok: false, message: rebase.failure.message };
    return rebase.value
      ? { ok: true, message: '变基仍在进行中。', rebaseInProgress: rebase.value }
      : { ok: true, message: successMessage };
  }
  const conflicts = await runGitAsyncResult(repositoryPath, ['diff', '--name-only', '--diff-filter=U', '-z']);
  const conflictedFiles = conflicts.ok ? conflicts.stdout.split('\0').filter(Boolean) : [];
  const mergeInProgress = await readGitMergeInProgressAsync(repositoryPath);
  const mergeCommitMessage = mergeInProgress ? await readGitMergeMessageAsync(repositoryPath) : null;
  return {
    ok: false,
    message: firstGitError(result, failureMessage),
    ...(conflictedFiles.length ? { conflicted: true, conflictedFiles } : {}),
    ...(mergeInProgress ? { mergeInProgress: true } : {}),
    ...(mergeCommitMessage ? { mergeCommitMessage } : {}),
    ...(rebase.ok && rebase.value ? { rebaseInProgress: rebase.value } : {}),
  };
}

function markGitOrdinaryRebase(repositoryPath) {
  const result = runGitResult(repositoryPath, ['rev-parse', '--git-path', 'rebase-merge']);
  if (result.status !== 0 || !result.stdout.trim()) {
    return { ok: false, message: firstGitError(result, '无法记录变基状态。') };
  }
  const statePath = path.resolve(repositoryPath, result.stdout.trim());
  if (!fs.existsSync(statePath)) return { ok: true };
  try {
    fs.writeFileSync(path.join(statePath, gitOrdinaryRebaseMarker), '');
    return { ok: true };
  } catch (error) {
    return { ok: false, message: `无法记录变基状态：${error.message}` };
  }
}

async function integrateGitCommit(projectPath, plan) {
  if (!plan || typeof plan !== 'object') return { ok: false, message: '合并或变基计划无效。' };
  const preview = await prepareGitIntegration(projectPath, plan.kind, plan.targetRef, plan.targetLabel);
  if (!preview.ok || !preview.plan) return preview;
  const fresh = preview.plan;
  if (fresh.branch !== plan.branch || fresh.headHash !== plan.headHash || fresh.targetHash !== plan.targetHash ||
      fresh.targetRef !== plan.targetRef || fresh.hasMergeCommits !== plan.hasMergeCommits) {
    return { ok: false, message: '分支或目标提交已变化，请重新检查并确认。' };
  }
  const repositoryPath = findGitRoot(projectPath);
  if (!repositoryPath) return { ok: false, message: '未检测到 Git 仓库。' };
  const args = fresh.kind === 'merge'
    ? ['merge', '--ff', '--commit', '--no-squash', '--no-edit', '--no-autostash', '--', fresh.targetHash]
    : ['rebase', '--merge', '--keep-empty', '--no-rebase-merges', '--no-autosquash', '--no-update-refs', '--no-autostash', '--no-fork-point', '--verify', fresh.targetHash];
  const result = await runGitIntegrationCommand(repositoryPath, args);
  const marker = fresh.kind === 'rebase' ? markGitOrdinaryRebase(repositoryPath) : { ok: true };
  const outcome = await gitIntegrationResult(repositoryPath, result, `${fresh.kind === 'merge' ? '合并' : '变基'}完成。`, 'Git 操作失败。');
  return marker.ok ? outcome : { ...outcome, ok: false, message: `${outcome.message} ${marker.message}` };
}

async function runGitRebaseControl(projectPath, action) {
  const repositoryPath = await findGitRootAsync(projectPath);
  if (!repositoryPath) return { ok: false, message: '未检测到 Git 仓库。' };
  const rebase = await readGitRebaseStateResult(repositoryPath);
  if (!rebase.ok) return { ok: false, message: rebase.failure.message };
  if (!rebase.value) return { ok: false, message: '当前没有进行中的变基。' };
  if (rebase.value.interactive && action !== 'abort') {
    return { ok: false, message: '此变基请使用外部 Git 工具继续或跳过。' };
  }
  if (action === 'continue' && !rebase.value.canContinue) {
    return { ok: false, message: '请先解决并暂存所有冲突。' };
  }
  const result = await runGitIntegrationCommand(repositoryPath, ['rebase', `--${action}`]);
  return gitIntegrationResult(repositoryPath, result, `变基${action === 'continue' ? '继续' : action === 'skip' ? '跳过' : '中止'}完成。`, '变基操作失败。');
}

function continueGitRebase(projectPath) { return runGitRebaseControl(projectPath, 'continue'); }
function skipGitRebase(projectPath) { return runGitRebaseControl(projectPath, 'skip'); }
function abortGitRebase(projectPath) { return runGitRebaseControl(projectPath, 'abort'); }