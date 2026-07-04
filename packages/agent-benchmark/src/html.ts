/** Extract a complete HTML document from a model's free-text response. */
export function extractHtml(text: string): string {
  const fence = text.match(/```(?:html)?\s*\n?([\s\S]*?)```/i);
  const body = fence ? fence[1]! : text;
  const start = body.search(/<!doctype html|<html[\s>]/i);
  if (start >= 0) {
    const lower = body.toLowerCase();
    const end = lower.lastIndexOf("</html>");
    if (end > start) return body.slice(start, end + "</html>".length).trim();
    return body.slice(start).trim();
  }
  return body.trim();
}

/** Apply a converge patch by appending it as the final <style> so its rules win. */
export function applyPatchCss(html: string, patchCss: string): string {
  if (!patchCss.trim()) return html;
  const style = `\n<style data-osui-patch>\n${patchCss}\n</style>\n`;
  const idx = html.toLowerCase().lastIndexOf("</body>");
  if (idx >= 0) return html.slice(0, idx) + style + html.slice(idx);
  return html + style;
}
