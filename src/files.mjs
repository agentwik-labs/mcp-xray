// Lists the JavaScript files of an extracted package (what both REA and the grep baseline look at).
// Symlinks are skipped, so a package cannot point the analyser at files outside itself.
import { readdirSync, lstatSync } from "node:fs";
import { join, relative } from "node:path";

const SOURCE = /\.(c|m)?(js|ts)$/;
const TYPES_ONLY = /\.d\.(c|m)?ts$/;
const TEST_OR_CONFIG = /(^|\/)(__tests__|test|tests)\/|\.(test|spec)\.|(^|\/)vitest\.config|(^|\/)jest\.config/;
const MAX_BYTES = 8e6;

export function jsFiles(root, dir = root, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) {
      if (name !== "node_modules" && name !== ".git") jsFiles(root, p, out);
    } else if (SOURCE.test(name) && !TYPES_ONLY.test(name) && st.size < MAX_BYTES) {
      const rel = relative(root, p);
      if (!TEST_OR_CONFIG.test(rel)) out.push(rel);
    }
  }
  return out.sort();
}
