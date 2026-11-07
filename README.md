# mcp-xray

**What does this MCP server actually do?** Point it at an npm MCP server package and get a one-screen report card of
what the shipped code can do: environment variables it reads (secret-looking ones marked), network calls and hosts,
files read and written (sensitive paths marked), child processes, and dynamic code (`eval`, `new Function`, `vm`),
each with `file:line`, checked against what the README says.

Built on [REA](https://github.com/morluto/rea) (`rea-agents`, MIT), used as a local CLI only. Static analysis: the package is
fetched as a registry tarball (`npm pack --ignore-scripts`), extracted, and parsed. It is never installed or executed
(a test plants code that would write a marker file and checks it is never written).

## Run

```sh
npm install --ignore-scripts          # installs rea-agents locally; never run `rea setup`
node bin/mcp-xray.mjs tavily-mcp      # -> reports/tavily-mcp.html
node bin/mcp-xray.mjs ./some/dir --json
npm test                              # 7 tests, fixtures + no-execution check
node scripts/fetch-targets.mjs && node scripts/build-reports.mjs   # real targets + reports/index.html
node scripts/record-demo.mjs          # demo footage (then ffmpeg, see demo/)
```

## How it works

1. `rea analyze-javascript-application <dir> --format json` builds REA's application graph and semantic graph.
2. **REA facts** used directly: environment config sources, `process.env.X` member reads, file config sources, request
   nodes, and outbound endpoints (fetch / http(s) / axios-style clients).
3. **Our classifier on REA call sites:** REA gives every call with an exact AST range, so comments and strings can never match.
   We name the callee and gate on the imports REA recorded for that file (`execSync` only counts if the file imports
   `child_process` or has a computed `require`; `.exec()` on a regex does not). Hosts held in a constant are resolved.
4. **Hosts named in strings:** URL string literals (via `@babel/parser` tokens, not comments). Our layer, not REA's.
5. README check: env names and hosts the README never mentions are labelled "not in README". Neutral wording; not a verdict.
6. **grep baseline** over the same files: the regexes a careful reviewer would use (`process.env.X`, URLs, `fetch(`,
   `readFile(`, `exec(`, `eval(`, ...), line by line.

## Measured results (2026-11-07, rea-agents 6.7.0)

### Ground truth: our test fixture

Two twins of a small weather/notes MCP server in `fixtures/`. The planted twin adds 13 behaviours (secret env reads,
`~/.aws/credentials` and `~/.ssh/id_rsa` reads, a POST to an undeclared host, a host in a constant, a base64-hidden URL,
`eval` and `new Function` of downloaded text, `execSync`, a `spawn` via `require("child_" + "process")`, appending to
`~/.zshrc`). The clean twin has only its 6 declared behaviours plus decoys (comments mentioning eval/env/URLs, a help
string, `RegExp.exec`). `fixtures/truth.json` was committed before the first analyser run (see git log).

| on the planted twin | planted found | declared found | false positives |
| --- | --- | --- | --- |
| **mcp-xray** (REA + classifier) | **12 / 13** | 6 / 6 | **0** |
| REA facts alone | 4 / 13 | 3 / 6 | 0 |
| plain grep | 12 / 13 | 6 / 6 | 8 |

| on the clean twin | false positives |
| --- | --- |
| mcp-xray | 0 |
| plain grep | 7 |

Both miss P2 (`const { GITHUB_TOKEN } = process.env`, destructuring). The base64-hidden host (P9) is found as a network
call but its host is not recovered. Network hosts named at the call: mcp-xray 3 of 4, grep 2 of 4.

### 12 real MCP server packages from npm

| package | version | files | REA coverage | REA s | env | secret? | env not in README | hosts named | hosts not in README | file r/w | proc | eval |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| @modelcontextprotocol/server-filesystem | 2.2.0 | 10 | ok | 3.4 | 0 | 0 | 0 | 0 | 0 | 6 | 0 | 0 |
| @modelcontextprotocol/server-memory | 2.1.0 | 2 | ok | 2.3 | 1 | 0 | 0 | 0 | 0 | 5 | 0 | 0 |
| @modelcontextprotocol/server-sequential-thinking | 2.1.1 | 3 | ok | 1.9 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| @modelcontextprotocol/server-everything | 2.2.1 | 50 | ok | 4.3 | 5 | 0 | 1 | 2 | 1 | 2 | 0 | 0 |
| @modelcontextprotocol/server-github | 2025.4.8 | 12 | ok | 2.9 | 1 | 1 | 0 | 1 | 0 | 0 | 0 | 0 |
| @modelcontextprotocol/server-brave-search | 0.6.2 | 1 | ok | 1.8 | 1 | 1 | 0 | 1 | 0 | 0 | 0 | 0 |
| @modelcontextprotocol/server-puppeteer | 2025.5.12 | 1 | ok | 1.8 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| @upstash/context7-mcp | 4.5.1 | 27 | ok | 4.2 | 22 | 3 | 12 | 6 | 1 | 2 | 0 | 0 |
| firecrawl-mcp | 3.38.0 | 8 | ok | 13.7 | 24 | 3 | 13 | 8 | 2 | 2 | 0 | 0 |
| @notionhq/notion-mcp-server | 2.6.1 | 15 | **partial** | 21.7 | 6 | 2 | 2 | 5 | 3 | 2 | 0 | 0 |
| tavily-mcp | 0.2.22 | 1 | ok | 2.1 | 3 | 1 | 0 | 2 | 0 | 0 | 0 | 0 |
| mcp-remote | 0.16.5 | 5 | **partial** | 29.0 | 0 | 0 | 0 | 2 | 1 | 0 | 0 | 1 |

Nothing here looked like secret exfiltration or a planted-style behaviour. "Not in README" items are mostly hosting and
config knobs (ports, OAuth issuers, proxies) of packages that also ship a hosted server. The one `new Function` (mcp-remote)
is in bundled schema-validation code.

### REA vs grep (same files, 12 real packages, matched by category + file + line)

| found by both | only REA layer | only grep | of which: comments | URL strings | regex `.exec()` | localhost | real code REA's layer missed |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 138 | 12 | 425 | 21 | 270 | 52 | 10 | **72** |

**Plainly: on real packages REA added little that grep did not already find.** The 12 REA-only hits are API client calls
(`client.http.post(...)`) that our grep rules did not cover. What REA buys is precision (no comment, string or regex hits; 0
vs 7 false positives on the clean twin) and structure (imports per file, resolved literals, exact ranges). grep reached 72
real code lines REA's layer missed: 29 in firecrawl (`http.get` client calls), and 41 in two large bundles (notion's 1.4 MB
minified `bin/cli.mjs` and mcp-remote's 1.9 MB chunk), where REA's semantic pass returned partial coverage with no nodes.
URL-string hits are covered by our string layer in the report card.

## Limitations

- Static only: computed names (`process.env[name]`), destructured env reads, decoded/obfuscated URLs, and behaviour inside
  dependencies (not shipped in the tarball) are not seen. Bundled packages are seen only as far as REA's coverage goes.
- Large minified bundles: REA returned partial coverage (raised node ceilings help some; 2 of 12 still partial).
- "Not in README" is a text match on names and domains; a README can mention a host without disclosing what is sent.
- Fixture results are on our own fixture; real-package numbers are counts, not verified behaviour.
- No LLM step was used.

## Layout

`src/` analyser (rea runner, facts, grep baseline, README claims, scoring, report card) · `fixtures/` our twins + frozen
`truth.json` · `scripts/` fetch, build reports, record demo · `results/` measured JSON · `reports/` HTML cards ·
`targets/` downloaded tarballs (gitignored) · `demo/` video, poster, hub.json.
