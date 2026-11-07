// What the package says about itself: env var names and hosts mentioned in its README / package.json.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
export function readmeClaims(root) {
  const name = readdirSync(root).find((f) => /^readme(\.md|\.markdown|\.txt)?$/i.test(f));
  const text = name ? readFileSync(join(root, name), "utf8") : "";
  let pkg = {}; try { pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")); } catch {}
  const all = text + "\n" + (pkg.description || "") + "\n" + (pkg.homepage || "");
  const env = new Set([...all.matchAll(/\b([A-Z][A-Z0-9]*_[A-Z0-9_]+)\b/g)].map((m) => m[1]));
  const hosts = new Set([...all.matchAll(/\b((?:[a-z0-9-]+\.)+[a-z]{2,})\b/gi)].map((m) => m[1].toLowerCase()).filter((h) => !/\.(md|js|ts|json|py|png|jpg|gif|svg|txt|yml|yaml|sh|tsx|html)$/.test(h)));
  return { readme: name || null, readme_bytes: text.length, env, hosts, text: all.toLowerCase(), pkg };
}
// a host counts as documented if the README names it, a parent domain of it, or a subdomain of it
export function hostDocumented(host, claims) {
  if (!host || host.startsWith("(")) return false;
  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/.test(host)) return true;
  const base = host.split(".").slice(-2).join(".");
  return [...claims.hosts].some((h) => h === host || host.endsWith("." + h) || h.endsWith("." + host) || h.split(".").slice(-2).join(".") === base);
}
