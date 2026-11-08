import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../dashboard/js/election.js',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('function stopWatchingCandidates('),source.indexOf('async function loadSecureState('));
const snapshot=rows=>({docs:rows.map(row=>({id:row.id,data:()=>row}))});
const initial=[{id:'one',fullName:'One',position:'President',approved:true},{id:'two',fullName:'Two',position:'Vice President',approved:true}];
function setup(view='candidates'){
 let selectors=[],gallery=0,ballots=0,closed=0,reads=0,stops=0,failed=0;
 const subscriptions=[];
 const ctx=vm.createContext({context:null,candidateDraft:null,db:{},candidates:[],watchedElection:'',stopCandidateWatch:null,activeCandidateId:'',candidateWatchGeneration:0,currentView:view,
  collection:(_db,...parts)=>parts.join('/'),getDocs:async()=>{reads++;return snapshot(initial);},
  onSnapshot:(ref,next,error)=>{subscriptions.push({ref,next,error});return ()=>{stops++;};},
  closeCandidateProfile:()=>{closed++;ctx.activeCandidateId='';},
  renderCandidates:()=>{gallery++;},renderBallot:()=>{
   ballots++;selectors=['President','Vice President'].map(position=>({dataset:{position},value:'',options:[{value:''},...ctx.candidates.filter(c=>c.position===position).map(c=>({value:c.id}))]}));
  },
  document:{querySelectorAll:()=>selectors},failClosed:()=>{failed++;},console:{warn:()=>{}},
 });
 vm.runInContext(helpers,ctx);
 return {ctx,subscriptions,gallery:()=>gallery,ballots:()=>ballots,closed:()=>closed,reads:()=>reads,stops:()=>stops,failed:()=>failed,setSelectors:value=>{selectors=value;},selectors:()=>selectors};
}
test('live removal hides the candidate and leaves other candidate records intact',()=>{
 const h=setup();h.ctx.applyCandidateSnapshot(snapshot(initial));
 h.ctx.applyCandidateSnapshot(snapshot([{...initial[0],removed:true},initial[1]]));
 assert.deepEqual(Array.from(h.ctx.candidates,c=>c.id),['two']);assert.equal(h.ctx.candidates[0].fullName,'Two');assert.equal(h.gallery(),2);
});
test('an open profile closes when its candidate is removed',()=>{
 const h=setup();h.ctx.activeCandidateId='one';h.ctx.applyCandidateSnapshot(snapshot([{...initial[0],removed:true},initial[1]]));
 assert.equal(h.closed(),1);assert.equal(h.ctx.activeCandidateId,'');
});
test('removal clears a stale ballot choice while preserving another valid selection',()=>{
 const h=setup('ballot');h.setSelectors([{dataset:{position:'President'},value:'one'},{dataset:{position:'Vice President'},value:'two'}]);
 h.ctx.applyCandidateSnapshot(snapshot([{...initial[0],removed:true},initial[1]]));
 assert.equal(h.selectors()[0].value,'');assert.equal(h.selectors()[1].value,'two');assert.equal(h.ballots(),1);
});
test('routine refreshes do not overwrite live removal events with a second read',async()=>{
 const h=setup();await h.ctx.watchElectionCandidates('e',true);
 h.subscriptions[0].next(snapshot([{...initial[0],removed:true},initial[1]]));
 await h.ctx.watchElectionCandidates('e',true);
 assert.equal(h.reads(),1);assert.deepEqual(Array.from(h.ctx.candidates,c=>c.id),['two']);
});
test('late callbacks from a different election cannot repopulate the student list',async()=>{
 const h=setup();await h.ctx.watchElectionCandidates('old',true);const old=h.subscriptions[0];
 await h.ctx.watchElectionCandidates('new',true);h.subscriptions[1].next(snapshot([initial[1]]));old.next(snapshot([initial[0]]));
 assert.equal(h.ctx.watchedElection,'new');assert.deepEqual(Array.from(h.ctx.candidates,c=>c.id),['two']);assert.equal(h.stops(),1);
});
test('leaving the election stops updates and clears any open profile',async()=>{
 const h=setup();await h.ctx.watchElectionCandidates('e',true);h.ctx.activeCandidateId='one';const old=h.subscriptions[0];
 await h.ctx.watchElectionCandidates('',false);old.next(snapshot(initial));
 assert.equal(h.ctx.candidates.length,0);assert.equal(h.ctx.watchedElection,'');assert.equal(h.closed(),1);
});
test('listener errors clear stale data and fail closed for ballot views',async()=>{
 const h=setup('ballot');await h.ctx.watchElectionCandidates('e',true);h.subscriptions[0].error(Error('unavailable'));
 assert.equal(h.ctx.candidates.length,0);assert.equal(h.ctx.watchedElection,'');assert.equal(h.failed(),1);
});
test('a slow initial read cannot overwrite a newly selected election',async()=>{
 const h=setup();let resolveOld;const oldRead=new Promise(resolve=>{resolveOld=resolve;});
 h.ctx.getDocs=ref=>ref.includes('/old/')?oldRead:Promise.resolve(snapshot([initial[1]]));
 const pending=h.ctx.watchElectionCandidates('old',true);await h.ctx.watchElectionCandidates('new',true);
 resolveOld(snapshot([initial[0]]));await pending;
 assert.equal(h.subscriptions.length,1);assert.equal(h.ctx.watchedElection,'new');assert.deepEqual(Array.from(h.ctx.candidates,c=>c.id),['two']);
});
test('failed initial reads clear the watched election so a retry can occur',async()=>{
 const h=setup();h.ctx.getDocs=async()=>{throw Error('unavailable');};await assert.rejects(h.ctx.watchElectionCandidates('e',true));
 assert.equal(h.ctx.watchedElection,'');assert.equal(h.ctx.candidates.length,0);
});
test('secure loading keeps candidate removal updates active during voting',async()=>{
 const h=setup('ballot');Object.assign(h.ctx,{watchRegistration(){},student:{uid:'student'},auth:{currentUser:null},doc:(_db,...parts)=>parts.join('/'),getDoc:async()=>({exists:()=>false}),callSecure:async()=>({electionId:'e',candidateVisible:false,votingOpen:true}),application:null,voterStatus:null,turnout:{}});
 vm.runInContext(source.slice(source.indexOf('async function loadSecureState('),source.indexOf('let registrationSubscription =')),h.ctx);
 await h.ctx.loadSecureState();assert.equal(h.ctx.watchedElection,'e');assert.equal(h.subscriptions.length,1);
});

test('callbacks from a retired subscription cannot revive candidates after same-election retry',async()=>{
 const h=setup();await h.ctx.watchElectionCandidates('e',true);const old=h.subscriptions[0];
 old.error(Error('unavailable'));await h.ctx.watchElectionCandidates('e',true);
 h.subscriptions[1].next(snapshot([initial[1]]));old.next(snapshot(initial));
 assert.deepEqual(Array.from(h.ctx.candidates,c=>c.id),['two']);
});
