import { z } from "zod";
import { describeMissingImagePath } from "@one-shot-ui/core";

export interface ToolSpec {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodRawShape;
  /** Map validated tool args to a CLI command name + argv. */
  build(args: Record<string, unknown>): { command: string; cliArgs: string[] };
}

/** Emit `args` only when `cond` is truthy; otherwise nothing. */
function flag(cond: unknown, ...args: string[]): string[] {
  return cond ? args : [];
}

const compare: ToolSpec = {
  name: "compare",
  title: "Compare a build against a reference screenshot",
  description:
    "Deterministically diff an implementation screenshot against a reference screenshot. Returns a " +
    "pixel-mismatch ratio, width/height deltas, a ranked list of structural issues (missing/extra " +
    "elements, position, size, color, shadow, spacing), an irreducible-mismatch floor so you know " +
    "when further pixel-chasing is futile, AND a `spacing[]` array of high-trust, directly-CSS-able " +
    "sizing/spacing deltas (top-bar/band heights, content-column left edges, gutter widths) measured by " +
    "pixel projection — use these to close sizing/spacing gaps exactly. Inputs are image file paths " +
    "(PNG/JPG); the same inputs always produce the same numbers.",
  inputSchema: {
    reference_path: z.string().describe("Path (absolute, or relative to the server's launch directory) to the reference (design) screenshot."),
    implementation_path: z.string().describe("Path (absolute, or relative to the server's launch directory) to the current build screenshot."),
    top: z.number().int().positive().optional().describe("Maximum number of issues to return (default 20)."),
    auto_resize: z
      .boolean()
      .optional()
      .describe("Resize the implementation to the reference's dimensions before diffing."),
    region: z.string().optional().describe("Limit the diff to a named semantic anchor from the reference."),
    disable_ocr: z.boolean().optional().describe("Skip OCR text extraction. OCR runs by default and roughly doubles latency; disable it when you don't need text content or typography (note: extract then returns empty fontSizes)."),
    heatmap_path: z.string().optional().describe("If set, write a diff heatmap PNG to this path."),
  },
  build(a) {
    return {
      command: "compare",
      cliArgs: [
        "compare",
        String(a.reference_path),
        String(a.implementation_path),
        "--json",
        "--top",
        String(a.top ?? 20),
        ...flag(a.auto_resize, "--auto-resize"),
        ...flag(a.region, "--region", String(a.region)),
        ...flag(a.disable_ocr, "--no-ocr"),
        ...flag(a.heatmap_path, "--heatmap", String(a.heatmap_path)),
      ],
    };
  },
};

const extract: ToolSpec = {
  name: "extract",
  title: "Extract structured design data from a screenshot",
  description:
    "Analyze a single reference screenshot into structured data an agent can build from: layout regions " +
    "(position/size), dominant colors, typography, spacing, a suggested implementation strategy, and a " +
    "`rulers` block of deterministic projection measurements (background-zone band heights, content-column " +
    "edges + widths, gutter widths) — build to these exact values to get sizing/spacing right the first time. " +
    "Returns a compact summary by default; set full=true for the complete report. Input is an image file path.",
  inputSchema: {
    image_path: z.string().describe("Path (absolute, or relative to the server's launch directory) to the screenshot to analyze."),
    fine: z.boolean().optional().describe("Use fine-grained (4px) layout detection for small details."),
    disable_ocr: z.boolean().optional().describe("Skip OCR text extraction. OCR runs by default and roughly doubles latency; disable it when you don't need text content or typography (note: extract then returns empty fontSizes)."),
    full: z.boolean().optional().describe("Return the full detailed report instead of the compact summary."),
    dpr: z.number().positive().optional().describe("Device pixel ratio of the screenshot (pass 2 for a Retina/Mac capture). When set, the compact report's font sizes and region bounds are returned in CSS pixels instead of raw image pixels. Auto-detected when omitted, but passing it is more reliable."),
  },
  build(a) {
    return {
      command: "extract",
      cliArgs: [
        "extract",
        String(a.image_path),
        "--json",
        ...flag(a.fine, "--fine"),
        ...flag(a.disable_ocr, "--no-ocr"),
        ...flag(a.full, "--no-compact"),
        ...flag(a.dpr, "--dpr", String(a.dpr)),
      ],
    };
  },
};

