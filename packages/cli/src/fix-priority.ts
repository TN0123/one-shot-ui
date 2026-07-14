// Order suggested fixes by what humans actually notice, not by pixel weight.
// Design2Code's human-preference study (arXiv 2403.03163) found layout/position
// and presence-of-content dominate perceived fidelity, color matters less, and
// exact text/typography barely registers. So a missing section or overlapping
// text should be surfaced to the model before a font-weight tweak — regardless of
// how many pixels each moves.

export interface RankableFix {
  priority?: string; // "high" | "medium" | "low"
  category?: string;
  issueCode?: string;
}

/** Lower = fix this first. */
export function humanSeverityRank(fix: RankableFix): number {
  const cat = (fix.category ?? "").toLowerCase();
  const code = (fix.issueCode ?? "").toUpperCase();
  // Missing / extra content and overlapping text — the failures humans see first.
  if (cat.includes("structure") || cat.includes("content") || code.includes("MISSING") || code.includes("EXTRA")) return 0;
  if (cat.includes("overlap") || code.includes("OVERLAP")) return 0;
  // Placement: layout, position, spacing, alignment.
  if (cat.includes("layout") || cat.includes("position") || cat.includes("spacing") || cat.includes("align")) return 1;
  if (cat.includes("size") || cat.includes("dimension")) return 2;
  if (cat.includes("color")) return 3;
  if (cat.includes("typograph") || cat.includes("font") || cat.includes("text")) return 4;
  return 2.5;
}

const priorityRank = (p?: string): number => (p === "high" ? 0 : p === "medium" ? 1 : p === "low" ? 2 : 1.5);

/**
 * Stable re-sort by human severity first, then by the tool's own priority within
 * a severity tier. Reorders only — never adds or drops fixes.
 */
export function sortFixesByHumanSeverity<T extends RankableFix>(fixes: T[]): T[] {
  return [...fixes].sort(
    (a, b) => humanSeverityRank(a) - humanSeverityRank(b) || priorityRank(a.priority) - priorityRank(b.priority),
  );
}
