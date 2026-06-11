import type { Bounds } from "@one-shot-ui/core";

export interface ElementInfo {
  selector: string;
  tag: string;
  /** CSS px, viewport-relative. */
  bounds: Bounds;
  area: number;
  /** DOM depth — containers (smaller depth) are tried first within a pass. */
  depth: number;
  /** innerText trimmed, ≤120 chars. */
  text: string | null;
  /** Computed-style subset keyed by camelCase property. */
  styles: Record<string, string>;
}

export interface MatchedRegion {
  id: string;
  bounds: Bounds;
  fill: string | null;
  borderRadius: number | null;
}

export interface MatchedTextBlock {
  text: string;
  bounds: Bounds;
  fontSize: number | null;
  fontWeight: number | null;
  color: string | null;
}

export interface MatchedElement {
  element: ElementInfo;
  region: MatchedRegion | null;
  textBlocks: MatchedTextBlock[];
  iou: number;
}

export interface Candidate {
  selector: string;
  property: string;
  value: string;
  /** e.g. "geometry:width", "color:fill", "typography:font-size" */
  source: string;
  /** Present → numeric line search around the accepted value applies. */
  numeric?: { base: number; unit: string };
}

export interface AcceptedFix {
  selector: string;
  property: string;
  value: string;
  source: string;
  gainPixels: number;
}

export interface MissingStructure {
  regionId: string;
  bounds: Bounds;
  note: string;
}

export interface ConvergeReport {
  initialMismatchRatio: number;
  finalMismatchRatio: number;
  initialMismatchPixels: number;
  finalMismatchPixels: number;
  evals: number;
  passes: number;
  accepted: AcceptedFix[];
  rejectedCount: number;
  missingStructure: MissingStructure[];
  verdict: "pixel-converged" | "css-exhausted" | "budget-exhausted";
  patchCss: string;
}
