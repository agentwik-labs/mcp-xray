// Playwright for the demo scripts only (record-demo, shot). Not a dependency of mcp-xray itself:
// install it yourself (`npm i --no-save playwright && npx playwright install chromium`) or set PLAYWRIGHT_FROM
// to a directory whose node_modules already has it.
import { createRequire } from "node:module";
import { join } from "node:path";

const from = process.env.PLAYWRIGHT_FROM ? join(process.env.PLAYWRIGHT_FROM, "/") : import.meta.url;
export const { chromium } = createRequire(from)("playwright");
