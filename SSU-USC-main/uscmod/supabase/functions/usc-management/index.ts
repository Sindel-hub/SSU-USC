import { createStudentAuthAdapter } from "./auth-adapter.mjs";
import {
  createManagementService,
  PUBLIC_MANAGEMENT_ACTIONS,
} from "./service.mjs";
import { parseFile } from "./workbook.ts";
import {
  CORS_HEADERS,
  env,
  jsonResponse,
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST")
    return jsonResponse({ ok: false, message: "POST required." }, 405);
  try {
    // Read with a hard byte limit, including clients without Content-Length.
    const reader = req.body?.getReader();
    if (!reader) throw Error("Request body required.");
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 7400000) {
        await reader.cancel();
        throw Error("Request is too large.");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const body = JSON.parse(new TextDecoder().decode(bytes));
    const publicAction = PUBLIC_MANAGEMENT_ACTIONS.includes(body.action);
    const actor = publicAction
      ? null
      : await verifyFirebaseIdToken(req.headers.get("x-firebase-token") || "");
    if (body.action === "import_preview" && body.file) {
      const profile = actor
        ? await firestoreVersionedGet(`users/${actor.uid}`)
        : null;
      if (
        actor?.role !== "admin" ||
        profile?.data.role !== "admin" ||
        profile?.data.accountStatus !== "approved" ||
        profile?.data.isActive === false
      )
        throw Error("Administrator access required.");
      body.table = await parseFile(body.file);
      delete body.file;
    }
    // Use only Supabase's ingress-provided address; never a body-supplied address.
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "";
    let network = "";
    if (body.action === "survey_submit" || body.action === "activate") {
      const secret = Deno.env.get("MANAGEMENT_RATE_LIMIT_SECRET") || "";
      if (secret.length < 32 || !ip)
        throw Error("Submission protection is not configured. Contact USC.");
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
      network = Array.from(new Uint8Array(digest), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");
    }
    const result = await service(body.action, body, actor, network);
    return jsonResponse({ ok: true, ...result });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to complete this operation.";
    // Provider diagnostics can contain request data. Return a generic message instead.
    return jsonResponse(
      {
        ok: false,
        message: message.startsWith("Google API")
          ? "The record changed or the storage operation failed. Refresh and retry; contact the administrator if it persists."
          : message,
      },
      400,
    );
  }
});
