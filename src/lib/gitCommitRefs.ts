import type { ProjectGitCommitRef, ProjectGitCommitRefKind, ProjectGitCommitSummary, ProjectGitSnapshot } from "../types";

export type GitCommitRefPresentationKind = ProjectGitCommitRefKind | "unknown";
export type GitCommitRefDenseDisplay = "label" | "icon";

export type GitCommitRefPresentationContext = Partial<
  Pick<ProjectGitSnapshot, "branch" | "headHash" | "branches" | "remotes" | "upstream">
> & {
  graphColorByRefName?: Readonly<Record<string, number>>;
};

export interface GitCommitRefPresentationMember {
  kind: GitCommitRefPresentationKind;
  name: string;
  identity: string;
  label: string;
  title: string;
  priority: number;
  order: number;
  isCurrentHead: boolean;
  isHeadTarget: boolean;
  isCurrentUpstream: boolean;
  graphColorIndex?: number;
  groupKey: string;
}

export interface GitCommitRefDenseMember extends GitCommitRefPresentationMember {
  display: GitCommitRefDenseDisplay;
  memberNames: readonly string[];
  memberTitles: readonly string[];
}

export interface GitCommitRefDensePresentation {
  members: readonly GitCommitRefDenseMember[];
  hiddenMembers: readonly GitCommitRefPresentationMember[];
}

export interface GitCommitRefPresentation {
  full: readonly GitCommitRefPresentationMember[];
  dense: GitCommitRefDensePresentation;
}

type SourceRef = Pick<ProjectGitCommitRef, "name"> & Partial<Pick<ProjectGitCommitRef, "kind">>;
type Candidate = Omit<GitCommitRefPresentationMember, "order" | "isHeadTarget"> & { sourceIndex: number };

const isExactHeadReference = (name: string) => name === "HEAD" || /^HEAD ->\s+\S+$/.test(name);
const refLabel = (name: string) => (isExactHeadReference(name) && name !== "HEAD" ? name.replace(/^HEAD ->\s*/, "").trim() : name);
const compareNames = (left: string, right: string) => (left === right ? 0 : left < right ? -1 : 1);
const normalizeRemoteRefName = (name: string) => name.replace(/^refs\/remotes\//, "");

const legacyRefs = (refs?: string): SourceRef[] =>
  (refs || "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => ({ name }));

const isRemoteReference = (name: string, context: GitCommitRefPresentationContext) =>
  name.endsWith("/HEAD") ||
  /^(?:origin|upstream|remote|remotes\/[^/]+)\//.test(name) ||
  (context.remotes || []).some((remote) => name.startsWith(`${remote.name}/`));

const refKind = (ref: SourceRef, context: GitCommitRefPresentationContext): GitCommitRefPresentationKind => {
  if (ref.kind === "head" && !isExactHeadReference(ref.name)) {
    return isRemoteReference(ref.name, context) ? "remote" : "unknown";
  }
  if (ref.kind) return ref.kind;
  if (isExactHeadReference(ref.name)) return "head";
  if (ref.name.startsWith("tag:")) return "tag";
  if (context.branch === ref.name || (context.branches || []).some((branch) => branch.name === ref.name)) return "local";
  if (isRemoteReference(ref.name, context)) return "remote";
  return "unknown";
};

const upstreamRefNames = (context: GitCommitRefPresentationContext) => {
  const upstream = context.upstream;
  if (!upstream) return new Set<string>();
  return new Set([upstream.ref, `${upstream.remote}/${upstream.branch}`].filter(Boolean).map(normalizeRemoteRefName));
};

const remainingPriority = (kind: GitCommitRefPresentationKind) => {
  if (kind === "local") return 3;
  if (kind === "remote") return 4;
  if (kind === "tag") return 5;
  return 6;
};

const denseMember = (member: GitCommitRefPresentationMember, display: GitCommitRefDenseDisplay): GitCommitRefDenseMember => ({
  ...member,
  display,
  memberNames: [member.name],
  memberTitles: [member.title],
});

export const presentGitCommitRefs = (
  commit: ProjectGitCommitSummary,
  context: GitCommitRefPresentationContext = {},
): GitCommitRefPresentation => {
  const refs: SourceRef[] = commit.refNames === undefined ? legacyRefs(commit.refs) : commit.refNames;
  const upstreamNames = upstreamRefNames(context);
  const candidates: Candidate[] = refs.map((ref, sourceIndex) => {
    const kind = refKind(ref, context);
    const isCurrentHead = kind === "head" && isExactHeadReference(ref.name) && (!context.headHash || context.headHash === commit.hash);
    const isCurrentUpstream = kind === "remote" && upstreamNames.has(normalizeRemoteRefName(ref.name));
    const possibleGraphColorIndex = context.graphColorByRefName?.[ref.name];
    const graphColorIndex =
      typeof possibleGraphColorIndex === "number" && Number.isFinite(possibleGraphColorIndex) ? possibleGraphColorIndex : undefined;
    const priority = isCurrentHead ? 0 : isCurrentUpstream ? 1 : graphColorIndex === undefined ? remainingPriority(kind) : 2;

    return {
      kind,
      name: ref.name,
      identity: `${kind}:${ref.name}`,
      label: refLabel(ref.name),
      title: ref.name,
      priority,
      isCurrentHead,
      isCurrentUpstream,
      graphColorIndex,
      groupKey: `${graphColorIndex ?? "none"}:${kind}`,
      sourceIndex,
    };
  });
  const sortedCandidates = candidates.sort(
    (left, right) => left.priority - right.priority || compareNames(left.name, right.name) || left.sourceIndex - right.sourceIndex,
  );
  const currentHeadLabel = sortedCandidates.find((member) => member.isCurrentHead)?.label;
  const full = sortedCandidates.map(({ sourceIndex: _sourceIndex, ...member }, order) => ({
    ...member,
    order,
    isHeadTarget: member.kind === "local" && member.label === currentHeadLabel,
  }));
  const hiddenMembers = full.filter(
    (member) => member.kind === "local" && currentHeadLabel !== undefined && member.label === currentHeadLabel,
  );
  const denseSource = full.filter((member) => !hiddenMembers.includes(member));
  const primaryNonRemote =
    denseSource.find((member) => member.isCurrentHead) ?? denseSource.find((member) => member.kind !== "remote");
  const remoteMembers = denseSource.filter((member) => member.kind === "remote");
  const firstRemote = remoteMembers[0];
  const primaryRemote = remoteMembers.find((member) => !member.name.endsWith("/HEAD")) || firstRemote;
  const orderedRemoteMembers = primaryRemote
    ? [primaryRemote, ...remoteMembers.filter((member) => member !== primaryRemote)]
    : [];
  const members: GitCommitRefDenseMember[] = [];

  for (const member of denseSource) {
    if (member.kind !== "remote") {
      members.push(denseMember(member, member === primaryNonRemote ? "label" : "icon"));
      continue;
    }
    if (member !== firstRemote) continue;
    for (const remote of orderedRemoteMembers) {
      members.push(denseMember(remote, remote === primaryRemote ? "label" : "icon"));
    }
  }

  return { full, dense: { members, hiddenMembers } };
};