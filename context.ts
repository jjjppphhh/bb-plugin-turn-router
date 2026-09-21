import type { BbPluginApi } from '@get-bb/plugin-sdk';
type TimelineRow = Awaited<ReturnType<BbPluginApi['sdk']['threads']['timeline']>>['rows'][number];
export function hasPriorAssistantResponse(rows: TimelineRow[]): boolean {
  for (const row of rows) {
    if (row.kind==='turn' && hasPriorAssistantResponse(row.children ?? [])) return true;
    if (row.kind==='conversation' && row.role==='assistant' && row.text.trim()) return true;
  }
  return false;
}
export function compactContext(rows: TimelineRow[], title: string, todos: string[] = []): {text:string;characters:number} {
  const messages: string[]=[];
  function visit(row: TimelineRow) {
    if (row.kind==='turn') { for (const child of row.children ?? []) visit(child); }
    else if (row.kind==='conversation') messages.push(`${row.role}: ${row.text}`);
  }
  rows.forEach(visit);
  const characters=messages.reduce((n,m)=>n+m.length,0);
  // The first fetched message anchors the recent work; recent messages retain decisions and corrections.
  const recent=messages.slice(-6).map(t=>t.slice(0,1800)).join('\n');
  return {text:`Thread: ${title}\nOpen plan: ${todos.join('; ').slice(0,1500)}\n${recent}`.slice(-10000),characters};
}
