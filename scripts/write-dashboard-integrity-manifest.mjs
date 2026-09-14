import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dashboardSourceDirectoryPath = "apps/agent-health-console/src";
const dashboardIntegrityManifestPath = "apps/agent-health-console/dashboard-integrity-manifest.v1.json";
const approvedSourcePaths = ["dashboard-html.ts", "health-summary-v1.ts", "index.ts"];
function sourceFiles(root) {
  if (!existsSync(root)) return [];

  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      files.push(...sourceFiles(join(root, entry.name)));
      continue;
    }
    if (entry.isFile() && extname(entry.name).toLowerCase() === ".ts") files.push(join(root, entry.name));
  }
  return files;
}

function writeDashboardIntegrityManifest(root = repositoryRoot) {
  const sourceRoot = join(root, dashboardSourceDirectoryPath);
  const sourcePaths = sourceFiles(sourceRoot).map((file) => relative(sourceRoot, file)).sort();
  if (sourcePaths.length !== approvedSourcePaths.length
    || sourcePaths.some((path, index) => path !== approvedSourcePaths[index])) {
    throw new Error("Dashboard source file set does not match the reviewed release.");
  }

  const manifest = {
    schema_version: "DashboardIntegrityManifestV1",
    files: approvedSourcePaths.map((path) => ({
      path,
      sha256: createHash("sha256").update(readFileSync(join(sourceRoot, path))).digest("hex"),
    })),
  };
  writeFileSync(join(root, dashboardIntegrityManifestPath), `${JSON.stringify(manifest, null, 2)}\n`);
}

writeDashboardIntegrityManifest();
