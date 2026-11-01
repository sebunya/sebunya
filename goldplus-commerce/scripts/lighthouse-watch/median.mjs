// Median-run selection for Lighthouse Watch.
//
// One Lighthouse run per page per week is a coin toss: performance moves 5-10
// points between identical back-to-back runs (network jitter, CPU contention,
// simulated throttling). The watch runs RUNS times (default 3) per URL and form
// factor at 03:00 Kampala, when the extra minutes cost nobody anything, and
// keeps the run whose performance score is the median. Lighthouse CI does the
// same. An unreadable or scoreless run is ignored; with none usable, null.
export function pickMedianRun(lhrs) {
  const usable = lhrs
    .filter((l) => l && typeof l === 'object' && l.categories?.performance && typeof l.categories.performance.score === 'number')
    .sort((a, b) => a.categories.performance.score - b.categories.performance.score);
  if (usable.length === 0) return null;
  return usable[Math.floor((usable.length - 1) / 2)];
}

// "<slug>.<mobile|desktop>.<n>.json" (or the older "<slug>.<ff>.json") → key "<slug>.<ff>"
export function runKey(file) {
  const m = /^(.*)\.(mobile|desktop)(?:\.\d+)?\.json$/.exec(file);
  return m ? { key: `${m[1]}.${m[2]}`, formFactor: m[2] === 'desktop' ? 'DESKTOP' : 'MOBILE' } : null;
}
