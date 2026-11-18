// Turns REA Evidence into a list of behaviours: env vars read, network calls, files read/written,
// child processes, dynamic code. Two layers, both labelled on every finding:
//   "rea"        a fact REA reports directly (environment config sources, file config sources, requests, endpoints)
//   "rea-site"   a REA call site (exact AST range, so comments and strings never match) that our small
//                classifier names by its callee, gated on the imports REA recorded for that file.
// (A third layer, "ast", is added in analyze.mjs from src/ast.mjs.)
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const CATEGORIES = ["env", "network", "file-read", "file-write", "process", "dynamic-code"];
const SECRET_NAME = /(API_?KEY|_KEY$|^KEY$|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?$|PRIVATE_KEY|COOKIE|_PAT$)/i;
const NOT_SECRET = /(_URL|_TTL|_MS|_ENABLED|_ENFORCEMENT|_VALIDATION|_PASSTHROUGH|_ONLY|_AUDIENCES?|_ISSUER|_PATH|_FILE|_DIR)$/i;
export const SECRET_RE = { test: (k) => SECRET_NAME.test(k) && !NOT_SECRET.test(k) };
export const SENSITIVE_PATH_RE = /(\.ssh|\.aws|\.npmrc|\.netrc|\.kube|\.docker\/config|\.gnupg|gcloud|\.git-credentials|Keychains|\.env\b|id_rsa|id_ed25519)/;
export const PERSIST_PATH_RE = /(\.zshrc|\.bashrc|\.bash_profile|\.profile|LaunchAgents|crontab|autostart|Startup)/;

