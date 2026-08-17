import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const resolveBuildVersion = () => {
  const configuredVersion = process.env.PROJECT_LAUNCH_SERVICE_VERSION?.trim();
  if (configuredVersion) return configuredVersion;

  try {
    const gitVersion = execFileSync("git", ["describe", "--tags", "--always", "--dirty"], {
      encoding: "utf8",
    }).trim();
    if (gitVersion) return gitVersion;
  } catch {}

  return "local";
};

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
