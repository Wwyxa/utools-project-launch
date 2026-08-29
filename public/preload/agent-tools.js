function agentToolRequiredString(params, key, label) {
  const value = typeof params?.[key] === "string" ? params[key].trim() : "";
  if (!value) {
    throw new Error(`${label}不能为空。`);
  }
  return value;
}

function agentToolOptionalString(params, key) {
  return typeof params?.[key] === "string" ? params[key].trim() : "";
}

function agentToolHasParam(params, key) {
  return Boolean(params && Object.prototype.hasOwnProperty.call(params, key));
}

function agentToolOptionalPatchString(params, key, label) {
  if (!agentToolHasParam(params, key)) {
    return undefined;
  }
  if (typeof params[key] !== "string") {
    throw new Error(`${label}必须是字符串。`);
  }
  return params[key].trim();
}

function agentToolOptionalStringArray(params, key, label) {
  if (!agentToolHasParam(params, key)) {
    return undefined;
  }
  if (!Array.isArray(params[key])) {
    throw new Error(`${label}必须是字符串数组。`);
  }

  return [
    ...new Set(
      params[key].map((value) => {
        if (typeof value !== "string" || !value.trim()) {
          throw new Error(`${label}中的每一项都必须是非空字符串。`);
        }
        return value.trim();
      }),
    ),
  ];
}

function agentProjectEnvironmentPatch(params) {
  const hasEnv = agentToolHasParam(params, "env");
  const removeEnvKeys = agentToolOptionalStringArray(params, "removeEnvKeys", "要删除的环境变量名");
  if (!hasEnv && removeEnvKeys === undefined) {
    return undefined;
  }

  if (hasEnv && (!params.env || typeof params.env !== "object")) {
    throw new Error("环境变量必须是 key 和 value 均为字符串的数组。");
  }

  const entries = Array.isArray(params.env)
    ? params.env.map((entry) => {
        if (
          !entry ||
          Array.isArray(entry) ||
          typeof entry !== "object" ||
          typeof entry.key !== "string" ||
          typeof entry.value !== "string"
        ) {
          throw new Error("每个环境变量都必须包含字符串类型的 key 和 value。");
        }
        return [entry.key, entry.value];
      })
    : Object.entries(hasEnv ? params.env : {});
  const env = Object.fromEntries(
    entries.map(([key, value]) => {
      const normalizedKey = key.trim();
      if (!normalizedKey || typeof value !== "string") {
        throw new Error("环境变量名不能为空，且环境变量值必须是字符串。");
      }
      return [normalizedKey, value];
    }),
  );
  if (Object.keys(env).length !== entries.length) {
    throw new Error("环境变量名不能重复。");
  }
  const removedKeySet = new Set(removeEnvKeys || []);
  if (Object.keys(env).some((key) => removedKeySet.has(key))) {
    throw new Error("同一个环境变量不能同时更新和删除。");
  }
  return { env, removeEnvKeys: removeEnvKeys || [] };
}

function agentProjectEnvironmentPatchHasChanges(environmentPatch) {
  return Boolean(
    environmentPatch && (Object.keys(environmentPatch.env).length || environmentPatch.removeEnvKeys.length),
  );
}

function applyAgentProjectEnvironmentPatch(project, environmentPatch) {
  if (!environmentPatch) {
    return project.env || {};
  }

  const env = { ...(project.env || {}) };
  environmentPatch.removeEnvKeys.forEach((key) => delete env[key]);
  return { ...env, ...environmentPatch.env };
}

const agentProjectTypeOptions = [
  { type: "Node.js", kind: "node", icon: "node" },
  { type: "Vue", kind: "node", icon: "vue" },
  { type: "React", kind: "node", icon: "react" },
  { type: "Python", kind: "python", icon: "python" },
  { type: "Go", kind: "go", icon: "go" },
  { type: "Rust", kind: "custom", icon: "rust" },
  { type: "Java", kind: "custom", icon: "java" },
  { type: "Docker", kind: "custom", icon: "docker" },
  { type: "Database", kind: "custom", icon: "database" },
  { type: "Web", kind: "custom", icon: "browser" },
  { type: "CLI", kind: "custom", icon: "terminal" },
  { type: "API", kind: "custom", icon: "backend" },
  { type: "Package", kind: "custom", icon: "package" },
  { type: "AI", kind: "custom", icon: "ai" },
  { type: "Executable", kind: "executable", icon: "executable" },
  { type: "Custom", kind: "custom", icon: "custom" },
];

