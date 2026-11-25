import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import * as firestore from 'firebase/firestore';
import * as standing from '../shared/student-standing.js';
import * as permissions from '../shared/officer-permissions.js';

let env;
const nameKey = createHash('sha256').update('ana student').digest('hex');
const claim = {
  nameKey, normalizedName: 'ana student', fullName: 'Ana Student',
  studentId: '123456', uid: 'new-student', accountRole: 'student', createdBy: 'admin'
};
const input = {
  studentId: '123456', fullName: 'Ana Student', institutionalEmail: 'ana@example.edu',
  college: 'College of Education', program: 'Bachelor of Elementary Education',
  yearLevel: '1st Year', studentStanding: 'active', eligible: true
};
const source = fs.readFileSync(new URL('../shared/browser-provisioning.js', import.meta.url), 'utf8')
  .replace(/import\s+[\s\S]*?from\s+"[^"]+";/g, '').replace(/export /g, '');

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-ssu-registration',
    firestore: { rules: fs.readFileSync(process.env.SSU_RULES_FILE || new URL('../firestore.rules', import.meta.url), 'utf8') }
  });
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    for (const [uid, role, status] of [['admin', 'admin', 'approved'], ['officer', 'officer', 'approved'], ['student', 'student', 'approved'], ['suspended', 'admin', 'suspended']]) {
      await firestore.setDoc(firestore.doc(db, 'users', uid), { uid, role, studentId: role === "student" ? "990001" : "990002", accountStatus: status, isActive: status === 'approved' });
    }
    await firestore.setDoc(firestore.doc(db, 'election_config/current'), { electionId: 'current-election' });
  });
});
const adminDb = () => env.authenticatedContext('admin', { role: 'admin' }).firestore();
const ref = db => firestore.doc(db, 'student_name_claims', nameKey);

// Run the actual browser provisioning functions against the emulator. Only the
// secondary Authentication account/email calls are stubbed; every Firestore
// query and atomic batch uses the real SDK and the project's security rules.
function provisioner(db, actor = 'admin') {
  const created = [], deleted = [];
  const bindings = {
    ...firestore, ...standing, ...permissions,
    db, firebaseConfig: {},
    auth: { currentUser: { uid: actor, email: `${actor}@example.edu`, getIdTokenResult: async () => ({ claims: { role: actor === 'admin' ? 'admin' : 'officer' } }) } },
    initializeApp: () => ({}), deleteApp: async () => {}, getAuth: () => ({}),
    createUserWithEmailAndPassword: async (_, email) => {
      const user = { uid: `created-${created.length}`, email }; created.push(user); return { user };
    },
    deleteUser: async user => { deleted.push(user.uid); }, signOut: async () => {},
    updateProfile: async () => {}, sendEmailVerification: async () => {}, sendPasswordResetEmail: async () => {}
  };
  const api = new Function(...Object.keys(bindings), `${source}; return { provisionStudentAccount, provisionOfficerAccount };`)(...Object.values(bindings));
  return { ...api, created, deleted };
}

test('approved trusted admin can check a missing name claim and reserve it', async () => {
  const db = adminDb();
  assert.equal((await assertSucceeds(firestore.getDoc(ref(db)))).exists(), false);
  await assertSucceeds(firestore.setDoc(ref(db), claim));
  assert.equal((await firestore.getDoc(ref(db))).data().uid, claim.uid);
});

test('anonymous, student, officer, suspended admin, and untrusted admin cannot read or create reservations', async () => {
  const contexts = [env.unauthenticatedContext(), env.authenticatedContext('student', { role: 'student' }), env.authenticatedContext('officer', { role: 'officer' }), env.authenticatedContext('suspended', { role: 'admin' }), env.authenticatedContext('admin', {})];
  for (const context of contexts) {
    const db = context.firestore();
    await assertFails(firestore.getDoc(ref(db)));
    await assertFails(firestore.setDoc(ref(db), claim));
  }
});

test('reservations cannot be overwritten or taken over; only admins may release them', async () => {
  const db = adminDb();
  await assertSucceeds(firestore.setDoc(ref(db), claim));
  await assertFails(firestore.setDoc(ref(db), { ...claim, uid: 'another-user' }));
  await assertFails(firestore.updateDoc(ref(db), { fullName: 'Another Name' }));
  await assertFails(firestore.deleteDoc(ref(env.authenticatedContext('officer', { role: 'officer' }).firestore())));
  await assertSucceeds(firestore.deleteDoc(ref(db)));
});

test('malformed name reservations and forged creator IDs are rejected', async () => {
  const db = adminDb();
  for (const patch of [{ nameKey: 'wrong' }, { createdBy: 'someone-else' }, { accountRole: 'admin' }, { studentId: '../other' }, { studentId: 'ABC123' }, { studentId: '123-456' }, { studentId: '123_456' }, { uid: '' }, { normalizedName: '' }]) {
    await assertFails(firestore.setDoc(ref(db), { ...claim, ...patch }));
  }
  await assertFails(firestore.setDoc(firestore.doc(db, 'student_name_claims', 'invalid-key'), { ...claim, nameKey: 'invalid-key' }));
});

