import { createManagementHandler } from "./http.mjs";
import {
  managementEnvironment,
  validateManagementConfig,
  assertVerifiedTokenProject,
} from "./config.mjs";
import { createStudentAuthAdapter } from "./auth-adapter.mjs";
import { createManagementService } from "./service.mjs";
import { parseFile } from "./workbook.ts";
import {
  env,
  verifyFirebaseIdToken,
  firestoreVersionedGet,
  firestoreWorkflowQuery,
  firestoreWorkflowCommit,
  googleJson,
  sha256,
  randomToken,
  sendEmail,
  escapeHtml,
} from "../_shared/usc-email-common.ts";

const projectUrl = () =>
  `https://identitytoolkit.googleapis.com/v1/projects/${env().firebaseProjectId}`;
const service = createManagementService({
  get: firestoreVersionedGet,
  list: (collection: string, parent: string, limit: number) =>
    firestoreWorkflowQuery(collection, parent, "", limit),
  commit: firestoreWorkflowCommit,
  hash: sha256,
  random: () => randomToken().slice(0, 32),
  get portalUrl() {
    return env().portalUrl;
  },
  ...createStudentAuthAdapter({ googleJson, projectUrl, hash: sha256 }),
  async sendActivation(email: string, url: string) {
    await sendEmail(
      email,
      "Activate your SSU-USC student account",
      `<p>Your verified-source student record has been imported by SSU-USC.</p><p><a href="${escapeHtml(url)}">Set your password and activate your account</a></p><p>This private link expires in 24 hours and can be used once. Do not forward it. Contact USC if you did not expect this message.</p>`,
      `Activate your SSU-USC account: ${url}\nThis private link expires in 24 hours. Do not forward it.`,
    );
  },
});

let healthVerifiedUntil = 0;
const handler = createManagementHandler({
  service,
  async probe() {
    if (Date.now() < healthVerifiedUntil) return;
    const database = await googleJson(
      `https://firestore.googleapis.com/v1/projects/${env().firebaseProjectId}/databases/(default)`,
    );
    if (!database?.name) throw Error("Staging database is not available.");
    healthVerifiedUntil = Date.now() + 30000;
  },
  async verifyToken(token: string) {
    const actor = await verifyFirebaseIdToken(token);
    assertVerifiedTokenProject(token, env().firebaseProjectId);
    return actor;
  },
  getProfile: async (uid: string) =>
    (await firestoreVersionedGet(`users/${uid}`))?.data || null,
  parseFile,
  configuration: () =>
    validateManagementConfig(
      managementEnvironment((name: string) => Deno.env.get(name)),
    ),
  async networkHash(ip: string, secret: string) {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const digest = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(ip),
    );
    return Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
  },
});
Deno.serve(handler);
