"use strict";
const { randomUUID } = require("node:crypto");
const { isIP } = require("node:net");
const { ServiceError } = require("./settings.cjs");
const PUBLIC_ACTIONS = new Set(["needsAssessmentPublic", "needsAssessmentSubmit", "studentActivateAccount"]);
const ACTIONS = new Set([...PUBLIC_ACTIONS, "officerCandidateFind", "officerAssignmentManage", "officerAssignments", "officerTracklist", "officerActivityList", "officerRecord", "officerReportSubmit", "officerModuleAction", "announcementDraftList", "announcementWorkflow", "accountReplace", "notificationReadList", "notificationReadMark", "needsAssessmentManage", "needsAssessmentList", "needsAssessmentResponses", "studentAnnualPreview", "studentAnnualApply", "studentAnnualJob", "studentActivationResend", "studentRecordsList", "studentRecordDetail"]);
const STATUS = { "invalid-argument": 400, unauthenticated: 401, "permission-denied": 403, "not-found": 404, "already-exists": 409, "failed-precondition": 412, aborted: 409, "resource-exhausted": 429, unavailable: 503 };
// Static categories only: never log raw exceptions or configuration values.
function startupCategory(error) {
  const messages = new Map([
    ["Firebase service account must be configured as a JSON object.", "service-account-json-invalid"],
    ["Use a service account belonging to the configured Firebase project.", "service-account-fields-invalid"],
    ["Configure an exact HTTPS website origin without a path or trailing slash.", "website-origin-invalid"],
    ["Set USC_ENVIRONMENT to staging or production.", "environment-missing"],
    ["Configure the target Firebase project ID.", "firebase-project-invalid"],
    ["Firebase web configuration must be configured as a JSON object.", "firebase-web-json-invalid"],
    ["Firebase web configuration must match the target project and include apiKey/authDomain.", "firebase-web-fields-invalid"]
  ]);
  if (error instanceof ServiceError && messages.has(error.message)) return messages.get(error.message);
  const codes = new Map([["app/invalid-credential", "firebase-credential-invalid"], ["app/invalid-app-options", "firebase-app-options-invalid"], ["app/duplicate-app", "firebase-app-already-initialized"], ["MODULE_NOT_FOUND", "runtime-dependency-missing"]]);
  return codes.get(error?.code) || "runtime-startup-failed";
}
const MAX_BYTES = 1024 * 1024;
async function readBody(req) {
  let body = req.body;
  if (body === undefined) {
    const chunks = []; let length = 0;
    for await (const chunk of req) {
      length += Buffer.byteLength(chunk);
      if (length > MAX_BYTES) throw new ServiceError("invalid-argument", "Request is too large.");
      chunks.push(Buffer.from(chunk));
    }
    body = Buffer.concat(chunks).toString("utf8");
  }
  if (Buffer.isBuffer(body)) body = body.toString("utf8");
  if (typeof body === "string") {
    if (Buffer.byteLength(body) > MAX_BYTES) throw new ServiceError("invalid-argument", "Request is too large.");
    try { body = JSON.parse(body); } catch { throw new ServiceError("invalid-argument", "Send a JSON request."); }
  }
  if (!body || typeof body !== "object" || Array.isArray(body) || Buffer.byteLength(JSON.stringify(body)) > MAX_BYTES || Object.keys(body).some(key => !["action", "data"].includes(key)) || !ACTIONS.has(body.action) || !body.data || typeof body.data !== "object" || Array.isArray(body.data)) throw new ServiceError("invalid-argument", "Invalid management request.");
  return body;
}
function clientIP(req, hosted) {
  const forwarded = hosted ? String(req.headers["x-vercel-forwarded-for"] || req.headers["x-forwarded-for"] || "").split(",")[0].trim() : "";
  return isIP(forwarded) ? forwarded : req.socket?.remoteAddress || "unknown";
}
function createManagementHTTPHandler({ getRuntime, hosted = Boolean(process.env.VERCEL), log = entry => console.error(JSON.stringify(entry)) }) {
  return async function management(req, res) {
    const requestId = randomUUID();
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Request-ID", requestId);
    const send = (status, data) => { res.statusCode = status; res.end(JSON.stringify(data)); };
    if (req.method !== "POST") { res.setHeader("Allow", "POST"); return send(405, { error: { code: "invalid-argument", message: "Use POST." } }); }
    try {
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] || "")) throw new ServiceError("invalid-argument", "Use application/json.");
      const { action, data } = await readBody(req);
      let runtime;
      try { runtime = await getRuntime(); } catch (error) {
        log({ requestId, stage: "runtime-startup", category: startupCategory(error),
          step: new Set(["settings", "firebase-app", "firestore-client", "firestore-settings", "auth-client"]).has(error?.startupStep) ? error.startupStep : "other",
          kind: new Set(["Error", "TypeError", "SyntaxError", "RangeError", "FirebaseAppError"]).has(error?.name) ? error.name : "other",
          reason: new Set(["ERR_MODULE_NOT_FOUND", "ERR_PACKAGE_PATH_NOT_EXPORTED", "ERR_REQUIRE_ESM", "ERR_REQUIRE_ASYNC_MODULE", "MODULE_NOT_FOUND", "app/invalid-credential", "app/invalid-app-options", "app/duplicate-app", "failed-precondition"]).has(error?.code) ? error.code : "other"
        });
        throw new ServiceError("unavailable", "Hosted services are not configured. Contact the administrator.");
      }
      const origin = req.headers.origin;
      if (origin && !runtime.settings.allowedOrigins.has(origin)) throw new ServiceError("permission-denied", "This website origin is not authorized.");
      if (runtime.settings.enforceAppCheck) {
        const appToken = req.headers["x-firebase-appcheck"];
        if (typeof appToken !== "string") throw new ServiceError("unauthenticated", "Application verification is required.");
        try { await runtime.verifyAppCheckToken(appToken); } catch { throw new ServiceError("unauthenticated", "Application verification failed."); }
      }
      const request = { data, rawRequest: { ip: clientIP(req, hosted) } };
      if (PUBLIC_ACTIONS.has(action)) {
        request.rawRequest.ip = await runtime.limitPublicRequest(action, request.rawRequest.ip);
      } else {
        const match = /^Bearer ([^\s]+)$/.exec(req.headers.authorization || "");
        if (!match || match[1].length > 10000) throw new ServiceError("unauthenticated", "Please sign in first.");
        try { const token = await runtime.verifyIdToken(match[1]); request.auth = { uid: token.uid, token }; }
        catch { throw new ServiceError("unauthenticated", "Your session could not be verified. Sign in again."); }
      }
      const result = await runtime.handlers[action](request);
      send(200, { data: result });
    } catch (error) {
      const expected = error instanceof ServiceError;
      const code = expected && STATUS[error.code] ? error.code : "internal";
      log({ requestId, code }); // Never log request bodies, passwords, tokens, keys or SMTP errors.
      send(STATUS[code] || 500, { error: { code, message: expected && code !== "internal" ? error.message : "The request could not be completed. Please retry later.", requestId } });
    }
  };
}
module.exports = { createManagementHTTPHandler, PUBLIC_ACTIONS, ACTIONS, clientIP };
