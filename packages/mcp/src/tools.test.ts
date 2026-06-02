import { describe, it, expect } from "bun:test";
import { TOOLS, REQUIRED_FILE_ARGS } from "./tools.js";

function byName(name: string) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} not found`);
  return tool;
}

describe("tool arg building", () => {
  it("compare maps required + optional args to CLI flags", () => {
    const { command, cliArgs } = byName("compare").build({
      reference_path: "/ref.png",
      implementation_path: "/impl.png",
      top: 5,
      auto_resize: true,
      region: "header",
      disable_ocr: true,
      heatmap_path: "/out.png",
    });
    expect(command).toBe("compare");
    expect(cliArgs).toEqual([
      "compare",
      "/ref.png",
      "/impl.png",
      "--json",
      "--top",
      "5",
      "--auto-resize",
      "--region",
      "header",
      "--no-ocr",
      "--heatmap",
      "/out.png",
    ]);
  });

  it("compare omits optional flags when not provided and defaults top to 20", () => {
    const { cliArgs } = byName("compare").build({
      reference_path: "/ref.png",
      implementation_path: "/impl.png",
    });
    expect(cliArgs).toEqual(["compare", "/ref.png", "/impl.png", "--json", "--top", "20"]);
  });

  it("extract maps fine/full/disable_ocr", () => {
    const { cliArgs } = byName("extract").build({ image_path: "/a.png", fine: true, full: true });
    expect(cliArgs).toEqual(["extract", "/a.png", "--json", "--fine", "--no-compact"]);
  });

  it("suggest_fixes maps styling/framework", () => {
    const { command, cliArgs } = byName("suggest_fixes").build({
      reference_path: "/ref.png",
      implementation_path: "/impl.png",
      styling: "css",
      framework: "vanilla",
    });
    expect(command).toBe("suggest-fixes");
    expect(cliArgs).toEqual([
      "suggest-fixes",
      "/ref.png",
      "/impl.png",
      "--json",
      "--top",
      "20",
      "--styling",
      "css",
      "--framework",
      "vanilla",
    ]);
  });

  it("tokens and plan are single-image commands", () => {
    expect(byName("tokens").build({ image_path: "/a.png" }).cliArgs).toEqual([
      "tokens",
      "/a.png",
      "--json",
    ]);
    expect(byName("plan").build({ image_path: "/a.png", disable_ocr: true }).cliArgs).toEqual([
      "plan",
      "/a.png",
      "--json",
      "--no-ocr",
    ]);
  });

  it("exposes exactly the five read-only tools", () => {
    expect(TOOLS.map((t) => t.name).sort()).toEqual([
      "compare",
      "extract",
      "plan",
      "suggest_fixes",
      "tokens",
    ]);
  });

  it("file-arg guard covers every path-typed input across tools", () => {
    expect([...REQUIRED_FILE_ARGS].sort()).toEqual([
      "image_path",
      "implementation_path",
      "reference_path",
    ]);
  });
});
