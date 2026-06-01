export type Bounds = { x: number; y: number; width: number; height: number };

export type FixIssueLike = {
  code?: string;
  cssSelector?: string;
  anchorName?: string;
  nodeId?: string;
  cssProperty?: string;
  issueBounds?: Bounds;
};

export type FixTarget = {
  /** A selector the agent can actually apply — only set when it's real (DOM diff or scaffold attr). */
  cssSelector?: string;
  /** Where the affected element is, for screenshot-only mode where no real selector exists. */
  region?: Bounds;
  /** Human-readable hint appended to the fix description (region + property to adjust). */
  descriptor?: string;
  /** Maximum confidence this target may be assigned — caps phantom suggestions. */
  confidenceCap: number;
};

const CSS_CATEGORY: Record<string, string> = {
  POSITION_MISMATCH: "position/margin/padding",
  SIZE_MISMATCH: "width/height",
  SPACING_MISMATCH: "margin/padding/gap",
  BORDER_RADIUS_MISMATCH: "border-radius",
  COLOR_MISMATCH: "background-color",
  COLOR_MISMATCH_AT_POSITION: "background-color",
  SHADOW_MISMATCH: "box-shadow",
  GRADIENT_MISMATCH: "background",
  FONT_SIZE_MISMATCH: "font-size",
  FONT_WEIGHT_MISMATCH: "font-weight",
  FONT_FAMILY_MISMATCH: "font-family",
};

export function inferCssCategory(issueCode: string | undefined): string | undefined {
  return issueCode ? CSS_CATEGORY[issueCode] : undefined;
}

/**
 * Decide what an agent should act on for a given diff issue.
 *
 * The tool works from screenshots, so it usually has NO access to the real DOM.
 * A CSS selector cannot be derived from pixels — slugifying OCR'd text produces
 * phantom classes (`.main-content-search-accounts-status-reg-2`) that match nothing
 * in the user's code, which is actively harmful to an agent applying fixes literally.
 *
 * So we only emit a selector when it's genuinely real, and otherwise hand the agent
 * the signal we CAN derive from pixels: the element's region + the property to adjust.
 */
export function resolveFixTarget(issue: FixIssueLike, isScaffoldGenerated: boolean): FixTarget {
  // 1. Real DOM selector (e.g. from --dom-diff against a live URL) — trustworthy.
  if (issue.cssSelector) {
    return { cssSelector: issue.cssSelector, confidenceCap: 1 };
  }

  // 2. Implementation was scaffolded by this tool — data-* attributes really exist.
  if (isScaffoldGenerated && issue.nodeId) {
    return { cssSelector: `[data-node="${issue.nodeId}"]`, confidenceCap: 1 };
  }

  // 3. Screenshot-only / manually-built HTML — never fabricate a selector.
  const region = issue.issueBounds;
  const cssProp = issue.cssProperty ?? inferCssCategory(issue.code);
  const descriptor = region
    ? `element near ${region.x},${region.y} ${region.width}x${region.height}${cssProp ? `, adjust ${cssProp}` : ""}`
    : cssProp
      ? `target element with ${cssProp}`
      : undefined;
  return { region, descriptor, confidenceCap: 0.5 };
}
