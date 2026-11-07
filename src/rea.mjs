// Runs REA's static JavaScript analyser (CLI) on a directory and returns its parsed Evidence JSON.
// REA parses sources as inert text; nothing in the target is executed.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const req = createRequire(import.meta.url);
export const REA_BIN = join(dirname(req.resolve("rea-agents/package.json")), "scripts/rea.mjs");
export const REA_VERSION = JSON.parse(readFileSync(join(dirname(REA_BIN), "../package.json"), "utf8")).version;

export function runRea(dir, { cache } = {}) {
  if (cache && existsSync(cache)) return JSON.parse(readFileSync(cache, "utf8"));
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [REA_BIN, "analyze-javascript-application", dir, "--format", "json",
    "--integrity-policy", "record-and-continue", "--analysis-timeout-ms", "240000", "--max-heap-mb", "4096", "--max-semantic-nodes-per-file", "150000", "--max-semantic-nodes", "400000", "--max-semantic-unknowns", "400000", "--max-semantic-unknowns-per-file", "150000"],
    { encoding: "utf8", maxBuffer: 1 << 30, env: { ...process.env, NO_COLOR: "1" } });
  if (r.status !== 0 && !r.stdout.trim().startsWith("{")) throw new Error(`REA failed (${r.status}): ${(r.stderr || "").split("\n").filter((l) => !l.includes("rea_progress")).join("\n").slice(0, 800)}`);
  const ev = JSON.parse(r.stdout);
  ev.__ms = Date.now() - t0;
  if (cache) writeFileSync(cache, JSON.stringify(ev));
  return ev;
}
