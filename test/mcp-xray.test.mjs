import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyze } from "../src/analyze.mjs";
import { score } from "../src/score.mjs";
import { hostDocumented } from "../src/readme.mjs";
import { reportCard } from "../src/report.mjs";

const truth = JSON.parse(readFileSync(new URL("../fixtures/truth.json", import.meta.url)));
const planted = analyze("fixtures/mcp-planted");
const clean = analyze("fixtures/mcp-clean");

test("planted twin: finds at least 12 of 13 planted behaviours with no false positives", () => {
  const s = score(planted.facts, truth["mcp-planted"].behaviours);
  assert.ok(s.planted_found >= 12, JSON.stringify(s));
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

test("analysis never executes target code", () => {
  const dir = mkdtempSync(join(tmpdir(), "mcpx-"));
  const marker = join(dir, "EXECUTED");
  mkdirSync(join(dir, "pkg"));
  writeFileSync(join(dir, "pkg/package.json"), JSON.stringify({ name: "trap", main: "index.js" }));
  writeFileSync(join(dir, "pkg/index.js"), `const fs = require("fs");\nfs.writeFileSync(${JSON.stringify(marker)}, "x");\neval("1");\n`);
  const rep = analyze(join(dir, "pkg"));
  assert.equal(existsSync(marker), false);
  assert.ok(rep.facts.some((f) => f.category === "file-write") && rep.facts.some((f) => f.category === "dynamic-code"));
});

test("report card renders the fixture label and planted ids", () => {
  const html = reportCard(planted, { fixture: true, planted: new Map([["env|dist/sync.js|9", "P1"]]) });
  assert.match(html, /OUR TEST FIXTURE/);
  assert.match(html, />P1</);
  assert.doesNotMatch(reportCard(clean), /class="tag"/);
});
