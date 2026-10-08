import type { AppStore } from "../appStoreShape";
import type { ProjectFileListResult, ProjectFileSearchResult, ProjectFileMutationKind, ProjectFileMutationResult, ProjectFileReadResult, ProjectFileWriteResult } from "../../types";
import { bridge } from "../helpers/bridge";

export const projectFilesActions = {
  async listProjectFiles(this: AppStore, projectId: string, relativePath = ""): Promise<ProjectFileListResult | null> {
    const project = this.projects.find((item) => item.id === projectId);
    if (!project || project.pathExists === false) {
      return null;
    }

    return bridge.listProjectFiles(project.path, relativePath);
  },

  async searchProjectFiles(this: AppStore,
    projectId: string,
    query: string,
    options?: { limit?: number },
  ): Promise<ProjectFileSearchResult | null> {
    const project = this.projects.find((item) => item.id === projectId);
    if (!project || project.pathExists === false) return null;
    return bridge.searchProjectFiles(project.path, query, options);
  },

  async createProjectEntry(this: AppStore,
    projectId: string,
    parentRelativePath: string,
    name: string,
    kind: ProjectFileMutationKind,
  ): Promise<ProjectFileMutationResult | null> {
    const project = this.projects.find((item) => item.id === projectId);
    if (!project || project.pathExists === false) return null;
    return bridge.createProjectEntry(project.path, parentRelativePath, name, kind);
  },

  async renameProjectEntry(this: AppStore,
    projectId: string,
    relativePath: string,
    name: string,
  ): Promise<ProjectFileMutationResult | null> {
    const project = this.projects.find((item) => item.id === projectId);
    if (!project || project.pathExists === false) return null;
    return bridge.renameProjectEntry(project.path, relativePath, name);
  },

  async deleteProjectEntry(this: AppStore, projectId: string, relativePath: string): Promise<ProjectFileMutationResult | null> {
    const project = this.projects.find((item) => item.id === projectId);
    if (!project || project.pathExists === false) return null;
    return bridge.deleteProjectEntry(project.path, relativePath);
  },

  async showProjectEntryInFolder(this: AppStore, projectId: string, relativePath: string): Promise<void> {
    const project = this.projects.find((item) => item.id === projectId);
    if (!project || project.pathExists === false) return;
    await bridge.showProjectEntryInFolder(project.path, relativePath);
  },

  async readProjectFile(this: AppStore, projectId: string, relativePath: string): Promise<ProjectFileReadResult | null> {
    const project = this.projects.find((item) => item.id === projectId);
    if (!project || project.pathExists === false) {
      return null;
    }

    return bridge.readProjectFile(project.path, relativePath);
  },

  async writeProjectFile(this: AppStore,
    projectId: string,
    relativePath: string,
    content: string,
  ): Promise<ProjectFileWriteResult | null> {
    const project = this.projects.find((item) => item.id === projectId);
    if (!project || project.pathExists === false) {
      return null;
    }

    return bridge.writeProjectFile(project.path, relativePath, content);
  }
};
