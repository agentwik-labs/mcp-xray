// Downloads each target as a registry tarball (npm pack, scripts ignored) and extracts it under targets/.
// Nothing is installed and no target code is run.
import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync, readdirSync, existsSync, rmSync } from "node:fs";
const list = JSON.parse(readFileSync("targets.json", "utf8"));
mkdirSync("targets", { recursive: true });
for (const pkg of list) {
  const dir = `targets/${pkg.replace(/[@/]/g, "_").replace(/^_/, "")}`;
  if (existsSync(`${dir}/package/package.json`)) { console.log("have", pkg); continue; }
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  execFileSync("npm", ["pack", pkg, "--ignore-scripts", "--silent", "--pack-destination", dir], { stdio: ["ignore", "pipe", "inherit"] });
  const tgz = readdirSync(dir).find((f) => f.endsWith(".tgz"));
  execFileSync("tar", ["-xzf", `${dir}/${tgz}`, "--no-same-owner", "--no-same-permissions", "-C", dir]);
  console.log("got", pkg, tgz);
}
