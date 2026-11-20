import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHmac } from "node:crypto";
import { createManagementHandler } from "../supabase/functions/usc-management/http.mjs";
import {
  validateManagementConfig,
  assertVerifiedTokenProject,
} from "../supabase/functions/usc-management/config.mjs";
import { fixture } from "./helpers/management-fixture.mjs";
const portal = "https://ssu-preview.example";
const values = () => ({
  SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
  FIREBASE_PROJECT_ID: "ssu-backend-staging",
  FIREBASE_WEB_API_KEY: "staging-test-key",
  FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
    project_id: "ssu-backend-staging",
    client_email: "service@ssu-backend-staging.iam.gserviceaccount.com",
    private_key:
      "-----BEGIN PRIVATE KEY-----\nTEST ONLY\n-----END PRIVATE KEY-----",
  }),
  PORTAL_URL: portal,
  MANAGEMENT_RATE_LIMIT_SECRET: "test-only-rate-secret-32-characters",
});
function backend(overrides = {}) {
  const f = fixture();
  f.setTime(Date.now());
  let parsed = 0,
    probed = 0;
  const handler = createManagementHandler({
    service: f.handle,
    verifyToken: async (token) => {
      if (!["admin-token", "officer-token", "student-token"].includes(token))
        throw Error("Invalid token");
      return { uid: token.split("-")[0], role: token.split("-")[0] };
    },
    getProfile: async (uid) => (await f.io.get("users/" + uid))?.data || null,
    parseFile: async (file) => {
      parsed++;
      return file.table;
    },
    configuration: () => validateManagementConfig(values()),
    networkHash: async (ip, secret) =>
      createHmac("sha256", secret).update(ip).digest("hex"),
    probe: async () => {
      probed++;
    },
    ...overrides,
  });
  return { f, handler, counts: () => ({ parsed, probed }) };
}
const request = (action, payload = {}, token = "", extra = {}) =>
  new Request("https://backend.example/functions/v1/usc-management", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: portal,
      ...(token ? { "x-firebase-token": token } : {}),
      ...extra,
    },
    body: JSON.stringify({ action, ...payload }),
  });
