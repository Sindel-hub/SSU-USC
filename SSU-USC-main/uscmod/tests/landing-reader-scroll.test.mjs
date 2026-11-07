import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../home/js/home.js',import.meta.url),'utf8');
const navigation=source.slice(source.indexOf('function bindSectionStepNavigation'),source.indexOf('function bindEventsFollowingBackground'));
function fixture(open=true,mobile=false){
 const handlers={},steps=[],dialog={open};
 class Element {closest(){return null;}}
 const section=top=>({getBoundingClientRect:()=>({top})});
 const dom={welcomeSection:section(0),heroCopy:section(0),announcementSection:section(500),eventsSection:section(1000),aboutSection:section(2000)};
 const window={innerHeight:900,scrollY:0,matchMedia:()=>({matches:mobile,addEventListener(){}}),addEventListener:(type,fn)=>{handlers[type]=fn;},clearTimeout(){},setTimeout:()=>1};
 const ctx=vm.createContext({window,dom,document:{getElementById:()=>dialog},Element,performance:{now:()=>1000},getLandingHeaderHeight:()=>0,scrollToSection:target=>steps.push(target)});
 vm.runInContext(navigation+';bindSectionStepNavigation()',ctx);
 const target=new Element();
 function event(deltaY=400,y=400){let prevented=false;return {target,deltaY,cancelable:true,changedTouches:[{clientX:100,clientY:y}],preventDefault(){prevented=true;},get prevented(){return prevented;}};}
 return {handlers,steps,dialog,event};
}
test('landing wheel handler leaves open announcement input for native scrolling',()=>{
 const f=fixture();const event=f.event();f.handlers.wheel(event);assert.equal(event.prevented,false);assert.equal(f.steps.length,0);
});
test('an existing landing momentum lock cannot swallow wheel input after reader opens',()=>{
 const f=fixture(false);const landing=f.event();f.handlers.wheel(landing);assert.equal(landing.prevented,true);assert.equal(f.steps.length,1);
 f.dialog.open=true;const popup=f.event();f.handlers.wheel(popup);assert.equal(popup.prevented,false);assert.equal(f.steps.length,1);
});
test('mobile navigation leaves touch and wheel gestures native with or without a reader',()=>{
 for(const open of [true,false]){
  const f=fixture(open,true),event=f.event();f.handlers.wheel(event);
  assert.equal(event.prevented,false);assert.equal(f.steps.length,0);
  for(const type of ['touchstart','touchmove','touchend']) assert.equal(f.handlers[type],undefined);
 }
});

test('activity list wheel input stays native even while landing chapter navigation is locked',()=>{
 const f=fixture(false);f.handlers.wheel(f.event());assert.equal(f.steps.length,1);
 const input=f.event();input.target.closest=selector=>selector==='.activity-card-grid'?{}:null;
 f.handlers.wheel(input);assert.equal(input.prevented,false);assert.equal(f.steps.length,1);
});
test('mobile calendar and activity-list gestures do not register chapter swipe handlers',()=>{
 const f=fixture(false,true);
 const event=f.event();event.target.closest=selector=>selector==='.activity-card-grid'?{}:null;
 f.handlers.wheel(event);assert.equal(event.prevented,false);assert.equal(f.steps.length,0);
 assert.equal(f.handlers.touchmove,undefined);
});
