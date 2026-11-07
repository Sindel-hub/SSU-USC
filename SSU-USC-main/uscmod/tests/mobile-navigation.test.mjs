import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../dashboard/js/events-section-scroll.js',import.meta.url),'utf8');
function fixture(mobile,reduced=false){
 const handlers={},calls=[],buttons={};
 const frame={scrollHeight:2000,clientHeight:600,clientTop:0,scrollTop:0,style:{setProperty(){}},getBoundingClientRect:()=>({top:100}),addEventListener:(name,fn)=>handlers[name]=fn,scrollTo:options=>calls.push(options)};
 const sections={eventsHighlightSection:{getBoundingClientRect:()=>({top:100})},eventsUpcomingSection:{getBoundingClientRect:()=>({top:700})}};
 const ctx=vm.createContext({document:{getElementById:id=>id==='eventsPageMain'?frame:sections[id]||{addEventListener:(name,fn)=>buttons[id]=fn}},matchMedia:query=>({matches:query.includes('max-width')?mobile:reduced,addEventListener(){}}),ResizeObserver:class{observe(){}},cancelAnimationFrame(){},requestAnimationFrame:()=>1,performance:{now:()=>0},getComputedStyle:()=>({overflowY:'visible'})});
 vm.runInContext(source,ctx);return{handlers,calls,buttons};
}
test('mobile Events buttons navigate immediately; desktop keeps smooth navigation',()=>{
 for(const [mobile,reduced,expected] of [[true,false,'instant'],[false,false,'smooth'],[false,true,'instant']]){
  const f=fixture(mobile,reduced);f.buttons.eventsScrollDown();assert.equal(f.calls.at(-1).top,600);assert.equal(f.calls.at(-1).behavior,expected);
  f.buttons.eventsScrollUp();assert.equal(f.calls.at(-1).top,0);assert.equal(f.calls.at(-1).behavior,expected);
 }
});
test('mobile Events wheel input is native while desktop retains its smoother',()=>{
 for(const mobile of [true,false]){
  const f=fixture(mobile);let prevented=false;
  f.handlers.wheel({cancelable:true,deltaY:100,deltaX:0,deltaMode:0,target:{closest:()=>null,parentElement:null},preventDefault(){prevented=true;}});
  assert.equal(prevented,!mobile);
 }
});
