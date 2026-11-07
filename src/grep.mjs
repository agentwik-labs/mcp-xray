// The baseline: what a careful reviewer gets from grep over the same files, line by line.
// It has no idea what is code, comment or string; that is the point of the comparison.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { jsFiles } from "./files.mjs";
import { SECRET_RE, hostOf } from "./facts.mjs";

export const GREP_RULES = {
  env: [/process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g, /process\.env\[\s*["'`]([A-Za-z_][A-Za-z0-9_]*)["'`]\s*\]/g],
  network: [/(https?:\/\/[A-Za-z0-9.-]+)/g, /\b(fetch)\s*\(/g, /\b(https?\.(?:request|get))\s*\(/g, /\b(axios(?:\.\w+)?)\s*\(/g],
  "file-read": [/\b(readFileSync|readFile|createReadStream)\s*\(/g],
  "file-write": [/\b(writeFileSync|writeFile|appendFileSync|appendFile|createWriteStream)\s*\(/g],
  process: [/\b(child_process)\b/g, /\b(execSync|execFileSync|execFile|spawnSync|spawn|exec|fork)\s*\(/g],
  "dynamic-code": [/\b(eval)\s*\(/g, /\b(new\s+Function)\s*\(/g],
};

export function grepFacts(root, files = jsFiles(root)) {
  const out = [];
  for (const file of files) {
    const lines = readFileSync(join(root, file), "utf8").split("\n");
    lines.forEach((text, i) => {
      for (const [category, rules] of Object.entries(GREP_RULES)) {
        const vals = new Set();
        for (const re of rules) for (const m of text.matchAll(re)) vals.add(category === "network" ? hostOf(m[1]) || m[1] : m[1]);
        const t = text.trim(); const comment = /^(\/\/|\/\*|\*)/.test(t); const regexExec = /(\w|\/[gimsuy]*)\.exec\s*\(/.test(text);
        for (const value of vals) out.push({ category, file, line: i + 1, value, comment, regexExec: category === "process" ? regexExec : undefined, secret: category === "env" ? SECRET_RE.test(value) : undefined, layer: "grep" });
      }
    });
  }
  // a network line with both a URL and fetch( counts once
  const seen = new Set();
  return out.filter((f) => { const k = `${f.category}|${f.file}|${f.line}${f.category === "env" ? "|" + f.value : ""}`; if (seen.has(k)) return false; seen.add(k); return true; });
}
