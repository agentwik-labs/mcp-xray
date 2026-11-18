// Fetching a package from the npm registry as a tarball, without installing it or running any of its scripts.
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

// "@scope/name" -> "scope_name": a safe directory or file name for a package.
export const packageId = (pkg) => pkg.replace(/[@/]/g, "_").replace(/^_/, "");

// Downloads the registry tarball into dir with `npm pack --ignore-scripts` and extracts it; returns the package root.
export function fetchPackage(spec, dir) {
  mkdirSync(dir, { recursive: true });
  execFileSync("npm", ["pack", spec, "--ignore-scripts", "--silent", "--pack-destination", dir], { stdio: ["ignore", "pipe", "inherit"] });
  const tgz = readdirSync(dir).find((f) => f.endsWith(".tgz"));
  if (!tgz) throw new Error(`npm pack produced no tarball for ${spec}`);
  execFileSync("tar", ["-xzf", join(dir, tgz), "--no-same-owner", "--no-same-permissions", "-C", dir]);
  return join(dir, "package");
}