test("staging config rejects missing, production and mismatched project credentials", () => {
  assert.throws(() => validateManagementConfig({}), /Missing backend/);
  assert.equal(
    validateManagementConfig(values()).projectId,
    "ssu-backend-staging",
  );
  assert.throws(
    () =>
      validateManagementConfig({
        ...values(),
        FIREBASE_PROJECT_ID: "universitystudentcouncil-856cc",
      }),
    /production/,
  );
  assert.throws(
    () =>
      validateManagementConfig({
        ...values(),
        SUPABASE_URL: "https://svgfxatigtjdrwzibjbu.supabase.co",
      }),
    /production/,
  );
  assert.throws(
    () =>
      validateManagementConfig({
        ...values(),
        FIREBASE_SERVICE_ACCOUNT_JSON:
          values().FIREBASE_SERVICE_ACCOUNT_JSON.replaceAll(
            "ssu-backend-staging",
            "different-project",
          ),
      }),
    /service account/,
  );
  assert.throws(
    () =>
      validateManagementConfig({
        ...values(),
        MANAGEMENT_RATE_LIMIT_SECRET: "short",
      }),
    /32 characters/,
  );
});
test("health checks actual storage probe and never returns credential details", async () => {
  const app = backend();
  const response = await app.handler(
    new Request("https://backend.example/functions/v1/usc-management/health"),
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).storage, "reachable");
  assert.equal(app.counts().probed, 1);
  const broken = backend({
    probe: async () => {
      throw Error("private secret diagnostic");
    },
  });
  const failed = await broken.handler(
    new Request("https://backend.example/health"),
  );
  assert.equal(failed.status, 503);
  assert.ok(!(await failed.text()).includes("private secret"));
  const missing = backend({
    configuration: () => {
      throw Error("Missing private details");
    },
  });
  const unavailable = await missing.handler(request("surveys_available"));
  assert.equal(unavailable.status, 503);
  assert.ok(!(await unavailable.text()).includes("private details"));
});
test("CORS permits only the configured portal and rejects untrusted origins before writes", async () => {
  const app = backend();
  const options = await app.handler(
    new Request("https://backend.example", {
      method: "OPTIONS",
      headers: { Origin: portal },
    }),
  );
  assert.equal(options.status, 204);
  assert.equal(options.headers.get("access-control-allow-origin"), portal);
  const denied = await app.handler(
    request("survey_save", {}, "admin-token", {
      Origin: "https://evil.example",
    }),
  );
  assert.equal(denied.status, 403);
  assert.equal((await app.f.io.list("needs_surveys")).length, 0);
});
test("HTTP validation rejects malformed JSON, non-JSON content, missing actions and unsupported methods", async () => {
  const app = backend();
  assert.equal(
    (await app.handler(new Request("https://backend.example"))).status,
    405,
  );
  for (const body of ["{", "null", "[]", "{}"])
    assert.equal(
      (
        await app.handler(
          new Request("https://backend.example", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
          }),
        )
      ).status,
      400,
    );
  assert.equal(
    (
      await app.handler(
        new Request("https://backend.example", {
          method: "POST",
          body: "action=x",
        }),
      )
    ).status,
    400,
  );
});
test("private actions reject unsigned requests and unauthorized importers before parsing uploaded files", async () => {
  const app = backend();
  assert.equal((await app.handler(request("students_list"))).status, 401);
  assert.equal(
    (
      await app.handler(
        request("import_preview", { file: { table: [] } }, "officer-token"),
      )
    ).status,
    403,
  );
  assert.equal(app.counts().parsed, 0);
  app.f.seed("users/admin", {
    role: "admin",
    accountStatus: "approved",
    isActive: true,
    accountRemoved: true,
  });
  assert.equal(
    (
      await app.handler(
        request("import_preview", { file: { table: [] } }, "admin-token"),
      )
    ).status,
    403,
  );
  assert.equal(app.counts().parsed, 0);
});
test("real HTTP server connects officer publication to anonymous submission and private analytics", async () => {
  const app = backend();
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const response = await app.handler(
      new Request("http://localhost" + req.url, {
        method: req.method,
        headers: req.headers,
        ...(!["GET", "HEAD"].includes(req.method)
          ? { body: Buffer.concat(chunks) }
          : {}),
      }),
    );
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const endpoint =
      "http://127.0.0.1:" +
      server.address().port +
      "/functions/v1/usc-management";
    const post = async (action, payload = {}, token = "") => {
      const req = request(action, payload, token, {
        "x-forwarded-for": "192.0.2.5",
      });
      return fetch(endpoint, {
        method: "POST",
        headers: req.headers,
        body: await req.text(),
      });
    };
    const definition = {
      title: "HTTP integration survey",
      description: "",
      instructions: "",
      department: "all",
      startsAt: Date.now() - 1000,
      endsAt: Date.now() + 60000,
      questions: [
        {
          label: "Priority",
          type: "choice",
          required: true,
          options: ["Library", "Transport"],
        },
      ],
    };
    let response = await post(
      "survey_save",
      { survey: definition },
      "officer-token",
    );
    assert.equal(response.status, 200);
    const { id } = await response.json();
    assert.equal(
      (await post("survey_state", { id, state: "published" }, "officer-token"))
        .status,
      200,
    );
    response = await post("surveys_available");
    assert.equal(response.status, 200);
    assert.equal((await response.json()).surveys[0].id, id);
    const submission = {
      id,
      department: "College of Engineering",
      answers: { q1: "Library" },
      submissionKey: "a".repeat(32),
    };
    assert.equal((await post("survey_submit", submission)).status, 200);
    assert.equal((await post("survey_submit", submission)).status, 200);
    assert.equal(
      (await app.f.io.get("needs_surveys/" + id)).data.responseCount,
      1,
    );
    assert.equal((await post("survey_analytics", { id })).status, 401);
    response = await post("survey_analytics", { id }, "officer-token");
    assert.equal((await response.json()).analytics.total, 1);
    await post("survey_state", { id, state: "closed" }, "officer-token");
    assert.equal(
      (
        await post("survey_submit", {
          ...submission,
          submissionKey: "b".repeat(32),
        })
      ).status,
      400,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
test("public writes require a trusted ingress address and provider failures are sanitized", async () => {
  const app = backend();
  assert.equal((await app.handler(request("survey_submit", {}))).status, 503);
  const failing = backend({
    service: async () => {
      throw Error("Google API request failed: sensitive provider details");
    },
  });
  const response = await failing.handler(request("surveys_available"));
  assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes("sensitive provider"));
});

test("verified Firebase tokens must still belong to the isolated staging project", () => {
  const project = "ssu-backend-staging";
  const token = (claims) =>
    "header." +
    Buffer.from(JSON.stringify(claims)).toString("base64url") +
    ".signature";
  assert.doesNotThrow(() =>
    assertVerifiedTokenProject(
      token({ aud: project, iss: "https://securetoken.google.com/" + project }),
      project,
    ),
  );
  assert.throws(
    () =>
      assertVerifiedTokenProject(
        token({
          aud: "production",
          iss: "https://securetoken.google.com/production",
        }),
        project,
      ),
    /staging/,
  );
  assert.throws(
    () =>
      assertVerifiedTokenProject(
        token({ aud: project, iss: "https://attacker.example" }),
        project,
      ),
    /staging/,
  );
});