function agentProjectTypeOption(params) {
  const type = agentToolRequiredString(params, "type", "项目类型");
  const option = agentProjectTypeOptions.find((candidate) => candidate.type === type);
  if (!option) {
    throw new Error(
      `项目类型必须是以下之一：${agentProjectTypeOptions.map((candidate) => candidate.type).join("、")}。`,
    );
  }
  return option;
}

function agentProjectGroups(projects) {
  const groups = new Set();
  projects.forEach((project) => {
    const group = typeof project?.group === "string" ? project.group.trim() : "";
    if (group) {
      groups.add(group);
    }
  });
  return [...groups];
}

function agentProjectVisibility(params, fallback) {
  if (!agentToolHasParam(params, "visibility")) {
    return fallback;
  }
  if (params.visibility !== "public" && params.visibility !== "private") {
    throw new Error("项目可见性必须是 public 或 private。");
  }
  return params.visibility;
}

function notifyAgentProjectCatalogChanged(projectId) {
  if (typeof window.dispatchEvent !== "function" || typeof CustomEvent !== "function") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent("project-bridge-event", {
      detail: {
        type: "projects-changed",
        projectId,
        source: "agent",
        timestamp: new Date().toISOString(),
      },
    }),
  );
}

function createAgentToolId(prefix) {
  const suffix =
    globalThis.crypto?.randomUUID?.() ||
    crypto.randomUUID?.() ||
    `${Date.now()}-${Math.random().toString(36).slice(2)}-${process.pid}`;
  return `${prefix}-${suffix}`;
}

function agentProjectScriptDetails(script) {
  return {
    id: script.id,
    name: script.name,
    command: script.command,
    cwd: script.cwd || ".",
    note: script.note || "",
    source: script.source || "manual",
    status: script.status || "IDLE",
  };
}

function agentProjectSummary(project) {
  return {
    id: project.id,
    name: project.name,
    path: project.path,
    type: project.type,
    group: project.group || "",
    visibility: project.visibility || "public",
    status: project.status || "STOPPED",
    scriptCount: Array.isArray(project.scripts) ? project.scripts.length : 0,
  };
}

function agentProjectDetails(project) {
  return {
    ...agentProjectSummary(project),
    kind: project.kind || "custom",
    description: project.description || "",
    quickLink: project.quickLink || "",
    createdAt: project.createdAt || "",
    updatedAt: project.updatedAt || "",
    environmentKeys: Object.keys(project.env || {}).sort(),
    scripts: Array.isArray(project.scripts) ? project.scripts.map(agentProjectScriptDetails) : [],
  };
}

function listAgentProjects() {
  const projects = readProjects();
  return {
    projects: projects.map(agentProjectSummary),
    count: projects.length,
    groups: agentProjectGroups(projects),
    projectTypes: agentProjectTypeOptions.map((option) => option.type),
  };
}

function getAgentProject(params) {
  const projectId = agentToolRequiredString(params, "projectId", "项目 ID");
  const project = readProjects().find((candidate) => candidate.id === projectId);
  if (!project) {
    throw new Error("未找到指定项目。");
  }
  return { project: agentProjectDetails(project) };
}

