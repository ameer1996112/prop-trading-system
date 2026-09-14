import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

function git(...args: string[]) {
  return spawnSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
}

describe("execution-edge local environment ignore boundary", () => {
  it.each([
    "apps/execution-edge/.dev.vars",
    "apps/execution-edge/.dev.vars.local",
    "apps/execution-edge/.dev.vars.preview",
    "apps/execution-edge/.dev.vars.production",
  ])("ignores local environment variant %s", (path) => {
    const result = git("check-ignore", "--no-index", "--quiet", path);
    expect(result.status, result.stderr).toBe(0);
  });

  it("keeps the names-only example explicitly unignored and tracked", () => {
    const ignored = git(
      "check-ignore",
      "--no-index",
      "--quiet",
      "apps/execution-edge/.dev.vars.example",
    );
    const tracked = git(
      "ls-files",
      "--error-unmatch",
      "apps/execution-edge/.dev.vars.example",
    );

    expect(ignored.status, ignored.stderr).toBe(1);
    expect(tracked.status, tracked.stderr).toBe(0);
  });
});
