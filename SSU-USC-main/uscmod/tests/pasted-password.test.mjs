import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../shared/pasted-password.js',import.meta.url),'utf8');
function harness({accept='Abcdefg234!XYz',error='auth/invalid-credential'}={}){
 const handlers={},calls=[];
 const input={value:'',selectionStart:0,selectionEnd:0,addEventListener:(name,fn)=>handlers[name]=fn};
 const ctx=vm.createContext({navigator:{clipboard:{writeText:async text=>calls.push(['copy',text])}}});
 vm.runInContext(source.replaceAll('export ',''),ctx);
 const login=ctx.bindPastedPasswordLogin(input,async(id,password)=>{
  calls.push([id,password]);if(password!==accept)throw Object.assign(new Error('denied'),{code:error});return {uid:'existing-student'};
 });
 const paste=text=>{input.selectionStart=0;input.selectionEnd=input.value.length;handlers.paste({clipboardData:{getData:()=>text}});input.value=text.replace(/[\r\n]/g,'');};
 return {ctx,input,calls,paste,login};
}
for(const identifier of ['001234','student@ssu.edu.ph','verified@gmail.com'])test(`pasted generated password logs into existing account via ${identifier}`,async()=>{
 const h=harness();h.paste(' \nAbcdefg234!XYz\r\n\t');
 assert.equal((await h.login(identifier,h.input.value)).uid,'existing-student');
 assert.equal(h.calls.length,2);assert.equal(h.calls[1][1],'Abcdefg234!XYz');
});
test('clean pasted passwords use a single exact authentication attempt',async()=>{
 const h=harness();h.paste('Abcdefg234!XYz');await h.login('001234',h.input.value);assert.equal(h.calls.length,1);
});
test('valid passwords with meaningful surrounding spaces authenticate exactly',async()=>{
 const h=harness({accept:' Abcdefg234!XYz '});h.paste(' Abcdefg234!XYz ');await h.login('id',h.input.value);assert.equal(h.calls.length,1);
});
test('typed passwords, personal passwords and edits after paste are never trimmed',async()=>{
 for(const mode of ['typed','personal','edited']){
 const h=harness();
 if(mode==='personal')h.paste(' personal password ');
 else if(mode==='edited'){h.paste(' Abcdefg234!XYz ');h.input.value+='x';}
 else h.input.value=' Abcdefg234!XYz ';
 await assert.rejects(h.login('id',h.input.value));assert.equal(h.calls.length,1);
 }
});
for(const error of ['auth/too-many-requests','auth/network-request-failed','auth/user-disabled','auth/legacy-mfa-enrolled'])test(`paste does not retry ${error}`,async()=>{
 const h=harness({error});h.paste(' Abcdefg234!XYz ');await assert.rejects(h.login('id',h.input.value));assert.equal(h.calls.length,1);
});
test('incorrect pasted passwords still fail password verification',async()=>{
 const h=harness({accept:'Different234!XY'});h.paste(' Abcdefg234!XYz ');await assert.rejects(h.login('id',h.input.value));assert.equal(h.calls.length,2);
});
test('copy writes only the exact temporary password and handles clipboard denial',async()=>{
 const h=harness(),button={};await h.ctx.copyTemporaryPassword('Abcdefg234!XYz',button);
 assert.equal(h.calls[0][1],'Abcdefg234!XYz');assert.equal(button.textContent,'Password copied');
 h.ctx.navigator.clipboard.writeText=async()=>{throw Error('denied');};
 await h.ctx.copyTemporaryPassword('secret',button);assert.match(button.textContent,/select password manually/);
});
