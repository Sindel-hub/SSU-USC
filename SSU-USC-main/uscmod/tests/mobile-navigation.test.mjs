import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../dashboard/js/events-section-scroll.js',import.meta.url),'utf8');
function fixture(mobile,reduced=false){
 const handlers={},calls=[],buttons={};
 const frame={scrollHeight:2000,clientHeight:600,clientTop:0,scrollTop:0,style:{setProperty(){}},getBoundingClientRect:()=>({top:100}),addEventListener:(name,fn)=>handlers[name]=fn,scrollTo:options=>calls.push(options)};
 const sections={eventsHighlightSection:{getBoundingClientRect:()=>({top:100-frame.scrollTop})},eventsUpcomingSection:{getBoundingClientRect:()=>({top:700-frame.scrollTop})}};
 const ctx=vm.createContext({document:{getElementById:id=>id==='eventsPageMain'?frame:sections[id]||{addEventListener:(name,fn)=>buttons[id]=fn}},matchMedia:query=>({matches:query.includes('max-width')?mobile:reduced,addEventListener(){}}),ResizeObserver:class{observe(){}},cancelAnimationFrame(){},requestAnimationFrame:()=>1,performance:{now:()=>0},getComputedStyle:()=>({overflowY:'visible'})});
 vm.runInContext(source,ctx);return{handlers,calls,buttons,frame};
}
test('Events section shortcuts animate on mobile and desktop, respecting reduced motion',()=>{
 for(const [mobile,reduced,expected] of [[true,false,'smooth'],[false,false,'smooth'],[false,true,'instant']]){
  const f=fixture(mobile,reduced);f.buttons.eventsScrollDown();assert.equal(f.calls.at(-1).top,600);assert.equal(f.calls.at(-1).behavior,expected);
  f.buttons.eventsScrollUp();assert.equal(f.calls.at(-1).top,0);assert.equal(f.calls.at(-1).behavior,expected);
 }
});
test('Events wheel input smoothly advances chapters on mobile and desktop',()=>{
 for(const mobile of [true,false]){
  const f=fixture(mobile);let prevented=false;
  f.handlers.wheel?.({cancelable:true,deltaY:100,deltaX:0,deltaMode:0,target:{closest:()=>null,parentElement:null},preventDefault(){prevented=true;}});
  assert.equal(prevented,true);
 }
});

test('card lists, calendars and horizontal gestures keep native scrolling',()=>{
 for(const nested of [true,false]){
  const f=fixture(false);let prevented=false;
  f.handlers.wheel({cancelable:true,deltaY:100,deltaX:nested?0:200,target:{closest:()=>nested?{}:null},preventDefault(){prevented=true}});
  assert.equal(prevented,false);assert.equal(f.calls.length,0);
 }
});
test('wheel momentum keeps one chapter target and reverse input can immediately return',()=>{
 const f=fixture(false);const event=dy=>({cancelable:true,deltaY:dy,deltaX:0,target:{closest:()=>null},preventDefault(){}});
 f.handlers.wheel(event(100));f.frame.scrollTop=200;f.handlers.wheel(event(100));assert.equal(f.calls.length,1);
 f.handlers.wheel(event(-100));assert.equal(f.calls.length,2);assert.equal(f.calls.at(-1).top,0);
});
test('touch swipes advance chapters without cancelling touch movement, and reduced motion stays native',()=>{
 for(const reduced of [false,true]){
 const f=fixture(true,reduced);f.handlers.touchstart({target:{closest:()=>null},touches:[{clientX:50,clientY:500}]});
 assert.equal(f.handlers.touchmove,undefined);
 f.handlers.touchend({changedTouches:[{clientX:50,clientY:350}]});assert.equal(f.calls.length,reduced?0:1);
 }
});
