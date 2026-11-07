// Analyses every extracted target under targets/ (static only) and writes results/targets/*.json + a summary.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { analyze, compare } from "../src/analyze.mjs";
const list = JSON.parse(readFileSync("targets.json", "utf8"));
mkdirSync("results/targets", { recursive: true });
const rows = [];
for (const pkg of list) {
  const id = pkg.replace(/[@/]/g, "_").replace(/^_/, "");
  const root = `targets/${id}/package`;
  if (!existsSync(root)) { console.log("missing", pkg); continue; }
  try {
    const rep = analyze(root, { cache: `targets/${id}/rea.json` });
    rep.id = id;
    writeFileSync(`results/targets/${id}.json`, JSON.stringify(rep, null, 1));
    const c = compare(rep);
    const undocEnv = rep.facts.filter((f) => f.category === "env" && !f.documented).length;
    const undocHosts = new Set(rep.facts.filter((f) => f.category === "network" && !f.documented && !f.value.startsWith("(")).map((f) => f.value)).size;
    rows.push({ pkg, version: rep.version, js_files: rep.js_files, coverage: rep.coverage.status, truncated: rep.coverage.truncated, rea_ms: rep.rea_ms, ...rep.summary, undocumented_env: undocEnv, undocumented_hosts: undocHosts, grep_total: new Set(rep.grep.map((f) => `${f.category}|${f.file}|${f.line}`)).size, ...c });
    console.log(pkg, JSON.stringify(rows.at(-1)));
  } catch (e) { console.log("FAIL", pkg, e.message.slice(0, 300)); rows.push({ pkg, error: e.message.slice(0, 300) }); }
}
writeFileSync("results/targets-summary.json", JSON.stringify(rows, null, 1));
