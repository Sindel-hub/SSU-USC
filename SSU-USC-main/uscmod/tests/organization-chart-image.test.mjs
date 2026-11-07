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
