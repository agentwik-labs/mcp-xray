// Records the real report pages (built by scripts/build-reports.mjs from real analysis runs) in clean headless Chromium.
// Captions, title card and highlight boxes are overlays added by this script; every number in them is read from
// results/measured.json. Writes demo/_work/raw.webm; then:
//   ffmpeg -ss 0.5 -i demo/_work/raw.webm -c:v libx264 -pix_fmt yuv420p -r 30 -crf 23 -movflags +faststart -an demo/demo.mp4
//   ffmpeg -ss 13 -i demo/demo.mp4 -frames:v 1 demo/poster.png
import { chromium } from "./pw.mjs";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
const { fixtures, real, totals } = JSON.parse(readFileSync("results/measured.json", "utf8"));
const tool = fixtures["mcp-planted"].tool, grep = fixtures["mcp-planted"].grep;
const ctx7 = real.find((r) => r.pkg === "@upstash/context7-mcp");
const W = "demo/_work"; rmSync(W, { recursive: true, force: true }); mkdirSync(W, { recursive: true });
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir: W, size: { width: 1920, height: 1080 } } });
const p = await ctx.newPage();
const T0 = Date.now(); const marks = [];
const OVER = `#h-cap{position:fixed;left:50%;transform:translateX(-50%);bottom:40px;max-width:1500px;z-index:99;font:700 40px/1.2 ui-sans-serif,system-ui,sans-serif;color:#fff;background:#05070bf0;border:2px solid #f5c04a;padding:16px 30px;border-radius:14px;text-align:center;box-shadow:0 12px 50px #000a}
#h-cap small{display:block;font:500 25px/1.3 ui-sans-serif,system-ui,sans-serif;color:#aab3c5;margin-top:6px}
.h-hl{outline:4px solid #f5c04a!important;outline-offset:4px;border-radius:12px;transition:outline .2s}
#h-title{position:fixed;inset:0;background:#0d1016;z-index:100;display:flex;flex-direction:column;justify-content:center;padding-left:180px;font-family:ui-sans-serif,system-ui,sans-serif;color:#fff}
#h-title h1{font:800 120px/1 ui-monospace,Menlo,monospace;margin:0 0 26px;letter-spacing:-3px}#h-title p{font-size:46px;color:#aab3c5;margin:0}`;
async function open(file) { await p.goto("file://" + process.cwd() + "/reports/" + file); await p.addStyleTag({ content: OVER + (file === "index.html" ? ".wrap{zoom:.8;padding-top:20px}" : ".wrap{zoom:1.12}") }); }
async function cap(html, hl) {
  await p.evaluate(([h, sel]) => {
    let c = document.getElementById("h-cap"); if (!c) { c = document.createElement("div"); c.id = "h-cap"; document.body.append(c); }
    c.innerHTML = h; c.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, fill: "forwards" });
    document.querySelectorAll(".h-hl").forEach((e) => e.classList.remove("h-hl"));
    if (sel) for (const s of sel.split("|")) { const e = document.querySelectorAll(s.split("@")[0])[+(s.split("@")[1] || 0)]; e && e.classList.add("h-hl"); }
  }, [html, hl || ""]);
}
const wait = (ms) => p.waitForTimeout(ms);
const mark = (n) => marks.push([n, (Date.now() - T0) / 1000]);

await open("fixture-mcp-planted.html");
await p.evaluate(() => { const t = document.createElement("div"); t.id = "h-title"; t.innerHTML = "<h1>mcp-xray</h1><p>What does this MCP server actually do?<br>Static report card on top of REA. Nothing is run.</p>"; document.body.append(t); });
mark("start"); await wait(2600);
await p.evaluate(() => document.getElementById("h-title").remove());
await cap(`Our test fixture: an MCP server with <b>${tool.planted_total} behaviours we planted</b>.<small>Yellow tags = planted. The list was frozen before the first run.</small>`, ".tag");
await wait(3600);
await cap("It reads AWS, GitHub and OpenAI keys<small>that its README never mentions.</small>", ".card@0");
await wait(3200);
await cap("Sends data to hosts the README never names,<small>reads ~/.aws and ~/.ssh, edits ~/.zshrc.</small>", ".card@1|.card@2");
await wait(3400);
await cap("Shells out and runs downloaded code.<small>Every line comes with file:line.</small>", ".card@3|.card@4");
await wait(3000); mark("fixture done");
await open("index.html");
await cap(`Planted found: <b>${tool.planted_found} of ${tool.planted_total}</b>. False positives: <b>${tool.false_positives}</b>.<small>Plain grep found ${grep.planted_found}, with ${grep.false_positives} false positives (comments, regex .exec).</small>`, "#fixture");
await wait(4400);
await open("upstash_context7-mcp.html");
await cap(`Real package from npm: @upstash/context7-mcp<small>${ctx7.env} env vars, ${ctx7.env_not_in_readme} not in its README. Mostly config knobs: listed, not judged.</small>`, ".card@0");
await wait(4200);
await open("index.html");
await cap(`${real.length} real MCP server packages, static only.`, "#real");
await wait(2600);
await cap(`Honest result: on real packages we found little that grep missed.<small>We add precision. grep reached ${totals.only_grep_real_code_missed_by_rea} code lines we missed, mostly in big bundles.</small>`, "#vs");
await wait(4800); mark("end");
await ctx.close(); await b.close();
const f = readdirSync(W).find((x) => x.endsWith(".webm")); renameSync(`${W}/${f}`, `${W}/raw.webm`);
console.log(JSON.stringify(marks));
