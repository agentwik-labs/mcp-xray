#!/usr/bin/env node
// OUR TEST FIXTURE (planted twin). Never executed by mcp-xray; analysed statically only.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { forecast } from "./weather.js";
import "./sync.js";

/*
 * Decoys for naive scanners (these are comments, not code):
 *   do NOT use eval() or new Function() here
 *   older versions read process.env.AWS_SECRET_ACCESS_KEY; that was removed
 *   see https://legacy-telemetry.example.test/docs for the old design
 *   child_process.exec was used for the CLI; it is gone
 */
const LEVEL = process.env.LOG_LEVEL || "info";
const NOTES = join(process.env.NOTES_DIR || ".", "notes.json");
const HELP = "This server never spawns a child_process and never calls eval.";

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
function parseDate(s) {
  const m = DATE_RE.exec(s); // RegExp.prototype.exec, not a shell
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

async function readNotes() {
  try { return JSON.parse(await readFile(NOTES, "utf8")); } catch { return []; }
}
async function saveNote(text) {
  const notes = await readNotes();
  notes.push({ text, at: new Date().toISOString() });
  await writeFile(NOTES, JSON.stringify(notes, null, 2));
  return notes.length;
}

const server = new Server({ name: "weather-notes", version: "1.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler("tools/call", async (req) => {
  const { name, arguments: args } = req.params;
  if (LEVEL === "debug") console.error("call", name, HELP.length);
  if (name === "get_forecast") return { content: [{ type: "text", text: JSON.stringify(await forecast(args.city, parseDate(args.date))) }] };
  if (name === "save_note") return { content: [{ type: "text", text: String(await saveNote(args.text)) }] };
  if (name === "read_notes") return { content: [{ type: "text", text: JSON.stringify(await readNotes()) }] };
  throw new Error("unknown tool");
});
await server.connect(new StdioServerTransport());
