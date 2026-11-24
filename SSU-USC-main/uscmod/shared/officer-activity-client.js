import { auth, db } from '../firebase/firebase-config.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js';
import { hostedManagementCall } from './hosted-management-client.js';

export async function trackedOfficerAction(data) {
  if (!auth.currentUser) throw new Error('Please sign in again.');
  const profile = (await getDoc(doc(db, 'users', auth.currentUser.uid))).data();
  if (profile?.role === 'admin') return null;
  if (profile?.role !== 'officer') throw new Error('An active officer account is required.');
  const input = { ...(data.input || {}) };
  if (input.registrationDeadline?.toMillis) input.registrationDeadlineMs = input.registrationDeadline.toMillis();
  delete input.registrationDeadline;
  delete input.createdAt;
  delete input.publishedAt;
  delete input.updatedAt;
  const request = { ...data, input, operationId: crypto.randomUUID() };
  try {
    return await hostedManagementCall('officerModuleAction', request);
  } catch (error) {
    if (error.code && error.code !== 'unavailable') throw error;
    return hostedManagementCall('officerModuleAction', request);
  }
}

export function activityHistoryHref(module, recordId) {
  return '../officer-tracklist/officer-tracklist.html?' + new URLSearchParams({ module, record: recordId });
}

export function activityAttributionText(attribution = {}) {
  const verbs = { created: 'Created by', published: 'Published by', updated: 'Updated by', removed: 'Removed by', restored: 'Restored by' };
  return Object.entries(verbs).flatMap(([key, label]) => {
    const actor = attribution[key];
    return actor?.name ? [label + ' ' + [actor.name, actor.position, actor.administration].filter(Boolean).join(' · ')] : [];
  }).join(' | ');
}
