import type { CompareIssue } from "@one-shot-ui/core";

// Whole-image signals, plus colour: a recoloured element is actionable no matter how small it is
// (a wrong-coloured badge or button matters), so colour issues must not be dropped by area.
const AREA_EXEMPT_CODES = new Set([
  "DIMENSION_MISMATCH",
  "PIXEL_DIFFERENCE",
  "REGION_SEMANTIC_FALLBACK",
  "COLOR_MISMATCH",
  "COLOR_MISMATCH_AT_POSITION",
]);

/**
 * Decide whether an issue survives the low-contribution filter. Issues whose mismatch covers less
 * than `minRatio` of the image are usually noise — EXCEPT exempt codes (whole-image signals and
 * colour), which stay regardless of size.
 */
export function keepIssueByContribution(issue: CompareIssue, totalArea: number, minRatio = 0.01): boolean {
  if (!issue.issueBounds) return true;
  if (AREA_EXEMPT_CODES.has(issue.code)) return true;
  if (totalArea <= 0) return true;
  const area = issue.issueBounds.width * issue.issueBounds.height;
  return area / totalArea >= minRatio;
}
