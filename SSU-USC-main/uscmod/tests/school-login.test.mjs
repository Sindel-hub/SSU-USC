import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('public signup is removed and school identifier login is present', () => {
  const html = read('index/index.html');
  const js = read('index/js/index.js');
  assert.doesNotMatch(html, /Create an account|signupForm|Valid Gmail Address/i);
  assert.match(html, /Institutional Email or Student ID/i);
  assert.match(js, /resolveLoginCandidates/);
});

test('trusted backend disables self-registration and provisions school accounts', () => {
  const fn = read('functions/index.js');
  assert.match(fn, /Public account registration is disabled/);
  assert.match(fn, /exports\.provisionSchoolAccounts/);
  assert.match(fn, /Provision new students from the confirmed Student Records import/);
  assert.match(read('functions/student-records.js'), /student_records\/\$\{uid\}/);
  assert.match(fn, /generateTemporaryPassword/);
});

test('normal portal access and election eligibility are separated', () => {
  const guard = read('shared/auth-guard.js');
  const rules = read('firestore.rules');
  assert.match(guard, /profile\.schoolProvisioned !== true/);
  assert.match(guard, /isElectionProtectedPath\(\)/);
  assert.match(rules, /function schoolStudent\(\)/);
  assert.match(rules, /function verifiedStudent\(\)/);
});

test('profile drawer allows optional password change', () => {
  const profile = read('shared/profile-manager.js');
  assert.match(profile, /updatePassword/);
  assert.match(profile, /uscProfileChangePassword/);
  assert.match(profile, /Change Password/);
});


test('student profile always contains the Gmail self-service section above password change', () => {
  const profile = read('shared/profile-manager.js');
  const email = read('shared/email-settings.js');
  const gmailIndex = profile.indexOf('id="gmailSettings"');
  const passwordIndex = profile.indexOf('usc-profile-password-card');
  assert.ok(gmailIndex >= 0 && passwordIndex > gmailIndex);
  assert.match(email, /<label[^>]*for="gmailAddress">Personal Gmail address<\/label>/);
  assert.match(email, /id="gmailAddress" type="email"/);
  assert.match(email, /Gmail login, recovery and alerts activate after you confirm it/);
  assert.match(email, /No administrator approval is required/);
  assert.doesNotMatch(email, /<details>/);
});

test('replacement aliases are authoritative for ID and email login', async () => {
  const source = read('index/js/index.js');
  const resolver = source.slice(source.indexOf('async function resolveLoginCandidates('), source.indexOf('async function signInByIdentifier('));
  const build = new Function('clean','isStudentId','normalizeStudentId','schoolAuthAliasForStudentId','isEmail','normalizeEmail','schoolAuthAliasForEmail', resolver + ';return resolveLoginCandidates;');
  for (const alias of ['replacement@student.ssu-usc.local', '']) {
    const resolve = build(String, value => /^\d+$/.test(value), String, async()=>alias, value=>value.includes('@'), value=>value.toLowerCase(), async()=>alias);
    assert.deepEqual(await resolve('123'), [alias || '123@student.ssu-usc.local']);
    assert.deepEqual(await resolve('person@ssu.edu.ph'), [alias || 'person@ssu.edu.ph']);
  }
});
test('wrong replacement password never falls through to the disabled previous login', async () => {
  const source=read('index/js/index.js');
  const body=source.slice(source.indexOf('async function signInByIdentifier('),source.indexOf('async function signInSecurely('));
  const attempts=[];
  const login=new Function('isPersonalGmail','resolveLoginCandidates','signInSecurely',body+';return signInByIdentifier;')(
    ()=>false,async()=>['replacement@student.ssu-usc.local'],async email=>{attempts.push(email);throw Object.assign(Error('Wrong password'),{code:'auth/invalid-credential'});}
  );
  await assert.rejects(login('123','wrong'),{code:'auth/invalid-credential'});
  assert.deepEqual(attempts,['replacement@student.ssu-usc.local']);
});
