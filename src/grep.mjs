// The baseline: what a careful reviewer gets from grep over the same files, line by line.
// It has no idea what is code, comment or string; that is the point of the comparison.
// These rules are kept as first measured, so the comparison stays fixed.
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

const COMMENT_LINE = /^(\/\/|\/\*|\*)/;
const REGEX_EXEC = /(\w|\/[gimsuy]*)\.exec\s*\(/;

function grepLine(text, file, line) {
  const out = [];
  const comment = COMMENT_LINE.test(text.trim());
  const regexExec = REGEX_EXEC.test(text);
  for (const [category, rules] of Object.entries(GREP_RULES)) {
    const values = new Set();
    for (const re of rules) for (const m of text.matchAll(re)) values.add(category === "network" ? hostOf(m[1]) || m[1] : m[1]);
    for (const value of values) {
      out.push({
        category, file, line, value, comment,
        regexExec: category === "process" ? regexExec : undefined,
        secret: category === "env" ? SECRET_RE.test(value) : undefined,
        layer: "grep",
      });
    }
  }
  return out;
}

export function grepFacts(root, files = jsFiles(root)) {
  const out = [];
  for (const file of files) {
    readFileSync(join(root, file), "utf8").split("\n").forEach((text, i) => out.push(...grepLine(text, file, i + 1)));
  }
  // one hit per location (a line with both a URL and fetch( counts once); env keeps one per name
  const seen = new Set();
  return out.filter((f) => {
    const k = `${f.category}|${f.file}|${f.line}` + (f.category === "env" ? `|${f.value}` : "");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
