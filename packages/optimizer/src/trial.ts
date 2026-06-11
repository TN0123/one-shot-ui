import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import type { Page } from "playwright";

/** Minimum mismatch-pixel reduction to accept a candidate (anti-AA-churn). */
export const MIN_GAIN_PIXELS = 8;

/**
 * Stricter than compare's 0.12: at 0.12 pixelmatch's YIQ cutoff (~507) is blind
 * to dark-theme color drift (e.g. #1C1D26 vs #262834 ≈ 62), and at 0.03 (~32)
 * still blind to adjacent-surface edges (#1C1D26 card vs #15161C body ≈ 28),
 * which silently vetoes small position fixes. 0.02 (~14) sees both; pixelmatch
 * AA detection + MIN_GAIN_PIXELS keep anti-aliasing churn out of acceptance.
 */
export const OBJECTIVE_THRESHOLD = 0.02;

const SETTLE_MS = 60;
const STYLE_TAG_ID = "one-shot-ui-converge";
const PREP_TAG_ID = "one-shot-ui-converge-prep";

export interface Objective {
  /** Mismatch pixel count of the current page vs the reference. */
  measure(): Promise<number>;
  readonly totalPixels: number;
}

export function createObjective(
  page: Page,
  referenceRgba: Uint8ClampedArray,
  width: number,
  height: number,
  threshold: number = OBJECTIVE_THRESHOLD,
): Objective {
  const total = width * height;
  const refData = new Uint8Array(referenceRgba.buffer, referenceRgba.byteOffset, referenceRgba.byteLength);
  return {
    totalPixels: total,
    async measure(): Promise<number> {
      const buf = await page.screenshot({ fullPage: false });
      const shot = PNG.sync.read(Buffer.from(buf));
      if (shot.width !== width || shot.height !== height) {
        throw new Error(
          `Screenshot is ${shot.width}x${shot.height}, expected ${width}x${height} (reference raw px). Viewport/DPR drift.`,
        );
      }
      return pixelmatch(refData, shot.data, undefined, width, height, { threshold });
    },
  };
}

/** selector → property → value, rendered in insertion order (deterministic). */
export function rulesToCss(rules: Map<string, Map<string, string>>): string {
  const lines: string[] = [];
  for (const [selector, props] of rules) {
    if (!props.size) continue;
    const decls = [...props.entries()].map(([p, v]) => `${p}: ${v} !important;`).join(" ");
    lines.push(`${selector} { ${decls} }`);
  }
  return lines.join("\n");
}

export class StyleBank {
  constructor(private page: Page) {}

  async setRules(rules: Map<string, Map<string, string>>): Promise<void> {
    const css = rulesToCss(rules);
    await this.page.evaluate(
      ([id, text]) => {
        let tag = document.getElementById(id!);
        if (!tag) {
          tag = document.createElement("style");
          tag.id = id!;
          document.head.appendChild(tag);
        }
        tag.textContent = text!;
      },
      [STYLE_TAG_ID, css] as const,
    );
  }
}

/** Kill animation/transition noise and wait for fonts so trials are deterministic. */
export async function preparePage(page: Page): Promise<void> {
  await page.evaluate((id) => {
    let tag = document.getElementById(id);
    if (!tag) {
      tag = document.createElement("style");
      tag.id = id;
      document.head.appendChild(tag);
    }
    tag.textContent =
      "*, *::before, *::after { transition: none !important; animation: none !important; caret-color: transparent !important; }";
    return (document as any).fonts?.ready;
  }, PREP_TAG_ID);
  await page.waitForTimeout(50);
}

export interface TrialContext {
  page: Page;
  bank: StyleBank;
  rules: Map<string, Map<string, string>>;
  objective: Objective;
}

/**
 * Trial one declaration: apply on top of accepted rules, measure, keep iff the
 * mismatch drops by ≥ MIN_GAIN_PIXELS; otherwise restore the previous rules.
 */
export async function trialCandidate(
  ctx: TrialContext,
  currentPixels: number,
  selector: string,
  property: string,
  value: string,
): Promise<{ accepted: boolean; pixels: number }> {
  const { page, bank, rules, objective } = ctx;
  const props = rules.get(selector);
  const previous = props?.get(property);
  const hadProp = props?.has(property) ?? false;

  if (!rules.has(selector)) rules.set(selector, new Map());
  rules.get(selector)!.set(property, value);
  await bank.setRules(rules);
  await page.waitForTimeout(SETTLE_MS);

  const pixels = await objective.measure();
  if (currentPixels - pixels >= MIN_GAIN_PIXELS) {
    return { accepted: true, pixels };
  }

  // Revert
  const propsNow = rules.get(selector)!;
  if (hadProp && previous !== undefined) {
    propsNow.set(property, previous);
  } else {
    propsNow.delete(property);
    if (!propsNow.size) rules.delete(selector);
  }
  await bank.setRules(rules);
  await page.waitForTimeout(SETTLE_MS);
  return { accepted: false, pixels: currentPixels };
}
