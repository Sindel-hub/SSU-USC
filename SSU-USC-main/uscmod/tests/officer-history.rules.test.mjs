import test from 'node:test';
import fs from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';

test('term-managed officer rules enforce server-only history, expiry and mutation routing', async () => {
  const env = await initializeTestEnvironment({ projectId: 'demo-ssu-officer-history', firestore: { rules: fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') } });
  try {
    const now = Date.now();
    await env.withSecurityRulesDisabled(async c => {
      const db = c.firestore();
      await setDoc(doc(db, 'users', 'officer'), { role: 'officer', accountStatus: 'approved', isActive: true, studentStanding: 'active', officePosition: 'Public Information Officer', officerPermissions: ['dashboard.view', 'bulletin.manage', 'complaints.view'], officerPermissionSource: 'custom', officerAssignmentId: 'term' });
      await setDoc(doc(db, 'users', 'legacy'), { role: 'officer', accountStatus: 'approved', isActive: true, officePosition: 'President' });
      await setDoc(doc(db, 'officer_assignments', 'term'), { officerUid: 'officer', status: 'active', startsAtMs: now - 10000, endsAtMs: now + 3600000 });
      await setDoc(doc(db, 'officer_records', 'record'), { officerUid: 'officer', assignmentId: 'term', snapshot: { content: 'Private report' } });
      await setDoc(doc(db, 'announcements', 'post'), { title: 'Post', officerAssignmentId: 'term' });
      await setDoc(doc(db, 'complaints', 'case'), { studentUid: 'unrelated-student', status: 'Submitted' });
    });
    const db = env.authenticatedContext('officer', { role: 'officer' }).firestore();
    const legacy = env.authenticatedContext('legacy', { role: 'officer' }).firestore();
    await assertFails(setDoc(doc(legacy, 'events', 'event'), { title: 'Bypass history' }));
    await assertFails(setDoc(doc(legacy, 'programs', 'program'), { title: 'Bypass history' }));
    await assertFails(deleteDoc(doc(legacy, 'announcements', 'post')));
    await assertFails(updateDoc(doc(legacy, 'complaints', 'case'), { status: 'Under Review' }));
    await assertFails(getDoc(doc(db, 'officer_records', 'record')));
    await assertFails(setDoc(doc(db, 'officer_records', 'forged'), { officerUid: 'officer', action: 'Claim work' }));
    await assertFails(updateDoc(doc(db, 'officer_records', 'record'), { officerUid: 'someone-else' }));
    await assertFails(deleteDoc(doc(db, 'officer_records', 'record')));
    await assertFails(setDoc(doc(db, 'announcements', 'direct-write'), { title: 'Bypass history' }));
    await assertFails(deleteDoc(doc(db, 'announcements', 'post')));
    await assertFails(updateDoc(doc(db, 'users', 'officer'), { officerAssignmentId: null }));
    await assertSucceeds(getDoc(doc(db, 'complaints', 'case')));
    await env.withSecurityRulesDisabled(c => updateDoc(doc(c.firestore(), 'officer_assignments', 'term'), { endsAtMs: now - 1 }));
    await assertFails(getDoc(doc(db, 'complaints', 'case')));
    await assertFails(updateDoc(doc(db, 'complaints', 'case'), { status: 'Resolved' }));
    // An expected anniversary is informational only for explicitly adopted terms.
    await env.withSecurityRulesDisabled(c => updateDoc(doc(c.firestore(), 'officer_assignments', 'term'), { termPolicy: 'until-turnover', expectedEndsAtMs: now - 1, actualEndsAtMs: null }));
    await assertSucceeds(getDoc(doc(db, 'complaints', 'case')));
    await assertFails(updateDoc(doc(db, 'officer_assignments', 'term'), { termPolicy: 'until-turnover', actualEndsAtMs: null }));
    await env.withSecurityRulesDisabled(c => updateDoc(doc(c.firestore(), 'officer_assignments', 'term'), { status: 'completed', actualEndsAtMs: now }));
    await assertFails(getDoc(doc(db, 'complaints', 'case')));
    await env.withSecurityRulesDisabled(c => updateDoc(doc(c.firestore(), 'officer_assignments', 'term'), { status: 'active' }));
    await assertFails(getDoc(doc(db, 'complaints', 'case')));
  } finally { await env.cleanup(); }
});
