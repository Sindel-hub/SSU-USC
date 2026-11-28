"use strict";
const { createHmac } = require("node:crypto");
const { readServerSettings, ServiceError } = require("./settings.cjs");
const { createAuthorization } = require("./authorization.cjs");
const { createOfficerHistory } = require("./officer-history.cjs");
const { createOfficerModuleHandlers } = require("./officer-modules.cjs");
const { createActivationMailer } = require("./activation-mail.cjs");
const { createStudentRecordHandlers } = require("../functions/student-records.js");
const { createNeedsAssessmentHandlers } = require("../functions/needs-assessment.js");
const { createAnnouncementWorkflow } = require("./announcement-workflow.cjs");
const { createNotificationReadHandlers } = require("./notification-reads.cjs");
const { createAccountReplacementHandlers } = require("./account-replacement.cjs");
const {createEventParticipationHandlers} = require("./event-participation.cjs");
const {createReportingHandlers}=require("./reporting.cjs");
const {createEligibilityHandlers}=require("./reporting-eligibility.cjs");
let cached;
function startupStep(step, operation) {
  try { return operation(); }
  catch (error) {
    const wrapped = new Error("Hosted startup failed.");
    wrapped.startupStep = step;
    wrapped.code = error?.code;
    wrapped.name = error?.name;
    throw wrapped;
  }
}
function createPublicLimiter({ db, key, clock = Date.now }) {
  return async (action, ip) => {
    const bucket = action === "needsAssessmentPublic" ? "read" : "write";
    const digest = createHmac("sha256", key).update(`${bucket}:${ip}`).digest("hex");
    const ref = db.collection("hosted_request_limits").doc(digest);
    const window = Math.floor(clock() / 60000);
    await db.runTransaction(async tx => {
      const snap = await tx.get(ref), previous = snap.data();
      const count = previous?.window === window ? previous.count : 0;
      if (count >= (bucket === "read" ? 120 : 30)) throw new ServiceError("resource-exhausted", "Too many requests from this network. Please wait a minute.");
      tx.set(ref, { window, count: count + 1, lastSeenAt: clock() });
    });
    return digest;
  };
}
function getRuntime() {
  if (cached) return cached;
  const settings = readServerSettings();
  const { initializeApp, cert } = require("firebase-admin/app");
  const { getAuth } = require("firebase-admin/auth");
  const { getFirestore, Timestamp } = require("firebase-admin/firestore");
  const { getAppCheck } = require("firebase-admin/app-check");
  const nodemailer = require("nodemailer");
  const app = startupStep("firebase-app", () => initializeApp({ projectId: settings.projectId, credential: cert(settings.account) }, "usc-hosted-management"));
  const db = startupStep("firestore-client", () => getFirestore(app));
  startupStep("firestore-settings", () => db.settings({ ignoreUndefinedProperties: true }));
  const adminAuth = startupStep("auth-client", () => getAuth(app));
  const authorization = createAuthorization({ db });
  const sendActivation = createActivationMailer({ publicOrigin: settings.publicOrigin, createTransport: nodemailer.createTransport });
  const dependencies = { db, adminAuth, ...authorization, HttpsError: ServiceError, sendActivation };
  const history = createOfficerHistory({ ...dependencies });
  cached = {
    settings,
    handlers: { ...createReportingHandlers({...dependencies,history}), ...createEligibilityHandlers({...dependencies,history}), ...createEventParticipationHandlers({...dependencies, history}), ...createAccountReplacementHandlers(dependencies), ...createNotificationReadHandlers(dependencies), ...createAnnouncementWorkflow({ ...dependencies, history, Timestamp, publicOrigin: settings.publicOrigin }), ...createNeedsAssessmentHandlers({ ...dependencies, history }), ...createStudentRecordHandlers(dependencies), ...history.handlers, ...createOfficerModuleHandlers({ ...dependencies, history, Timestamp }) },
    verifyIdToken: token => adminAuth.verifyIdToken(token, true),
    verifyAppCheckToken: token => getAppCheck(app).verifyToken(token),
    limitPublicRequest: createPublicLimiter({ db, key: settings.account.private_key })
  };
  return cached;
}
module.exports = { getRuntime, createPublicLimiter };
