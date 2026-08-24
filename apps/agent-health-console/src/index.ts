import { healthSummaryV1, type AgentHealthConsoleEnv } from "./health-summary-v1";
import { renderDashboardHtml } from "./dashboard-html";

export interface Env extends AgentHealthConsoleEnv {}

const HEALTH_SUMMARY_PATH = "/api/v1/health-summary";
const NO_STORE = { "cache-control": "no-store" };
const ROOT_PATH = "/";

function response(status: number): Response {
  return new Response(null, { status, headers: NO_STORE });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "GET") return response(405);
    if (url.pathname === ROOT_PATH) {
      return new Response(renderDashboardHtml(), {
        headers: { ...NO_STORE, "content-type": "text/html; charset=utf-8" },
      });
    }
    if (url.pathname !== HEALTH_SUMMARY_PATH) return response(404);

    const summary = await healthSummaryV1(env, Math.floor(Date.now() / 1_000));
    return Response.json(summary, { headers: NO_STORE });
  },
} satisfies ExportedHandler<Env>;
