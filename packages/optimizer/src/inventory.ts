import type { Page } from "playwright";
import type { ElementInfo } from "./types.js";

export const STYLE_KEYS = [
  "width",
  "height",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "marginTop",
  "marginRight",
  "marginBottom",
  "marginLeft",
  "gap",
  "rowGap",
  "columnGap",
  "backgroundColor",
  "color",
  "borderRadius",
  "borderWidth",
  "borderColor",
  "fontSize",
  "fontWeight",
  "fontFamily",
  "lineHeight",
  "letterSpacing",
  "boxShadow",
  "display",
  "position",
] as const;

/**
 * Runs INSIDE the browser via page.evaluate — must stay fully self-contained
 * (no outer-scope captures, serialized with Function.prototype.toString).
 */
function collectElementsInPage(styleKeys: string[], maxElements: number): ElementInfo[] {
  function cssEscapeIdent(s: string): string {
    const css = (window as any).CSS;
    return css && css.escape ? css.escape(s) : s.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }
  function buildSelector(el: Element): string {
    const id = (el as HTMLElement).id;
    if (id) {
      const sel = `#${cssEscapeIdent(id)}`;
      if (document.querySelectorAll(sel).length === 1) return sel;
    }
    const parts: string[] = [];
    let cur: Element | null = el;
    while (cur && cur !== document.documentElement) {
      let part = cur.tagName.toLowerCase();
      const cls = Array.from((cur as HTMLElement).classList).slice(0, 2);
      if (cls.length) part += "." + cls.map(cssEscapeIdent).join(".");
      const parent: Element | null = cur.parentElement;
      if (parent) {
        const sameTag = Array.from(parent.children).filter((c) => c.tagName === cur!.tagName);
        if (sameTag.length > 1) part += `:nth-of-type(${sameTag.indexOf(cur) + 1})`;
      }
      parts.unshift(part);
      const candidate = parts.join(" > ");
      if (document.querySelectorAll(candidate).length === 1) return candidate;
      cur = parent;
    }
    return parts.join(" > ");
  }
  function depthOf(el: Element): number {
    let d = 0;
    let cur = el.parentElement;
    while (cur) {
      d++;
      cur = cur.parentElement;
    }
    return d;
  }
  // Is this element's text cut off by an overflow box (on itself or an ancestor)?
  // Deterministic — scrollSize vs clientSize under a clipping overflow, no OCR, no
  // pixel hit-testing. (Occlusion — text painted over by an opaque overlay — is a
  // plausible but unobserved failure; a reliable detector needs glyph-level, not
  // single-point, testing, so it is intentionally not attempted here. Add one when
  // a real occlusion case appears. ponytail: clip-only, add occlude when data shows it.)
  function hiddenReason(el: Element, r: DOMRect): "clip" | null {
    const CLIP = ["hidden", "clip", "scroll", "auto"];
    let node: Element | null = el;
    while (node && node !== document.documentElement) {
      const s = window.getComputedStyle(node);
      const clipY = CLIP.indexOf(s.overflowY) >= 0 && node.scrollHeight > node.clientHeight + 2;
      const clipX = CLIP.indexOf(s.overflowX) >= 0 && node.scrollWidth > node.clientWidth + 2;
      if (clipY || clipX) {
        if (node === el) return "clip";
        const nr = node.getBoundingClientRect();
        // An ancestor clips THIS text only if the text box spills past its client area.
        if (r.top < nr.top - 2 || r.bottom > nr.bottom + 2 || r.left < nr.left - 2 || r.right > nr.right + 2)
          return "clip";
      }
      node = node.parentElement;
    }
    return null;
  }
  const skipTags = ["SCRIPT", "STYLE", "LINK", "META", "NOSCRIPT", "BR", "HEAD", "TITLE"];
  const out: ElementInfo[] = [];
  const all = document.body ? Array.from(document.body.querySelectorAll("*")) : [];
  for (const el of all) {
    if (skipTags.includes(el.tagName)) continue;
    const r = el.getBoundingClientRect();
    if (r.width * r.height < 16) continue;
    if (r.bottom < 0 || r.right < 0 || r.top > window.innerHeight || r.left > window.innerWidth) continue;
    const cs = window.getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) continue;
    const styles: Record<string, string> = {};
    for (const k of styleKeys) styles[k] = (cs as any)[k] ?? "";
    const raw = (el as HTMLElement).innerText;
    const text = raw ? raw.trim().slice(0, 120) : "";
    out.push({
      selector: buildSelector(el),
      tag: el.tagName.toLowerCase(),
      classes: Array.from((el as HTMLElement).classList).slice(0, 3),
      bounds: {
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.round(r.width),
        height: Math.round(r.height),
      },
      area: Math.round(r.width * r.height),
      depth: depthOf(el),
      text: text.length ? text : null,
      styles,
      hidden: text.length ? hiddenReason(el, r) : null,
    });
  }
  // Keep the largest elements when over the cap…
  out.sort((a, b) => b.area - a.area);
  const top = out.slice(0, maxElements);
  // …then restore deterministic container-first, top-down order.
  top.sort((a, b) => a.depth - b.depth || a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x);
  return top;
}

export async function collectElements(page: Page, maxElements = 200): Promise<ElementInfo[]> {
  return (await page.evaluate(
    ([fnSrc, keys, max]) => {
      const fn = new Function(`return (${fnSrc})`)() as (k: string[], m: number) => unknown;
      return fn(keys as string[], max as number);
    },
    [collectElementsInPage.toString(), STYLE_KEYS as unknown as string[], maxElements] as const,
  )) as ElementInfo[];
}