function createAgentProject(params) {
  const name = agentToolRequiredString(params, "name", "项目名称");
  const projectPath = agentToolRequiredString(params, "path", "项目路径");
  const projectType = agentProjectTypeOption(params);
  const environmentPatch = agentProjectEnvironmentPatch(params);
  if (environmentPatch?.removeEnvKeys.length) {
    throw new Error("创建项目时不能删除环境变量。");
  }
  const now = new Date().toISOString();
  const project = {
    id: createAgentToolId("project"),
    name,
    path: projectPath,
    visibility: agentProjectVisibility(params, "public"),
    type: projectType.type,
    kind: projectType.kind,
    icon: projectType.icon,
    cardStyle: "default",
    tinyCardButtonCount: 1,
    quickLink: agentToolOptionalString(params, "quickLink"),
    group: agentToolOptionalString(params, "group"),
    status: "STOPPED",
    description: agentToolOptionalString(params, "description"),
    scripts: [],
    automationTasks: [],
    env: environmentPatch?.env || {},
    memo: "",
    todos: [],
    sortOrder: Date.now(),
    createdAt: now,
    updatedAt: now,
  };

  writeStoredProject(project);
  const storedProject = readPersistedProject(project.id);
  if (!storedProject) {
    throw new Error("项目配置保存后无法重新读取，请重试。");
  }
  notifyAgentProjectCatalogChanged(storedProject.id);
  return {
    operation: "created",
    project: agentProjectDetails(storedProject),
    pathExists: pathExists(projectPath),
  };
}

function updateAgentProject(params) {
  const projectId = agentToolRequiredString(params, "projectId", "项目 ID");
  const updatedFields = [];
  const name = agentToolOptionalPatchString(params, "name", "项目名称");
  const projectPath = agentToolOptionalPatchString(params, "path", "项目路径");
  const description = agentToolOptionalPatchString(params, "description", "项目说明");
  const group = agentToolOptionalPatchString(params, "group", "项目分组");
  const quickLink = agentToolOptionalPatchString(params, "quickLink", "快捷链接");
  const projectType = agentToolHasParam(params, "type") ? agentProjectTypeOption(params) : null;
  const visibility = agentToolHasParam(params, "visibility") ? agentProjectVisibility(params, "public") : undefined;
  const environmentPatch = agentProjectEnvironmentPatch(params);

  if (name !== undefined) {
    if (!name) {
      throw new Error("项目名称不能为空。");
    }
    updatedFields.push("name");
  }
  if (projectPath !== undefined) {
    if (!projectPath) {
      throw new Error("项目路径不能为空。");
    }
    updatedFields.push("path");
  }
  if (projectType) {
    updatedFields.push("type");
  }
  if (description !== undefined) {
    updatedFields.push("description");
  }
  if (group !== undefined) {
    updatedFields.push("group");
  }
  if (quickLink !== undefined) {
    updatedFields.push("quickLink");
  }
  if (visibility !== undefined) {
    updatedFields.push("visibility");
  }
  if (agentProjectEnvironmentPatchHasChanges(environmentPatch)) {
    updatedFields.push("env");
  }
  if (updatedFields.length === 0) {
    throw new Error("请至少提供一个可编辑字段。");
  }

  const updatedProject = mutateStoredProject(projectId, (project) => {
    const nextProject = { ...project, updatedAt: new Date().toISOString() };
    if (name !== undefined) nextProject.name = name;
    if (projectPath !== undefined) nextProject.path = projectPath;
    if (projectType) {
      nextProject.type = projectType.type;
      nextProject.kind = projectType.kind;
      nextProject.icon = projectType.icon;
    }
    if (description !== undefined) nextProject.description = description;
    if (group !== undefined) nextProject.group = group;
    if (quickLink !== undefined) nextProject.quickLink = quickLink;
    if (visibility !== undefined) nextProject.visibility = visibility;
    if (agentProjectEnvironmentPatchHasChanges(environmentPatch)) {
      nextProject.env = applyAgentProjectEnvironmentPatch(project, environmentPatch);
    }
    return nextProject;
  });
  if (!updatedProject) {
    throw new Error("未找到指定项目。");
  }

  const storedProject = readPersistedProject(projectId);
  if (!storedProject) {
    throw new Error("项目配置保存后无法重新读取，请重试。");
  }
  notifyAgentProjectCatalogChanged(projectId);
  return {
    operation: "updated",
    project: agentProjectDetails(storedProject),
    updatedFields,
  };
}

function upsertAgentProject(params) {
  return agentToolHasParam(params, "projectId") ? updateAgentProject(params) : createAgentProject(params);
}

