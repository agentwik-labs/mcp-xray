// Turns REA Evidence into a list of behaviours: env vars read, network calls, files read/written,
// child processes, dynamic code. Two layers, both labelled on every finding:
//   "rea"        a fact REA reports directly (environment config sources, file config sources, requests, endpoints)
//   "rea-site"   a REA call site (exact AST range, so comments and strings never match) that our small
//                classifier names by its callee, gated on the imports REA recorded for that file.
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
const FS_MODS = /^(node:)?(fs|fs\/promises)$|^(fs-extra|graceful-fs|jsonfile)$/;
const PROC_MODS = /^(node:)?child_process$|^(execa|cross-spawn)$/;
const VM_MODS = /^(node:)?vm$/;

const lineStarts = (src) => { const s = [0]; for (let i = 0; i < src.length; i++) if (src[i] === "\n") s.push(i + 1); return s; };
const sliceRange = (file, r) => {
  const a = file.ls[r.start.line - 1] + r.start.column, b = file.ls[r.end.line - 1] + r.end.column;
  return file.src.slice(a, Math.min(b, a + 600));
};
const CALLEE_RE = /^\s*(new\s+)?((?:[A-Za-z_$][\w$]*)(?:\s*\??\.\s*[A-Za-z_$][\w$]*)*)\s*(?:\?\.)?\(/;

// Literal-ish argument summary for file calls: homedir() + string parts -> "~/.aws/credentials"
function pathHint(text) {
  const home = /homedir\(\)|os\.homedir|process\.env\.HOME|USERPROFILE/.test(text);
  const parts = [...text.matchAll(/["'`]([^"'`$\n]{1,80})["'`]/g)].map((m) => m[1]).filter((p) => /^[\w.\-\/~]+$/.test(p) && !/^(utf-?8|ascii|base64|hex|latin1)$/i.test(p));
  const tpl = text.match(/`\$\{[^}]*homedir\(\)\}([^`]*)`/);
  if (tpl) return "~" + tpl[1];
  if (home && parts.length) return "~/" + parts.join("/").replace(/^\/+/, "");
  return parts.length ? parts[0] : null;
}

function resolveIdent(file, ident) {
  const m = file.src.match(new RegExp(`(?:const|let|var)\\s+${ident.replace(/\$/g, "\\$")}\\s*=\\s*["'\`]([^"'\`]+)["'\`]`));
  return m ? m[1] : null;
}
export function hostOf(v) {
  if (!v) return null;
  const m = String(v).match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#:"'`\s]+)/i);
  if (m) return m[1].toLowerCase();
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(v)) return v.toLowerCase();
  return null;
}

export function extractFacts(ev, root) {
  const n = ev.normalized_result;
  const g = n.graph, sg = n.semantic_graph;
  const files = new Map();
  const getFile = (p) => {
    if (!files.has(p)) { let src = ""; try { src = readFileSync(join(root, p), "utf8"); } catch {} files.set(p, { src, ls: lineStarts(src) }); }
    return files.get(p);
  };
  // imports per file, from REA's graph edges
  const byId = new Map(g.nodes.map((x) => [x.node_id, x]));
  const imports = new Map();
  for (const e of g.edges) {
    if (e.relation !== "imports") continue;
    const s = byId.get(e.source_node_id), t = byId.get(e.target_node_id);
    const sk = s?.identity?.key, tk = t?.identity?.key;
    if (!sk || !tk) continue;
    const path = sk.slice(sk.indexOf(":") + 1);
    if (!imports.has(path)) imports.set(path, new Set());
    const spec = tk.replace(/^(external|static-import|require|dynamic-import|import):/, "");
    imports.get(path).add(spec);
  }
  const has = (path, re) => [...(imports.get(path) || [])].some((s) => re.test(s));
  const dynRequire = (path) => [...(imports.get(path) || [])].some((s) => /^require\(/.test(s) && !/^require\(["'][^"']+["']\)$/.test(s));

  const out = [];
  const add = (f) => out.push(f);
  const loc = (x) => x.identity?.source_range?.start?.line ?? null;

  for (const x of sg.nodes) {
    const file = x.identity?.module_path;
    if (!file) continue;
    if (x.kind === "config-source" && x.properties?.source_kind === "environment" && x.properties.key) {
      add({ category: "env", file, line: loc(x), value: x.properties.key, secret: SECRET_RE.test(x.properties.key), layer: "rea" });
    } else if (x.kind === "expression" && x.properties?.operation_kind === "read" && x.properties.property_path?.[0] === "env" && x.properties.property_path.length === 2 && x.identity.source_range) {
      // REA's member-read expression process.env.KEY (it does not always lift these to config sources)
      const f = getFile(file);
      if (/^\s*process\s*\.\s*env\b/.test(sliceRange(f, x.identity.source_range))) { const key = x.properties.property_path[1]; add({ category: "env", file, line: loc(x), value: key, secret: SECRET_RE.test(key), layer: "rea" }); }
    } else if (x.kind === "config-source" && x.properties?.source_kind === "file") {
      const f = getFile(file); const t = x.identity.source_range ? sliceRange(f, x.identity.source_range) : "";
      add({ category: "file-read", file, line: loc(x), value: pathHint(t), layer: "rea" });
    } else if (x.kind === "request") {
      let ep = x.properties?.endpoint || null;
      const f = getFile(file); const t = x.identity.source_range ? sliceRange(f, x.identity.source_range) : "";
      let resolved = "rea";
      if (!hostOf(ep)) {
        const lead = t.match(/\(\s*`\$\{([A-Za-z_$][\w$]*)\}/) || t.match(/\(\s*([A-Za-z_$][\w$]*)\s*[,)]/) || t.match(/hostname\s*:\s*([A-Za-z_$][\w$]*)/);
        const lit = t.match(/hostname\s*:\s*["'`]([^"'`]+)["'`]/);
        const v = lit ? lit[1] : lead ? resolveIdent(f, lead[1]) : null;
        if (hostOf(v)) { ep = v; resolved = "rea-site"; }
      }
      add({ category: "network", file, line: loc(x), value: hostOf(ep) || "(host not static)", url: ep, method: x.properties?.method, layer: resolved });
    } else if (x.kind === "call-site" && x.identity.source_range) {
      const f = getFile(file);
      const t = sliceRange(f, x.identity.source_range);
      const m = t.match(CALLEE_RE);
      if (!m) continue;
      const isNew = !!m[1], callee = m[2].replace(/\s+/g, ""), last = callee.split(/\??\./).pop();
      const line = loc(x);
      if (!isNew && callee === "eval") add({ category: "dynamic-code", file, line, value: "eval", layer: "rea-site" });
      else if (isNew && (callee === "Function" || callee === "globalThis.Function")) add({ category: "dynamic-code", file, line, value: "new Function", layer: "rea-site" });
      else if (/^(runInNewContext|runInThisContext|runInContext|compileFunction)$/.test(last) && has(file, VM_MODS)) add({ category: "dynamic-code", file, line, value: "vm." + last, layer: "rea-site" });
      else if (PROC.has(last) && (has(file, PROC_MODS) || dynRequire(file))) {
        const arg = t.match(/\(\s*["'`]([^"'`]{1,60})["'`]/);
        add({ category: "process", file, line, value: last + (arg ? ` ${arg[1]}` : ""), layer: "rea-site" });
      } else if (READ.has(last) && has(file, FS_MODS)) add({ category: "file-read", file, line, value: pathHint(t.slice(m[0].length)), layer: "rea-site" });
      else if (WRITE.has(last) && has(file, FS_MODS)) add({ category: "file-write", file, line, value: pathHint(t.slice(m[0].length)), layer: "rea-site" });
    }
  }
  // REA application-graph endpoints that are outbound calls (fetch, http/https, axios-style clients, absolute URLs)
  for (const x of g.nodes) {
    if (x.kind !== "endpoint") continue;
    for (const o of x.observations || []) {
      const p = o.properties || {}; const lv = o.evidence?.location?.value || {};
      if (p.endpoint_kind !== "network") continue;
      const mech = String(p.mechanism || "");
      const abs = hostOf(p.value);
      if (!(abs || /^call:(fetch|https?\.|axios|got|undici|ky|needle|superagent)|\.http\.(get|post|put|patch|delete|request)$|^call:request$/.test(mech))) continue;
      const file = lv.path || lv.source; const line = lv.start?.line ?? lv.range?.start?.line ?? null;
      if (!file) continue;
      add({ category: "network", file, line, value: abs || "(host not static)", url: p.value, method: mech.replace(/^call:/, ""), layer: "rea" });
    }
  }
  // de-duplicate (REA can emit nested call sites for one line)
  const seen = new Set();
  out.sort((a, b) => (a.value?.startsWith?.("(") ? 1 : 0) - (b.value?.startsWith?.("(") ? 1 : 0)); // resolved hosts first
  const facts = out.filter((f) => { const k = f.category === "network" ? `${f.category}|${f.file}|${f.line}` : `${f.category}|${f.file}|${f.line}|${f.value}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .map((f) => ({ ...f, sensitive: f.category.startsWith("file") && f.value ? SENSITIVE_PATH_RE.test(f.value) || PERSIST_PATH_RE.test(f.value) : undefined }));
  facts.sort((a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) || a.file.localeCompare(b.file) || a.line - b.line);
  return {
    facts,
    coverage: { status: sg.coverage?.status ?? g.coverage?.status, truncated: !!(sg.coverage?.truncated || g.coverage?.truncated), parsed_files: n.statistics.parsed_javascript_files, parse_failures: n.statistics.parse_failures, skipped_files: n.statistics.skipped_javascript_files },
    rea_ms: ev.__ms,
  };
}
