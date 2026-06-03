// Pure path heuristics for recognizing macOS screenshot "floating thumbnail" temp
// files. Lives in @one-shot-ui/core (no native deps) so both the CLI and the MCP
// server can share it without bundling sharp.
//
// Why this exists: on macOS a freshly-taken screenshot shows a floating thumbnail
// backed by a temp file under `…/T/TemporaryItems/NSIRD_screencaptureui_*/`. When an
// agent drags that thumbnail into a terminal, it gets the temp path — but macOS moves
// the file to its final folder (default ~/Desktop) once the thumbnail dismisses, so by
// the time the tool reads it the path is gone. We detect that case and explain it.

const SCREENSHOT_BASENAME = /^(Screenshot |Screen Shot |CleanShot )/i;

/** True when `p` looks like an ephemeral macOS screenshot temp path (not a saved file). */
export function isLikelyScreenshotTempPath(p: string): boolean {
  if (/\/TemporaryItems\//.test(p)) return true;
  if (/NSIRD_screencaptureui/i.test(p)) return true;
  // A screenshot-named file sitting in a system temp dir (rather than the Desktop or a
  // project directory) is almost certainly the floating-thumbnail backing file.
  const base = p.split("/").pop() ?? "";
  const inTempDir =
    /(^|\/)(private\/)?var\/folders\//.test(p) || /(^|\/)tmp\//.test(p) || /\/T\//.test(p);
  return SCREENSHOT_BASENAME.test(base) && inTempDir;
}

/** Build an agent-friendly "file not found" message, with macOS guidance when relevant. */
export function describeMissingImagePath(label: string, p: string): string {
  if (isLikelyScreenshotTempPath(p)) {
    return (
      `File not found for "${label}": ${p}\n` +
      `This looks like a macOS screenshot still in its temporary location. macOS moves the ` +
      `floating-thumbnail screenshot to its final folder (default: ~/Desktop) once the thumbnail ` +
      `dismisses, so this temporary path is already gone. Pass the saved path instead ` +
      `(e.g. ~/Desktop/Screenshot ....png), or copy the screenshot into your project first.`
    );
  }
  return `File not found for "${label}": ${p}. Pass an absolute path to an existing image (PNG/JPG).`;
}
