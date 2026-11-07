// One package directory in, one report object out.
import { runRea, REA_VERSION } from "./rea.mjs";
import { extractFacts, CATEGORIES } from "./facts.mjs";
import { grepFacts } from "./grep.mjs";
import { readmeClaims, hostDocumented } from "./readme.mjs";
import { jsFiles } from "./files.mjs";
import { hostsInStrings } from "./strings.mjs";

export function analyze(root, { cache } = {}) {
  const files = jsFiles(root);
  const ev = runRea(root, { cache });
  const fileSet = new Set(files);
  const x = extractFacts(ev, root);
  const { coverage, rea_ms } = x;
  const facts = x.facts.filter((f) => fileSet.has(f.file));
  const t0 = Date.now();
  const grep = grepFacts(root, files);
  const grep_ms = Date.now() - t0;
  const claims = readmeClaims(root);
  const strHosts = hostsInStrings(root, files).filter((h) => h.host);
  const named = new Map();
  for (const h of strHosts) { if (!named.has(h.host)) named.set(h.host, { host: h.host, where: `${h.file}:${h.line}`, count: 0, documented: hostDocumented(h.host, claims) }); named.get(h.host).count++; }
  for (const f of facts) {
    if (f.category === "env") f.documented = claims.env.has(f.value);
    if (f.category === "network") f.documented = hostDocumented(f.value, claims);
  }
  const pkg = claims.pkg;
  return {
    name: pkg.name || root.split("/").pop(), version: pkg.version || null, description: pkg.description || "",
    analysed_at: new Date().toISOString(), rea_version: REA_VERSION,
    js_files: files.length, coverage, rea_ms, grep_ms, readme: claims.readme,
    facts, grep, hosts_in_strings: [...named.values()].sort((a, b) => b.count - a.count),
    summary: Object.fromEntries(CATEGORIES.map((c) => [c, facts.filter((f) => f.category === c).length])),
  };
}

// REA-layer vs grep, by location (category + file + line)
export function compare(rep) {
  const k = (f) => `${f.category}|${f.file}|${f.line}`;
  const a = new Set(rep.facts.map(k)), b = new Set(rep.grep.map(k));
  const og = rep.grep.filter((f) => !a.has(k(f)));
  const ogk = new Set(og.map(k));
  const inComment = new Set(og.filter((f) => f.comment).map(k));
  const urlOnly = new Set(og.filter((f) => !f.comment && f.category === "network" && /\./.test(f.value) && !/^https?\./.test(f.value)).map(k));
  return { both: [...a].filter((x) => b.has(x)).length, only_rea: [...a].filter((x) => !b.has(x)).length, only_grep: ogk.size,
    only_grep_in_comments: inComment.size, only_grep_url_strings: [...urlOnly].filter((x) => !inComment.has(x)).length,
    only_grep_regex_exec: new Set(og.filter((f) => !f.comment && f.value === "exec" && f.regexExec).map(k)).size,
    only_grep_localhost: new Set(og.filter((f) => !f.comment && /^(localhost|127\.0\.0\.1)$/.test(f.value)).map(k)).size,
    only_grep_other: [...ogk].filter((x) => !inComment.has(x) && !urlOnly.has(x)).length };
}
