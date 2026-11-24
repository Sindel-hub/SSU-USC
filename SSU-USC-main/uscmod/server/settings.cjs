"use strict";
const PRODUCTION_PROJECT = "universitystudentcouncil-856cc";
const PRODUCTION_ORIGIN = "https://ssu-usc.vercel.app";
const PUBLIC_KEYS = new Set(["apiKey", "authDomain", "projectId", "storageBucket", "messagingSenderId", "appId", "measurementId", "databaseURL"]);
class ServiceError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
function invalid(message) { throw new ServiceError("failed-precondition", message); }
function json(value, label) {
  try { const result = JSON.parse(value); if (!result || typeof result !== "object" || Array.isArray(result)) throw Error(); return result; }
  catch { invalid(`${label} must be configured as a JSON object.`); }
}
function httpsOrigin(value) {
  try { const url = new URL(value); if (url.protocol !== "https:" || url.origin !== value || url.username || url.password) throw Error(); return url.origin; }
  catch { invalid("Configure an exact HTTPS website origin without a path or trailing slash."); }
}
function readPublicSettings(env = process.env) {
  const environment = env.USC_ENVIRONMENT;
  if (!["staging", "production"].includes(environment)) invalid("Set USC_ENVIRONMENT to staging or production.");
  const projectId = String(env.USC_FIREBASE_PROJECT_ID || "");
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) invalid("Configure the target Firebase project ID.");
  if (environment === "staging" && projectId === PRODUCTION_PROJECT) invalid("Staging must not connect to production Firebase.");
  if (environment === "production" && projectId !== PRODUCTION_PROJECT) invalid("Production Firebase project does not match this application.");
  if (env.VERCEL_ENV === "preview" && environment !== "staging") invalid("Vercel Preview must use staging services.");
  if (env.VERCEL_ENV === "production" && environment !== "production") invalid("Production deployments must use the production environment configuration.");
  if (env.VERCEL && projectId.startsWith("demo-")) invalid("Hosted deployments cannot use a demo/emulator project.");
  const webConfig = json(env.USC_FIREBASE_WEB_CONFIG_JSON, "Firebase web configuration");
  if (Object.keys(webConfig).some(key => !PUBLIC_KEYS.has(key))) invalid("Firebase web configuration contains unsupported or private fields.");
  if (webConfig.projectId !== projectId || typeof webConfig.apiKey !== "string" || !webConfig.apiKey || typeof webConfig.authDomain !== "string" || !/^[a-z0-9.-]+$/i.test(webConfig.authDomain)) invalid("Firebase web configuration must match the target project and include apiKey/authDomain.");
  const deploymentOrigin = env.VERCEL_URL ? httpsOrigin(`https://${env.VERCEL_URL}`) : null;
  const productionOrigin = environment === "production"
    ? httpsOrigin(env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : PRODUCTION_ORIGIN)
    : null;
  const publicOrigin = httpsOrigin(env.USC_PUBLIC_ORIGIN || productionOrigin || deploymentOrigin);
  if (environment === "staging" && publicOrigin === PRODUCTION_ORIGIN) invalid("Staging activation links must not point to production.");
  return { environment, projectId, webConfig, publicOrigin, allowedOrigins: new Set([publicOrigin, productionOrigin, deploymentOrigin].filter(Boolean)), appCheckSiteKey: String(env.USC_APP_CHECK_SITE_KEY || "") };
}
function readServerSettings(env = process.env) {
  const settings = readPublicSettings(env);
  if (["FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST", "FUNCTIONS_EMULATOR"].some(key => env[key])) invalid("The hosted API must not use emulator settings.");
  const account = json(env.USC_FIREBASE_SERVICE_ACCOUNT_JSON, "Firebase service account");
  if (account.type !== "service_account" || account.project_id !== settings.projectId || typeof account.client_email !== "string" || !account.client_email.endsWith(".iam.gserviceaccount.com") || typeof account.private_key !== "string" || !account.private_key.includes("BEGIN PRIVATE KEY")) invalid("Use a service account belonging to the configured Firebase project.");
  const enforceAppCheck = env.USC_ENFORCE_APP_CHECK === "true";
  if (enforceAppCheck && (!settings.appCheckSiteKey || settings.appCheckSiteKey.includes("YOUR_"))) invalid("App Check enforcement requires a configured frontend site key.");
  return { ...settings, account: { ...account, private_key: account.private_key.replace(/\\n/g, "\n") }, enforceAppCheck };
}
function readGmailSettings(env = process.env) {
  const user = String(env.USC_GMAIL_USER || "").trim().toLowerCase();
  const pass = String(env.USC_GMAIL_APP_PASSWORD || "").replace(/\s/g, "");
  if (!/^[a-z0-9.]+@gmail\.com$/.test(user) || !/^[a-z0-9]{16}$/i.test(pass)) invalid("Configure a dedicated Gmail address and its Google app password.");
  return { user, pass };
}
module.exports = { ServiceError, readPublicSettings, readServerSettings, readGmailSettings };
