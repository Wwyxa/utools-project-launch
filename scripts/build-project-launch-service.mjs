import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** @param {(file: string, args: string[], options: { encoding: "utf8" }) => string} [runGit] */
export const resolveBuildVersion = (environment = process.env, runGit = execFileSync) => {
  const configuredVersion = environment.PROJECT_LAUNCH_SERVICE_VERSION?.trim();
  if (configuredVersion) return configuredVersion;

  try {
    const gitVersion = runGit("git", ["describe", "--tags", "--match", "service-v*", "--always", "--dirty"], {
      encoding: "utf8",
    }).trim();
    if (gitVersion) return gitVersion.startsWith("service-v") ? gitVersion : `local-${gitVersion}`;
  } catch {}

  return "local";
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  mkdirSync("service/bin", { recursive: true });
  const version = resolveBuildVersion();
  execFileSync(
    "go",
    [
      "-C",
      "service",
      "build",
      "-trimpath",
      "-buildvcs=false",
      `-ldflags=-s -w -X main.version=${version}`,
      "-o",
      "bin",
      "./cmd/project-launch-service",
    ],
    { stdio: "inherit" },
  );
}
