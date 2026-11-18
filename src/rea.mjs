// Runs REA's static JavaScript analyser (CLI) on a directory and returns its parsed Evidence JSON.
// REA parses sources as inert text; nothing in the target is executed.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const REA_PKG = require.resolve("rea-agents/package.json");
export const REA_BIN = join(dirname(REA_PKG), "scripts/rea.mjs");
export const REA_VERSION = JSON.parse(readFileSync(REA_PKG, "utf8")).version;

// Raised node ceilings so large bundles get as far as REA can take them.
const REA_ARGS = [
  "--format", "json",
  "--integrity-policy", "record-and-continue",
  "--analysis-timeout-ms", "240000",
  "--max-heap-mb", "4096",
  "--max-semantic-nodes-per-file", "150000",
  "--max-semantic-nodes", "400000",
  "--max-semantic-unknowns", "400000",
  "--max-semantic-unknowns-per-file", "150000",
];

export function runRea(dir, { cache } = {}) {
  if (cache && existsSync(cache)) return JSON.parse(readFileSync(cache, "utf8"));
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [REA_BIN, "analyze-javascript-application", dir, ...REA_ARGS],
    { encoding: "utf8", maxBuffer: 1 << 30, env: { ...process.env, NO_COLOR: "1" } });
  if (r.error) throw new Error(`REA could not start: ${r.error.message}`);
  if (r.status !== 0 && !r.stdout.trim().startsWith("{")) {
    const stderr = (r.stderr || "").split("\n").filter((l) => !l.includes("rea_progress")).join("\n");
    throw new Error(`REA failed (${r.status}): ${stderr.slice(0, 800)}`);
  }
  const ev = JSON.parse(r.stdout);
  ev.__ms = Date.now() - t0;
  if (cache) writeFileSync(cache, JSON.stringify(ev));
  return ev;
}
