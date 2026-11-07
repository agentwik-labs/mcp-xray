// Renders one report card (one screen) per package, plus an index page. Neutral wording: we list behaviour, we do not judge.
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const CSS = `*{box-sizing:border-box}body{margin:0;background:#0d1016;color:#e8ecf3;font:16px/1.45 ui-sans-serif,system-ui,-apple-system,sans-serif}
.wrap{max-width:1500px;margin:0 auto;padding:34px 44px}
.top{display:flex;align-items:baseline;gap:18px;flex-wrap:wrap}.top h1{font:800 40px/1.1 ui-monospace,Menlo,monospace;margin:0;letter-spacing:-1px}
.ver{color:#8b95a7;font:600 20px ui-monospace,Menlo,monospace}.desc{color:#aab3c5;margin:6px 0 0;font-size:18px;max-width:1100px}
.tag{display:inline-block;background:#f5c04a;color:#10131a;font:800 15px ui-monospace,Menlo,monospace;padding:5px 12px;border-radius:6px;letter-spacing:.5px}
.meta{color:#8b95a7;font:14px ui-monospace,Menlo,monospace;margin-top:10px}
.tiles{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin:22px 0}
.tile{background:#151a23;border:1px solid #232a37;border-radius:12px;padding:14px 16px}.tile b{display:block;font:800 38px/1 ui-monospace,Menlo,monospace}.tile span{color:#8b95a7;font-size:14px}
.tile.warn b{color:#ff8a65}.grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px}
.card{background:#151a23;border:1px solid #232a37;border-radius:12px;padding:14px 18px;min-height:120px}.card h2{font-size:15px;text-transform:uppercase;letter-spacing:1.2px;color:#8b95a7;margin:0 0 10px}
.row{display:flex;gap:8px;align-items:center;font:14.5px/1.5 ui-monospace,Menlo,monospace;padding:3px 0;border-bottom:1px solid #1c2230}.row:last-child{border:0}
.row .v{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.row .w{color:#6d7789;font-size:12.5px}
.b{font:700 11.5px ui-monospace,Menlo,monospace;padding:2px 7px;border-radius:5px;white-space:nowrap}.b.doc{background:#16352a;color:#5fd39a}.b.undoc{background:#3d2a14;color:#ffb35c}
.b.sec{background:#3a1a24;color:#ff7a95}.b.pl{background:#f5c04a;color:#111}.b.lay{background:#1f2633;color:#8fa3c4}
.none{color:#5c6577;font-style:italic}.foot{color:#6d7789;font-size:13.5px;margin-top:16px}
table{border-collapse:collapse;width:100%;font:15px ui-monospace,Menlo,monospace}td,th{padding:8px 10px;border-bottom:1px solid #232a37;text-align:right}td:first-child,th:first-child{text-align:left}th{color:#8b95a7;font-weight:600}
.big{font:800 30px ui-monospace,Menlo,monospace}`;

function rows(items, render, empty = "none found") {
  return items.length ? items.map(render).join("") : `<div class="none">${empty}</div>`;
}
const where = (f) => `<span class="w">${esc(f.file.split("/").slice(-2).join("/"))}:${f.line}</span>`;