const suggestFixes: ToolSpec = {
  name: "suggest_fixes",
  title: "Get ranked fix suggestions from a diff",
  description:
    "Diff a build against a reference and return concrete, ranked fix observations (size, color, shadow, " +
    "spacing) with values measured from the reference. Selectors are only emitted when they resolve from " +
    "real DOM; for screenshot-only input the fixes are region-anchored observations with capped confidence " +
    "rather than guessed selectors. Inputs are image file paths.",
  inputSchema: {
    reference_path: z.string().describe("Path (absolute, or relative to the server's launch directory) to the reference (design) screenshot."),
    implementation_path: z.string().describe("Path (absolute, or relative to the server's launch directory) to the current build screenshot."),
    top: z.number().int().positive().optional().describe("Maximum number of fixes to return (default 20)."),
    region: z.string().optional().describe("Limit fixes to a named semantic anchor from the reference."),
    styling: z.enum(["tailwind", "css"]).optional().describe("Styling output: tailwind or css (default tailwind)."),
    framework: z.enum(["react", "vanilla"]).optional().describe("Output format: react or vanilla (default react)."),
    disable_ocr: z.boolean().optional().describe("Skip OCR text extraction. OCR runs by default and roughly doubles latency; disable it when you don't need text content or typography (note: extract then returns empty fontSizes)."),
  },
  build(a) {
    return {
      command: "suggest-fixes",
      cliArgs: [
        "suggest-fixes",
        String(a.reference_path),
        String(a.implementation_path),
        "--json",
        "--top",
        String(a.top ?? 20),
        ...flag(a.region, "--region", String(a.region)),
        ...flag(a.styling, "--styling", String(a.styling)),
        ...flag(a.framework, "--framework", String(a.framework)),
        ...flag(a.disable_ocr, "--no-ocr"),
      ],
    };
  },
};

const tokens: ToolSpec = {
  name: "tokens",
  title: "Extract design tokens from a screenshot",
  description:
    "Extract design tokens (color palette, spacing scale, radii) from a reference screenshot. " +
    "Input is an image file path.",
  inputSchema: {
    image_path: z.string().describe("Path (absolute, or relative to the server's launch directory) to the screenshot to analyze."),
    disable_ocr: z.boolean().optional().describe("Skip OCR text extraction. OCR runs by default and roughly doubles latency; disable it when you don't need text content or typography (note: extract then returns empty fontSizes)."),
    dpr: z.number().positive().optional().describe("Device pixel ratio of the screenshot (pass 2 for a Retina/Mac capture). When set, spacing/font-size/radius tokens are returned in CSS pixels instead of raw image pixels. Auto-detected when omitted."),
  },
  build(a) {
    return {
      command: "tokens",
      cliArgs: ["tokens", String(a.image_path), "--json", ...flag(a.disable_ocr, "--no-ocr"), ...flag(a.dpr, "--dpr", String(a.dpr))],
    };
  },
};

const plan: ToolSpec = {
  name: "plan",
  title: "Generate an implementation strategy from a screenshot",
  description:
    "Generate a suggested implementation plan (layout strategy, CSS primitives, repeated patterns, " +
    "typography notes) from a reference screenshot. Input is an image file path.",
  inputSchema: {
    image_path: z.string().describe("Path (absolute, or relative to the server's launch directory) to the screenshot to analyze."),
    disable_ocr: z.boolean().optional().describe("Skip OCR text extraction. OCR runs by default and roughly doubles latency; disable it when you don't need text content or typography (note: extract then returns empty fontSizes)."),
    dpr: z.number().positive().optional().describe("Device pixel ratio of the screenshot (pass 2 for a Retina/Mac capture). Auto-detected when omitted."),
  },
  build(a) {
    return {
      command: "plan",
      cliArgs: ["plan", String(a.image_path), "--json", ...flag(a.disable_ocr, "--no-ocr"), ...flag(a.dpr, "--dpr", String(a.dpr))],
    };
  },
};

export const TOOLS: ToolSpec[] = [compare, extract, suggestFixes, tokens, plan];

/** Tool args whose values must point at an existing file before the CLI is spawned. */
export const REQUIRED_FILE_ARGS = new Set(["reference_path", "implementation_path", "image_path"]);

/**
 * Validate that every required file arg present in `args` points at an existing file,
 * per the injected `fileExists` predicate. Returns an agent-friendly error message for
 * the first missing one (with macOS screenshot-temp-path guidance when applicable), or
 * null when all present required files exist. Dependency-injected for testability.
 */
export function validateRequiredFiles(
  args: Record<string, unknown>,
  fileExists: (p: string) => boolean
): string | null {
  for (const key of REQUIRED_FILE_ARGS) {
    const value = args[key];
    if (typeof value === "string" && !fileExists(value)) {
      return describeMissingImagePath(key, value);
    }
  }
  return null;
}
