// Scores findings against a frozen ground-truth list: same category, same file, line in the item's lines.
export function score(findings, truth) {
  const hit = new Set();
  const fps = [];
  const keyed = new Map();
  for (const f of findings) { const k = `${f.category}|${f.file}|${f.line}`; if (!keyed.has(k)) keyed.set(k, f); }
  for (const [k, f] of keyed) {
    const t = truth.find((t) => t.category === f.category && t.file === f.file && t.lines.includes(f.line));
    if (t) hit.add(t.id); else fps.push(f);
  }
  const planted = truth.filter((t) => t.planted);
  return {
    found: truth.filter((t) => hit.has(t.id)).map((t) => t.id),
    missed: truth.filter((t) => !hit.has(t.id)).map((t) => t.id),
    planted_found: planted.filter((t) => hit.has(t.id)).length,
    planted_total: planted.length,
    real_found: truth.filter((t) => !t.planted && hit.has(t.id)).length,
    real_total: truth.filter((t) => !t.planted).length,
    false_positives: fps.length,
    fp_detail: fps.map((f) => `${f.category} ${f.file}:${f.line} ${f.value ?? ""}`.trim()),
  };
}
