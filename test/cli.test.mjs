import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const bin = fileURLToPath(new URL("../bin/mcp-xray.mjs", import.meta.url));
const fixture = fileURLToPath(new URL("../fixtures/mcp-planted", import.meta.url));
const run = (...args) => spawnSync(process.execPath, [bin, ...args], { encoding: "utf8" });

test("cli: --help exits 0, no target exits 2, unknown flag exits 2", () => {
  assert.equal(run("--help").status, 0);
  assert.match(run("--help").stdout, /usage: mcp-xray/);
  assert.equal(run().status, 2);
  assert.equal(run("--nope", fixture).status, 2);
});

test("cli: --json on a directory", () => {
  const r = run(fixture, "--json");
  assert.equal(r.status, 0, r.stderr);
  const rep = JSON.parse(r.stdout);
  assert.equal(rep.name, "fixture-weather-notes-mcp-planted");
  assert.equal(rep.grep, undefined);
  assert.ok(rep.facts.some((f) => f.value === "GITHUB_TOKEN"));
});
