import type { AppStore } from "../appStoreShape";
import { createBlankProjectForm, formFromProject, inferProjectIcon, scriptDiscoveryKey, createEnvId } from "../helpers/projectHelpers";
import type { ProjectFormValue, ProjectScriptDiscoverySource, ProjectBridgeScriptCandidate, ProjectScriptFormValue, ProjectEnvironmentEntry } from "../../types";
import { bridge } from "../helpers/bridge";

export const projectFormActions = {
  openCreateProjectForm(this: AppStore) {
    this.projectFormMode = "create";
    this.projectFormDraft = createBlankProjectForm();
    this.projectFormInspectionMessage = "";
    this.projectFormCwdSuggestions = ["."];
    this.projectFormOpen = true;
  },

  openEditProjectForm(this: AppStore, projectId: string) {
    const project = this.projects.find((item) => item.id === projectId);
    if (!project) {
      return;
    }

    this.projectFormMode = "edit";
    this.projectFormDraft = formFromProject(project);
    this.projectFormInspectionMessage =
      project.pathExists === false ? project.unavailableReason || "当前路径不可用" : "";
    void this.refreshProjectFormCwdSuggestions(project.path);
    this.projectFormOpen = true;
  },

  openDuplicateProjectForm(this: AppStore, projectId: string) {
    const project = this.projects.find((item) => item.id === projectId);
    if (!project) {
      return;
    }

    const sourceForm = formFromProject(project);
    this.projectFormMode = "duplicate";
    this.projectFormDraft = {
      ...sourceForm,
      id: null,
      name: `${sourceForm.name} - Copy`,
      // Empty ids make saveProjectForm generate script ids scoped to the new project.
      scripts: sourceForm.scripts.map((script) => ({ ...script, id: "" })),
    };
    this.projectFormInspectionMessage = "已复制项目配置，请修改名称或路径后保存。";
    void this.refreshProjectFormCwdSuggestions(project.path);
    this.projectFormOpen = true;
  },

  closeProjectForm(this: AppStore) {
    this.projectFormOpen = false;
    this.projectFormDraft = createBlankProjectForm();
    this.projectFormInspectionMessage = "";
    this.projectFormCwdSuggestions = ["."];
  },

  updateProjectForm(this: AppStore, patch: Partial<ProjectFormValue>) {
    this.projectFormDraft = {
      ...this.projectFormDraft,
      ...patch,
    };
  },

  async inspectCurrentProjectPath(this: AppStore) {
    const projectPath = this.projectFormDraft.path.trim();
    if (!projectPath) {
      this.projectFormInspectionMessage = "";
      return;
    }

    this.projectFormInspecting = true;
    const currentName = this.projectFormDraft.name.trim();
    try {
      const result = await bridge.inspectProjectPath(projectPath);
      this.projectFormDraft = {
        ...this.projectFormDraft,
        name: currentName || result.name || this.projectFormDraft.name,
        kind: result.kind || this.projectFormDraft.kind,
        type: result.type || this.projectFormDraft.type,
        icon:
          this.projectFormDraft.icon ||
          inferProjectIcon(
            result.kind || this.projectFormDraft.kind,
            result.type || this.projectFormDraft.type,
            result.name || currentName,
          ),
      };
      await this.refreshProjectFormCwdSuggestions(projectPath);
      this.projectFormInspectionMessage =
        result.message || (result.pathExists ? "已识别路径信息" : "当前路径不可用，可保存后重新定位");
    } finally {
      this.projectFormInspecting = false;
    }
  },

  async discoverProjectFormScripts(this: AppStore, sources: ProjectScriptDiscoverySource[]): Promise<ProjectBridgeScriptCandidate[]> {
    const projectPath = this.projectFormDraft.path.trim();
    if (!projectPath) {
      this.projectFormInspectionMessage = "请先填写项目路径";
      return [];
    }

    this.projectFormInspecting = true;
    try {
      const result = await bridge.discoverProjectScripts(projectPath, { sources });
      this.projectFormInspectionMessage = result.message || `发现 ${result.scripts.length} 条可导入命令`;
      return result.scripts;
    } finally {
      this.projectFormInspecting = false;
    }
  },

  importProjectFormScripts(this: AppStore, candidates: ProjectBridgeScriptCandidate[]) {
    const existing = new Set(this.projectFormDraft.scripts.map(scriptDiscoveryKey));
    const additions = candidates.reduce<ProjectScriptFormValue[]>((scripts, candidate, index) => {
      const script: ProjectScriptFormValue = {
        id: `script-${Date.now()}-${index}`,
        name: candidate.name,
        command: candidate.command,
        cwd: candidate.cwd || ".",
        note: candidate.note || "",
        source: candidate.source,
      };
      const key = scriptDiscoveryKey(script);
      if (!script.command || existing.has(key)) return scripts;
      existing.add(key);
      scripts.push(script);
      return scripts;
    }, []);
    if (additions.length > 0) {
      this.projectFormDraft.scripts = [...this.projectFormDraft.scripts, ...additions];
    }
    this.projectFormInspectionMessage =
      additions.length > 0 ? `已导入 ${additions.length} 条命令` : "所选命令已在列表中";
    return additions.length;
  },

  async refreshProjectFormCwdSuggestions(this: AppStore, projectPath?: string) {
    const normalizedPath = (projectPath ?? this.projectFormDraft.path).trim();
    if (!normalizedPath) {
      this.projectFormCwdSuggestions = ["."];
      return;
    }

    try {
      const suggestions = await bridge.listProjectSubdirectories(normalizedPath);
      this.projectFormCwdSuggestions = Array.from(new Set([".", ...suggestions.filter(Boolean)]));
    } catch (error) {
      this.projectFormCwdSuggestions = ["."];
    }
  },

  async pickProjectPath(this: AppStore) {
    const result = await bridge.pickProjectPath();
    if (result.path) {
      this.updateProjectForm({ path: result.path });
      await this.inspectCurrentProjectPath();
      return;
    }

    if (result.message) {
      this.projectFormInspectionMessage = result.message;
    }
  },

  async pickQuickLinkPath(this: AppStore) {
    const result = await bridge.pickQuickLinkPath();
    if (result.path) {
      this.updateProjectForm({ quickLink: result.path });
      return;
    }

    if (result.message) {
      this.projectFormInspectionMessage = result.message;
    }
  },

  addEnvironmentEntry(this: AppStore) {
    this.projectFormDraft.envEntries.push({
      id: createEnvId(),
      key: "",
      value: "",
    });
  },

  updateEnvironmentEntry(this: AppStore, entryId: string, patch: Partial<ProjectEnvironmentEntry>) {
    const entry = this.projectFormDraft.envEntries.find((item) => item.id === entryId);
    if (entry) {
      Object.assign(entry, patch);
    }
  },

  removeEnvironmentEntry(this: AppStore, entryId: string) {
    this.projectFormDraft.envEntries = this.projectFormDraft.envEntries.filter((item) => item.id !== entryId);
  },

  addScriptEntry(this: AppStore) {
    this.projectFormDraft.scripts.push({
      id: `script-${Date.now()}`,
      name: "start",
      command: "",
      cwd: ".",
      note: "",
      source: "manual",
    });
  },

  updateScriptEntry(this: AppStore, scriptId: string, patch: Partial<ProjectScriptFormValue>) {
    const script = this.projectFormDraft.scripts.find((item) => item.id === scriptId);
    if (script) {
      Object.assign(script, patch);
    }
  },

  removeScriptEntry(this: AppStore, scriptId: string) {
    this.projectFormDraft.scripts = this.projectFormDraft.scripts.filter((item) => item.id !== scriptId);
  },

  moveScriptEntry(this: AppStore, scriptId: string, direction: "up" | "down") {
    const currentIndex = this.projectFormDraft.scripts.findIndex((item) => item.id === scriptId);
    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= this.projectFormDraft.scripts.length) {
      return;
    }

    const scripts = [...this.projectFormDraft.scripts];
    const [script] = scripts.splice(currentIndex, 1);
    scripts.splice(targetIndex, 0, script);
    this.projectFormDraft.scripts = scripts;
  },

  reorderScriptEntry(this: AppStore, scriptId: string, targetScriptId: string) {
    if (scriptId === targetScriptId) {
      return;
    }

    const scripts = [...this.projectFormDraft.scripts];
    const currentIndex = scripts.findIndex((item) => item.id === scriptId);
    const targetIndex = scripts.findIndex((item) => item.id === targetScriptId);
    if (currentIndex < 0 || targetIndex < 0) {
      return;
    }

    const [script] = scripts.splice(currentIndex, 1);
    scripts.splice(targetIndex, 0, script);
    this.projectFormDraft.scripts = scripts;
  },

  reorderProjectScripts(this: AppStore, projectId: string, scriptId: string, targetScriptId: string) {
    if (scriptId === targetScriptId) {
      return false;
    }

    const project = this.projects.find((item) => item.id === projectId);
    if (!project) {
      return false;
    }

    const sourceIndex = project.scripts.findIndex((script) => script.id === scriptId);
    const targetIndex = project.scripts.findIndex((script) => script.id === targetScriptId);
    if (sourceIndex < 0 || targetIndex < 0) {
      return false;
    }

    const scripts = [...project.scripts];
    const [script] = scripts.splice(sourceIndex, 1);
    scripts.splice(targetIndex, 0, script);
    project.scripts = scripts;
    project.lastUpdated = new Date().toLocaleString();
    void this.persistProjects();
    return true;
  }
};
