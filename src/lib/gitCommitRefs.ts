import type {
  ProjectGitCommitRef,
  ProjectGitCommitRefKind,
  ProjectGitCommitSummary,
  ProjectGitSnapshot,
} from "../types";

export type GitCommitRefPresentationKind = ProjectGitCommitRefKind | "unknown";
export type GitCommitRefDenseDisplay = "label" | "icon";

export type GitCommitRefPresentationContext = Partial<
  Pick<ProjectGitSnapshot, "branch" | "headHash" | "isDetachedHead" | "branches" | "remotes" | "upstream" | "base">
> & {
  graphColorByRefIdentity?: Readonly<Record<string, number>>;
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
  isCurrentUpstream: boolean;
  isCurrentBase: boolean;
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

type SourceRef = Pick<ProjectGitCommitRef, "name"> & Partial<Pick<ProjectGitCommitRef, "kind" | "head">>;
type Candidate = Omit<GitCommitRefPresentationMember, "priority" | "order" | "isCurrentHead"> & {
  sourceIndex: number;
  current: boolean;
  isHeadReference: boolean;
};

const isExactHeadReference = (name: string) => name === "HEAD" || /^HEAD ->\s+\S+$/.test(name);
const refLabel = (name: string) =>
  isExactHeadReference(name) && name !== "HEAD" ? name.replace(/^HEAD ->\s*/, "").trim() : name;
const compareNames = (left: string, right: string) => (left === right ? 0 : left < right ? -1 : 1);
const normalizeRemoteRefName = (name: string) => name.replace(/^refs\/remotes\//, "");
const hashesMatch = (left: string, right: string) => left === right || left.startsWith(right) || right.startsWith(left);

export const gitCommitRefIdentity = (kind: GitCommitRefPresentationKind, name: string) => `${kind}:${name}`;

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
  if (context.branch === ref.name || (context.branches || []).some((branch) => branch.name === ref.name))
    return "local";
  if (isRemoteReference(ref.name, context)) return "remote";
  return "unknown";
};

const upstreamRefNames = (context: GitCommitRefPresentationContext) => {
  const upstream = context.upstream;
  if (!upstream) return new Set<string>();
  return new Set([upstream.ref, `${upstream.remote}/${upstream.branch}`].filter(Boolean).map(normalizeRemoteRefName));
};

const baseRefNames = (context: GitCommitRefPresentationContext) => {
  const base = context.base;
  return new Set([base?.ref, base && `${base.remote}/${base.branch}`].filter(Boolean).map(normalizeRemoteRefName));
};

const remainingPriority = (kind: GitCommitRefPresentationKind) => {
  if (kind === "local") return 3;
  if (kind === "remote") return 4;
  if (kind === "tag" || kind === "stash") return 5;
  return 6;
};

const denseMember = (
  source: readonly GitCommitRefPresentationMember[],
  display: GitCommitRefDenseDisplay,
): GitCommitRefDenseMember => {
  const member = source[0];
  if (!member) throw new Error("A dense Git reference group must contain a member.");
  const memberNames = source.map((candidate) => candidate.name);
  const memberTitles = source.map((candidate) => candidate.title);
  return {
    ...member,
    title: memberTitles.join("\n"),
    display,
    memberNames,
    memberTitles,
  };
};

const candidatePriority = (candidate: Candidate & Pick<GitCommitRefPresentationMember, "isCurrentHead">) => {
  if (candidate.isCurrentHead) return 0;
  if (candidate.isCurrentUpstream) return 1;
  if (candidate.isCurrentBase) return 2;
  if (candidate.graphColorIndex !== undefined) return 3;
  return remainingPriority(candidate.kind) + 1;
};

export const presentGitCommitRefs = (
  commit: ProjectGitCommitSummary,
  context: GitCommitRefPresentationContext = {},
): GitCommitRefPresentation => {
  const refs: SourceRef[] = commit.refNames === undefined ? legacyRefs(commit.refs) : commit.refNames;
  const upstreamNames = upstreamRefNames(context);
  const baseNames = baseRefNames(context);
  const currentCommit = !context.headHash || hashesMatch(context.headHash, commit.hash);
  const candidates: Candidate[] = refs.map((ref, sourceIndex) => {
    const kind = refKind(ref, context);
    const label = refLabel(ref.name);
    const isHeadReference = kind === "head" && isExactHeadReference(ref.name) && currentCommit;
    const isCurrentUpstream = kind === "remote" && upstreamNames.has(normalizeRemoteRefName(ref.name));
    const isCurrentBase = kind === "remote" && baseNames.has(normalizeRemoteRefName(ref.name));
    const identity = gitCommitRefIdentity(kind, ref.name);
    const possibleGraphColorIndex = context.graphColorByRefIdentity?.[identity];
    const graphColorIndex =
      typeof possibleGraphColorIndex === "number" && Number.isFinite(possibleGraphColorIndex)
        ? possibleGraphColorIndex
        : undefined;

    return {
      kind,
      name: ref.name,
      identity,
      label,
      title: ref.name,
      isCurrentUpstream,
      isCurrentBase,
      graphColorIndex,
      groupKey: `${graphColorIndex ?? "none"}:${kind}`,
      sourceIndex,
      current: Boolean(ref.head),
      isHeadReference,
    };
  });
  const headReference = candidates.find((candidate) => candidate.isHeadReference);
  const headTarget =
    !context.isDetachedHead && currentCommit
      ? candidates.find(
          (candidate) =>
            candidate.kind === "local" &&
            (candidate.current || candidate.label === headReference?.label || candidate.label === context.branch),
        )
      : undefined;
  const sortedCandidates = candidates
    .filter((candidate) => candidate !== headReference || !headTarget)
    .map((candidate) => ({
      ...candidate,
      isCurrentHead: candidate === headTarget || (!headTarget && candidate.isHeadReference),
    }))
    .map((candidate) => ({ ...candidate, priority: candidatePriority(candidate) }))
    .sort(
      (left, right) =>
        left.priority - right.priority || compareNames(left.name, right.name) || left.sourceIndex - right.sourceIndex,
    );
  const full = sortedCandidates.map(
    ({ sourceIndex: _sourceIndex, current: _current, isHeadReference: _isHeadReference, ...member }, order) => ({
      ...member,
      order,
    }),
  );
  const members: GitCommitRefDenseMember[] = [];
  let remaining = full.slice();
  const firstColored = remaining.find((member) => member.graphColorIndex !== undefined);
  const primary =
    firstColored ??
    remaining.find((member) => member.isCurrentHead) ??
    remaining.find((member) => member.kind !== "tag");
  if (primary) {
    members.push(denseMember([primary], "label"));
    remaining = remaining.filter((member) => member !== primary);
  }
  const groups = new Map<string, GitCommitRefPresentationMember[]>();
  for (const member of remaining) {
    const group = groups.get(member.groupKey);
    if (group) group.push(member);
    else groups.set(member.groupKey, [member]);
  }
  for (const group of groups.values()) {
    members.push(denseMember(group, "icon"));
  }

  return { full, dense: { members, hiddenMembers: [] } };
};
