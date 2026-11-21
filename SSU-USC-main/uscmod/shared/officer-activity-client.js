import { auth, db } from '../firebase/firebase-config.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js';
import { hostedManagementCall } from './hosted-management-client.js';

// Only term-managed officers use this transport. Legacy modules keep their
// existing workflow until an administrator explicitly migrates the officer.
export async function trackedOfficerAction(data) {
  if (!auth.currentUser) throw new Error('Please sign in again.');
  const profile = (await getDoc(doc(db, 'users', auth.currentUser.uid))).data();
  if (!profile?.officerAssignmentId) return null;
  if (profile.role !== 'officer') throw new Error('Your officer term has ended. Sign in again.');
  const input = { ...(data.input || {}) };
  if (input.registrationDeadline?.toMillis) input.registrationDeadlineMs = input.registrationDeadline.toMillis();
  delete input.registrationDeadline;
  delete input.createdAt;
  delete input.publishedAt;
  delete input.updatedAt;
  return hostedManagementCall('officerModuleAction', { ...data, input, operationId: crypto.randomUUID() });
}

export function canModifyTermRecord(record) {
  try { const p = JSON.parse(sessionStorage.getItem('studentProfile') || '{}'); return !p.officerAssignmentId || p.officerAssignmentId === record.officerAssignmentId; }
  catch { return false; }
}
