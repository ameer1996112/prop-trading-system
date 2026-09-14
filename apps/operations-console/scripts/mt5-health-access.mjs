import { spawn } from "node:child_process";
import { MT5_HEALTH_ORIGIN } from "./mt5-health-proxy.mjs";

const LOGIN_TIMEOUT_MS = 120000;
const MAX_CAPTURE_BYTES = 32 * 1024;
const MAX_TOKEN_LENGTH = 16 * 1024;

// Explicit CLI startup only. cloudflared owns its normal local authentication
// cache; this helper neither reads that cache nor creates another token file.
export function acquireMt5AccessToken({ spawnImpl = spawn, signal } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    let deadline;
    let settled = false;
    const captured = { stdout: [], stderr: [] };
    const sizes = { stdout: 0, stderr: 0 };

    function finish(value) {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      signal?.removeEventListener("abort", fail);
      if (!value && child) {
        try { child.kill("SIGKILL"); } catch { /* Only a generic error leaves this boundary. */ }
      }
      child?.stdout?.destroy();
      child?.stderr?.destroy();
      for (const chunks of Object.values(captured)) {
        for (const chunk of chunks) chunk.fill(0);
        chunks.length = 0;
      }
      if (value) resolve(value);
      else reject(new Error("MT5 Access authentication required"));
    }
    function fail() { finish(); }
    if (signal?.aborted) return fail();
    try {
      child = spawnImpl("cloudflared", ["access", "login", "--app", MT5_HEALTH_ORIGIN, "--no-verbose"], {
        shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      });
      child.once("error", fail);
      if (!child.stdout || !child.stderr) return fail();
      for (const stream of ["stdout", "stderr"]) {
        child[stream].on("data", (chunk) => {
          if (settled) return;
          sizes[stream] += Buffer.byteLength(chunk);
          if (sizes[stream] > MAX_CAPTURE_BYTES) return fail();
          captured[stream].push(Buffer.from(chunk));
        });
        child[stream].once("error", fail);
      }
      child.once("close", (code) => {
        if (settled) return;
        if (code !== 0) return fail();
        const bytes = Buffer.concat(captured.stdout);
        const value = bytes.toString("utf8").replace(/\r?\n$/, "");
        bytes.fill(0);
        if (value.length > MAX_TOKEN_LENGTH || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return fail();
        finish(value);
      });
      signal?.addEventListener("abort", fail, { once: true });
      deadline = setTimeout(fail, LOGIN_TIMEOUT_MS);
    } catch {
      fail();
    }
  });
}
