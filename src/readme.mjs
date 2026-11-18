// What the package says about itself: env var names and hosts mentioned in its README / package.json.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const README = /^readme(\.md|\.markdown|\.txt)?$/i;
const ENV_NAME = /\b([A-Z][A-Z0-9]*_[A-Z0-9_]+)\b/g;
const DOMAIN = /\b((?:[a-z0-9-]+\.)+[a-z]{2,})\b/gi;
const FILE_EXT = /\.(md|js|ts|json|py|png|jpg|gif|svg|txt|yml|yaml|sh|tsx|html)$/;
const LOCAL = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/;

export function readmeClaims(root) {
  const name = readdirSync(root).find((f) => README.test(f));
  const text = name ? readFileSync(join(root, name), "utf8") : "";
  let pkg = {};
  try { pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")); } catch { /* no or invalid package.json */ }
  const all = text + "\n" + (pkg.description || "") + "\n" + (pkg.homepage || "");
  const env = new Set([...all.matchAll(ENV_NAME)].map((m) => m[1]));
  const hosts = new Set([...all.matchAll(DOMAIN)].map((m) => m[1].toLowerCase()).filter((h) => !FILE_EXT.test(h)));
  return { readme: name || null, readme_bytes: text.length, env, hosts, text: all.toLowerCase(), pkg };
}

// A host counts as documented if the README names it, a parent domain of it, a subdomain of it,
// or another host under the same registrable-looking base (last two labels).
export function hostDocumented(host, claims) {
  if (!host || host.startsWith("(")) return false;
  if (LOCAL.test(host)) return true;
  const base = host.split(".").slice(-2).join(".");
  return [...claims.hosts].some((h) => h === host || host.endsWith("." + h) || h.endsWith("." + host) || h.split(".").slice(-2).join(".") === base);
}
