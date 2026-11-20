import { PUBLIC_MANAGEMENT_ACTIONS } from "./service.mjs";
const MAX_BODY_BYTES = 7_400_000;
async function readJson(req) {
  if (
    !req.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    throw Error("Send application/json.");
  const reader = req.body?.getReader();
  if (!reader) throw Error("Request body required.");
  const chunks = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > MAX_BODY_BYTES) {
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
  let body;
  try {
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw Error("Invalid JSON request.");
  }
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    typeof body.action !== "string" ||
    body.action.length > 64
  )
    throw Error("A management action is required.");
  return body;
}
/** Build the real request handler separately from the Deno listener for HTTP tests. */
export function createManagementHandler({
  service,
  verifyToken,
  getProfile,
  parseFile,
  configuration,
  networkHash,
  probe,
}) {
  return async (req) => {
    let config;
    try {
      config = configuration();
    } catch {
      return Response.json(
        {
          ok: false,
          message: "The survey service is not configured. Contact USC.",
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    const origin = req.headers.get("origin");
    const cors = {
      "Access-Control-Allow-Origin": config.portalOrigin,
      "Access-Control-Allow-Headers":
        "content-type, x-firebase-token, authorization, apikey, x-client-info",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      Vary: "Origin",
      "Cache-Control": "no-store",
    };
    const json = (data, status = 200) =>
      Response.json(data, { status, headers: cors });
    if (origin && origin !== config.portalOrigin)
      return json(
        {
          ok: false,
          message: "This site is not authorized to use the survey service.",
        },
        403,
      );
    if (req.method === "OPTIONS")
      return new Response(null, { status: 204, headers: cors });
    if (req.method === "GET" && new URL(req.url).pathname.endsWith("/health")) {
      try {
        await probe();
        return json({
          ok: true,
          service: "usc-management",
          configured: true,
          storage: "reachable",
        });
      } catch {
        return json(
          {
            ok: false,
            service: "usc-management",
            configured: true,
            storage: "unavailable",
            message: "The staging database connection could not be verified.",
          },
          503,
        );
      }
    }
    if (req.method !== "POST")
      return json({ ok: false, message: "POST required." }, 405);
    try {
      const body = await readJson(req);
      let actor = null;
      if (!PUBLIC_MANAGEMENT_ACTIONS.includes(body.action)) {
        try {
          actor = await verifyToken(req.headers.get("x-firebase-token") || "");
        } catch {
          return json(
            { ok: false, message: "Sign in again to use this feature." },
            401,
          );
        }
      }
      if (body.action === "import_preview" && body.file) {
        const profile = await getProfile(actor.uid);
        if (
          actor.role !== "admin" ||
          profile?.role !== "admin" ||
          profile.accountStatus !== "approved" ||
          profile.isActive === false ||
          profile.accountRemoved ||
          profile.accountRemovalPending
        )
          return json(
            { ok: false, message: "Administrator access required." },
            403,
          );
        body.table = await parseFile(body.file);
        delete body.file;
      }
      let network = "";
      if (body.action === "survey_submit" || body.action === "activate") {
        // Supabase must overwrite this ingress header; never accept an address in JSON.
        const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
        if (!ip)
          return json(
            {
              ok: false,
              message: "Submission protection is unavailable. Contact USC.",
            },
            503,
          );
        network = await networkHash(ip, config.rateSecret);
      }
      return json({
        ok: true,
        ...(await service(body.action, body, actor, network)),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (
        message.startsWith("Google API") ||
        message.includes("private key") ||
        message.includes("Edge Function secret")
      )
        return json(
          {
            ok: false,
            message:
              "The storage operation failed or the record changed. Refresh and retry.",
          },
          503,
        );
      return json(
        { ok: false, message: message || "Unable to complete this operation." },
        400,
      );
    }
  };
}