test('officer provisioning is retired without creating Authentication accounts', async () => {
  const api=provisioner(adminDb());
  await assert.rejects(api.provisionOfficerAccount({...input,officePosition:'Secretary'}), /Use Officer Management/);
  assert.equal(api.created.length,0);
});
test('even an administrator cannot create officer profiles or promote directly through browser writes', async () => {
  const db=adminDb();
  await assertFails(firestore.setDoc(firestore.doc(db,'users','forged-officer'),{uid:'forged-officer',role:'officer',accountStatus:'approved',isActive:true,schoolProvisioned:true,studentId:'990004',fullName:'Synthetic Officer',email:'synthetic@example.invalid',yearLevel:'2nd Year',studentStanding:'active',isVerifiedStudent:true,officePosition:'Treasurer',officerPermissions:['dashboard.view','reports.generate'],officerPermissionSource:'position-default'}));
  await assertFails(firestore.updateDoc(firestore.doc(db,'users','student'),{role:'officer',officePosition:'Treasurer'}));
  await assertFails(firestore.updateDoc(firestore.doc(db,'users','student'),{yearLevel:'3rd Year'}));
  await assertFails(firestore.updateDoc(firestore.doc(db,'users','student'),{academicYear:'2026-2027'}));
  for(const patch of [{graduationImportId:'forged'},{droppedImportId:'forged'},{accessRestoreImportId:'forged'},{standingManagedDisabled:true}]) await assertFails(firestore.updateDoc(firestore.doc(db,'users','student'),patch));
  await assertSucceeds(firestore.updateDoc(firestore.doc(db,'users','student'),{studentStanding:'dropped',isActive:false,isVerifiedStudent:false}));
  await assertFails(firestore.updateDoc(firestore.doc(db,'users','officer'),{role:'student'}));
  await assertFails(firestore.updateDoc(firestore.doc(db,'users','officer'),{officerPermissions:['dashboard.view','bulletin.manage']}));
  await assertSucceeds(firestore.updateDoc(firestore.doc(db,'users','student'),{accountStatus:'suspended',isActive:false}));
});

test('browser student creation cannot bypass the centralized records workflow', async () => {
  const db=adminDb(), api=provisioner(db);
  await assert.rejects(api.provisionStudentAccount(input));
  assert.equal((await firestore.getDocs(firestore.collection(db,'users'))).docs.some(doc => doc.data().studentId===input.studentId),false);
  await assertFails(firestore.setDoc(firestore.doc(db,'student_records','forged'),{studentId:input.studentId}));
  await assertFails(firestore.setDoc(firestore.doc(db,'student_record_ids',input.studentId),{uid:'forged'}));
});

test('non-admin provisioning is rejected before Authentication creates an account', async () => {
  const api = provisioner(env.authenticatedContext('officer', { role: 'officer' }).firestore(), 'officer');
  await assert.rejects(api.provisionStudentAccount(input), /System Administrator access is required/);
  assert.equal(api.created.length, 0);
});

test('optional email still rejects malformed and reserved internal addresses before creating Auth accounts', async () => {
  const api = provisioner(adminDb());
  for (const institutionalEmail of ['bad', '123456@student.ssu-usc.local']) await assert.rejects(api.provisionStudentAccount({...input, institutionalEmail}), /valid institutional email/);
  assert.equal(api.created.length, 0);
});
test('legacy Student ID records and linked email aliases prevent duplicate manual accounts', async () => {
  const db = adminDb(), api = provisioner(db);
  await firestore.setDoc(firestore.doc(db,'school_accounts/123456'),{studentId:'123456',uid:'legacy'});
  await assert.rejects(api.provisionStudentAccount(input), /Duplicate Student IDs/);
  await firestore.deleteDoc(firestore.doc(db,'school_accounts/123456'));
  const key = createHash('sha256').update(input.institutionalEmail).digest('hex');
  await firestore.setDoc(firestore.doc(db,'login_aliases/email_'+key),{authEmail:'old@student.ssu-usc.local',uid:'legacy',kind:'institutionalEmail'});
  await assert.rejects(api.provisionStudentAccount(input), /institutional email already has an account/);
  assert.equal(api.created.length, 0);
});
test('alias writes remain privileged, existing owners cannot be replaced, and verification tokens remain server-only', async () => {
  const db=adminDb(), alias=firestore.doc(db,'login_aliases/id_123456');
  await firestore.setDoc(alias,{authEmail:'123456@student.ssu-usc.local',uid:'student',kind:'studentId'});
  await assertFails(firestore.setDoc(alias,{authEmail:'attacker@ssu.edu.ph',uid:'other',kind:'studentId'}));
  await assertSucceeds(firestore.updateDoc(alias,{authEmail:'verified@ssu.edu.ph'}));
  const studentDb=env.authenticatedContext('student',{role:'student',email:'student@ssu.edu.ph',email_verified:true}).firestore();
  await assertFails(firestore.updateDoc(firestore.doc(studentDb,'login_aliases/id_123456'),{authEmail:'attacker@ssu.edu.ph'}));
  await assertFails(firestore.setDoc(firestore.doc(studentDb,'login_aliases/email_'+'a'.repeat(64)),{authEmail:'attacker@ssu.edu.ph',kind:'institutionalEmail'}));
  for(const contextDb of [db,studentDb,env.unauthenticatedContext().firestore()]) {
    await assertFails(firestore.getDoc(firestore.doc(contextDb,'institutional_email_requests/student')));
    await assertFails(firestore.setDoc(firestore.doc(contextDb,'institutional_email_requests/student'),{email:'attacker@ssu.edu.ph'}));
  }
});

test('manual IDs remain required and cannot contain document-path characters or exceed the Auth local-part limit', async () => {
  const api=provisioner(adminDb());
  for(const studentId of ['', '   ', '../123', '123/456', '123 456', 'ABC123', '123-456', '123_456', '123.456', 'abc@ssu.edu.ph', '1'.repeat(65)]) {
    await assert.rejects(api.provisionStudentAccount({...input,studentId}), /numbers only/);
    await assert.rejects(api.provisionOfficerAccount({...input,studentId,officePosition:'Secretary'}), /Use Officer Management/);
  }
  assert.equal(api.created.length,0);
});
