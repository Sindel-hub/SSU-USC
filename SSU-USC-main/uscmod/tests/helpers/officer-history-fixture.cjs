const { fixture } = require('./student-records-fixture.cjs');
const { createAuthorization } = require('../../server/authorization.cjs');
const { createOfficerHistory, POSITIONS } = require('../../server/officer-history.cjs');
const { createOfficerModuleHandlers } = require('../../server/officer-modules.cjs');
const { createNeedsAssessmentHandlers } = require('../../functions/needs-assessment.js');
const { DEPARTMENTS } = require('../../functions/needs-assessment-model.js');
const { ServiceError } = require('../../server/settings.cjs');
function historyFixture() {
  const f = fixture(), authorization = createAuthorization({ db: f.db, clock: () => f.now });
  f.records.set('users/admin', { role: 'admin', fullName: 'Authorized Administrator', accountStatus: 'approved', isActive: true });
  const dependencies = { db: f.db, adminAuth: f.adminAuth, ...authorization, clock: () => f.now, HttpsError: ServiceError };
  const history = createOfficerHistory(dependencies);
  const handlers = { ...history.handlers, ...createOfficerModuleHandlers({ ...dependencies, history, Timestamp: { fromMillis: n => n } }), ...createNeedsAssessmentHandlers({ ...dependencies, history }) };
  const req = (uid, data, role = f.records.get('users/' + uid)?.role) => ({ auth: { uid, token: { role, email_verified: true, auth_time: f.now / 1000 } }, data });
  const seed = (uid, studentId) => f.seed({ uid, studentId, fullName: 'Synthetic ' + uid, email: uid + '@example.invalid', role: 'student', accountStatus: 'approved', isActive: true, studentStanding: 'active' });
  for (const [uid, sid] of [['first', '990001'], ['second', '990002'], ['other', '990003']]) seed(uid, sid);
  async function assign(uid = 'first', position = 'Treasurer', extra = {}) {
    const data = { action: 'assign', assignmentId: 'assignment-' + uid, officerUid: uid, position, department: DEPARTMENTS[0], administration: '2026–2027', authorization: 'Synthetic approved appointment', startsAtMs: f.now - 1000, endsAtMs: f.now + 86400000, ...extra };
    return handlers.officerAssignmentManage(req('admin', data));
  }
  const reports = () => [...f.records.entries()].filter(([p]) => p.startsWith('officer_records/')).map(([p, v]) => ({ id: p.split('/').at(-1), ...v }));
  return Object.assign(f, { authorization, history, h: handlers, req, assign, reports });
}
module.exports = { historyFixture };
