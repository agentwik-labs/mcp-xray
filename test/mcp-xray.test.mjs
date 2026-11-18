import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyze.mjs";
import { score } from "../src/score.mjs";
import { hostDocumented } from "../src/readme.mjs";
import { reportCard } from "../src/report.mjs";

const truth = JSON.parse(readFileSync(new URL("../fixtures/truth.json", import.meta.url)));
const fixture = (name) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
const planted = analyze(fixture("mcp-planted"));
const clean = analyze(fixture("mcp-clean"));

test("planted twin: finds all 13 planted behaviours with no false positives", () => {
  const s = score(planted.facts, truth["mcp-planted"].behaviours);
  assert.equal(s.planted_found, 13, JSON.stringify(s));
  assert.equal(s.false_positives, 0, s.fp_detail.join("; "));
  assert.equal(s.real_found, 6);
});

test("clean twin: every declared behaviour found, zero false positives; grep baseline is fooled by the decoys", () => {
  const s = score(clean.facts, truth["mcp-clean"].behaviours);
  assert.equal(s.real_found, 6);
  assert.equal(s.false_positives, 0, s.fp_detail.join("; "));
  assert.ok(score(clean.grep, truth["mcp-clean"].behaviours).false_positives >= 5);
});

test("README check: planted secrets and hosts are reported as not in README; declared ones are", () => {
  const env = Object.fromEntries(planted.facts.filter((f) => f.category === "env").map((f) => [f.value, f]));
  assert.equal(env.AWS_SECRET_ACCESS_KEY.documented, false);
  assert.equal(env.AWS_SECRET_ACCESS_KEY.secret, true);
  assert.equal(env.WEATHER_API_KEY.documented, true);
  assert.deepEqual([env.GITHUB_TOKEN.line, env.GITHUB_TOKEN.layer, env.GITHUB_TOKEN.secret, env.GITHUB_TOKEN.documented], [10, "ast", true, false]);
  const hosts = new Set(planted.facts.filter((f) => f.category === "network" && !f.documented).map((f) => f.value));
  assert.ok(hosts.has("telemetry.collector-example.test") && hosts.has("stats.metrics-example.test"));
});

test("sensitive and persistence paths are flagged", () => {
  const paths = planted.facts.filter((f) => f.sensitive).map((f) => f.value);
  assert.deepEqual(paths.sort(), ["~/.aws/credentials", "~/.ssh/id_rsa", "~/.zshrc"]);
});

test("hostDocumented matches parent and sub domains, not strangers", () => {
  const claims = { hosts: new Set(["api.example.com"]) };
  assert.equal(hostDocumented("example.com", claims), true);
  assert.equal(hostDocumented("cdn.example.com", claims), true);
  assert.equal(hostDocumented("evil.test", claims), false);
});

test("grep baseline misses the destructured env read (P2); its rules are unchanged since the first measurement", () => {
  assert.deepEqual(score(planted.grep, truth["mcp-planted"].behaviours).missed, ["P2"]);
});

test("analysis never executes target code", () => {
  const dir = mkdtempSync(join(tmpdir(), "mcpx-"));
  const marker = join(dir, "EXECUTED");
  mkdirSync(join(dir, "pkg"));
  writeFileSync(join(dir, "pkg/package.json"), JSON.stringify({ name: "trap", main: "index.js" }));
  writeFileSync(join(dir, "pkg/index.js"), `const fs = require("fs");\nfs.writeFileSync(${JSON.stringify(marker)}, "x");\neval("1");\n`);
  const rep = analyze(join(dir, "pkg"));
  assert.equal(existsSync(marker), false);
  rmSync(dir, { recursive: true, force: true });
  assert.ok(rep.facts.some((f) => f.category === "file-write") && rep.facts.some((f) => f.category === "dynamic-code"));
});

test("env reads REA reports in other shapes: destructuring and optional chains", () => {
  const dir = mkdtempSync(join(tmpdir(), "mcpx-env-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "env-shapes" }));
  writeFileSync(join(dir, "index.js"), "const { A_TOKEN } = process.env;\nconst b = process.env.B_SECRET?.trim();\nconst c = process.env.C_PLAIN;\n");
  const rep = analyze(dir);
  rmSync(dir, { recursive: true, force: true });
  const env = rep.facts.filter((f) => f.category === "env").map((f) => `${f.value}@${f.line}:${f.layer}`);
  assert.deepEqual(env, ["A_TOKEN@1:ast", "B_SECRET@2:rea", "C_PLAIN@3:rea"]);
});

test("report card renders the fixture label and planted ids", () => {
  const html = reportCard(planted, { fixture: true, planted: new Map([["env|dist/sync.js|9", "P1"]]) });
  assert.match(html, /OUR TEST FIXTURE/);
  assert.match(html, />P1</);
  assert.doesNotMatch(reportCard(clean), /class="tag"/);
});
