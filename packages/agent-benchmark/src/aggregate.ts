import type { Scorecard } from "./score.js";

export interface TierResult {
  agentId: string;
  tier: 0 | 1 | 2;
  caseId: string;
  cohort: "provable" | "unknown";
  visualScore: number;
  floor: number;
  // Carried for persistence to leaderboard.json (spec §5/§6); aggregation ignores them.
  scorecard?: Scorecard;
  htmlPath?: string;
  capturePath?: string;
}

export interface AgentTierStat {
  agentId: string;
  tier: number;
  mean: number;
  median: number;
  n: number;
}

export interface AgentLift {
  agentId: string;
  tier0: number;
  tier2: number;
  absoluteLift: number;
  gapClosed: number;
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export function statsByAgentTier(
  results: TierResult[],
  cohort: "provable" | "unknown" = "provable",
): AgentTierStat[] {
  const buckets = new Map<string, number[]>();
  for (const r of results) {
    if (r.cohort !== cohort) continue;
    const key = `${r.agentId}|${r.tier}`;
    (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(r.visualScore);
  }
  const out: AgentTierStat[] = [];
  for (const [key, scores] of buckets) {
    const [agentId, tier] = key.split("|");
    out.push({ agentId: agentId!, tier: Number(tier), mean: mean(scores), median: median(scores), n: scores.length });
  }
  return out.sort((a, b) => a.agentId.localeCompare(b.agentId) || a.tier - b.tier);
}

export function liftByAgent(
  results: TierResult[],
  cohort: "provable" | "unknown" = "provable",
): AgentLift[] {
  const stats = statsByAgentTier(results, cohort);
  const byAgent = new Map<string, { 0?: number; 2?: number }>();
  for (const s of stats) {
    const entry = byAgent.get(s.agentId) ?? {};
    if (s.tier === 0) entry[0] = s.mean;
    if (s.tier === 2) entry[2] = s.mean;
    byAgent.set(s.agentId, entry);
  }
  const out: AgentLift[] = [];
  for (const [agentId, e] of byAgent) {
    const tier0 = e[0] ?? 0;
    const tier2 = e[2] ?? tier0;
    const gap = 100 - tier0;
    out.push({
      agentId,
      tier0,
      tier2,
      absoluteLift: tier2 - tier0,
      gapClosed: gap > 0 ? (tier2 - tier0) / gap : 0,
    });
  }
  return out.sort((a, b) => b.tier0 - a.tier0);
}
