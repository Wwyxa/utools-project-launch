import { PROJECT_MAX_RELATED_PROJECTS } from "../types";
import type { Project, ProjectRelation } from "../types";

export const normalizeProjectRelations = (value: unknown): ProjectRelation[] => {
  const relations = Array.isArray(value) ? value : [];
  const seenProjectIds = new Set<string>();

  return relations.reduce<ProjectRelation[]>((normalizedRelations, relation) => {
    if (!relation || typeof relation !== "object") {
      return normalizedRelations;
    }

    const candidate = relation as Partial<ProjectRelation>;
    const projectId = typeof candidate.projectId === "string" ? candidate.projectId.trim() : "";
    if (!projectId || seenProjectIds.has(projectId) || normalizedRelations.length >= PROJECT_MAX_RELATED_PROJECTS) {
      return normalizedRelations;
    }

    seenProjectIds.add(projectId);
    normalizedRelations.push({ projectId, bidirectional: candidate.bidirectional === true });
    return normalizedRelations;
  }, []);
};

export const resolveProjectRelatedProjectIds = (projectId: string, projects: readonly Project[]): string[] => {
  const project = projects.find((candidate) => candidate.id === projectId);
  if (!project) {
    return [];
  }

  const relatedProjectIds: string[] = [];
  const seenProjectIds = new Set<string>();
  const knownProjectIds = new Set(projects.map((candidate) => candidate.id));
  const addProjectId = (candidateId: string) => {
    if (
      candidateId &&
      candidateId !== projectId &&
      knownProjectIds.has(candidateId) &&
      !seenProjectIds.has(candidateId)
    ) {
      seenProjectIds.add(candidateId);
      relatedProjectIds.push(candidateId);
    }
  };

  normalizeProjectRelations(project.relatedProjects).forEach((relation) => addProjectId(relation.projectId));
  projects.forEach((sourceProject) => {
    if (
      sourceProject.id !== projectId &&
      normalizeProjectRelations(sourceProject.relatedProjects).some(
        (relation) => relation.projectId === projectId && relation.bidirectional,
      )
    ) {
      addProjectId(sourceProject.id);
    }
  });

  return relatedProjectIds;
};
