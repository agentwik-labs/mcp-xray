// Builds reports/: one card per fixture and real target, and index.html with the measured tables.
// Writes results/measured.json (the numbers in the README) and results/targets/<id>.json.
// Real targets must already be under targets/ (node scripts/fetch-targets.mjs); REA output is cached there.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { analyze, compare } from "../src/analyze.mjs";
import { reportCard, CSS } from "../src/report.mjs";
import { score } from "../src/score.mjs";
import { REA_VERSION } from "../src/rea.mjs";
import { packageId } from "../src/targets.mjs";

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const sum = (rows, k) => rows.reduce((a, r) => a + r[k], 0);

function measureFixtures(truth) {
  const fx = {};
  for (const t of ["mcp-planted", "mcp-clean"]) {
    const rep = analyze(`fixtures/${t}`);
    const tb = truth[t].behaviours;
    const planted = new Map(tb.filter((b) => b.planted).flatMap((b) => b.lines.map((l) => [`${b.category}|${b.file}|${l}`, b.id])));
    writeFileSync(`reports/fixture-${t}.html`, reportCard(rep, { fixture: true, planted }));
    fx[t] = { tool: score(rep.facts, tb), rea_only: score(rep.facts.filter((f) => f.layer === "rea"), tb), grep: score(rep.grep, tb), overlap: compare(rep) };
  }
  return fx;
}

function measureTarget([pkg, pinned]) {
  const id = packageId(pkg);
  const rep = analyze(`targets/${id}/package`, { cache: `targets/${id}/rea.json` });
  if (rep.version !== pinned) throw new Error(`targets/${id} is ${pkg}@${rep.version}, targets.json pins ${pinned}; delete it and re-run fetch-targets`);
  writeFileSync(`reports/${id}.html`, reportCard(rep));
  writeFileSync(`results/targets/${id}.json`, JSON.stringify(rep, null, 1));
  const envs = [...new Map(rep.facts.filter((f) => f.category === "env").map((f) => [f.value, f])).values()];
  const calledHosts = new Map(rep.facts.filter((f) => f.category === "network" && !f.value.startsWith("(")).map((f) => [f.value, f]));
  const undocCalled = [...calledHosts.values()].filter((f) => !f.documented).length;
  const undocStrings = rep.hosts_in_strings.filter((h) => !h.documented && !calledHosts.has(h.host)).length;
  return {
    pkg, id, version: rep.version, files: rep.js_files,
    coverage: rep.coverage.status + (rep.coverage.truncated ? "*" : ""), rea_s: +(rep.rea_ms / 1000).toFixed(1),
    env: envs.length, secret_env: envs.filter((f) => f.secret).length, env_not_in_readme: envs.filter((f) => !f.documented).length,
    network_calls: rep.summary.network, hosts_named: rep.hosts_in_strings.length, hosts_not_in_readme: undocCalled + undocStrings,
    file_rw: rep.summary["file-read"] + rep.summary["file-write"], process: rep.summary.process, dynamic: rep.summary["dynamic-code"],
    ...compare(rep),
  };
}

function totalsOf(real) {
  const keys = ["both", "only_rea", "only_grep", "only_grep_in_comments", "only_grep_url_strings", "only_grep_other", "only_grep_regex_exec", "only_grep_localhost"];
  const totals = { packages: real.length, ...Object.fromEntries(keys.map((k) => [k, sum(real, k)])) };
  totals.only_grep_real_code_missed_by_rea = totals.only_grep_other - totals.only_grep_regex_exec - totals.only_grep_localhost;
  return totals;
}

const missedText = (s) => s.missed.filter((id) => id.startsWith("P")).join(", ") || "none";

