import type { CompareIssue } from "@one-shot-ui/core";

/**
 * Detect when semantic layout matching has collapsed.
 *
 * On surfaces the segmenter wasn't tuned for (uniform dark fills, low-contrast
 * mobile screens) the reference yields regions but almost none of them match the
 * implementation. Previously this was silent — the tool went on to emit confident
 * structural/size/color fixes from zero real matches. We surface it loudly instead,
 * so an agent treats the structural fixes with suspicion and falls back to the
 * pixel mismatch + visual inspection.
 */
export function detectLayoutCollapse(params: {
  referenceNodeCount: number;
  matchedNodeCount: number;
}): CompareIssue | null {
  const { referenceNodeCount, matchedNodeCount } = params;

  const noMatchesDespiteStructure = referenceNodeCount >= 2 && matchedNodeCount === 0;
  const nearlyNoMatches = referenceNodeCount >= 5 && matchedNodeCount <= 1;
  if (!noMatchesDespiteStructure && !nearlyNoMatches) {
    return null;
  }

  return {
    code: "LAYOUT_COLLAPSE",
    severity: "high",
    message: `Semantic layout matching collapsed: only ${matchedNodeCount} of ${referenceNodeCount} reference regions matched. Structural, size, color, and spacing findings for this image are unreliable — trust the pixel mismatch ratio and inspect the build visually.`,
    suggestedFix:
      "Could not semantically align this layout. Do not auto-apply structural fixes; verify the implementation by eye and rely on the overall pixel mismatch.",
    reference: { referenceRegions: referenceNodeCount, matchedRegions: matchedNodeCount },
  };
}
