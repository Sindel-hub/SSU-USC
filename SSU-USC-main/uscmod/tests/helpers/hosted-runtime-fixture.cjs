const { fixture } = require('./student-records-fixture.cjs');
const { ServiceError } = require('../../server/settings.cjs');
const { createAuthorization } = require('../../server/authorization.cjs');
const { createActivationMailer } = require('../../server/activation-mail.cjs');
const { createPublicLimiter } = require('../../server/runtime.cjs');
const { createStudentRecordHandlers } = require('../../functions/student-records.js');
const { createNeedsAssessmentHandlers } = require('../../functions/needs-assessment.js');
function hostedFixture(origin = 'https://staging.example.invalid') {
  const f = fixture(), mail = [], verifiedTokens = [], logs = [];
  f.records.set('users/admin-test', { uid: 'admin-test', fullName: 'Synthetic Admin', role: 'admin', accountStatus: 'approved', isActive: true });
  const authorization = createAuthorization({ db: f.db, clock: () => f.now });
  const env = { USC_GMAIL_USER: 'usc.synthetic.notifications@gmail.com', USC_GMAIL_APP_PASSWORD: 'abcdefghijklmnop' };
  const sendActivation = createActivationMailer({ publicOrigin: origin, env, createTransport: () => ({ sendMail: async message => { mail.push(message); return { accepted: [message.to], rejected: [] }; } }) });
  const dependencies = { db: f.db, adminAuth: f.adminAuth, ...authorization, sendActivation, HttpsError: ServiceError, clock: () => f.now };
  const runtime = {
    settings: { allowedOrigins: new Set([origin]), enforceAppCheck: false },
    handlers: { ...createStudentRecordHandlers(dependencies), ...createNeedsAssessmentHandlers(dependencies) },
    verifyIdToken: async token => {
      verifiedTokens.push(token);
      if (token === 'fixture-admin') return { uid: 'admin-test', role: 'admin', email_verified: true, auth_time: Math.floor(f.now / 1000) };
      if (token === 'fixture-officer') return { uid: 'officer-test', role: 'officer', email_verified: true, auth_time: Math.floor(f.now / 1000) };
      if (token === 'fixture-student') return { uid: 'student-test', role: 'student', email_verified: true, auth_time: Math.floor(f.now / 1000) };
      throw Error('Synthetic revoked/invalid token');
    },
    verifyAppCheckToken: async token => { if (token !== 'valid-app-check') throw Error('Invalid App Check'); },
    limitPublicRequest: createPublicLimiter({ db: f.db, key: 'synthetic-rate-key', clock: () => f.now })
  };
  return Object.assign(f, { runtime, mail, verifiedTokens, logs });
}
module.exports = { hostedFixture };
