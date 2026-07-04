export interface ReviseContext {
  refImagePath: string;
  currentImagePath: string;
  feedbackJson: string;
  currentHtml: string;
}

export interface Agent {
  id: string;
  generate(refImagePath: string): Promise<string>;
  revise(ctx: ReviseContext): Promise<string>;
}

export const GENERATE_PROMPT =
  "Rebuild the UI in the attached screenshot as ONE self-contained HTML document. " +
  "Inline all CSS in a <style> tag; use no external assets, fonts, scripts, or images " +
  "(use solid color boxes as placeholders where images appear). Match layout, spacing, " +
  "colors, and typography as closely as you can. Output ONLY the HTML in a single ```html code block.";

export function revisePrompt(feedbackJson: string): string {
  return (
    "You previously rebuilt a reference UI (first image) as HTML; the second image is your " +
    "current render. A deterministic diff tool reported these ranked issues as JSON:\n\n" +
    feedbackJson +
    "\n\nApply the fixes to your HTML to match the reference more closely. Keep it one " +
    "self-contained document. Output ONLY the full revised HTML in a single ```html code block."
  );
}
