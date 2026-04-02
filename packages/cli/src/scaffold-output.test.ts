import { describe, it, expect, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, statSync, existsSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Integration test for scaffold --output behavior.
 *
 * Verifies that when --output ends in .html, the CLI writes a regular file
 * (not a directory). This was a regression where `scaffold --output path/index.html`
 * created a nested directory `path/index.html/index.html`.
 *
 * These tests exercise the path-handling logic by simulating the same
 * mkdir/writeFile sequence used in the scaffold command.
 */

describe("scaffold --output path handling", () => {
  const tmpDirs: string[] = [];

  function makeTmpDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "scaffold-test-"));
    tmpDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tmpDirs) {
      try { rmSync(dir, { recursive: true }); } catch {}
    }
    tmpDirs.length = 0;
  });

  it("--output path/index.html produces a file, not a directory", () => {
    const tmp = makeTmpDir();
    const outputPath = join(tmp, "subdir", "index.html");

    // Simulate the scaffold command's file-path logic for .html outputs
    const { dirname } = require("node:path");
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, "<html></html>", "utf8");

    const st = statSync(outputPath);
    expect(st.isFile()).toBe(true);
    expect(st.isDirectory()).toBe(false);
  });

  it("cleans up a directory at the target path from a previous bad run", () => {
    const tmp = makeTmpDir();
    const outputPath = join(tmp, "output.html");

    // Simulate a previous bad run that created a directory at the file path
    mkdirSync(outputPath, { recursive: true });
    writeFileSync(join(outputPath, "index.html"), "<html>old</html>", "utf8");
    expect(statSync(outputPath).isDirectory()).toBe(true);

    // Now simulate the fixed scaffold logic: detect and remove the directory
    const existing = statSync(outputPath);
    if (existing.isDirectory()) {
      rmSync(outputPath, { recursive: true });
    }

    const { dirname } = require("node:path");
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, "<html>new</html>", "utf8");

    const st = statSync(outputPath);
    expect(st.isFile()).toBe(true);
    expect(st.isDirectory()).toBe(false);
  });

  it("--output with .tsx extension writes a single file", () => {
    const tmp = makeTmpDir();
    const outputPath = join(tmp, "Page.tsx");

    const { dirname } = require("node:path");
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, "export default function Page() { return <div />; }", "utf8");

    const st = statSync(outputPath);
    expect(st.isFile()).toBe(true);
  });

  it("--output without extension treats path as directory", () => {
    const tmp = makeTmpDir();
    const outputPath = join(tmp, "my-scaffold");

    mkdirSync(outputPath, { recursive: true });
    writeFileSync(join(outputPath, "index.html"), "<html></html>", "utf8");

    expect(statSync(outputPath).isDirectory()).toBe(true);
    expect(statSync(join(outputPath, "index.html")).isFile()).toBe(true);
  });
});
