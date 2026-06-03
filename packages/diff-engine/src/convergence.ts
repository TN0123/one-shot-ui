// Deterministic convergence assessment for a compare report.
//
// The headline pixel-mismatch ratio is dominated by background and reads as "almost
// done" even when the build is structurally incomplete (e.g. 3.5% mismatch while only
// 17 of 51 elements exist). This turns the same signals the report already computes —
// node coverage, visual hierarchy, adjusted mismatch, worst-region concentration —
// into a single verdict + human reasons an agent can act on, so it keeps iterating
// instead of stopping on a misleadingly low percentage.

export interface ConvergenceInput {
  /** Adjusted pixel-mismatch ratio, 0..1. */
  adjustedMismatch: number;
  /** Visual hierarchy score, 0..100. */
  hierarchyScore: number;
  /** Number of layout nodes detected in the reference. */
  refNodeCount: number;
  /** Number of layout nodes detected in the build. */
  builtNodeCount: number;
  /** Share of total mismatch concentrated in the single worst region, 0..1. */
  topRegionContribution?: number;
}

export interface ConvergenceAssessment {
  status: "converged" | "not-converged";
  reasons: string[];
  completeness: {
    /** builtNodeCount / refNodeCount, 0..1; null when the reference has no nodes. */
    nodeCoverage: number | null;
    refNodeCount: number;
    builtNodeCount: number;
    hierarchyScore: number;
  };
}

export const CONVERGENCE_THRESHOLDS = {
  /** Build must reproduce at least this share of reference layout nodes. */
  minNodeCoverage: 0.8,
  /** Visual hierarchy below this means content/structure is likely missing. */
  minHierarchyScore: 60,
  /** Adjusted pixel mismatch above this is not yet converged. */
  maxAdjustedMismatch: 0.05,
  /** A single region holding more than this share of mismatch is worth calling out… */
  maxTopRegionContribution: 0.6,
  /** …but only when overall mismatch is above this floor (else the region is noise). */
  topRegionMismatchFloor: 0.03,
} as const;

export function assessConvergence(input: ConvergenceInput): ConvergenceAssessment {
  const t = CONVERGENCE_THRESHOLDS;
  const reasons: string[] = [];

  const nodeCoverage = input.refNodeCount > 0 ? input.builtNodeCount / input.refNodeCount : null;

  if (nodeCoverage != null && nodeCoverage < t.minNodeCoverage) {
    const missing = Math.max(0, input.refNodeCount - input.builtNodeCount);
    reasons.push(
      `structural coverage ${Math.round(nodeCoverage * 100)}% — ${missing} of ${input.refNodeCount} reference elements may be missing`
    );
  }

  if (input.hierarchyScore < t.minHierarchyScore) {
    reasons.push(
      `low visual hierarchy (${Math.round(input.hierarchyScore)}/100) — implementation likely missing content or structure`
    );
  }

  if (input.adjustedMismatch > t.maxAdjustedMismatch) {
    reasons.push(
      `pixel mismatch ${(input.adjustedMismatch * 100).toFixed(1)}% exceeds the ${(t.maxAdjustedMismatch * 100).toFixed(0)}% target`
    );
  }

  if (
    input.topRegionContribution != null &&
    input.topRegionContribution > t.maxTopRegionContribution &&
    input.adjustedMismatch > t.topRegionMismatchFloor
  ) {
    reasons.push(
      `one region holds ${Math.round(input.topRegionContribution * 100)}% of the mismatch — focus your next edits there`
    );
  }

  return {
    status: reasons.length === 0 ? "converged" : "not-converged",
    reasons,
    completeness: {
      nodeCoverage,
      refNodeCount: input.refNodeCount,
      builtNodeCount: input.builtNodeCount,
      hierarchyScore: Math.round(input.hierarchyScore),
    },
  };
}
