import { describe, expect, it, vi } from "vitest";
import { resolveBuildVersion } from "../scripts/build-project-launch-service.mjs";

describe("service build version", () => {
  it("uses only service release tags", () => {
    const git = vi.fn(() => "service-v1.2.0-3-gabcdef0-dirty\n");
    expect(resolveBuildVersion({}, git)).toBe("service-v1.2.0-3-gabcdef0-dirty");
    expect(git).toHaveBeenCalledWith("git", ["describe", "--tags", "--match", "service-v*", "--always", "--dirty"], { encoding: "utf8" });
  });

  it("labels untagged builds as local and respects explicit versions", () => {
    expect(resolveBuildVersion({}, () => "abcdef0-dirty\n")).toBe("local-abcdef0-dirty");
    const git = vi.fn();
    expect(resolveBuildVersion({ PROJECT_LAUNCH_SERVICE_VERSION: " service-v2.0.0 " }, git)).toBe("service-v2.0.0");
    expect(git).not.toHaveBeenCalled();
    expect(resolveBuildVersion({}, () => { throw new Error("Git unavailable"); })).toBe("local");
  });
});