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
const coordinateEffort: Record<string,number> = {low:1,medium:2,high:3,xhigh:4,max:5,ultra:6};
const familyCoordinate: Record<string,readonly [number,number,number]> = {
  'gpt-5.6-luna':[5,6,1], 'gpt-5.6-terra':[5,6,2], 'gpt-5.6-sol':[5,6,3],
  'gpt-5.5':[5,5,1], 'gpt-6-astra':[6,0,1],
};
export function capabilityCoordinate(selection:Selection):readonly [number,number,number,number]|null {
  const family=familyCoordinate[selection.model],effort=coordinateEffort[selection.reasoningLevel];
  return family&&effort ? [...family,effort] : null;
}
export function modelJumpDistance(from:Selection,to:Selection):number {
  const a=capabilityCoordinate(from),b=capabilityCoordinate(to);
  if(!a||!b||a[0]!==b[0]||a[1]!==b[1])return Number.POSITIVE_INFINITY;
  return Math.abs((b[2]-a[2])*6+(b[3]-a[3]));
}
export function chooseRoute(args: { candidates: Candidate[]; rating: Rating; premium: number; current?: Selection; contextCharacters?: number; established?: boolean }): Route {
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
  // Treat reasoning as the sub-delineator of a model family. Within one model
  // generation, a family switch must clear five reasoning-sized steps. If it
  // does not, use the cheapest adequate effort in the current family instead.
  if (!args.established && currentRow && chosen.family !== current.model
      && modelJumpDistance(current,{model:chosen.family,reasoningLevel:chosen.reasoningLevel}) <= 5) {
    const nearbyCurrent = rows.filter(row => row.family === current.model && row.score >= target - .5)
      .sort((a,b) => a.costPerTask-b.costPerTask || effortOrder(a.reasoningLevel)-effortOrder(b.reasoningLevel))[0];
    if (nearbyCurrent) chosen = nearbyCurrent;
  }
  // Once a thread has substantive history, preserve its model family. Varying
  // reasoning effort is cheap; changing the model can alter interpretation of
  // prior decisions and lose provider-side prompt-cache reuse. Promote only
  // when no eligible effort in the current family meets the rated demand.
  if (args.established && currentRow) {
    const currentFamily = eligible.filter(row => row.family === current.model);
    const currentAdequate = currentFamily.filter(row => row.score >= target - .5)
      .sort((a,b) => a.costPerTask-b.costPerTask || effortOrder(a.reasoningLevel)-effortOrder(b.reasoningLevel));
    if (currentAdequate.length) chosen = currentAdequate[0]!;
    else {
      const strongestCurrent = [...currentFamily].sort((a,b) => b.score-a.score || effortOrder(b.reasoningLevel)-effortOrder(a.reasoningLevel))[0];
      const promotion = strongestCurrent && ranked.find(row => row.score > strongestCurrent.score);
      chosen = promotion ?? strongestCurrent ?? currentRow;
    }
  }
  // Hysteresis: retain a sufficiently capable model if the saving is marginal.
  // Long histories increase the margin because switching can lose prompt-cache reuse.
  const savingThreshold = (args.contextCharacters ?? 0) > 24000 ? .5 : .2;
  if (currentRow && currentRow.score >= target-.5 && effortOrder(currentRow.reasoningLevel) <= effortOrder(cap)
      && currentRow.costPerTask <= chosen.costPerTask / (1-savingThreshold)) chosen = currentRow;
  return {model: chosen.family, reasoningLevel: chosen.reasoningLevel, reason: rating.reason,
    source: data.benchmark, score: chosen.score, estimatedCost: chosen.costPerTask};
}
