// Hosts named in code string literals (not comments), via @babel/parser tokens. Our layer, not REA's:
// REA's graph names the hosts a call site resolves to, but not URL strings kept in config objects.
import { parse } from "@babel/parser";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hostOf } from "./facts.mjs";
const URL_RE = /\bhttps?:\/\/[A-Za-z0-9.-]+/g;
export function hostsInStrings(root, files) {
  const out = [];
  for (const file of files) {
    const src = readFileSync(join(root, file), "utf8");
    let toks;
    try { toks = parse(src, { sourceType: "unambiguous", errorRecovery: true, tokens: true, allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true, plugins: ["jsx"] }).tokens; }
    catch { out.push({ file, error: "parse failed" }); continue; }
    for (const t of toks) {
      const label = t.type?.label;
      if (label !== "string" && label !== "template") continue;
      const v = String(t.value ?? "");
      for (const m of v.matchAll(URL_RE)) { const host = hostOf(m[0]); if (host && host.includes(".") && !/^(www\.w3\.org|json-schema\.org)$/.test(host)) out.push({ host, file, line: t.loc.start.line }); }
    }
  }
  return out;
}
