const fs = require("fs");
const path = require("path");

const preloadModuleFiles = [
  "foundation.js",
  "local-state.js",
  "runtime-records.js",
  "icon-packs.js",
  "preferences.js",
  "project-launch-service.js",
  "environment-tools.js",
  "ai.js",
  "platform.js",
  "github-auth.js",
  "git-avatar-cache.js",
  "git.js",
  "github-pr.js",
  "projects.js",
  "migration.js",
  "data-tools.js",
  "backups.js",
  "agent-tools.js",
  "git-diff.js",
  "git-integration.js",
  "processes.js",
  "bridge.js",
];
const preloadModuleRoot =
  typeof __dirname === "string" ? path.join(__dirname, "preload") : path.join("public", "preload");
const preloadSource = preloadModuleFiles
  .map((fileName) => fs.readFileSync(path.join(preloadModuleRoot, fileName), "utf8"))
  .join("\n");

eval(preloadSource);
