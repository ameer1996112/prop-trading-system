import { describe, expect, it } from "vitest";
import { renderDashboardHtml } from "../src/dashboard-html";
import worker, { type Env } from "../src/index";

describe("health dashboard HTML", () => {
  it("renders a same-origin dashboard with fixed safe polling", () => {
    const html = renderDashboardHtml();

    expect(html).toContain('fetch("/api/v1/health-summary"');
    expect(html).toContain("10_000");
    expect(html).toContain("Manual refresh");
    expect(html).toContain("ONLINE");
    expect(html).toContain("STALE");
    expect(html).toContain("OFFLINE");
    expect(html).toContain("UNKNOWN");
    expect(html).not.toMatch(/balance|equity|margin|position|order|broker server|bearer/iu);
  });

  it("serves the dashboard without querying D1", async () => {
    const env = {
      AGENT_HEALTH_ACCOUNT_ID: "unused",
      AGENT_HEALTH_INSTALLATION_ID: "unused",
      AGENT_HEALTH_DB: {
        prepare() {
          throw new Error("D1 must not be queried for the dashboard");
        },
      },
    } as unknown as Env;

    const response = await worker.fetch(new Request("https://console.example/"), env);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
