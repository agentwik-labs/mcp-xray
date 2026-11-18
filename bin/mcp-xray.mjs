#!/usr/bin/env node
// mcp-xray <npm-package | extracted-dir> [--json] [--out report.html]
// For a package spec: downloads the registry tarball with `npm pack --ignore-scripts` into a temporary directory,
// extracts it, analyses it statically, and deletes it. Never installs or runs the package.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { analyze } from "../src/analyze.mjs";
import { reportCard } from "../src/report.mjs";
import { fetchPackage, packageId } from "../src/targets.mjs";

const USAGE = `usage: mcp-xray <npm-package | dir> [--json] [--out report.html]

  <npm-package>  an npm package spec, e.g. tavily-mcp or @upstash/context7-mcp@4.5.1
  <dir>          an already extracted package directory
  --json         print the findings as JSON instead of writing an HTML report
  --out FILE     where to write the HTML report (default: reports/<package>.html)`;

function parse() {
  return parseArgs({
    allowPositionals: true,
    options: {
      json: { type: "boolean" },
      out: { type: "string" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
}

function main() {
  let values, positionals;
  try {
    ({ values, positionals } = parse());
  } catch (e) {
    console.error(`${e.message}\n\n${USAGE}`);
    return 2;
  }
  if (values.version) {
    console.log(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version);
    return 0;
  }
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  if (positionals.length !== 1) {
    console.error(USAGE);
    return 2;
  }

  const target = positionals[0];
  const isDir = existsSync(target) && statSync(target).isDirectory();
  const work = isDir ? null : mkdtempSync(join(tmpdir(), "mcp-xray-"));
  let rep;
  try {
    rep = analyze(isDir ? target : fetchPackage(target, work));
  } catch (e) {
    console.error(`mcp-xray: ${e.message}`);
    return 1;
  } finally {
    if (work) rmSync(work, { recursive: true, force: true });
  }

  if (values.json) {
    console.log(JSON.stringify({ ...rep, grep: undefined }, null, 1));
    return 0;
  }
  const out = values.out || `reports/${packageId(rep.name)}.html`;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, reportCard(rep));
  const c = rep.summary;
  console.log(`${rep.name}@${rep.version}: env ${c.env}, network ${c.network}, file r/w ${c["file-read"]}/${c["file-write"]}, process ${c.process}, dynamic ${c["dynamic-code"]} -> ${out}`);
  return 0;
}

process.exitCode = main();