export function reportCard(rep, { fixture = false, planted = new Map() } = {}) {
  const F = rep.facts;
  const by = (c) => F.filter((f) => f.category === c);
  const pl = (f) => { const id = planted.get(`${f.category}|${f.file}|${f.line}`); return id ? `<span class="b pl">${id}</span>` : ""; };
  // env: one row per name
  const envMap = new Map(); for (const f of by("env")) if (!envMap.has(f.value)) envMap.set(f.value, f);
  const env = [...envMap.values()].sort((a, b) => (b.secret ? 1 : 0) - (a.secret ? 1 : 0) || (a.documented ? 1 : 0) - (b.documented ? 1 : 0));
  const calls = by("network");
  const callHosts = new Map(); for (const f of calls) { const k = f.value; if (!callHosts.has(k)) callHosts.set(k, { ...f, n: 0 }); callHosts.get(k).n++; }
  const strHosts = (rep.hosts_in_strings || []).filter((h) => !callHosts.has(h.host));
  const undocHosts = [...callHosts.values()].filter((h) => !h.documented && !h.value.startsWith("(")).length + strHosts.filter((h) => !h.documented).length;
  const t = (n, label, warn) => `<div class="tile${warn && n ? " warn" : ""}"><b>${n}</b><span>${label}</span></div>`;
  const files = [...by("file-read"), ...by("file-write")];
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(rep.name)} - mcp-xray</title><style>${CSS}</style></head><body><div class="wrap">
<div class="top">${fixture ? '<span class="tag">OUR TEST FIXTURE: behaviours planted by us</span>' : ""}<h1>${esc(rep.name)}</h1><span class="ver">${esc(rep.version || "")}</span></div>
<p class="desc">${esc(rep.description).slice(0, 220)}</p>
<div class="meta">${rep.js_files} source files · REA ${esc(rep.rea_version)} coverage: ${esc(rep.coverage.status)}${rep.coverage.truncated ? " (truncated)" : ""} · README: ${rep.readme ? esc(rep.readme) : "none"} · static only, nothing executed</div>
<div class="tiles">${t(envMap.size, "env vars read")}${t(env.filter((e) => e.secret).length, "look like secrets")}${t(undocHosts, "hosts not in README", true)}${t(files.length, "file reads / writes")}${t(by("process").length, "child processes", true)}${t(by("dynamic-code").length, "dynamic code (eval)", true)}</div>
<div class="grid">
<div class="card"><h2>Environment variables</h2>${rows(env.slice(0, 12), (f) => `<div class="row">${pl(f)}<span class="v">${esc(f.value)}</span>${f.secret ? '<span class="b sec">secret?</span>' : ""}<span class="b ${f.documented ? "doc" : "undoc"}">${f.documented ? "in README" : "not in README"}</span></div>`)}${env.length > 12 ? `<div class="none">+${env.length - 12} more</div>` : ""}</div>
<div class="card"><h2>Network</h2>${rows([...callHosts.values()].slice(0, 7), (f) => `<div class="row">${pl(f)}<span class="v">${esc(f.value)}</span><span class="w">${f.n} call${f.n > 1 ? "s" : ""}</span>${f.value.startsWith("(") ? "" : `<span class="b ${f.documented ? "doc" : "undoc"}">${f.documented ? "in README" : "not in README"}</span>`}</div>`, "no outbound calls found")}
${strHosts.length ? `<div class="w" style="margin:8px 0 2px">hosts named in code strings</div>` + strHosts.slice(0, 6).map((h) => `<div class="row"><span class="v">${esc(h.host)}</span><span class="w">${h.count}×</span><span class="b ${h.documented ? "doc" : "undoc"}">${h.documented ? "in README" : "not in README"}</span></div>`).join("") : ""}</div>
<div class="card"><h2>Files read / written</h2>${rows(files.slice(0, 9), (f) => `<div class="row">${pl(f)}<span class="b lay">${f.category === "file-read" ? "read" : "write"}</span><span class="v">${esc(f.value || "(path not static)")}</span>${f.sensitive ? '<span class="b sec">sensitive path</span>' : ""}${where(f)}</div>`)}</div>
<div class="card"><h2>Child processes</h2>${rows(by("process").slice(0, 6), (f) => `<div class="row">${pl(f)}<span class="v">${esc(f.value)}</span>${where(f)}</div>`)}</div>
<div class="card"><h2>Dynamic code</h2>${rows(by("dynamic-code").slice(0, 6), (f) => `<div class="row">${pl(f)}<span class="v">${esc(f.value)}</span>${where(f)}</div>`)}</div>
<div class="card"><h2>Same files, plain grep</h2><div class="row"><span class="v">grep hits (locations)</span><b>${new Set(rep.grep.map((f) => f.category + f.file + f.line)).size}</b></div><div class="row"><span class="v">this report (locations)</span><b>${new Set(F.map((f) => f.category + f.file + f.line)).size}</b></div><div class="w" style="margin-top:6px">grep also matches comments, regex .exec() and URL strings; see README for the measured comparison.</div></div>
</div>
<div class="foot">mcp-xray: static analysis with REA (rea-agents ${esc(rep.rea_version)}) plus our call-site classifier. Lists what the shipped code can do, with file:line. Not a verdict on the package.</div>
</div></body></html>`;
}
