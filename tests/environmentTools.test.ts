import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatEnvironmentArguments,
  parseEnvironmentArguments,
  validateCustomEnvironmentToolInput,
} from "../src/lib/environmentTools";

describe("environment tools", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("parses quoted arguments and rejects shell operators", () => {
    expect(parseEnvironmentArguments('--version "long value"')).toEqual(["--version", "long value"]);
    expect(parseEnvironmentArguments(formatEnvironmentArguments(["--path", "C:\\Program Files\\Java"]))).toEqual([
      "--path",
      "C:\\Program Files\\Java",
    ]);
    expect(parseEnvironmentArguments('"unfinished')).toBeNull();
    expect(
      validateCustomEnvironmentToolInput({ name: "Java", command: "java", versionArgs: ["-version"] }).errors,
    ).toEqual({});
    expect(
      validateCustomEnvironmentToolInput({ name: "Bad", command: "java & whoami", versionArgs: [] }).errors,
    ).toEqual({ command: "unsafe" });
  });
});
