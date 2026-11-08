const {test}=require('node:test'); const assert=require('node:assert/strict'); const fs=require('node:fs'); const vm=require('node:vm'); const path=require('node:path'); const {stripTypeScriptTypes}=require('node:module');
const source=stripTypeScriptTypes(fs.readFileSync(`${__dirname}/../src/services/scoreboard.service.ts`,'utf8')).replace(/^import .*;\s*$/gm,'').replace(/export /g,'');
function setup(files={},options={}) {const requests=[]; const fakeFS={readFileSync:p=>{if(!(p in files))throw Object.assign(new Error('missing'),{code:'ENOENT'});return files[p]},mkdirSync(){},writeFileSync:(p,s)=>files[p]=s,renameSync:(a,b)=>{files[b]=files[a];delete files[a]}}; const api=vm.runInNewContext(`${source}\nnew ScoreboardService()`,{axios:{get:async url=>{requests.push(url);if(url.includes('/teams?'))return{data:{sports:[{leagues:[{teams:[{team:{id:'130',displayName:'Michigan Wolverines'}}]}]}]}};if(url.includes('/schedule'))return{data:{events:[{id:'game',date:new Date().toISOString()}]}};if(options.error)throw options.error;if(options.events)return{data:{events:options.events}};return{data:{events:[]}}}},fs:fakeFS,path,process:{env:{DATA_DIR:'/data'}},__dirname:'/app',console:{log(...args){options.logs?.push(args.join(" "))},warn(){},error(){}},setInterval:()=>({}),clearInterval(){},setTimeout:()=>({}),clearTimeout(){},Date});api.startPolling=()=>{};return{api,files,requests};}
function tracked(api,event='score',id=event){let count=0;api.registerFlow({id,name:id,trigger:{type:'sports_score',properties:{team:'Michigan Wolverines',sport:'football',league:'college-football',event}}},()=>count++);const t=api.trackedTeams.get(id);t.teamId='130';t.schedule=[{id:'game',date:new Date().toISOString()}];return{t,count:()=>count};}
const event=(score,state='in',winner=false,id='game')=>({id,status:{type:{state}},competitions:[{competitors:[{team:{id:'130'},score:String(score),winner}]}]});
const feed=(api,t,...events)=>api.processLeagueEvents(events,[t]);
test('score baseline, increase, repeat and final update',()=>{const{api}=setup();const x=tracked(api);feed(api,x.t,event(0,'pre'),event(6),event(6),event(7),event(10,'post'));assert.equal(x.count(),3);});
test('win only once on confirmed final; loss and tie do not fire',()=>{const{api}=setup();const x=tracked(api,'win');feed(api,x.t,event(7),event(14,'post',true),event(14,'post',true));assert.equal(x.count(),1);const y=tracked(api,'win','loser');feed(api,y.t,event(7),event(7,'post',false));assert.equal(y.count(),0);});
test('kickoff only on pregame to in-progress transition',()=>{const{api}=setup();const x=tracked(api,'kickoff');feed(api,x.t,event(0,'pre'),event(0),event(0));assert.equal(x.count(),1);});
test('first observations of live or completed games never celebrate stale events',()=>{const{api}=setup();for(const type of ['score','win','kickoff']){const x=tracked(api,type);feed(api,x.t,event(21,'post',true));assert.equal(x.count(),0);}});
test('new game has its own baseline and cannot match an unrelated scheduled event',()=>{const{api}=setup();const x=tracked(api);feed(api,x.t,event(35,'post',true));x.t.schedule=[{id:'next',date:new Date().toISOString()}];feed(api,x.t,event(6,'in',false,'next'),event(13,'in',false,'next'),event(50,'in',false,'other'));assert.equal(x.count(),1);});
test('checkpoints survive process restart and flow reload without replay',()=>{const first=setup();const x=tracked(first.api,'win');feed(first.api,x.t,event(7),event(14,'post',true));assert.equal(x.count(),1);const second=setup(first.files);const y=tracked(second.api,'win');feed(second.api,y.t,event(14,'post',true));assert.equal(y.count(),0);second.api.syncFlows([{id:'win',enabled:true,trigger:{type:'sports_score',properties:{team:'Michigan Wolverines',sport:'football',league:'college-football',event:'win'}}}],()=>{});assert.equal(second.api.trackedTeams.size,1);});
test('college scoreboard requests full FBS coverage; NFL uses its own league',async()=>{const{api,requests}=setup();tracked(api);await api.poll();assert.ok(requests.some(u=>u.includes('groups=80')&&u.includes('limit=1000')&&u.includes('dates=')));});
test('kickoff feed regression cannot replay a kickoff',()=>{const{api}=setup();const x=tracked(api,'kickoff');feed(api,x.t,event(0,'pre'),event(0),event(0,'pre'),event(0));assert.equal(x.count(),1);});
test('score corrections cannot replay the same points',()=>{const{api}=setup();const x=tracked(api);feed(api,x.t,event(0,'pre'),event(7),event(6),event(7),event(10));assert.equal(x.count(),2);});
test('a confirmed win supersedes simultaneous final-score celebration',()=>{const{api}=setup();const s=tracked(api,'score');const w=tracked(api,'win');api.processLeagueEvents([event(7)],[s.t,w.t]);api.processLeagueEvents([event(14,'post',true)],[s.t,w.t]);assert.equal(s.count(),0);assert.equal(w.count(),1);});
test('football polling uses individual dates instead of unsupported date ranges',async()=>{const{api,requests}=setup();tracked(api);await api.poll();const boards=requests.filter(u=>u.includes('/scoreboard?'));assert.equal(boards.length,2);for(const url of boards)assert.match(url,/dates=\d{8}&groups=80$/);});
test('possession cadence is 15s on offense, 30s on defense/missing data, 60s at halftime',()=>{const{api}=setup();const x=tracked(api);const e=event(7);e.competitions[0].situation={possession:'130'};assert.equal(api.pollDelay([e],[x.t]),15000);e.competitions[0].situation.possession='164';assert.equal(api.pollDelay([e],[x.t]),30000);delete e.competitions[0].situation;assert.equal(api.pollDelay([e],[x.t]),30000);e.status.type.name='STATUS_HALFTIME';assert.equal(api.pollDelay([e],[x.t]),60000);});
test('one scoreboard request serves score, kickoff and win; cached schedules are shared',async()=>{const e=event(7);e.competitions[0].situation={possession:'130'};const{api,requests}=setup({}, {events:[e]});for(const type of ['score','win','kickoff'])tracked(api,type);await api.poll();assert.equal(requests.filter(u=>u.includes('/scoreboard?')).length,1);assert.equal(requests.filter(u=>u.includes('/schedule')).length,1);assert.ok(api.nextPollAt.get('football/college-football')-Date.now()>14000);await api.poll();assert.equal(requests.filter(u=>u.includes('/scoreboard?')).length,1);});
test('429 respects Retry-After and blocks fallback requests and immediate retry',async()=>{const error={response:{status:429,headers:{'retry-after':'120'}},message:'rate limited'};const{api,requests}=setup({}, {error});tracked(api);await api.poll();assert.equal(requests.filter(u=>u.includes('/scoreboard?')).length,1);assert.ok(api.backoffUntil.get('football/college-football')-Date.now()>119000);await api.poll();assert.equal(requests.filter(u=>u.includes('/scoreboard?')).length,1);});
test('HTTP-date Retry-After is honored and repeated failures back off exponentially',()=>{const{api}=setup();api.deferLeague('nfl',{response:{status:429,headers:{'retry-after':new Date(Date.now()+180000).toUTCString()}}});assert.ok(api.backoffUntil.get('nfl')-Date.now()>178000);api.deferLeague('nfl',{message:'timeout'});assert.ok(api.backoffUntil.get('nfl')-Date.now()>119000);api.deferLeague('nfl',{message:'timeout'});assert.ok(api.backoffUntil.get('nfl')-Date.now()>239000);});
test('NFL uses shared adaptive polling without college group filter',async()=>{const e=event(7);const{api,requests}=setup({}, {events:[e]});const x=tracked(api);x.t.trigger.properties.league='nfl';await api.poll();const url=requests.find(u=>u.includes('/scoreboard?'));assert.ok(url.includes('/football/nfl/'));assert.ok(!url.includes('groups='));});
test('completed games stop making scoreboard requests',async()=>{const{api,requests}=setup();const x=tracked(api);feed(api,x.t,event(7,'post',true));await api.poll();assert.equal(requests.filter(u=>u.includes('/scoreboard?')).length,0);});

