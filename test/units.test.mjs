// Unit tests for the pieces of core logic that do not need REA.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSource, envDestructures, hostsInTokens, isProcessEnv } from "../src/ast.mjs";
import { hostOf, pathHint, classifyCall, SECRET_RE } from "../src/facts.mjs";
import { grepFacts } from "../src/grep.mjs";
import { jsFiles } from "../src/files.mjs";
import { score } from "../src/score.mjs";
import { compare } from "../src/analyze.mjs";
import { packageId } from "../src/targets.mjs";

const envNames = (src, file) => envDestructures(parseSource(src, file).program).map((e) => `${e.name}@${e.line}`);

test("env destructuring: the shapes that read process.env", () => {
  const src = [
    "const { A_TOKEN } = process.env;",
    "const {",
    "  B_KEY,",
    '  C_SECRET: renamed = "x;y",',
    "} = process.env;",
    "let D; ({ D_SET } = process.env);",
    "function f({ E_PARAM } = process.env) {}",
    'const { "F_QUOTED": q } = process["env"];',
    "const { G_OPT } = process?.env;",
  ].join("\n");
  assert.deepEqual(envNames(src), ["A_TOKEN@1", "B_KEY@3", "C_SECRET@4", "D_SET@6", "E_PARAM@7", "F_QUOTED@8", "G_OPT@9"]);
});

test("env destructuring: not process.env, rest elements, computed keys and comments are ignored", () => {
  const src = [
    "const { NOT_ENV } = config.env;",
    "const { env } = process;",
    "const { [key]: v, ...rest } = process.env;",
    "// const { IN_COMMENT } = process.env;",
    'const s = "const { IN_STRING } = process.env";',
  ].join("\n");
  assert.deepEqual(envNames(src), []);
});

test("env destructuring: TypeScript sources parse", () => {
  assert.deepEqual(envNames("const { TS_TOKEN }: { TS_TOKEN?: string } = process.env;", "a.ts"), ["TS_TOKEN@1"]);
});

test("isProcessEnv", () => {
  const expr = (code) => parseSource(`(${code});`).program.body[0].expression;
  assert.equal(isProcessEnv(expr("process.env")), true);
  assert.equal(isProcessEnv(expr("other.env")), false);
  assert.equal(isProcessEnv(expr("process.envx")), false);
  assert.equal(isProcessEnv(expr("process[env]")), false);
});

test("hosts in string literals, not comments", () => {
  const ast = parseSource('// https://in-comment.example.com\nconst a = "https://api.example.com/v1";\nconst b = `wss://x.io`; const c = "https://www.w3.org/x";');
  assert.deepEqual(hostsInTokens(ast.tokens), [{ host: "api.example.com", line: 2 }]);
});

test("hostOf", () => {
  assert.equal(hostOf("https://user:pw@API.Example.com:8080/path"), "api.example.com");
  assert.equal(hostOf("wss://stream.example.io"), "stream.example.io");
  assert.equal(hostOf("api.example.com"), "api.example.com");
  assert.equal(hostOf("config.json"), null);
  assert.equal(hostOf("ftp://files.example.com"), null);
  assert.equal(hostOf("https://${host}/x"), null);
  assert.equal(hostOf(null), null);
});

test("pathHint names home-relative paths", () => {
  assert.equal(pathHint('(path.join(os.homedir(), ".aws", "credentials"), "utf8")'), "~/.aws/credentials");
  assert.equal(pathHint("(`${os.homedir()}/.ssh/id_rsa`)"), "~/.ssh/id_rsa");
  assert.equal(pathHint('("notes.json", "utf8")'), "notes.json");
  assert.equal(pathHint("(p)"), null);
});

