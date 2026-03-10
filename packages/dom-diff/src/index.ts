import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { chromium } from "playwright";
import type { Bounds, CompareIssue, DomElement, LayoutNode, SemanticAnchor } from "@one-shot-ui/core";

const EXTRACTED_STYLE_PROPERTIES = [
  "display",
  "position",
  "width",
  "height",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "border-radius",
  "border-width",
  "border-color",
  "border-style",
  "background-color",
  "color",
  "font-size",
  "font-weight",
  "font-family",
  "line-height",
  "letter-spacing",
  "box-shadow",
  "gap",
  "flex-direction",
  "justify-content",
  "align-items",
  "grid-template-columns",
  "grid-template-rows",
  "opacity"
] as const;

export interface ExtractDomOptions {
  url?: string;
  filePath?: string;
  width?: number;
  height?: number;
  deviceScaleFactor?: number;
}

/**
 * Extracts the DOM tree from an implementation page, including computed styles
 * and bounding boxes for all visible elements.
 */
export async function extractDomTree(options: ExtractDomOptions): Promise<DomElement[]> {
  const { url, filePath, width = 1440, height = 1024, deviceScaleFactor = 1 } = options;

  if (!url && !filePath) {
    throw new Error("Either url or filePath is required");
  }

  let browser;
  try {
    browser = await chromium.launch();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Executable doesn't exist")) {
      throw new Error("Playwright Chromium is not installed. Run `bun run install:browsers` and retry.");
    }
    throw error;
  }

  try {
    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor
    });

    const target = url ?? pathToFileURL(resolve(filePath!)).href;
    await page.goto(target, { waitUntil: "networkidle" });

    const elements = await page.evaluate((styleProps: string[]) => {
      function extractElement(el: Element, depth: number): any | null {
        if (depth > 8) return null;

        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return null;

        const computed = window.getComputedStyle(el);
        const style: Record<string, string> = {};
        for (const prop of styleProps) {
          style[prop] = computed.getPropertyValue(prop);
        }

        const children: any[] = [];
        for (const child of el.children) {
          const extracted = extractElement(child, depth + 1);
          if (extracted) children.push(extracted);
        }

        // Build a unique selector
        const tag = el.tagName.toLowerCase();
        const id = el.id ? `#${el.id}` : "";
        const classes = el.className && typeof el.className === "string"
          ? "." + el.className.trim().split(/\s+/).join(".")
          : "";
        const selector = `${tag}${id}${classes}`;

        return {
          selector,
          tagName: tag,
          bounds: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          },
          computedStyle: style,
          children: children.length > 0 ? children : undefined
        };
      }

      const body = document.body;
      if (!body) return [];

      const results: any[] = [];
      for (const child of body.children) {
        const extracted = extractElement(child, 0);
        if (extracted) results.push(extracted);
      }
      return results;
    }, [...EXTRACTED_STYLE_PROPERTIES]);

    return elements;
  } finally {
    await browser.close();
  }
}

/**
 * Compares DOM elements from the implementation against reference layout nodes.
 * Produces issues expressed in CSS property terms rather than absolute pixel coordinates.
 */
