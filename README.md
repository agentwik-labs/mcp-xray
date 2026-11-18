# mcp-xray

**On our planted test MCP server, mcp-xray finds 13 of 13 planted behaviours with 0 false positives; plain grep over
the same files finds 12 of 13 with 8 false positives.** Measured by `npm run fixtures`, which scores both against
`fixtures/truth.json` (committed before the analyser existed); numbers in `results/fixture-scores.json`
(rea-agents 6.7.0, 2026-11-18). The fixture is ours, and the 13th (an env read by destructuring) was fixed after we saw
it missed: read [what this number is and is not](#what-the-fixture-number-is-and-is-not).

**What does this MCP server actually do?** Point mcp-xray at an npm MCP server package and get a one-screen report of
what the shipped code can do: environment variables it reads (secret-looking names marked), network calls and hosts,
files read and written (sensitive paths marked), child processes, and dynamic code (`eval`, `new Function`, `vm`),
each with `file:line`, checked against what the README says.

Static analysis only. The package is fetched as a registry tarball (`npm pack --ignore-scripts`) into a temporary
directory, extracted, and parsed; it is never installed or executed (a test plants code that would write a marker file
and checks it is never written). Built on [REA](https://github.com/morluto/rea) (`rea-agents`, MIT), used as a local CLI.

## Install and run

Requires Node 22.19+ or 24.11+ (what `rea-agents` supports) and npm. Not published to npm yet; run it from a clone:

```sh
git clone https://github.com/agentwik-labs/mcp-xray.git
cd mcp-xray
npm ci --ignore-scripts                           # no dependency install scripts run
npm test                                          # 25 tests: fixtures, units, CLI, no-execution check

node bin/mcp-xray.mjs tavily-mcp                  # downloads the tarball, writes reports/tavily-mcp.html
node bin/mcp-xray.mjs @upstash/context7-mcp@4.5.1 --out card.html
node bin/mcp-xray.mjs fixtures/mcp-planted --json # an extracted package directory; JSON to stdout
```

Reproduce the measured results:

```sh
npm run fixtures     # fixtures -> results/fixture-scores.json, results/mcp-*.json
npm run fetch        # the 12 real packages at the versions pinned in targets.json -> targets/ (gitignored)
npm run reports      # REA on all of them (about 90 s) -> reports/*.html, results/measured.json
```

`scripts/record-demo.mjs` re-records `demo/demo.mp4` from the built reports; it needs Playwright, which is not a
dependency (see `scripts/pw.mjs`).

## How it works

1. `rea analyze-javascript-application <dir> --format json` builds REA's application graph and semantic graph.
2. **REA facts** used directly (`layer: "rea"`): environment config sources, `process.env.X` member reads, file config
   sources, request nodes, and outbound endpoints (fetch / http(s) / axios-style clients).
3. **Our classifier on REA call sites** (`layer: "rea-site"`): REA gives every call an exact AST range, so comments and
   strings never match. We name the callee and gate on the imports REA recorded for that file (`execSync` only counts
   if the file imports `child_process` or has a computed `require`; `.exec()` on a regex does not). A host held in a
   `const` string is resolved.
4. **Our AST layer** (`layer: "ast"`, `@babel/parser`, one pass per file): env vars read by destructuring
   `process.env` (`const { GITHUB_TOKEN } = process.env`, also renamed, defaulted, and in assignments and parameter
   defaults), and hosts named in URL string literals.
5. README check: env names and hosts the README never mentions are labelled "not in README". A text match, not a verdict.
6. **grep baseline** over the same files: the regexes a careful reviewer would use (`process.env.X`, URLs, `fetch(`,
   `readFile(`, `exec(`, `eval(`, ...), line by line. These rules are unchanged since the first measurement.

## Measured results (rea-agents 6.7.0)

### Ground truth: our test fixture

Two twins of a small weather/notes MCP server in `fixtures/`. The planted twin adds 13 behaviours (secret env reads,
`~/.aws/credentials` and `~/.ssh/id_rsa` reads, a POST to an undeclared host, a host in a constant, a base64-hidden URL,
`eval` and `new Function` of downloaded text, `execSync`, a `spawn` via `require("child_" + "process")`, appending to
`~/.zshrc`). The clean twin has only its 6 declared behaviours plus decoys (comments mentioning eval/env/URLs, a help
string, `RegExp.exec`). A finding counts if category, file and line match an entry in `fixtures/truth.json`.

| on the planted twin | planted found | declared found | false positives |
| --- | --- | --- | --- |
| **mcp-xray** (REA + our layers) | **13 / 13** | 6 / 6 | **0** |
| REA facts alone | 4 / 13 | 3 / 6 | 0 |
| plain grep | 12 / 13 | 6 / 6 | 8 |

| on the clean twin | false positives |
| --- | --- |
| mcp-xray | 0 |
| plain grep | 7 |

grep misses P2 (`const { GITHUB_TOKEN } = process.env`); a `} = process.env` rule would catch this one-line case.
grep's false positives are comments, a help string, `RegExp.exec`, import lines and a URL constant. The base64-hidden
host (P9) is found as a network call but its host is not recovered. Hosts named at the call: mcp-xray 3 of 4, grep 2 of 4.

#### What the fixture number is and is not

- We wrote the fixture and its truth list, so it tests the behaviours we thought of. `truth.json` was committed before
  the first analyser run (`git log -- fixtures/truth.json`) and has not changed since.
- The first measurement was 12 of 13: both mcp-xray and grep missed P2. We then added the AST layer for destructured
  env reads and re-measured: 13 of 13. So that one point was fixed after we saw the miss. On the 12 real packages the
  fix added no findings (none of them destructure `process.env`). A second fix in the same pass, for
  `process.env.X?.trim()` chains (REA reports them with a longer property path), added one env var to firecrawl; its
  row and the grep comparison below are re-measured with both fixes.
- The planted code is not obfuscated beyond one base64 string. A fixture score says nothing about recall on real
  malware.

### 12 real MCP server packages from npm

Versions pinned in `targets.json`; numbers from `results/measured.json`. "REA coverage" is REA's own status: `partial`
means its semantic pass hit its limits on that package; `unknown` means REA did not flag it partial.

| package | version | files | REA coverage | REA s | env | secret? | env not in README | hosts named | hosts not in README | file r/w | proc | eval |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| @modelcontextprotocol/server-filesystem | 2.2.0 | 10 | unknown | 3.4 | 0 | 0 | 0 | 0 | 0 | 6 | 0 | 0 |
| @modelcontextprotocol/server-memory | 2.1.0 | 2 | unknown | 2.3 | 1 | 0 | 0 | 0 | 0 | 5 | 0 | 0 |
| @modelcontextprotocol/server-sequential-thinking | 2.1.1 | 3 | unknown | 1.9 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| @modelcontextprotocol/server-everything | 2.2.1 | 50 | unknown | 4.3 | 5 | 0 | 1 | 2 | 1 | 2 | 0 | 0 |
| @modelcontextprotocol/server-github | 2025.4.8 | 12 | unknown | 2.9 | 1 | 1 | 0 | 1 | 0 | 0 | 0 | 0 |
| @modelcontextprotocol/server-brave-search | 0.6.2 | 1 | unknown | 1.8 | 1 | 1 | 0 | 1 | 0 | 0 | 0 | 0 |
| @modelcontextprotocol/server-puppeteer | 2025.5.12 | 1 | unknown | 1.8 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| @upstash/context7-mcp | 4.5.1 | 27 | unknown | 4.2 | 22 | 3 | 12 | 6 | 1 | 2 | 0 | 0 |
| firecrawl-mcp | 3.38.0 | 8 | unknown | 13.7 | 25 | 4 | 14 | 8 | 2 | 2 | 0 | 0 |
| @notionhq/notion-mcp-server | 2.6.1 | 15 | **partial** | 21.7 | 6 | 2 | 2 | 5 | 3 | 2 | 0 | 0 |
| tavily-mcp | 0.2.22 | 1 | unknown | 2.1 | 3 | 1 | 0 | 2 | 0 | 0 | 0 | 0 |
| mcp-remote | 0.16.5 | 5 | **partial** | 29.0 | 0 | 0 | 0 | 2 | 1 | 0 | 0 | 1 |

What the counts show, not a verdict: no package starts a child process; every secret-looking env var is the
service's own credential (`BRAVE_API_KEY`, `NOTION_TOKEN`, `FIRECRAWL_API_KEY`, ...) or a secret for its hosted-server
mode (`MCP_DELEGATED_CREDENTIAL_SECRET`, `OPENAI_APPS_CHALLENGE_TOKEN`, ...); the one `new Function`
(mcp-remote, `dist/proxy.js:7261`) is bundled Ajv compiling a JSON-schema validator. "Not in README" items are mostly
hosting and config knobs (ports, OAuth issuers, proxies) of packages that also ship a hosted server.

### Our layers vs grep (same files, 12 real packages, matched by category + file + line)

| found by both | only our layers | only grep | of which: comments | URL strings | regex `.exec()` | localhost | real code our layers missed |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 139 | 12 | 424 | 21 | 270 | 52 | 10 | **71** |

**Plainly: on real packages our layers added little that grep did not already find.** The 12 we found and grep did
not are firecrawl's API client calls (`client.http.post(...)`), which the grep rules do not cover. What REA buys is
precision (no comment, string or regex hits; 0 vs 7 false positives on the clean twin) and structure (imports per
file, resolved literals, exact ranges). grep reached 71 real code lines our layers missed: 28 in firecrawl (24 `client.http.get(...)`
calls and 4 `.fetch(...)` on framework objects), 2 in context7, and 41 in the two packages where REA's semantic pass returned partial coverage
(19 in notion's 1.4 MB minified `bin/cli.mjs`, 20 in mcp-remote's 1.7 MB bundled chunk, 2 elsewhere in mcp-remote). URL-string hits are covered by the AST host layer
in the report.

## Limitations

- **Static only.** It reports what the shipped code *can* do, not what it does at runtime. Not seen: computed names
  (`process.env[name]`, `const { env } = process; env.X`, `...rest` from `process.env`), decoded or obfuscated URLs
  and code, code downloaded at runtime, native addons, and dependencies (they are not in the tarball).
- **Large minified bundles:** REA's coverage is partial on 2 of 12 packages even with raised node ceilings; findings
  there are incomplete (see the 41 lines above).
- **Names, not data flow.** It does not trace which env var or file is sent to which host.
- **"Not in README"** is a text match on names and domains; a README can name a host without disclosing what is sent.
- **Fixture numbers are on our own fixture** (see above). Real-package numbers are counts, not verified behaviour.
- **Dependency weight:** `rea-agents` is a general reverse-engineering toolkit (about 140 MB installed). It is pinned
  to 6.7.0, the version measured; `npm audit` reports advisories in its transitive dependencies that a newer
  `rea-agents` release addresses. Bumping it means re-measuring.
- **Fetching:** the argument is passed to `npm pack` (with `--ignore-scripts`); give it registry packages.
  Symlinks inside a package are not followed.
- No LLM step is used.

## Name

Unrelated to the `mcp-xray` package already on npm (a debugging proxy). If this is published it will be
`@agentwik-labs/mcp-xray`.

## Layout

`bin/` CLI · `src/` analyser (REA runner, facts, AST layer, grep baseline, README claims, scoring, report card) ·
`fixtures/` our twins + frozen `truth.json` · `test/` · `scripts/` fetch, build reports, record demo · `results/`
measured JSON · `reports/` HTML cards · `demo/` video, poster, `hub.json`.

## License

MIT, see [LICENSE](LICENSE).
