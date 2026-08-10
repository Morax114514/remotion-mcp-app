import fs from "node:fs/promises";
import path from "node:path";
import { transform } from "esbuild";

const root = process.cwd();
const ignored = new Set(["node_modules", "dist", ".git", ".mcp-use"]);
const failures = [];
let checked = 0;

async function walk(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full);
      continue;
    }
    if (!/\.(?:ts|tsx)$/.test(entry.name)) continue;
    const loader = entry.name.endsWith(".tsx") ? "tsx" : "ts";
    try {
      await transform(await fs.readFile(full, "utf8"), { loader, format: "esm", target: "es2020" });
      checked += 1;
    } catch (error) {
      failures.push(`${path.relative(root, full)}: ${error.message}`);
    }
  }
}

await walk(root);
if (failures.length) {
  console.error(failures.join("\n\n"));
  process.exit(1);
}
console.log(`Syntax OK: ${checked} TypeScript/TSX files.`);
