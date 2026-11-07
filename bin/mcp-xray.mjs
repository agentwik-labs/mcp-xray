#!/usr/bin/env node
// mcp-xray <npm-package | extracted-dir> [--json] [--out file.html]
// For a package name: downloads the registry tarball with `npm pack --ignore-scripts`, extracts it under targets/,
// and analyses it statically. Never installs or runs the package.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync, statSync } from "node:fs";
import { analyze } from "../src/analyze.mjs";
import { reportCard } from "../src/report.mjs";
const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith("--"));
if (!target) { console.error("usage: mcp-xray <npm-package | dir> [--json] [--out report.html]"); process.exit(2); }
let root = target;
if (!existsSync(target) || !statSync(target).isDirectory()) {
  const dir = `targets/${target.replace(/[@/]/g, "_").replace(/^_/, "")}`;
  if (!existsSync(`${dir}/package/package.json`)) {
    mkdirSync(dir, { recursive: true });
    execFileSync("npm", ["pack", target, "--ignore-scripts", "--silent", "--pack-destination", dir], { stdio: ["ignore", "pipe", "inherit"] });
    const tgz = readdirSync(dir).find((f) => f.endsWith(".tgz"));
    execFileSync("tar", ["-xzf", `${dir}/${tgz}`, "--no-same-owner", "--no-same-permissions", "-C", dir]);
  }
  root = `${dir}/package`;
}
const rep = analyze(root);
if (args.includes("--json")) { console.log(JSON.stringify({ ...rep, grep: undefined }, null, 1)); process.exit(0); }
const outI = args.indexOf("--out");
const out = outI >= 0 ? args[outI + 1] : `reports/${rep.name.replace(/[@/]/g, "_").replace(/^_/, "")}.html`;
mkdirSync(out.split("/").slice(0, -1).join("/") || ".", { recursive: true });
writeFileSync(out, reportCard(rep));
const c = (k) => rep.summary[k];
console.log(`${rep.name}@${rep.version}: env ${c("env")}, network ${c("network")}, file r/w ${c("file-read")}/${c("file-write")}, process ${c("process")}, dynamic ${c("dynamic-code")} -> ${out}`);
