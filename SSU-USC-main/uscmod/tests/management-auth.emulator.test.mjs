import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createStudentAuthAdapter } from "../supabase/functions/usc-management/auth-adapter.mjs";
import { fixture } from "./helpers/management-fixture.mjs";
import { IMPORT_HEADERS } from "../shared/student-import-model.mjs";
const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (host && !/^(127\.0\.0\.1|localhost):[0-9]+$/.test(host))
  throw Error("This test only accepts a local Firebase Auth emulator.");
test(
  "real Firebase Auth emulator: passwordless disabled import, trusted Student claim, single-use activation and sign-in",
  { skip: !host },
  async () => {
    const project = "demo-ssu-management",
      base = "http://" + host;
    await fetch(base + "/emulator/v1/projects/" + project + "/accounts", {
      method: "DELETE",
    });
    const googleJson = async (url, init) => {
      const response = await fetch(url, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer owner",
        },
      });
      const data = await response.json();
      if (!response.ok)
        throw Error("Auth emulator request failed: " + data.error?.message);
      return data;
    };
    const adapter = createStudentAuthAdapter({
      googleJson,
      projectUrl: () =>
        base + "/identitytoolkit.googleapis.com/v1/projects/" + project,
      hash: async (v) => createHash("sha256").update(v).digest("hex"),
    });
    const f = fixture();
    Object.assign(f.io, adapter);
    const admin = { uid: "admin", role: "admin" },
      studentId = "008861",
      password = "local-test-password-2026";
    const plan = await f.handle(
      "import_preview",
      {
        table: [
          IMPORT_HEADERS,
          [
            studentId,
            "Emulator Test Student",
            "College of Engineering",
            "Bachelor of Science in Computer Engineering",
            "2",
            "",
            "2026–2027",
            "Active",
          ],
        ],
      },
      admin,
    );
    await f.handle("import_apply", { id: plan.id, confirm: true }, admin);
    const uid = (await f.io.get("student_id_claims/" + studentId)).data.uid;
    const lookup = await googleJson(
      base +
        "/identitytoolkit.googleapis.com/v1/projects/" +
        project +
        "/accounts:lookup",
      { method: "POST", body: JSON.stringify({ localId: [uid] }) },
    );
    assert.equal(lookup.users[0].disabled, true);
    assert.equal(JSON.parse(lookup.users[0].customAttributes).role, "student");
    assert.equal(lookup.users[0].passwordHash, undefined);
    // Retrying the provider step keeps the same pending UID and role.
    assert.equal(await adapter.ensurePendingAccount(studentId), uid);
    const signIn = () =>
      fetch(
        base +
          "/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: studentId + "@student.ssu-usc.local",
            password,
            returnSecureToken: true,
          }),
        },
      );
    assert.equal((await signIn()).ok, false);
    const activation = await f.handle(
        "activation_issue",
        { studentId, identityChecked: true },
        admin,
      ),
      token = new URLSearchParams(new URL(activation.url).hash.slice(1)).get(
        "token",
      );
    await f.handle("activate", { token, password }, null, "emulator-network");
    const response = await signIn();
    assert.equal(response.ok, true);
    const session = await response.json();
    const claims = JSON.parse(
      Buffer.from(session.idToken.split(".")[1], "base64url").toString(),
    );
    assert.equal(claims.role, "student");
    assert.equal(claims.user_id, uid);
    assert.equal(
      (await f.io.get("users/" + uid)).data.accountStatus,
      "approved",
    );
    await assert.rejects(
      f.handle("activate", { token, password }, null, "emulator-network"),
      /already used/,
    );
    await assert.rejects(
      adapter.ensurePendingAccount(studentId),
      /administrator review/,
    );
  },
);
