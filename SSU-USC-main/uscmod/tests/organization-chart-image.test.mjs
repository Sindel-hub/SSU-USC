import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../shared/organization-chart-image.js',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('export function validateChartFile'),source.indexOf('const image = document')).replaceAll('export ','');
test('only supported image files within 5 MB are accepted',()=>{
 const scope=vm.createContext({});vm.runInContext(helpers,scope);
 for(const type of ['image/jpeg','image/png','image/webp'])assert.doesNotThrow(()=>scope.validateChartFile({type,size:5242880}));
 assert.throws(()=>scope.validateChartFile({type:'image/svg+xml',size:100}),/JPG/);
 assert.throws(()=>scope.validateChartFile({type:'image/png',size:5242881}),/5 MB/);
 assert.throws(()=>scope.validateChartFile(null),/Choose/);
});
test('image preparation bounds dimensions, compresses and releases decoded image',async()=>{
 let released=false,dimensions;
 const scope=vm.createContext({createImageBitmap:async()=>({width:4000,height:2000,close(){released=true}}),document:{createElement(){return {getContext(){return {drawImage(...args){dimensions=args.slice(3)}}},toDataURL(_type,quality){return quality>.8?'data:image/webp;base64,'+'A'.repeat(900000):'data:image/webp;base64,UklGRg=='}}}}});
 vm.runInContext(helpers,scope);assert.equal(await scope.encodeChartImage({type:'image/png',size:100}),'data:image/webp;base64,UklGRg==');assert.deepEqual(Array.from(dimensions),[2048,1024]);assert.equal(released,true);
});

test('framing uses cover geometry, bounded zoom and edge-safe repositioning',()=>{
 const scope=vm.createContext({});vm.runInContext(helpers,scope);
 const landscape=scope.chartCropRect(1600,900,400,400,1,0,50);
 assert.equal(landscape.width,900);assert.equal(landscape.height,900);assert.equal(landscape.x,0);
 const right=scope.chartCropRect(1600,900,400,400,1,100,50);assert.equal(right.x,700);
 const portrait=scope.chartCropRect(900,1600,400,400,2,50,100);
 assert.equal(portrait.width,450);assert.equal(portrait.height,450);assert.equal(portrait.y,1150);
 const bounded=scope.chartCropRect(1600,900,400,400,99,-20,200);
 assert.equal(bounded.width,300);assert.equal(bounded.x,0);assert.equal(bounded.y,600);
});

test('framing export keeps the existing bounded WebP payload contract',()=>{
 let qualities=[];const scope=vm.createContext({});vm.runInContext(helpers,scope);
 assert.equal(scope.encodeChartCanvas({toDataURL:(type,quality)=>{assert.equal(type,'image/webp');qualities.push(quality);return quality>.7?'data:image/webp;base64,'+'A'.repeat(900000):'data:image/webp;base64,UklGRg=='}}),'data:image/webp;base64,UklGRg==');
 assert.deepEqual(qualities,[.9,.8,.7]);
 assert.throws(()=>scope.encodeChartCanvas({toDataURL:()=> 'data:image/webp;base64,'+'A'.repeat(900000)}),/too detailed/);
});

test('zoom-out fits the whole image and leaves proportional canvas space',()=>{
 const scope=vm.createContext({});vm.runInContext(helpers,scope);
 assert.equal(scope.chartFitZoom(400,1600,800,400),12);
 const fit=scope.chartCropRect(400,1600,800,400,.12,50,50);
 assert.ok(fit.width>=400&&fit.height>=1600);
 assert.ok(fit.x<=0&&fit.y<=0);
 const out=scope.chartCropRect(800,400,800,400,.25,50,50);
 assert.equal(out.width,3200);assert.equal(out.height,1600);
 assert.equal(out.x,-1200);assert.equal(out.y,-600);
});