export function compareDomToExtract(
  domElements: DomElement[],
  referenceNodes: LayoutNode[],
  anchors: SemanticAnchor[] = []
): CompareIssue[] {
  const flatDom = flattenDomTree(domElements);
  const issues: CompareIssue[] = [];

  // Match DOM elements to reference nodes by position/size similarity
  const matches = matchDomToLayout(flatDom, referenceNodes);

  for (const match of matches) {
    const { dom, reference } = match;
    const domBounds = dom.bounds;
    const refBounds = reference.bounds;
    const style = dom.computedStyle;
    const anchor = anchors.find((candidate) => candidate.nodeId === reference.id);
    const anchorName = anchor?.name ?? reference.id;

    // Position comparison
    const deltaX = domBounds.x - refBounds.x;
    const deltaY = domBounds.y - refBounds.y;
    if (Math.abs(deltaX) > 6 || Math.abs(deltaY) > 6) {
      const marginSuggestions: string[] = [];
      if (Math.abs(deltaY) > 6) {
        marginSuggestions.push(`${deltaY > 0 ? "move it up" : "move it down"} by ${Math.abs(deltaY)}px`);
      }
      if (Math.abs(deltaX) > 6) {
        marginSuggestions.push(`${deltaX > 0 ? "move it left" : "move it right"} by ${Math.abs(deltaX)}px`);
      }

      issues.push({
        code: "DOM_POSITION_MISMATCH",
        nodeId: reference.id,
        anchorId: anchor?.id,
        anchorName: anchor?.name,
        contextPath: anchor?.name,
        cssSelector: dom.selector,
        severity: Math.abs(deltaX) > 16 || Math.abs(deltaY) > 16 ? "high" : "medium",
        message: `${anchorName} (${dom.selector}) is offset from the reference position by ${deltaX}px horizontal and ${deltaY}px vertical.`,
        suggestedFix: marginSuggestions.join("; "),
        cssProperty: "margin",
        reference: { x: refBounds.x, y: refBounds.y },
        implementation: { x: domBounds.x, y: domBounds.y }
      });
    }

    // Size comparison
    const widthDelta = domBounds.width - refBounds.width;
    const heightDelta = domBounds.height - refBounds.height;
    if (Math.abs(widthDelta) > 6 || Math.abs(heightDelta) > 6) {
      const suggestions: string[] = [];
      if (Math.abs(widthDelta) > 6) suggestions.push(`width: ${refBounds.width}px`);
      if (Math.abs(heightDelta) > 6) suggestions.push(`height: ${refBounds.height}px`);

      issues.push({
        code: "DOM_SIZE_MISMATCH",
        nodeId: reference.id,
        anchorId: anchor?.id,
        anchorName: anchor?.name,
        contextPath: anchor?.name,
        cssSelector: dom.selector,
        severity: Math.abs(widthDelta) > 16 || Math.abs(heightDelta) > 16 ? "high" : "medium",
        message: `${anchorName} (${dom.selector}) size differs: width ${signedPx(widthDelta)}, height ${signedPx(heightDelta)}.`,
        suggestedFix: suggestions.length > 0 ? suggestions.join("; ") : undefined,
        cssProperty: "width/height",
        reference: { width: refBounds.width, height: refBounds.height },
        implementation: { width: domBounds.width, height: domBounds.height }
      });
    }

    // Border radius comparison
    if (reference.borderRadius !== null && reference.borderRadius !== undefined) {
      const domRadius = parsePx(style["border-radius"]);
      const radiusDelta = Math.abs(domRadius - reference.borderRadius);
      if (radiusDelta >= 2) {
        issues.push({
          code: "DOM_STYLE_MISMATCH",
          nodeId: reference.id,
          anchorId: anchor?.id,
          anchorName: anchor?.name,
          contextPath: anchor?.name,
          cssSelector: dom.selector,
          severity: radiusDelta >= 6 ? "medium" : "low",
          message: `${anchorName} (${dom.selector}) border-radius is ${domRadius}px, reference is ${reference.borderRadius}px.`,
          suggestedFix: `border-radius: ${reference.borderRadius}px`,
          cssProperty: "border-radius",
          reference: { borderRadius: reference.borderRadius },
          implementation: { borderRadius: domRadius }
        });
      }
    }

    // Background color comparison
    if (reference.fill) {
      const domBgColor = style["background-color"];
      if (domBgColor && domBgColor !== "rgba(0, 0, 0, 0)" && domBgColor !== "transparent") {
        const domHex = rgbaToHex(domBgColor);
        if (domHex) {
          const colorDelta = hexDistance(reference.fill, domHex);
          if (colorDelta >= 24) {
            issues.push({
              code: "DOM_STYLE_MISMATCH",
              nodeId: reference.id,
              anchorId: anchor?.id,
              anchorName: anchor?.name,
              contextPath: anchor?.name,
              cssSelector: dom.selector,
              severity: colorDelta >= 64 ? "medium" : "low",
              message: `${anchorName} (${dom.selector}) background-color is ${domBgColor}, reference fill is ${reference.fill}.`,
              suggestedFix: `background-color: ${reference.fill}`,
              cssProperty: "background-color",
              reference: { fill: reference.fill },
              implementation: { fill: domHex }
            });
          }
        }
      }
    }
  }

  return issues;
}

interface FlatDomElement {
  selector: string;
  tagName: string;
  bounds: Bounds;
  computedStyle: Record<string, string>;
}

function flattenDomTree(elements: DomElement[]): FlatDomElement[] {
  const flat: FlatDomElement[] = [];

  function walk(el: DomElement) {
    flat.push({
      selector: el.selector,
      tagName: el.tagName,
      bounds: el.bounds,
      computedStyle: el.computedStyle
    });
    if (el.children) {
      for (const child of el.children) {
        walk(child as DomElement);
      }
    }
  }

  for (const el of elements) {
    walk(el);
  }
  return flat;
}

function matchDomToLayout(
  domElements: FlatDomElement[],
  referenceNodes: LayoutNode[]
): Array<{ dom: FlatDomElement; reference: LayoutNode }> {
  const available = new Set(domElements.map((_, i) => i));
  const matches: Array<{ dom: FlatDomElement; reference: LayoutNode; score: number }> = [];

  for (const reference of referenceNodes) {
    let best: { index: number; score: number } | null = null;

    for (const index of available) {
      const dom = domElements[index]!;
      const score = boundsOverlapScore(reference.bounds, dom.bounds);
      if (score > 0.4 && (!best || score > best.score)) {
        best = { index, score };
      }
    }

    if (best) {
      available.delete(best.index);
      matches.push({
        dom: domElements[best.index]!,
        reference,
        score: best.score
      });
    }
  }

  return matches;
}

function boundsOverlapScore(a: Bounds, b: Bounds): number {
  const overlapX = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const overlapY = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const overlapArea = overlapX * overlapY;
  const unionArea = a.width * a.height + b.width * b.height - overlapArea;
  if (unionArea === 0) return 0;
  return overlapArea / unionArea;
}

function parsePx(value: string | undefined): number {
  if (!value) return 0;
  const match = value.match(/^(-?\d+(?:\.\d+)?)px$/);
  return match ? Number.parseFloat(match[1]!) : 0;
}

function signedPx(value: number): string {
  return `${value > 0 ? "+" : ""}${value}px`;
}

function rgbaToHex(rgba: string): string | null {
  const match = rgba.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!match) return null;
  const r = Number.parseInt(match[1]!, 10);
  const g = Number.parseInt(match[2]!, 10);
  const b = Number.parseInt(match[3]!, 10);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

function hexDistance(a: string, b: string): number {
  const ar = Number.parseInt(a.replace("#", "").slice(0, 2), 16);
  const ag = Number.parseInt(a.replace("#", "").slice(2, 4), 16);
  const ab = Number.parseInt(a.replace("#", "").slice(4, 6), 16);
  const br = Number.parseInt(b.replace("#", "").slice(0, 2), 16);
  const bg = Number.parseInt(b.replace("#", "").slice(2, 4), 16);
  const bb = Number.parseInt(b.replace("#", "").slice(4, 6), 16);
  return Math.abs(ar - br) + Math.abs(ag - bg) + Math.abs(ab - bb);
}