test('pregame tracking starts two hours early with a five-minute league cadence',async()=>{
  const e=event(0,'pre'); e.date=new Date(Date.now()+90*60*1000).toISOString();
  const{api,requests}=setup({}, {events:[e]}); const x=tracked(api,'kickoff');
  x.t.schedule=[{id:'game',date:e.date}]; x.t.fetchedAt=Date.now();
  await api.poll();
  assert.equal(requests.filter(u=>u.includes('/scoreboard?')).length,1);
  assert.equal(x.count(),0);
  assert.ok(api.nextPollAt.get('football/college-football')-Date.now()>299000);
  const saved=Object.values(api.states)[0]; assert.equal(saved.state,'pre'); assert.equal(saved.kickoffHandled,false);
  assert.ok(saved.firstObservedAt); assert.ok(saved.lastObservedAt);
  feed(api,x.t,event(0)); assert.equal(x.count(),1);
});
test('games outside the two-hour tracking window do not request a scoreboard',async()=>{
  const{api,requests}=setup(); const x=tracked(api,'kickoff');
  x.t.schedule=[{id:'game',date:new Date(Date.now()+121*60*1000).toISOString()}];x.t.fetchedAt=Date.now();
  await api.poll(); assert.equal(requests.filter(u=>u.includes('/scoreboard?')).length,0);
});
test('pregame cadence tightens to 30 seconds within fifteen minutes and for overdue starts',()=>{
  const{api}=setup(); const x=tracked(api,'kickoff');const e=event(0,'pre');
  for(const minutes of [14,0,-20]){e.date=new Date(Date.now()+minutes*60*1000).toISOString();assert.equal(api.pollDelay([e],[x.t]),30000);}
});
test('a saved pregame baseline survives a restart ninety minutes before kickoff',()=>{
  const first=setup();const x=tracked(first.api,'kickoff');feed(first.api,x.t,event(0,'pre'));
  const stamp=Object.values(first.api.states)[0].firstObservedAt;
  const second=setup(first.files);const y=tracked(second.api,'kickoff');
  feed(second.api,y.t,event(0,'pre'),event(0));assert.equal(y.count(),1);
  assert.equal(Object.values(second.api.states)[0].firstObservedAt,stamp);
  const third=setup(second.files);const z=tracked(third.api,'kickoff');feed(third.api,z.t,event(0));assert.equal(z.count(),0);
});
test('first live observation suppresses kickoff and subsequent points still fire',()=>{
  const{api}=setup();const k=tracked(api,'kickoff');const s=tracked(api,'score');
  api.processLeagueEvents([event(0)],[k.t,s.t]);assert.equal(k.count(),0);
  api.processLeagueEvents([event(6)],[k.t,s.t]);assert.equal(k.count(),0);assert.equal(s.count(),1);
});
test('diagnostics identify baseline, transition, restart and suppressed initial live kickoff without routine spam',()=>{
  const logs=[];const first=setup({}, {logs});const x=tracked(first.api,'kickoff');
  const pre=event(0,'pre');pre.date=new Date().toISOString();pre.status.type.name='STATUS_SCHEDULED';
  feed(first.api,x.t,pre,pre);
  let observations=logs.filter(l=>l.startsWith('[Sports observation] ')).map(l=>JSON.parse(l.slice('[Sports observation] '.length)));
  assert.equal(observations.length,1);assert.equal(observations[0].kind,'baseline');assert.equal(observations[0].kickoffDecision,'armed_waiting_for_live');
  assert.equal(observations[0].gameId,'game');assert.equal(observations[0].scheduledStart,pre.date);assert.ok(observations[0].observedAt);
  const live=event(0);live.status.type.name='STATUS_IN_PROGRESS';live.status.period=1;live.status.displayClock='15:00';
  feed(first.api,x.t,live);
  const change=JSON.parse(logs.filter(l=>l.startsWith('[Sports observation] ')).at(-1).slice('[Sports observation] '.length));
  assert.equal(change.previousState,'pre');assert.equal(change.state,'in');assert.equal(change.kickoffDecision,'fire');assert.equal(change.period,1);assert.equal(change.clock,'15:00');
  const restoredLogs=[];const second=setup(first.files,{logs:restoredLogs});const y=tracked(second.api,'kickoff');feed(second.api,y.t,live);
  assert.ok(restoredLogs.some(l=>l.includes('Loaded 1 saved game checkpoints')));
  const resumed=JSON.parse(restoredLogs.find(l=>l.startsWith('[Sports observation] ')).slice('[Sports observation] '.length));
  assert.equal(resumed.kind,'resumed');assert.equal(resumed.kickoffDecision,'already_handled');assert.equal(y.count(),0);
  const lateLogs=[];const late=setup({}, {logs:lateLogs});const z=tracked(late.api,'kickoff');feed(late.api,z.t,live);
  assert.ok(lateLogs.some(l=>l.includes('suppressed_initial_live_observation')));assert.equal(z.count(),0);
});
