import type { CompareIssue } from "@one-shot-ui/core";

const REMOVAL_CODES = new Set(["MISSING_NODE", "EXTRA_NODE", "LAYOUT_COUNT_MISMATCH", "TEXT_COUNT_MISMATCH"]);

/** A POSITION_MISMATCH whose offset is predominantly vertical — the signature of reflow. */
function isVerticalShift(issue: CompareIssue): boolean {
  if (issue.code !== "POSITION_MISMATCH") return false;
  const ref = issue.reference as { x?: number; y?: number } | undefined;
  const impl = issue.implementation as { x?: number; y?: number } | undefined;
  const dy = (issue as { deltaY?: number }).deltaY ??
    (ref?.y != null && impl?.y != null ? impl.y - ref.y : null);
  if (dy == null) return false;
  const dx = (issue as { deltaX?: number }).deltaX ??
    (ref?.x != null && impl?.x != null ? impl.x - ref.x : null);
  const adx = dx == null ? 0 : Math.abs(dx);
  return Math.abs(dy) > 4 && Math.abs(dy) >= adx;
}

/**
 * When an element is removed or added, everything below it shifts — and each downstream shift was
 * being emitted as its own POSITION_MISMATCH "fix" (the audit saw one deleted row spawn 14-23
 * contradictory phantom fixes). Those positions aren't independently wrong; they're a single reflow.
 *
 * If there's a removal/count mismatch AND a cascade of vertical shifts, collapse the cascade into one
 * note telling the agent to fix the missing/extra element first and re-check positions afterward.
 */
export function collapseReflowCascade(issues: CompareIssue[]): CompareIssue[] {
  const hasRemoval = issues.some((i) => REMOVAL_CODES.has(i.code));
  if (!hasRemoval) return issues;

  const cascade = issues.filter(isVerticalShift);
  if (cascade.length < 3) return issues;

  const kept = issues.filter((i) => !cascade.includes(i));
  kept.push({
    code: "REFLOW_CASCADE",
    severity: "medium",
    message: `${cascade.length} elements below removed/added content are shifted vertically — this is reflow from the element-count change, not ${cascade.length} independent position bugs.`,
    suggestedFix: "Fix the missing/extra element first; most of these vertical offsets resolve once the element count matches. Then re-run to check any remaining positions.",
  } as CompareIssue);
  return kept;
}
