import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const verifier = new URL("../../../scripts/verify-mt5-dry-run-boundary.mjs", import.meta.url);

async function loadVerifier() {
  expect(existsSync(verifier), "the MT5 dry-run boundary verifier must exist").toBe(true);
  return import(verifier.href);
}

describe("MT5 dry-run boundary", () => {
  it("keeps Worker and MT5 source free of execution authority", async () => {
    const { runBoundaryVerifier } = await loadVerifier();

    expect(runBoundaryVerifier()).toEqual({ ok: true, violations: [] });
  });

  it("rejects Worker execution authority escalations", async () => {
    const { scanWorkerSource } = await loadVerifier();

    expect(typeof scanWorkerSource).toBe("function");
    expect(scanWorkerSource('const execution_mode = "LIVE";')).toContain(
      "WORKER_EXECUTION_MODE_NOT_DRY_RUN",
    );
    expect(scanWorkerSource("const config = { execution_mode: LIVE }; ")).toContain(
      "WORKER_EXECUTION_MODE_NOT_DRY_RUN",
    );
    expect(scanWorkerSource('readonly execution_mode: "PAPER_ONLY";')).toContain(
      "WORKER_EXECUTION_MODE_NOT_DRY_RUN",
    );
    expect(scanWorkerSource('const config = { execution_mode: "DRY_RUN" };')).toEqual([]);
    expect(scanWorkerSource("const config = { real_execution_allowed: true }; ")).toContain(
      "WORKER_REAL_EXECUTION_ALLOWED_FORBIDDEN",
    );
  });

  it("rejects direct MT5 order APIs", async () => {
    const { scan } = await loadVerifier();

    expect(scan("void f(){ OrderSend(r,q); }")).toContain("MT5_ORDER_API_FORBIDDEN");
  });

  it("rejects MT5 DLL imports", async () => {
    const { scan } = await loadVerifier();

    expect(scan('#import "x.dll"')).toContain("MT5_DLL_IMPORT_FORBIDDEN");
  });

  it("skips ignored local MT5 artifacts", async () => {
    const { runBoundaryVerifier } = await loadVerifier();
    const root = mkdtempSync(join(tmpdir(), "mt5-dry-run-boundary-"));

    try {
      const local = join(root, "mt5/TradeOpsAgent/local");
      mkdirSync(local, { recursive: true });
      writeFileSync(join(local, "generated.mqh"), "void f(){ OrderSend(r,q); }\n");

      expect(runBoundaryVerifier(root)).toEqual({ ok: true, violations: [] });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips generated MT5 source while scanning ordinary EA source", async () => {
    const { runBoundaryVerifier } = await loadVerifier();
    const root = mkdtempSync(join(tmpdir(), "mt5-dry-run-boundary-"));

    try {
      const generated = join(root, "mt5/TradeOpsAgent/generated");
      const include = join(root, "mt5/TradeOpsAgent/Include");
      mkdirSync(generated, { recursive: true });
      mkdirSync(include, { recursive: true });
      writeFileSync(join(generated, "generated.mqh"), "void f(){ CTrade trade; }\n");
      writeFileSync(join(include, "active.mqh"), "void f(){ OrderSend(r,q); }\n");

      expect(runBoundaryVerifier(root)).toEqual({
        ok: false,
        violations: ["MT5_ORDER_API_FORBIDDEN"],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