test("call-site classifier is gated on imports", () => {
  const ctx = (mods, dyn = false) => ({ file: "a.js", line: 1, has: (_, re) => mods.some((m) => re.test(m)), dynamicRequire: () => dyn });
  assert.equal(classifyCall("re.exec(text)", ctx([])), null, "RegExp .exec without child_process");
  assert.deepEqual(classifyCall('execSync("whoami")', ctx(["node:child_process"])).value, "execSync whoami");
  assert.equal(classifyCall('cp.spawn("sh", [])', ctx([], true)).category, "process", "computed require counts");
  assert.equal(classifyCall("eval(x)", ctx([])).value, "eval");
  assert.equal(classifyCall('new Function("a", b)', ctx([])).value, "new Function");
  assert.equal(classifyCall("vm.runInNewContext(code)", ctx(["vm"])).value, "vm.runInNewContext");
  assert.equal(classifyCall('fs.readFileSync("a.json")', ctx(["fs"])).category, "file-read");
  assert.equal(classifyCall('fs.readFileSync("a.json")', ctx([])), null, "no fs import");
  assert.equal(classifyCall('writeFile("out.txt", d)', ctx(["fs/promises"])).category, "file-write");
});

test("secret-looking env names", () => {
  for (const k of ["GITHUB_TOKEN", "OPENAI_API_KEY", "AWS_SECRET_ACCESS_KEY", "DB_PASSWORD", "GH_PAT"]) assert.equal(SECRET_RE.test(k), true, k);
  for (const k of ["LOG_LEVEL", "TOKEN_URL", "SECRET_FILE", "API_KEY_PATH", "PORT"]) assert.equal(SECRET_RE.test(k), false, k);
});

test("grep baseline marks comment lines and dedupes per location", () => {
  const dir = mkdtempSync(join(tmpdir(), "mcpx-grep-"));
  writeFileSync(join(dir, "a.js"), '// eval(x)\nfetch("https://api.example.com")\nconst a = process.env.A, b = process.env.B;\n');
  const g = grepFacts(dir, ["a.js"]);
  rmSync(dir, { recursive: true, force: true });
  assert.deepEqual(g.map((f) => `${f.category}:${f.line}:${f.value}:${f.comment}`), [
    "dynamic-code:1:eval:true", "network:2:api.example.com:false", "env:3:A:false", "env:3:B:false",
  ]);
});

test("jsFiles: sources only, no tests, type declarations or symlinks", () => {
  const dir = mkdtempSync(join(tmpdir(), "mcpx-files-"));
  for (const d of ["dist", "test", "node_modules/x"]) mkdirSync(join(dir, d), { recursive: true });
  for (const f of ["dist/a.js", "dist/b.mjs", "dist/c.ts", "dist/c.d.ts", "dist/a.test.js", "test/t.js", "node_modules/x/i.js", "README.md"]) writeFileSync(join(dir, f), "");
  symlinkSync(tmpdir(), join(dir, "dist/outside"));
  const files = jsFiles(dir);
  rmSync(dir, { recursive: true, force: true });
  assert.deepEqual(files, ["dist/a.js", "dist/b.mjs", "dist/c.ts"]);
});

test("score: one match per location against frozen truth; the rest are false positives", () => {
  const truth = [{ id: "P1", planted: true, category: "env", file: "a.js", lines: [3] }, { id: "C1", category: "network", file: "a.js", lines: [5, 6] }];
  const s = score([
    { category: "env", file: "a.js", line: 3, value: "X" },
    { category: "env", file: "a.js", line: 3, value: "Y" },
    { category: "network", file: "a.js", line: 6 },
    { category: "process", file: "a.js", line: 9, value: "exec" },
  ], truth);
  assert.deepEqual([s.found, s.missed, s.planted_found, s.real_found, s.false_positives], [["P1", "C1"], [], 1, 1, 1]);
  assert.deepEqual(s.fp_detail, ["process a.js:9 exec"]);
});

test("compare buckets grep-only hits", () => {
  const f = (category, line, value, extra = {}) => ({ category, file: "a.js", line, value, ...extra });
  const c = compare({
    facts: [f("env", 1, "A"), f("network", 9, "x")],
    grep: [f("env", 1, "A"), f("dynamic-code", 2, "eval", { comment: true }), f("network", 3, "api.example.com"), f("process", 4, "exec", { regexExec: true }), f("network", 5, "localhost")],
  });
  assert.deepEqual(c, { both: 1, only_rea: 1, only_grep: 4, only_grep_in_comments: 1, only_grep_url_strings: 1, only_grep_regex_exec: 1, only_grep_localhost: 1, only_grep_other: 2 });
});

test("packageId", () => {
  assert.equal(packageId("@upstash/context7-mcp"), "upstash_context7-mcp");
  assert.equal(packageId("tavily-mcp"), "tavily-mcp");
});
