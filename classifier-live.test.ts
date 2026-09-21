import {it,expect} from 'vitest';
import {classify} from './classifier';
import {classifierPrompt} from './router';
import {defaults} from './settings';
it.skipIf(process.env.TURN_ROUTER_LIVE!=='1')('rates a synthetic task using the existing Luna sign-in',async()=>{
  const started=Date.now();
  const result=await classify(classifierPrompt('Change the Save button label to Save changes.','The settings screen is implemented and its tests pass.',0),{...defaults,timeoutMs:30000});
  console.log(JSON.stringify({kind:result.kind,complexity:result.complexity,latencyMs:Date.now()-started}));
  expect(result.complexity).toBeLessThan(30);expect(result.kind).toBe('tweak');
},35000);