function createAgentProjectScript(params) {
  const projectId = agentToolRequiredString(params, "projectId", "项目 ID");
  const name = agentToolRequiredString(params, "name", "脚本名称");
  const command = agentToolRequiredString(params, "command", "脚本命令");
  const script = {
    id: createAgentToolId("script"),
    name,
    command,
    cwd: agentToolOptionalString(params, "cwd") || ".",
    note: agentToolOptionalString(params, "note"),
    source: "manual",
    status: "IDLE",
  };
  const updatedProject = mutateStoredProject(projectId, (project) => ({
    ...project,
    scripts: [...(Array.isArray(project.scripts) ? project.scripts : []), script],
    updatedAt: new Date().toISOString(),
  }));
  if (!updatedProject) {
    throw new Error("未找到指定项目。");
  }

  const storedProject = readPersistedProject(projectId);
  const storedScript = storedProject?.scripts?.find((candidate) => candidate.id === script.id);
  if (!storedScript) {
    throw new Error("脚本保存后无法重新读取，请重试。");
  }
  notifyAgentProjectCatalogChanged(projectId);
  return {
    operation: "created",
    projectId,
    script: agentProjectScriptDetails(storedScript),
  };
}

function updateAgentProjectScript(params) {
  const projectId = agentToolRequiredString(params, "projectId", "项目 ID");
  const scriptId = agentToolRequiredString(params, "scriptId", "脚本 ID");
  const updatedFields = [];
  const name = agentToolOptionalPatchString(params, "name", "脚本名称");
  const command = agentToolOptionalPatchString(params, "command", "脚本命令");
  const cwd = agentToolOptionalPatchString(params, "cwd", "脚本工作目录");
  const note = agentToolOptionalPatchString(params, "note", "脚本说明");

  if (name !== undefined) {
    if (!name) {
      throw new Error("脚本名称不能为空。");
    }
    updatedFields.push("name");
  }
  if (command !== undefined) {
    if (!command) {
      throw new Error("脚本命令不能为空。");
    }
    updatedFields.push("command");
  }
  if (cwd !== undefined) {
    updatedFields.push("cwd");
  }
  if (note !== undefined) {
    updatedFields.push("note");
  }
  if (updatedFields.length === 0) {
    throw new Error("请至少提供一个可编辑字段。");
  }

  const updatedProject = mutateStoredProject(projectId, (project) => {
    const scripts = Array.isArray(project.scripts) ? project.scripts : [];
    const scriptIndex = scripts.findIndex((script) => script.id === scriptId);
    if (scriptIndex < 0) {
      throw new Error("未找到指定脚本。");
    }

    const currentScript = scripts[scriptIndex];
    const nextScript = { ...currentScript };
    if (name !== undefined) nextScript.name = name;
    if (command !== undefined) nextScript.command = command;
    if (cwd !== undefined) nextScript.cwd = cwd || ".";
    if (note !== undefined) nextScript.note = note;
    const nextScripts = [...scripts];
    nextScripts[scriptIndex] = nextScript;
    return {
      ...project,
      scripts: nextScripts,
      updatedAt: new Date().toISOString(),
    };
  });
  if (!updatedProject) {
    throw new Error("未找到指定项目。");
  }

  const storedProject = readPersistedProject(projectId);
  const storedScript = storedProject?.scripts?.find((candidate) => candidate.id === scriptId);
  if (!storedScript) {
    throw new Error("脚本保存后无法重新读取，请重试。");
  }
  notifyAgentProjectCatalogChanged(projectId);
  return {
    operation: "updated",
    projectId,
    script: agentProjectScriptDetails(storedScript),
    updatedFields,
  };
}

function upsertAgentProjectScript(params) {
  return agentToolHasParam(params, "scriptId") ? updateAgentProjectScript(params) : createAgentProjectScript(params);
}

function registerAgentTools() {
  if (typeof window.utools?.registerTool !== "function") {
    return;
  }

  window.utools.registerTool("project_manager_list_projects", listAgentProjects);
  window.utools.registerTool("project_manager_get_project", getAgentProject);
  window.utools.registerTool("project_manager_upsert_project", upsertAgentProject);
  window.utools.registerTool("project_manager_upsert_script", upsertAgentProjectScript);
}

registerAgentTools();
