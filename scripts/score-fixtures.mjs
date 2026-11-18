// Runs the analyser and the grep baseline on our two test fixtures and scores both against fixtures/truth.json.
// Writes results/<fixture>.json and results/fixture-scores.json.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { analyze, compare } from "../src/analyze.mjs";
import { score } from "../src/score.mjs";

const truth = JSON.parse(readFileSync(new URL("../fixtures/truth.json", import.meta.url)));
const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const networkValues = (findings) => new Set(findings.filter((f) => f.category === "network").map((f) => f.value));

function hostsNamed(rep, behaviours) {
  const truthHosts = behaviours.filter((b) => b.category === "network").map((b) => b.value);
  const ours = networkValues(rep.facts), grep = networkValues(rep.grep);
  return {
    truth: truthHosts.length,
    mcp_xray: truthHosts.filter((h) => ours.has(h)).length,
    grep: truthHosts.filter((h) => grep.has(h)).length,
    grep_extra_hosts: [...grep].filter((h) => !truthHosts.includes(h) && DOMAIN.test(h) && !/^https?\./.test(h)),
  };
}

mkdirSync("results", { recursive: true });
const res = {};
for (const t of ["mcp-planted", "mcp-clean"]) {
  const rep = analyze(`fixtures/${t}`);
  writeFileSync(`results/${t}.json`, JSON.stringify(rep, null, 1));
  const tb = truth[t].behaviours;
  res[t] = {
    rea_facts_only: score(rep.facts.filter((f) => f.layer === "rea"), tb),
    mcp_xray: score(rep.facts, tb),
    hosts_named: hostsNamed(rep, tb),
    grep: score(rep.grep, tb),
    overlap: compare(rep),
    layer_counts: rep.facts.reduce((a, f) => ((a[f.layer] = (a[f.layer] || 0) + 1), a), {}),
  };
}
writeFileSync("results/fixture-scores.json", JSON.stringify(res, null, 1));
console.log(JSON.stringify(res, null, 1));
