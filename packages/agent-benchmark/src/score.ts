export interface CompareLike {
  summary: { mismatchRatio: number };
  issues: Array<{
    category?: string;
    deltaX?: number;
    deltaY?: number;
    deltaWidth?: number;
    deltaHeight?: number;
  }>;
}

export interface Scorecard {
  color: number;
  typography: number;
  position: number;
  size: number;
  content: number;
}

export interface CaseScore {
  visualScore: number;
  mismatchRatio: number;
  scorecard: Scorecard;
}

export function scoreCompareReport(report: CompareLike): CaseScore {
  const mismatchRatio = report.summary.mismatchRatio;
  const visualScore = Math.max(0, Math.min(100, 100 * (1 - mismatchRatio)));
  const card: Scorecard = { color: 0, typography: 0, position: 0, size: 0, content: 0 };
  for (const issue of report.issues) {
    switch (issue.category) {
      case "color": card.color++; break;
      case "typography": card.typography++; break;
      case "content": card.content++; break;
      case "layout":
      default: {
        const sizeMag = Math.abs(issue.deltaWidth ?? 0) + Math.abs(issue.deltaHeight ?? 0);
        const posMag = Math.abs(issue.deltaX ?? 0) + Math.abs(issue.deltaY ?? 0);
        if (sizeMag > posMag) card.size++;
        else card.position++;
        break;
      }
    }
  }
  return { visualScore, mismatchRatio, scorecard: card };
}
