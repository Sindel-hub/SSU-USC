import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { initializeApp as initializeAdmin, deleteApp as deleteAdmin } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
const require = createRequire(import.meta.url);
const { createAdminSetUserPassword } = require('../functions/admin-set-user-password.js');

// This test deliberately cannot run against live Firebase services.
test('chosen password changes an actual emulator account, rejects the old password, and never enters Firestore', async () => {
  assert.ok(process.env.FIREBASE_AUTH_EMULATOR_HOST && process.env.FIRESTORE_EMULATOR_HOST, 'Run with npm run test:admin-password-integration');
  const projectId = 'demo-usc-admin-password', suffix = String(Date.now());
  const admin = initializeAdmin({ projectId }, `password-admin-${suffix}`);
  const app = initializeApp({ projectId, apiKey: 'demo-only-api-key' }, `password-client-${suffix}`);
  const db = getFirestore(admin), auth = getAdminAuth(admin), client = getAuth(app);
  connectAuthEmulator(client, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
  const adminUid = `admin-${suffix}`, targetUid = `student-${suffix}`;
  const targetEmail = `student-${suffix}@example.test`, oldPassword = 'PreviousPass#123', password = ' ChosenPass#456 ';
  try {
    await auth.createUser({ uid: adminUid, email: `admin-${suffix}@example.test`, password: oldPassword, emailVerified: true });
    await auth.setCustomUserClaims(adminUid, { role: 'admin' });
    await auth.createUser({ uid: targetUid, email: targetEmail, password: oldPassword });
    await db.doc(`users/${adminUid}`).set({ role: 'admin', accountStatus: 'approved', isActive: true });
    await db.doc(`users/${targetUid}`).set({ role: 'student', accountStatus: 'approved', isActive: true });
    const student = await signInWithEmailAndPassword(client, targetEmail, oldPassword);
    const oldToken = await student.user.getIdToken();
    const source = fs.readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
    const names = ['requireAuth','roleOf','requireRole','requireActiveRole','requireRecentAuth','requireVerifiedAdminEmail','cleanText'];
    const helpers = names.map(name => source.match(new RegExp(`(?:async )?function ${name}\\([^]*?(?=\\n(?:async )?function |\\nconst |\\nexports\\.|$)`))[0]).join('\n');
    class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
    const context = vm.createContext({ db, HttpsError }); vm.runInContext(helpers, context);
    const handle = createAdminSetUserPassword({ db, adminAuth: auth, FieldValue, HttpsError,
      requireActiveRole: context.requireActiveRole, requireRecentAuth: context.requireRecentAuth,
      audit: async (request, action, target, before, after, extra) => db.collection('audit_logs').add({ actorUid: request.auth.uid, action, target, before, after, ...extra })
    });
    // Token revocation times have second precision.
    await new Promise(resolve => setTimeout(resolve, 1100));
    const result = await handle({ auth: { uid: adminUid, token: { role: 'admin', email_verified: true, auth_time: Math.floor(Date.now()/1000) } }, data: { uid: targetUid, password } });
    assert.equal(result.changed, true);
    assert.equal(result.warning, '');
    await assert.rejects(signInWithEmailAndPassword(client, targetEmail, oldPassword));
    await assert.rejects(signInWithEmailAndPassword(client, targetEmail, password.trim()));
    const updated = await signInWithEmailAndPassword(client, targetEmail, password);
    assert.equal(updated.user.uid, targetUid);
    await assert.rejects(auth.verifyIdToken(oldToken, true), error => error.code === 'auth/id-token-revoked');
    const profile = (await db.doc(`users/${targetUid}`).get()).data();
    assert.equal(profile.role, 'student'); assert.equal(profile.accountStatus, 'approved'); assert.equal(profile.isActive, true);
    const logs = (await db.collection('audit_logs').where('target', '==', `users/${targetUid}`).get()).docs.map(doc => doc.data());
    assert.equal(logs.length, 1);
    assert.doesNotMatch(JSON.stringify([profile, logs, result]), /ChosenPass|PreviousPass/);
  } finally { await deleteApp(app); await deleteAdmin(admin); }
});