function indexPage(fx, real, totals) {
  const fxRow = (name, s) => `<tr><td>${name}</td><td class="big">${s.planted_found} / ${s.planted_total}</td><td>${s.real_found} / ${s.real_total}</td><td class="big">${s.false_positives}</td></tr>`;
  const p = fx["mcp-planted"], c = fx["mcp-clean"];
  return `<!doctype html><html><head><meta charset="utf-8"><title>mcp-xray: measured</title><style>${CSS}</style></head><body><div class="wrap">
<div class="top"><h1>mcp-xray</h1><span class="ver">what does this MCP server actually do?</span></div>
<p class="desc">Static report card for an npm MCP server package: env vars, network, files, child processes, dynamic code, checked against its README. Built on REA ${esc(REA_VERSION)}. Nothing is installed or executed.</p>
<div class="grid" style="grid-template-columns:1fr 1fr">
<div class="card" id="fixture"><h2><span class="tag">OUR TEST FIXTURE</span> &nbsp;${p.tool.planted_total} planted behaviours, frozen before the first run</h2>
<table><tr><th></th><th>planted found</th><th>declared found</th><th>false positives</th></tr>
${fxRow("mcp-xray (REA + our layers)", p.tool)}${fxRow("REA facts alone", p.rea_only)}${fxRow("plain grep", p.grep)}</table>
<table style="margin-top:14px"><tr><th>clean twin (no planted code)</th><th>false positives</th></tr><tr><td>mcp-xray</td><td class="big">${c.tool.false_positives}</td></tr><tr><td>plain grep</td><td class="big">${c.grep.false_positives}</td></tr></table>
<div class="foot">Planted behaviours missed: mcp-xray ${missedText(p.tool)}; grep ${missedText(p.grep)}. grep's false positives: comments, a help string, RegExp .exec(), an import line, a URL constant.</div></div>
<div class="card" id="real"><h2>${real.length} real MCP server packages from npm</h2>
<table><tr><th>package</th><th>env</th><th>secret?</th><th>not in README</th><th>hosts</th><th>files</th><th>proc</th><th>eval</th></tr>
${real.map((r) => `<tr><td>${esc(r.pkg.replace("@modelcontextprotocol/", "@mcp/"))}</td><td>${r.env}</td><td>${r.secret_env}</td><td>${r.env_not_in_readme + r.hosts_not_in_readme}</td><td>${r.hosts_named}</td><td>${r.file_rw}</td><td>${r.process}</td><td>${r.dynamic}</td></tr>`).join("")}</table>
<div class="foot">"not in README" = env names + hosts the code uses that the README never mentions. Mostly hosting/config knobs. Not a judgement.</div></div>
</div>
<div class="card" style="margin-top:16px" id="vs"><h2>Our layers vs grep on the same files (${real.length} real packages, by location)</h2>
<table><tr><th>found by both</th><th>only our layers</th><th>only grep</th><th>… in comments</th><th>… URL strings</th><th>… regex .exec()</th><th>… localhost</th><th>… real code our layers missed</th></tr>
<tr><td class="big">${totals.both}</td><td class="big">${totals.only_rea}</td><td class="big">${totals.only_grep}</td><td>${totals.only_grep_in_comments}</td><td>${totals.only_grep_url_strings}</td><td>${totals.only_grep_regex_exec}</td><td>${totals.only_grep_localhost}</td><td class="big">${totals.only_grep_real_code_missed_by_rea}</td></tr></table>
<div class="foot">Plainly: on real packages our layers found little grep missed. What they add is precision (no comment/regex hits) and resolved structure; grep reaches more raw lines, including large bundles REA analysed only partially.</div></div>
</div></body></html>`;
}

mkdirSync("reports", { recursive: true });
mkdirSync("results/targets", { recursive: true });
const truth = JSON.parse(readFileSync("fixtures/truth.json", "utf8"));
const fx = measureFixtures(truth);
const real = Object.entries(JSON.parse(readFileSync("targets.json", "utf8"))).map(measureTarget);
const totals = totalsOf(real);
writeFileSync("results/measured.json", JSON.stringify({ fixtures: fx, real, totals }, null, 1));
writeFileSync("reports/index.html", indexPage(fx, real, totals));
const brief = (v) => ({ tool: [v.tool.planted_found, v.tool.planted_total, v.tool.false_positives], rea_only: [v.rea_only.planted_found, v.rea_only.false_positives], grep: [v.grep.planted_found, v.grep.false_positives] });
console.log(JSON.stringify({ fx: Object.fromEntries(Object.entries(fx).map(([k, v]) => [k, brief(v)])), totals }));
