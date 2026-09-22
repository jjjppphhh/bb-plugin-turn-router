import {describe,it,expect} from 'vitest';
import {chooseRoute,BENCHMARK,capabilityCoordinate,modelJumpDistance,type Rating} from './benchmarks';
import {parseRating,explicitSelection,obviousRating} from './router';
const candidates=['gpt-6-astra','gpt-5.6-sol','gpt-5.6-terra','gpt-5.6-luna','gpt-5.5'].map(model=>({model,efforts:['low','medium','high','xhigh','max','ultra']}));
const rating=(n:number):Rating=>({kind:'implementation',complexity:n,uncertainty:n,risk:n,confidence:.9,reason:'Bounded task.'});
const route=(n:number,premium=50)=>chooseRoute({candidates,rating:rating(n),premium});
describe('per-turn routing',()=>{
 it('keeps the model family and reduces only effort for a narrow follow-up',()=>{
  const r=chooseRoute({candidates,rating:rating(10),premium:50,current:{model:'gpt-6-astra',reasoningLevel:'max'}});
  expect(r.model).toBe('gpt-5.6-luna');expect(['low','medium']).toContain(r.reasoningLevel);
 });
 it('keeps the model family after a substantive turn while adapting effort',()=>{
  const r=chooseRoute({candidates,rating:rating(10),premium:50,established:true,current:{model:'gpt-6-astra',reasoningLevel:'max'}});
  expect(r.model).toBe('gpt-6-astra');expect(['low','medium']).toContain(r.reasoningLevel);
 });
 it('keeps Luna instead of making a marginal switch to Terra',()=>{
  const r=chooseRoute({candidates,rating:rating(20),premium:50,current:{model:'gpt-5.6-luna',reasoningLevel:'high'}});
  expect(r).toMatchObject({model:'gpt-5.6-luna',reasoningLevel:'high'});
 });
 it('uses reasoning as the model-family sub-delineator',()=>{
  expect(capabilityCoordinate({model:'gpt-5.6-sol',reasoningLevel:'ultra'})).toEqual([5,6,3,6]);
  expect(modelJumpDistance({model:'gpt-5.6-luna',reasoningLevel:'high'},{model:'gpt-5.6-terra',reasoningLevel:'low'})).toBe(4);
  expect(modelJumpDistance({model:'gpt-5.6-luna',reasoningLevel:'low'},{model:'gpt-5.6-terra',reasoningLevel:'low'})).toBe(6);
 });
 it('still changes family when the current option is disproportionately expensive',()=>{
  const r=chooseRoute({candidates,rating:rating(10),premium:50,current:{model:'gpt-6-astra',reasoningLevel:'max'}});
  expect(r.model).toBe('gpt-5.6-luna');
 });
 it('promotes an established thread only when its current family cannot meet demand',()=>{
  const r=chooseRoute({candidates,rating:rating(100),premium:100,established:true,current:{model:'gpt-5.6-luna',reasoningLevel:'medium'}});
  expect(r.model).toBe('gpt-6-astra');
 });
 it('can reach Astra low, high and max at appropriate demand/preferences',()=>{
  expect(route(80)).toMatchObject({model:'gpt-6-astra',reasoningLevel:'low'});
  expect(route(100)).toMatchObject({model:'gpt-6-astra',reasoningLevel:'high'});
  expect(route(100,100)).toMatchObject({model:'gpt-6-astra',reasoningLevel:'max'});
 });
 it('holds selection when classifier is uncertain',()=>{
  expect(chooseRoute({candidates,rating:{...rating(5),confidence:.4},premium:50,current:{model:'gpt-6-astra',reasoningLevel:'high'}})).toMatchObject({model:'gpt-6-astra',reasoningLevel:'high',source:'retained'});
 });
 it('escalates on uncertainty or risk even if implementation is small',()=>{
  expect(chooseRoute({candidates,rating:{...rating(5),risk:95},premium:50}).model).toBe('gpt-6-astra');
 });
 it('does not invent support or benchmarks for ultra',()=>{
  expect(BENCHMARK.rows.every(r=>r.reasoningLevel!=='ultra')).toBe(true);
  expect(chooseRoute({candidates:candidates.filter(c=>c.model!=='gpt-6-astra'),rating:rating(100),premium:100}).model).not.toBe('gpt-6-astra');
 });
 it('honours explicit model and effort requests including unmeasured ultra',()=>{
  expect(explicitSelection('Use Astra ultra to review this.',candidates)).toEqual({model:'gpt-6-astra',reasoningLevel:'ultra'});
  expect(explicitSelection('Why did this choose Astra?',candidates)).toBeNull();
  expect(explicitSelection('Do not use Astra high.',candidates)).toBeNull();
 });
 it('does not silently substitute unavailable explicit models',()=>{
  expect(()=>explicitSelection('use astra high',candidates.slice(1))).toThrow('unavailable');
 });
 it('rejects malformed and out of range ratings',()=>{
  expect(()=>parseRating('{"complexity":999}')).toThrow();
  expect(()=>parseRating('plain prose')).toThrow();
 });
 it('only short-circuits very narrow tweaks with context',()=>{
  expect(obviousRating('fix the typo in that heading','Previous accepted implementation',0)?.kind).toBe('tweak');
  expect(obviousRating('make it simpler','Large design',0)).toBeNull();
  expect(obviousRating('fix the typo in that heading','',0)).toBeNull();
 });
 it('has dated primary-source provenance for every measured option',()=>{
  expect(BENCHMARK.rows.length).toBeGreaterThanOrEqual(22);
  for(const r of BENCHMARK.rows){expect(r.source).toMatch(/^https:\/\/artificialanalysis.ai\/models\//);expect(r.costPerTask).toBeGreaterThan(0);}
 });
});
