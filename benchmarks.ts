import data from './benchmark-data.json';
export const BENCHMARK = data;
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = typeof EFFORTS[number];
export type Candidate = { model: string; efforts: readonly string[] };
export type Selection = { model: string; reasoningLevel: string };
export type Rating = {
  kind: 'tweak' | 'implementation' | 'investigation' | 'architecture' | 'review' | 'question';
  complexity: number; uncertainty: number; risk: number; confidence: number; reason: string;
};
export type Route = Selection & { reason: string; source: string; score: number | null; estimatedCost: number | null };
const effortOrder = (effort: string) => EFFORTS.indexOf(effort as Effort);
export function chooseRoute(args: { candidates: Candidate[]; rating: Rating; premium: number; current?: Selection; contextCharacters?: number }): Route {
  const { rating, current } = args;
  // Policy thresholds are explicit heuristics, not benchmark measurements.
  const demand = Math.max(rating.complexity, rating.uncertainty * .85, rating.risk);
  let cap: Effort = demand <= 25 ? 'medium' : demand <= 55 ? 'high' : demand <= 80 ? 'xhigh' : 'max';
  const target = Math.min(53, 21 + demand * .28 + args.premium * .04 * (demand / 100));
  const rows = data.rows.filter(row => args.candidates.some(c => c.model === row.family && c.efforts.includes(row.reasoningLevel)));
  const currentRow = current && rows.find(r => r.family === current.model && r.reasoningLevel === current.reasoningLevel);
  const retain = (reason: string): Route | undefined => current && args.candidates.some(c => c.model === current.model && c.efforts.includes(current.reasoningLevel)) ? {
    ...current, reason, source: 'retained', score: currentRow?.score ?? null, estimatedCost: currentRow?.costPerTask ?? null,
  } : undefined;
  if (rating.confidence < .65) {
    const held = retain('Uncertain classification; keeping your current model and effort.');
    if (held) return held;
  }
  let eligible = rows.filter(r => effortOrder(r.reasoningLevel) <= effortOrder(cap));
  if (!eligible.length) eligible = rows;
  if (!eligible.length) throw new Error('No measured Codex model is available; keep your manual selection.');
  const adequate = eligible.filter(r => r.score >= target - .5);
  const ranked = [...(adequate.length ? adequate : eligible)].sort((a,b) =>
    adequate.length ? a.costPerTask-b.costPerTask || effortOrder(a.reasoningLevel)-effortOrder(b.reasoningLevel) || b.score-a.score
      : b.score-a.score || a.costPerTask-b.costPerTask || effortOrder(a.reasoningLevel)-effortOrder(b.reasoningLevel));
  let chosen = ranked[0]!;
  // Hysteresis: retain a sufficiently capable model if the saving is marginal.
  // Long histories increase the margin because switching can lose prompt-cache reuse.
  const savingThreshold = (args.contextCharacters ?? 0) > 24000 ? .5 : .2;
  if (currentRow && currentRow.score >= target-.5 && effortOrder(currentRow.reasoningLevel) <= effortOrder(cap)
      && currentRow.costPerTask <= chosen.costPerTask / (1-savingThreshold)) chosen = currentRow;
  return {model: chosen.family, reasoningLevel: chosen.reasoningLevel, reason: rating.reason,
    source: data.benchmark, score: chosen.score, estimatedCost: chosen.costPerTask};
}
