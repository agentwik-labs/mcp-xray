// Runs the analyser and the grep baseline on our two test fixtures and scores both against fixtures/truth.json.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { analyze, compare } from "../src/analyze.mjs";
import { score } from "../src/score.mjs";
const truth = JSON.parse(readFileSync(new URL("../fixtures/truth.json", import.meta.url)));
mkdirSync("results", { recursive: true });
const res = {};
for (const t of ["mcp-planted", "mcp-clean"]) {
  const rep = analyze(`fixtures/${t}`);
  writeFileSync(`results/${t}.json`, JSON.stringify(rep, null, 1));
  const tb = truth[t].behaviours;
  const hosts = (fs) => new Set(fs.filter((f) => f.category === "network").map((f) => f.value));
  const truthHosts = tb.filter((b) => b.category === "network").map((b) => b.value);
  res[t] = { rea_facts_only: score(rep.facts.filter((f) => f.layer === "rea"), tb), rea: score(rep.facts, tb),
    hosts_named: { truth: truthHosts.length, rea: truthHosts.filter((h) => hosts(rep.facts).has(h)).length, grep: truthHosts.filter((h) => hosts(rep.grep).has(h)).length,
      grep_extra_hosts: [...hosts(rep.grep)].filter((h) => !truthHosts.includes(h) && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h) && !/^https?\./.test(h)) }, grep: score(rep.grep, truth[t].behaviours), overlap: compare(rep), rea_layer_counts: rep.facts.reduce((a, f) => ((a[f.layer] = (a[f.layer] || 0) + 1), a), {}) };
}
writeFileSync("results/fixture-scores.json", JSON.stringify(res, null, 1));
console.log(JSON.stringify(res, null, 1));
