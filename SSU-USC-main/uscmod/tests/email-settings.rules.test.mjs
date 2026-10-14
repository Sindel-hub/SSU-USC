import test, { before, after } from "node:test";
import fs from "node:fs";
import { initializeTestEnvironment, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: "usc-supabase-email-rules-test",
    firestore: { rules: fs.readFileSync(new URL("../firestore.rules", import.meta.url), "utf8") },
  });
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "users", "u1"), {
      role: "student", schoolProvisioned: true, isActive: true, accountStatus: "approved", studentStanding: "active",
    });
  });
});
after(async () => { await env?.cleanup(); });

test("legacy Firestore email collections are closed after Supabase migration", async () => {
  const db = env.authenticatedContext("u1").firestore();
  await assertFails(setDoc(doc(db, "email_requests", "u1"), { requestedEmail: "student@gmail.com" }));
  await assertFails(getDoc(doc(db, "email_requests", "u1")));
  await assertFails(setDoc(doc(db, "email_accounts", "u1"), { verifiedEmail: "student@gmail.com" }));
  await assertFails(getDoc(doc(db, "email_accounts", "u1")));
});
