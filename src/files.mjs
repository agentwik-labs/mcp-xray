// Lists the JavaScript files of an extracted package (what both REA and the grep baseline look at).
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
export function jsFiles(root, dir = root, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { if (name !== "node_modules" && name !== ".git") jsFiles(root, p, out); }
    else if (/\.(c|m)?(js|ts)$/.test(name) && !/\.d\.(c|m)?ts$/.test(name) && st.size < 8e6) {
      const rel = relative(root, p);
      if (!/(^|\/)(__tests__|test|tests)\/|\.(test|spec)\.|(^|\/)vitest\.config|(^|\/)jest\.config/.test(rel)) out.push(rel);
    }
  }
  return out.sort();
}
