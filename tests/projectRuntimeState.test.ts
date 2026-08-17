import { describe, expect, it } from "vitest";
import { mergeScriptRuntimeState } from "../src/lib/projectRuntimeState";

describe("project runtime state", () => {
  it("preserves the active run identity when scripts are rebuilt", () => {
    const nextScripts = [
      {
        id: "script-1",
        name: "dev",
        command: "npm run dev",
        status: "IDLE" as const,
      },
    ];
    const previousScripts = [
      {
        id: "script-1",
        name: "dev",
        command: "npm run dev",
        status: "RUNNING" as const,
        pid: 4120,
        runId: "service-run-1",
        runtimeOwner: "service" as const,
      },
    ];

    expect(mergeScriptRuntimeState(nextScripts, previousScripts)[0]).toMatchObject({
      status: "RUNNING",
      pid: 4120,
      runId: "service-run-1",
      runtimeOwner: "service",
    });
  });
});
