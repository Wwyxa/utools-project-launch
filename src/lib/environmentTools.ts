import type {
  BuiltinEnvironmentToolOverride,
  CustomEnvironmentTool,
  EnvironmentToolDefinition,
  EnvironmentToolKey,
  EnvironmentToolRequest,
} from "../types";

const fallbackPythonCommand = globalThis.navigator?.platform?.toLowerCase().includes("win") ? "python" : "python3";

export const BUILTIN_ENVIRONMENT_TOOLS: EnvironmentToolDefinition[] = [
  { key: "node", name: "Node.js", command: "node", versionArgs: ["--version"] },
  { key: "npm", name: "npm", command: "npm", versionArgs: ["--version"] },
  { key: "pnpm", name: "pnpm", command: "pnpm", versionArgs: ["--version"] },
  { key: "yarn", name: "Yarn", command: "yarn", versionArgs: ["--version"] },
  { key: "python", name: "Python", command: fallbackPythonCommand, versionArgs: ["--version"] },
  { key: "pip", name: "pip", command: fallbackPythonCommand === "python" ? "pip" : "pip3", versionArgs: ["--version"] },
  { key: "go", name: "Go", command: "go", versionArgs: ["version"] },
  { key: "git", name: "Git", command: "git", versionArgs: ["--version"] },
  { key: "docker", name: "Docker", command: "docker", versionArgs: ["--version"] },
];

const shellOperatorPattern = /[|&;<>`\r\n\u0000-\u001f\u007f]|\$\(|\$\{/;

export interface CustomEnvironmentToolInput {
  name: string;
  command: string;
  versionArgs: string[];
}

export type CustomEnvironmentToolErrors = Partial<Record<keyof CustomEnvironmentToolInput, string>>;

export function validateCustomEnvironmentToolInput(input: CustomEnvironmentToolInput): {
  value?: CustomEnvironmentToolInput;
  errors: CustomEnvironmentToolErrors;
} {
  const value = {
    name: input.name.trim(),
    command: input.command.trim(),
    versionArgs: input.versionArgs.map((argument) => argument.trim()),
  };
  const errors: CustomEnvironmentToolErrors = {};
  if (!value.name) errors.name = "required";
  if (!value.command) errors.command = "required";
  if (value.command && shellOperatorPattern.test(value.command)) errors.command = "unsafe";
  if (value.versionArgs.some((argument) => !argument || shellOperatorPattern.test(argument))) {
    errors.versionArgs = "unsafe";
  }
  return Object.keys(errors).length > 0 ? { errors } : { value, errors };
}

export function parseEnvironmentArguments(value: string): string[] | null {
  const tokens: string[] = [];
  let token = "";
  let quote = "";
  let escaping = false;
  let started = false;
  const input = value.trim();
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!;
    if (escaping) {
      token += character;
      escaping = false;
      started = true;
    } else if (
      character === "\\" &&
      input[index + 1] !== undefined &&
      (input[index + 1] === quote ||
        (quote && input[index + 1] === "\\") ||
        (!quote && /[\\\s"']/.test(input[index + 1]!)))
    ) {
      escaping = true;
      started = true;
    } else if (quote) {
      if (character === quote) quote = "";
      else token += character;
      started = true;
    } else if (character === '"' || character === "'") {
      quote = character;
      started = true;
    } else if (/\s/.test(character)) {
      if (started) {
        tokens.push(token);
        token = "";
        started = false;
      }
    } else {
      token += character;
      started = true;
    }
  }
  if (quote || escaping) return null;
  if (started) tokens.push(token);
  return tokens;
}

export function formatEnvironmentArguments(argumentsList: string[]): string {
  return argumentsList.map((argument) => (/\s|["'\\]/.test(argument) ? JSON.stringify(argument) : argument)).join(" ");
}

export function normalizeCustomEnvironmentTool(value: unknown): CustomEnvironmentTool | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<CustomEnvironmentTool>;
  if (
    typeof candidate.id !== "string" ||
    !candidate.id.trim() ||
    BUILTIN_ENVIRONMENT_TOOLS.some((tool) => tool.key === candidate.id.trim()) ||
    !Array.isArray(candidate.versionArgs) ||
    candidate.versionArgs.some((argument) => typeof argument !== "string")
  ) {
    return null;
  }
  const validation = validateCustomEnvironmentToolInput({
    name: typeof candidate.name === "string" ? candidate.name : "",
    command: typeof candidate.command === "string" ? candidate.command : "",
    versionArgs: candidate.versionArgs,
  });
  if (!validation.value || Object.keys(validation.errors).length > 0) return null;
  return {
    id: candidate.id.trim(),
    ...validation.value,
    enabled: candidate.enabled !== false,
  };
}

export function normalizeBuiltinEnvironmentToolOverride(value: unknown): BuiltinEnvironmentToolOverride | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<BuiltinEnvironmentToolOverride>;
  const definition = BUILTIN_ENVIRONMENT_TOOLS.find((tool) => tool.key === candidate.key);
  if (
    !definition ||
    !Array.isArray(candidate.versionArgs) ||
    candidate.versionArgs.some((item) => typeof item !== "string")
  ) {
    return null;
  }
  const validation = validateCustomEnvironmentToolInput({
    name: definition.name,
    command: typeof candidate.command === "string" ? candidate.command : "",
    versionArgs: candidate.versionArgs,
  });
  return validation.value
    ? { key: definition.key, command: validation.value.command, versionArgs: validation.value.versionArgs }
    : null;
}

export function environmentToolRequest(
  key: string,
  customTools: CustomEnvironmentTool[],
  builtinOverrides: BuiltinEnvironmentToolOverride[] = [],
  builtinTools: EnvironmentToolDefinition[] = BUILTIN_ENVIRONMENT_TOOLS,
): EnvironmentToolRequest | null {
  const builtin = builtinTools.find((tool) => tool.key === key);
  const overrideCandidate = builtinOverrides.find((item) => item.key === key);
  const override = normalizeBuiltinEnvironmentToolOverride(overrideCandidate);
  if (builtin && overrideCandidate && !override) return null;
  if (builtin && override) {
    return { kind: "builtin-override", key: builtin.key, command: override.command, versionArgs: override.versionArgs };
  }
  if (builtin) return { kind: "builtin", key: builtin.key };
  const custom = customTools.find((tool) => tool.id === key && tool.enabled);
  return custom
    ? {
        kind: "custom",
        id: custom.id,
        name: custom.name,
        command: custom.command,
        versionArgs: custom.versionArgs,
      }
    : null;
}
