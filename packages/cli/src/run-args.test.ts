import { describe, test, expect } from "bun:test";
import { Command } from "commander";

/**
 * Build a minimal Commander program mirroring the `run` command's
 * argument / option definitions so we can test parsing without
 * triggering the real action handler.
 */
function buildRunCommand() {
  const program = new Command();
  program.exitOverride(); // throw instead of process.exit

  let parsed: { refArg?: string; implArg?: string; opts: Record<string, unknown> } | undefined;

  program
    .command("run")
    .argument("[referencePath]", "Path to the reference screenshot")
    .argument("[implementationPath]", "Path to implementation HTML file or URL")
    .option("--impl <path>", "Path to implementation HTML file or URL")
    .option("--file <path>", "Alias for --impl")
    .option("--reference <path>", "Alias for the referencePath argument")
    .option("--output <dir>", "Working directory for intermediate files", "./one-shot-run")
    .option("--max-passes <n>", "Maximum refinement passes", "5")
    .option("--threshold <ratio>", "Convergence threshold (mismatch ratio)", "0.02")
    .option("--no-ocr", "Disable OCR text extraction")
    .option("--json", "Print session log as JSON", false)
    .option("--dry-run", "Print detailed suggested edits for each pass", false)
    .action((referencePath, implementationPathArg, options) => {
      parsed = { refArg: referencePath, implArg: implementationPathArg, opts: options };
    });

  return { program, getParsed: () => parsed };
}

describe("run command argument parsing", () => {
  test("Pattern A: positional args — run ref.png impl.html", async () => {
    const { program, getParsed } = buildRunCommand();
    await program.parseAsync(["run", "ref.png", "impl.html"], { from: "user" });
    const p = getParsed();
    expect(p).toBeDefined();
    expect(p!.refArg).toBe("ref.png");
    expect(p!.implArg).toBe("impl.html");
  });

  test("Pattern B: flags only — run --reference ref.png --impl impl.html", async () => {
    const { program, getParsed } = buildRunCommand();
    await program.parseAsync(["run", "--reference", "ref.png", "--impl", "impl.html"], { from: "user" });
    const p = getParsed();
    expect(p).toBeDefined();
    expect(p!.refArg).toBeUndefined();
    expect(p!.opts.reference).toBe("ref.png");
    expect(p!.opts.impl).toBe("impl.html");
  });

  test("Pattern C: positional ref + option — run ref.png --output ./out", async () => {
    const { program, getParsed } = buildRunCommand();
    await program.parseAsync(["run", "ref.png", "--output", "./out"], { from: "user" });
    const p = getParsed();
    expect(p).toBeDefined();
    expect(p!.refArg).toBe("ref.png");
    expect(p!.opts.output).toBe("./out");
  });
});
