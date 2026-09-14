import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const feature = resolve(process.cwd(), "src/features/tradeops");
const files = readdirSync(feature, { recursive: true }).map(String).filter((file) => /\.tsx?$/.test(file));

describe("TradeOps feature safety boundary", () => {
  it("mounts the TradeOps dashboard at the root with paper-only metadata", () => {
    const page = readFileSync(resolve(process.cwd(), "src/app/page.tsx"), "utf8");
    const layout = readFileSync(resolve(process.cwd(), "src/app/layout.tsx"), "utf8");
    expect(page).toContain("<TradeOpsDashboard");
    expect(page).not.toContain("FoundationDashboard");
    expect(layout).toContain("TradeOps · Paper Operations");
    expect(layout).toMatch(/read-only paper/i);
  });

  it("imports no mutation helpers, legacy clients, backend, or fixture fallbacks", () => {
    for (const file of files) {
      const source = readFileSync(`${feature}/${file}`, "utf8");
      const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
      for (const statement of ast.statements) {
        if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
        expect(statement.moduleSpecifier?.getText(ast) ?? "", file).not.toMatch(/supabase|metaapi|railway|legacy|service.client|\/backend|fixtures/i);
        expect(statement.getText(ast), file).not.toMatch(/\b(createPaper|settlePaper|setPaperReadinessKillSwitch|applyPaper|postPaper|mutate)\w*/);
      }
      expect(source, file).not.toMatch(/\b(?:localStorage|sessionStorage)\s*\.|document\.cookie|process\.env/);
      expect(source, file).not.toMatch(/method\s*:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i);
      expect(source, file).not.toMatch(/\/(?:backend|api\/v1\/[^"'\s]+(?:settle|kill-switch))/);
      expect(source, file).not.toMatch(/(?:operatorCredential|credential|apiKey|secret)\s*(?::\s*string)?\s*=\s*["'][^"']+["']/i);
    }
  });

  it("has one composed session hook owner and no polling in presentation views", () => {
    const dashboard = readFileSync(`${feature}/TradeOpsDashboard.tsx`, "utf8");
    const views = readFileSync(`${feature}/PaperViews.tsx`, "utf8");
    expect(dashboard.match(/\buseTradeOps\(/g)).toHaveLength(1);
    expect(views).not.toMatch(/useTradeOps|setInterval|setTimeout|\bfetch\s*\(|from ["']\.\/session["'];?$/m);
  });
});
