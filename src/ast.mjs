// Our own layer on top of REA, from one @babel/parser pass per file (comments are never matched):
//   - hosts named in string literals (REA names the host a call resolves to, not URLs kept in config objects)
//   - env vars read by destructuring process.env, e.g. `const { GITHUB_TOKEN } = process.env`
import { parse } from "@babel/parser";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hostOf } from "./facts.mjs";

const URL_RE = /\bhttps?:\/\/[A-Za-z0-9.-]+/g;
const SPEC_HOSTS = /^(www\.w3\.org|json-schema\.org)$/;
const PARSE_OPTIONS = {
  sourceType: "unambiguous",
  errorRecovery: true,
  tokens: true,
  allowReturnOutsideFunction: true,
  allowAwaitOutsideFunction: true,
};
const isTypeScript = (file) => /\.(c|m)?ts$/.test(file);

export function parseSource(src, file = "") {
  return parse(src, { ...PARSE_OPTIONS, plugins: isTypeScript(file) ? ["typescript"] : ["jsx"] });
}

export function hostsInTokens(tokens) {
  const out = [];
  for (const t of tokens) {
    const label = t.type?.label;
    if (label !== "string" && label !== "template") continue;
    for (const m of String(t.value ?? "").matchAll(URL_RE)) {
      const host = hostOf(m[0]);
      if (host && host.includes(".") && !SPEC_HOSTS.test(host)) out.push({ host, line: t.loc.start.line });
    }
  }
  return out;
}

const isIdent = (n, name) => n?.type === "Identifier" && n.name === name;
const isEnvKey = (n, computed) => (!computed && isIdent(n, "env")) || (computed && n?.type === "StringLiteral" && n.value === "env");

// process.env, process["env"], process?.env
export function isProcessEnv(n) {
  return (n?.type === "MemberExpression" || n?.type === "OptionalMemberExpression") &&
    isIdent(n.object, "process") && isEnvKey(n.property, n.computed);
}

// The pattern and source of a destructuring: `const P = S`, `P = S`, and a default parameter `(P = S) => ...`
function destructuring(n) {
  if (n.type === "VariableDeclarator") return [n.id, n.init];
  if (n.type === "AssignmentExpression" && n.operator === "=") return [n.left, n.right];
  if (n.type === "AssignmentPattern") return [n.left, n.right];
  return [null, null];
}

function patternKeys(pattern) {
  const keys = [];
  for (const p of pattern.properties) {
    if (p.type !== "ObjectProperty" || p.computed) continue; // `...rest` and computed keys have no static name
    const name = p.key.type === "Identifier" ? p.key.name : p.key.type === "StringLiteral" ? p.key.value : null;
    if (name) keys.push({ name, line: p.key.loc.start.line });
  }
  return keys;
}

export function envDestructures(program) {
  const out = [];
  const stack = [program];
  while (stack.length) {
    const n = stack.pop();
    const [pattern, source] = destructuring(n);
    if (pattern?.type === "ObjectPattern" && isProcessEnv(source)) out.push(...patternKeys(pattern));
    for (const [k, v] of Object.entries(n)) {
      if (k === "loc" || k === "extra" || !v || typeof v !== "object") continue;
      if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === "string") stack.push(c); }
      else if (typeof v.type === "string") stack.push(v);
    }
  }
  return out.sort((a, b) => a.line - b.line);
}

// One parse per file; files that fail to parse are listed, not fatal.
export function astFacts(root, files) {
  const hosts = [], env = [], parseFailures = [];
  for (const file of files) {
    let ast;
    try { ast = parseSource(readFileSync(join(root, file), "utf8"), file); }
    catch { parseFailures.push(file); continue; }
    for (const h of hostsInTokens(ast.tokens)) hosts.push({ ...h, file });
    for (const e of envDestructures(ast.program)) env.push({ ...e, file });
  }
  return { hosts, env, parseFailures };
}
