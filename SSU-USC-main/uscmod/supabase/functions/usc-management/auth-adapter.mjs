// Firebase Auth's create and update APIs accept different fields. Keep the
// passwordless creation step separate from trusted role assignment.
export function createStudentAuthAdapter({
  googleJson,
  projectUrl,
  hash,
  now = Date.now,
}) {
  return {
    async ensurePendingAccount(studentId) {
      const uid = "import_" + (await hash(studentId)).slice(0, 48),
        email = `${studentId}@student.ssu-usc.local`;
      const result = await googleJson(projectUrl() + "/accounts:lookup", {
        method: "POST",
        body: JSON.stringify({ localId: [uid] }),
      });
      const user = result?.users?.[0];
      if (user) {
        let claims = {};
        try {
          claims = JSON.parse(user.customAttributes || "{}");
        } catch {
          throw Error("Existing Auth identity requires administrator review.");
        }
        if (
          user.email !== email ||
          !user.disabled ||
          (claims.role && claims.role !== "student")
        )
          throw Error("Existing Auth identity requires administrator review.");
      } else {
        // Deterministic UID makes a provider success + database failure retry safe.
        await googleJson(projectUrl() + "/accounts", {
          method: "POST",
          body: JSON.stringify({ localId: uid, email, disabled: true }),
        });
      }
      await googleJson(projectUrl() + "/accounts:update", {
        method: "POST",
        body: JSON.stringify({
          localId: uid,
          customAttributes: JSON.stringify({ role: "student" }),
        }),
      });
      return uid;
    },
    async activateAuth(uid, password) {
      await googleJson(projectUrl() + "/accounts:update", {
        method: "POST",
        body: JSON.stringify({
          localId: uid,
          password,
          disableUser: false,
          validSince: String(Math.floor(now() / 1000)),
        }),
      });
    },
  };
}
