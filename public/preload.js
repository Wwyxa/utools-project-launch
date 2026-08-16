const fs = require("fs");
const path = require("path");

const preloadModuleFiles = [
  "foundation.js",
  "preferences.js",
  "project-launch-service.js",
  "environment-tools.js",
  "ai.js",
  "platform.js",
  "git.js",
  "projects.js",
  "git-diff.js",
  "processes.js",
  "bridge.js",
];
const preloadModuleRoot =
  typeof __dirname === "string" ? path.join(__dirname, "preload") : path.join("public", "preload");
const preloadSource = preloadModuleFiles
  .map((fileName) => fs.readFileSync(path.join(preloadModuleRoot, fileName), "utf8"))
  .join("\n");

eval(preloadSource);
