// One package directory in, one report object out.
import { basename } from "node:path";
import { runRea, REA_VERSION } from "./rea.mjs";
import { extractFacts, sortFacts, CATEGORIES, SECRET_RE } from "./facts.mjs";
import { grepFacts } from "./grep.mjs";
import { readmeClaims, hostDocumented } from "./readme.mjs";
import { jsFiles } from "./files.mjs";
import { astFacts } from "./ast.mjs";

const factKey = (f) => `${f.category}|${f.file}|${f.line}`;

// Env reads by destructuring, which REA's facts do not lift (see src/ast.mjs). Skips any REA already reported.
function destructuredEnvFacts(astEnv, facts) {
  const have = new Set(facts.filter((f) => f.category === "env").map((f) => `${factKey(f)}|${f.value}`));
  return astEnv
    .map((e) => ({ category: "env", file: e.file, line: e.line, value: e.name, secret: SECRET_RE.test(e.name), layer: "ast" }))
    .filter((f) => !have.has(`${factKey(f)}|${f.value}`));
}

// Hosts named in string literals, one entry per host with its first location and a count.
function namedHosts(hosts, claims) {
  const byHost = new Map();
  for (const h of hosts) {
    if (!byHost.has(h.host)) byHost.set(h.host, { host: h.host, where: `${h.file}:${h.line}`, count: 0, documented: hostDocumented(h.host, claims) });
    byHost.get(h.host).count++;
  }
  return [...byHost.values()].sort((a, b) => b.count - a.count);
}

export function analyze(root, { cache } = {}) {
  const files = jsFiles(root);
  const fileSet = new Set(files);
  const rea = extractFacts(runRea(root, { cache }), root);
  const ast = astFacts(root, files);
  const reaFacts = rea.facts.filter((f) => fileSet.has(f.file));
  const facts = sortFacts([...reaFacts, ...destructuredEnvFacts(ast.env, reaFacts)]);

  const t0 = Date.now();
  const grep = grepFacts(root, files);
  const grep_ms = Date.now() - t0;

  const claims = readmeClaims(root);
  for (const f of facts) {
    if (f.category === "env") f.documented = claims.env.has(f.value);
    if (f.category === "network") f.documented = hostDocumented(f.value, claims);
  }
  const pkg = claims.pkg;
  return {
    name: pkg.name || basename(root), version: pkg.version || null, description: pkg.description || "",
    analysed_at: new Date().toISOString(), rea_version: REA_VERSION,
    js_files: files.length, coverage: rea.coverage, rea_ms: rea.rea_ms, grep_ms, readme: claims.readme,
    ast_parse_failures: ast.parseFailures,
    facts, grep, hosts_in_strings: namedHosts(ast.hosts, claims),
    summary: Object.fromEntries(CATEGORIES.map((c) => [c, facts.filter((f) => f.category === c).length])),
  };
}

// Our layers vs grep, matched by location (category + file + line)
export function compare(rep) {
  const keysOf = (fs) => new Set(fs.map(factKey));
  const ours = keysOf(rep.facts);
  const grepKeys = keysOf(rep.grep);
  const onlyGrep = rep.grep.filter((f) => !ours.has(factKey(f)));
  const onlyGrepKeys = keysOf(onlyGrep);
  const inComment = keysOf(onlyGrep.filter((f) => f.comment));
  const code = onlyGrep.filter((f) => !f.comment);
  const urlOnly = keysOf(code.filter((f) => f.category === "network" && /\./.test(f.value) && !/^https?\./.test(f.value)));
  return {
    both: [...ours].filter((k) => grepKeys.has(k)).length,
    only_rea: [...ours].filter((k) => !grepKeys.has(k)).length,
    only_grep: onlyGrepKeys.size,
    only_grep_in_comments: inComment.size,
    only_grep_url_strings: [...urlOnly].filter((k) => !inComment.has(k)).length,
    only_grep_regex_exec: keysOf(code.filter((f) => f.value === "exec" && f.regexExec)).size,
    only_grep_localhost: keysOf(code.filter((f) => /^(localhost|127\.0\.0\.1)$/.test(f.value))).size,
    only_grep_other: [...onlyGrepKeys].filter((k) => !inComment.has(k) && !urlOnly.has(k)).length,
  };
}
