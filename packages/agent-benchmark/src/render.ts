import type { AgentLift } from "./aggregate.js";

const n1 = (x: number): string => x.toFixed(1);
const pct = (x: number): string => `${(x * 100).toFixed(0)}%`;

/** Render the leaderboard as a single self-contained HTML page (no external assets). */
export function renderLeaderboard(
  lifts: AgentLift[],
  meta: { caseCount: number; generatedNote: string },
): string {
  const rows = lifts
    .map(
      (l) => `      <tr>
        <td class="agent">${escapeHtml(l.agentId)}</td>
        <td>${n1(l.tier0)}</td>
        <td>${n1(l.tier2)}</td>
        <td class="lift">+${n1(l.absoluteLift)}</td>
        <td>${pct(l.gapClosed)}</td>
      </tr>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>one-shot-ui — Agent UI-Replication Leaderboard</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; margin: 2rem auto; max-width: 820px; color: #1c1d26; }
  h1 { font-size: 1.4rem; } .note { color: #6b7280; }
  table { border-collapse: collapse; width: 100%; margin-top: 1rem; }
  th, td { padding: .5rem .75rem; text-align: right; border-bottom: 1px solid #e5e7eb; }
  th:first-child, td.agent { text-align: left; }
  td.lift { color: #16a34a; font-weight: 600; }
  th { color: #6b7280; font-weight: 600; }
</style></head>
<body>
  <h1>Agent UI-Replication Leaderboard</h1>
  <p class="note">${escapeHtml(meta.generatedNote)} · ${meta.caseCount} cases · scored by one-shot-ui (deterministic). Higher = closer to the reference. Agent rows are single-sample.</p>
  <table>
    <thead><tr><th>Agent</th><th>Tier 0 (cold)</th><th>Tier 2 (+tool)</th><th>Lift</th><th>Gap closed</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}
