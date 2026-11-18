// Downloads each package in targets.json, at the pinned version that was measured, as a registry tarball
// (npm pack, scripts ignored) and extracts it under targets/<id>/package. Nothing is installed and no target code is run.
import { readFileSync, existsSync, rmSync } from "node:fs";
import { fetchPackage, packageId } from "../src/targets.mjs";

const pinned = JSON.parse(readFileSync("targets.json", "utf8"));
for (const [pkg, version] of Object.entries(pinned)) {
  const dir = `targets/${packageId(pkg)}`;
  if (existsSync(`${dir}/package/package.json`)) { console.log("have", pkg); continue; }
  rmSync(dir, { recursive: true, force: true });
  fetchPackage(`${pkg}@${version}`, dir);
  console.log("got", `${pkg}@${version}`);
}
