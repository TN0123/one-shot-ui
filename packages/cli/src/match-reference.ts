/**
 * Resolve capture viewport + device scale from a reference screenshot.
 *
 * `--match-reference` used to set the viewport to the reference's RAW pixel size
 * while leaving the device scale factor at 1, so a 2x Retina reference (e.g.
 * 3420x1896) was rendered at 3420x1896 CSS px — everything double-size — forcing
 * agents to re-capture and crop. The fix: render at CSS dimensions (raw / dpr)
 * with the device scale factor set to that dpr, so the capture's pixel dimensions
 * match the reference and `compare` aligns without resizing.
 */
export interface MatchReferenceInput {
  rawWidth: number;
  rawHeight: number;
  /** DPR estimated from the reference pixels (estimateDpr). */
  estimatedDpr?: number;
  /** Explicit --reference-dpr override. */
  explicitDpr?: number;
}

export interface MatchReferenceViewport {
  width: number;
  height: number;
  scale: number;
  dpr: number;
}

export function resolveMatchReferenceViewport(input: MatchReferenceInput): MatchReferenceViewport {
  const dpr = input.explicitDpr ?? input.estimatedDpr ?? 1;
  return {
    width: Math.round(input.rawWidth / dpr),
    height: Math.round(input.rawHeight / dpr),
    scale: dpr,
    dpr
  };
}