const PROC = new Set(["exec", "execSync", "execFile", "execFileSync", "spawn", "spawnSync", "fork", "execa", "execaSync", "execaCommand", "crossSpawn"]);
const READ = new Set(["readFile", "readFileSync", "createReadStream", "readJson", "readJsonSync", "readJSON"]);
const WRITE = new Set(["writeFile", "writeFileSync", "appendFile", "appendFileSync", "createWriteStream", "outputFile", "outputFileSync", "writeJson", "writeJsonSync", "outputJson"]);
const VM_CALLS = /^(runInNewContext|runInThisContext|runInContext|compileFunction)$/;
const FS_MODS = /^(node:)?(fs|fs\/promises)$|^(fs-extra|graceful-fs|jsonfile)$/;
const PROC_MODS = /^(node:)?child_process$|^(execa|cross-spawn)$/;
const VM_MODS = /^(node:)?vm$/;
const NETWORK_MECHANISM = /^call:(fetch|https?\.|axios|got|undici|ky|needle|superagent)|\.http\.(get|post|put|patch|delete|request)$|^call:request$/;
const CALLEE_RE = /^\s*(new\s+)?((?:[A-Za-z_$][\w$]*)(?:\s*\??\.\s*[A-Za-z_$][\w$]*)*)\s*(?:\?\.)?\(/;
const TLD = /\.(com|net|org|io|dev|app|ai|co|test|me|so|sh|ly|gg|us|uk|de|fr|jp|cn|ru|edu|gov|info|biz|cloud|xyz|tech|site|page|ms|to|tv|fm|run|eu|in|ca|au|nl|se|ch)$/i;
const MAX_SLICE = 600;

// Host of an http(s)/ws(s) URL, or of a bare domain with a known TLD; null otherwise.
export function hostOf(v) {
  if (!v) return null;
  const m = String(v).match(/^(?:https?|wss?):\/\/(?:[^@/?#\s"'`]*@)?([^/?#:"'`\s@]+)/i);
  if (m) return /^[a-z0-9.-]+$/i.test(m[1]) ? m[1].toLowerCase() : null;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(v) && TLD.test(v)) return v.toLowerCase();
  return null;
}

// Literal-ish argument summary for file calls: homedir() + string parts -> "~/.aws/credentials"
export function pathHint(text) {
  const home = /homedir\(\)|os\.homedir|process\.env\.HOME|USERPROFILE/.test(text);
  const parts = [...text.matchAll(/["'`]([^"'`$\n]{1,80})["'`]/g)]
    .map((m) => m[1])
    .filter((p) => /^[\w.\-\/~]+$/.test(p) && !/^(utf-?8|ascii|base64|hex|latin1)$/i.test(p));
  const tpl = text.match(/`\$\{[^}]*homedir\(\)\}([^`]*)`/);
  if (tpl) return "~" + tpl[1];
  if (home && parts.length) return "~/" + parts.join("/").replace(/^\/+/, "");
  return parts.length ? parts[0] : null;
}

// Value of `const|let|var NAME = "literal"` anywhere in the file (first match).
function resolveIdent(src, ident) {
  const m = src.match(new RegExp(`(?:const|let|var)\\s+${ident.replace(/\$/g, "\\$")}\\s*=\\s*["'\`]([^"'\`]+)["'\`]`));
  return m ? m[1] : null;
}

const lineStarts = (src) => {
  const s = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") s.push(i + 1);
  return s;
};

// Source text cache keyed by module path, and the text under a REA source range (capped).
function sourceReader(root) {
  const files = new Map();
  const get = (path) => {
    if (!files.has(path)) {
      let src = "";
      try { src = readFileSync(join(root, path), "utf8"); } catch { /* file REA saw but we cannot read: no text */ }
      files.set(path, { src, ls: lineStarts(src) });
    }
    return files.get(path);
  };
  const slice = (path, r) => {
    if (!r) return "";
    const f = get(path);
    const a = f.ls[r.start.line - 1] + r.start.column, b = f.ls[r.end.line - 1] + r.end.column;
    return f.src.slice(a, Math.min(b, a + MAX_SLICE));
  };
  return { get, slice };
}

// Module specifiers imported per file, from REA's application-graph "imports" edges.
function importsByFile(graph) {
  const byId = new Map(graph.nodes.map((x) => [x.node_id, x]));
  const imports = new Map();
  for (const e of graph.edges) {
    if (e.relation !== "imports") continue;
    const sk = byId.get(e.source_node_id)?.identity?.key, tk = byId.get(e.target_node_id)?.identity?.key;
    if (!sk || !tk) continue;
    const path = sk.slice(sk.indexOf(":") + 1);
    if (!imports.has(path)) imports.set(path, new Set());
    imports.get(path).add(tk.replace(/^(external|static-import|require|dynamic-import|import):/, ""));
  }
  const specs = (path) => [...(imports.get(path) || [])];
  return {
    has: (path, re) => specs(path).some((s) => re.test(s)),
    // require(<computed>), e.g. require("child_" + "process")
    dynamicRequire: (path) => specs(path).some((s) => /^require\(/.test(s) && !/^require\(["'][^"']+["']\)$/.test(s)),
  };
}

// Host of a request whose endpoint REA left unresolved: a `hostname:` literal, or a leading identifier bound to a literal.
function resolveRequestHost(text, src) {
  const lit = text.match(/hostname\s*:\s*["'`]([^"'`]+)["'`]/);
  if (lit) return lit[1];
  const lead = text.match(/\(\s*`\$\{([A-Za-z_$][\w$]*)\}/) || text.match(/\(\s*([A-Za-z_$][\w$]*)\s*[,)]/) || text.match(/hostname\s*:\s*([A-Za-z_$][\w$]*)/);
  return lead ? resolveIdent(src, lead[1]) : null;
}

// Names one call site by its callee, gated on the file's imports. Returns a fact or null.
export function classifyCall(text, { file, line, has, dynamicRequire }) {
  const m = text.match(CALLEE_RE);
  if (!m) return null;
  const isNew = !!m[1], callee = m[2].replace(/\s+/g, ""), last = callee.split(/\??\./).pop();
  const fact = (category, value) => ({ category, file, line, value, layer: "rea-site" });
  const args = text.slice(m[0].length);
  if (!isNew && callee === "eval") return fact("dynamic-code", "eval");
  if (isNew && (callee === "Function" || callee === "globalThis.Function")) return fact("dynamic-code", "new Function");
  if (VM_CALLS.test(last) && has(file, VM_MODS)) return fact("dynamic-code", "vm." + last);
  if (PROC.has(last) && (has(file, PROC_MODS) || dynamicRequire(file))) {
    const arg = text.match(/\(\s*["'`]([^"'`]{1,60})["'`]/);
    return fact("process", last + (arg ? ` ${arg[1]}` : ""));
  }
  if (READ.has(last) && has(file, FS_MODS)) return fact("file-read", pathHint(args));
  if (WRITE.has(last) && has(file, FS_MODS)) return fact("file-write", pathHint(args));
  return null;
}

function semanticFacts(sg, src, imports) {
  const out = [];
  const loc = (x) => x.identity?.source_range?.start?.line ?? null;
  for (const x of sg.nodes) {
    const file = x.identity?.module_path;
    if (!file) continue;
    const p = x.properties || {}, range = x.identity.source_range, line = loc(x);
    if (x.kind === "config-source" && p.source_kind === "environment" && p.key) {
      out.push({ category: "env", file, line, value: p.key, secret: SECRET_RE.test(p.key), layer: "rea" });
    } else if (x.kind === "expression" && p.operation_kind === "read" && p.property_path?.[0] === "env" && p.property_path.length >= 2 && range) {
      // REA's member read process.env.KEY, also as the head of a longer chain like process.env.KEY?.trim()
      // (REA does not always lift these to config sources)
      if (/^\s*process\s*\.\s*env\b/.test(src.slice(file, range))) {
        const key = p.property_path[1];
        out.push({ category: "env", file, line, value: key, secret: SECRET_RE.test(key), layer: "rea" });
      }
    } else if (x.kind === "config-source" && p.source_kind === "file") {
      out.push({ category: "file-read", file, line, value: pathHint(src.slice(file, range)), layer: "rea" });
    } else if (x.kind === "request") {
      let ep = p.endpoint || null, layer = "rea";
      if (!hostOf(ep)) {
        const v = resolveRequestHost(src.slice(file, range), src.get(file).src);
        if (hostOf(v)) { ep = v; layer = "rea-site"; }
      }
      out.push({ category: "network", file, line, value: hostOf(ep) || "(host not static)", url: ep, method: p.method, layer });
    } else if (x.kind === "call-site" && range) {
      const f = classifyCall(src.slice(file, range), { file, line, ...imports });
      if (f) out.push(f);
    }
  }
  return out;
}

// Application-graph endpoints that are outbound calls (fetch, http/https, axios-style clients, absolute URLs).
function endpointFacts(graph) {
  const out = [];
  for (const x of graph.nodes) {
    if (x.kind !== "endpoint") continue;
    for (const o of x.observations || []) {
      const p = o.properties || {}, lv = o.evidence?.location?.value || {};
      if (p.endpoint_kind !== "network") continue;
      const mech = String(p.mechanism || ""), abs = hostOf(p.value);
      if (!abs && !NETWORK_MECHANISM.test(mech)) continue;
      const file = lv.path || lv.source;
      if (!file) continue;
      const line = lv.start?.line ?? lv.range?.start?.line ?? null;
      out.push({ category: "network", file, line, value: abs || "(host not static)", url: p.value, method: mech.replace(/^call:/, ""), layer: "rea" });
    }
  }
  return out;
}

export function sortFacts(facts) {
  return facts.sort((a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) || a.file.localeCompare(b.file) || a.line - b.line);
}

// One finding per location (REA can emit nested call sites for one line); a network call with a resolved host wins.
function dedupe(facts) {
  const unresolvedLast = (f) => (f.value?.startsWith?.("(") ? 1 : 0);
  const key = (f) => `${f.category}|${f.file}|${f.line}` + (f.category === "network" ? "" : `|${f.value}`);
  const seen = new Set();
  return [...facts].sort((a, b) => unresolvedLast(a) - unresolvedLast(b)).filter((f) => {
    const k = key(f);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const markSensitive = (f) => ({
  ...f,
  sensitive: f.category.startsWith("file") && f.value ? SENSITIVE_PATH_RE.test(f.value) || PERSIST_PATH_RE.test(f.value) : undefined,
});

export function extractFacts(ev, root) {
  const n = ev.normalized_result;
  const graph = n.graph, sg = n.semantic_graph;
  const raw = [...semanticFacts(sg, sourceReader(root), importsByFile(graph)), ...endpointFacts(graph)];
  return {
    facts: sortFacts(dedupe(raw).map(markSensitive)),
    coverage: {
      status: sg.coverage?.status ?? graph.coverage?.status,
      truncated: !!(sg.coverage?.truncated || graph.coverage?.truncated),
      parsed_files: n.statistics.parsed_javascript_files,
      parse_failures: n.statistics.parse_failures,
      skipped_files: n.statistics.skipped_javascript_files,
    },
    rea_ms: ev.__ms,
  };
}
