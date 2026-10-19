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
      await firestore.setDoc(firestore.doc(db, 'users', uid), { uid, role, accountStatus: status, isActive: status === 'approved' });
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
  for (const patch of [{ nameKey: 'wrong' }, { createdBy: 'someone-else' }, { accountRole: 'admin' }, { studentId: '123' }, { uid: '' }, { normalizedName: '' }]) {
    await assertFails(firestore.setDoc(ref(db), { ...claim, ...patch }));
  }
  await assertFails(firestore.setDoc(firestore.doc(db, 'student_name_claims', 'invalid-key'), { ...claim, nameKey: 'invalid-key' }));
});

for (const role of ['student', 'officer']) {
  test(`actual ${role} provisioning commits the complete account batch and blocks duplicates`, async () => {
    const db = adminDb(), api = provisioner(db);
    const result = await (role === 'student' ? api.provisionStudentAccount(input) : api.provisionOfficerAccount({ ...input, officePosition: 'Secretary' }));
    assert.equal(result.ok, true);
    const user = (await firestore.getDoc(firestore.doc(db, 'users', result.credential.uid))).data();
    assert.equal(user.role, role);
    assert.equal(user.studentId, input.studentId);
    for (const path of [`student_id_claims/${input.studentId}`, `student_name_claims/${nameKey}`, `school_accounts/${input.studentId}`, `student_masterlist/${input.studentId}`, `login_aliases/id_${input.studentId}`, `elections/current-election/voterRoster/${input.studentId}`]) {
      assert.equal((await firestore.getDoc(firestore.doc(db, path))).exists(), true, path);
    }
    assert.equal((await firestore.getDocs(firestore.collection(db, 'audit_logs'))).size, 1);
    await assert.rejects(api.provisionStudentAccount(input), /Duplicate Student IDs/);
    await assert.rejects(api.provisionStudentAccount({ ...input, studentId: '654321' }), /Duplicate account names/);
    assert.equal(api.created.length, 1);
    assert.deepEqual(api.deleted, []);
  });
}

test('non-admin provisioning is rejected before Authentication creates an account', async () => {
  const api = provisioner(env.authenticatedContext('officer', { role: 'officer' }).firestore(), 'officer');
  await assert.rejects(api.provisionStudentAccount(input), /System Administrator access is required/);
  assert.equal(api.created.length, 0);
});
