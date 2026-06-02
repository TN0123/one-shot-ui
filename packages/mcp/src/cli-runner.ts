import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface CliInvocation {
  cmd: string;
  prefixArgs: string[];
}

/**
 * Locate the one-shot-ui CLI entry. The MCP server shells out to the same
 * bundled CLI the published package ships, so its JSON output is byte-identical
 * to what `one-shot-ui <cmd> --json` produces on the command line — no logic is
 * reimplemented here, which keeps the deterministic guarantees intact.
 */
export function resolveCliEntry(): CliInvocation {
  const override = process.env.ONE_SHOT_UI_CLI;
  if (override && existsSync(override)) {
    return { cmd: process.execPath, prefixArgs: [override] };
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const builtCandidates = [
    join(here, "cli.mjs"), // published layout: dist/mcp.mjs sits beside dist/cli.mjs
    join(here, "..", "dist", "cli.mjs"),
    join(here, "..", "..", "..", "dist", "cli.mjs"), // dev: packages/mcp/src -> repo/dist
  ];
  for (const candidate of builtCandidates) {
    if (existsSync(candidate)) return { cmd: process.execPath, prefixArgs: [candidate] };
  }

  // Dev fallback: run the TypeScript source directly with Bun.
  const source = join(here, "..", "..", "cli", "src", "index.ts");
  if (existsSync(source)) return { cmd: "bun", prefixArgs: [source] };

  throw new Error(
    "Could not locate the one-shot-ui CLI (dist/cli.mjs). Run `bun run build`, " +
      "or set ONE_SHOT_UI_CLI to the CLI entry path."
  );
}

export interface RunCliResult {
  stdout: string;
  stderr: string;
  code: number;
}

/**
 * Run a one-shot-ui CLI command, capturing stdout/stderr into buffers. The child
 * stdio is piped (never inherited) so the CLI's own output cannot corrupt this
 * process's stdout, which is reserved for the MCP JSON-RPC stream.
 */
export function runCli(args: string[], opts: { timeoutMs?: number } = {}): Promise<RunCliResult> {
  const { cmd, prefixArgs } = resolveCliEntry();
  const timeoutMs = opts.timeoutMs ?? 180_000;

  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, [...prefixArgs, ...args], {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`one-shot-ui ${args[0] ?? ""} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({ stdout, stderr, code: code ?? -1 });
    });
  });
}

/** Parse the CLI's `--json` stdout, raising a clear error if the command failed. */
export function parseCliJson(result: RunCliResult, command: string): unknown {
  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || "(no output)";
    throw new Error(`one-shot-ui ${command} exited with code ${result.code}: ${detail}`);
  }
  const text = result.stdout.trim();
  try {
    return JSON.parse(text);
  } catch {
    // Be forgiving if a stray leading line slipped onto stdout.
    const start = text.indexOf("{");
    if (start > 0) {
      try {
        return JSON.parse(text.slice(start));
      } catch {
        /* fall through to the error below */
      }
    }
    throw new Error(
      `one-shot-ui ${command} did not return valid JSON. Output head: ${text.slice(0, 300)}`
    );
  }
}
