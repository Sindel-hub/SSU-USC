import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, serverTimestamp, setDoc } from "firebase/firestore";

let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "usc-event-participation-rules-test",
    firestore: { rules: fs.readFileSync(new URL("../firestore.rules", import.meta.url), "utf8") }
  });
});

after(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

async function seed(path, data) {
  await env.withSecurityRulesDisabled(async (context) => setDoc(doc(context.firestore(), path), data));
}

async function seedStudent(uid = "u1", studentId = "123456") {
  await seed(`users/${uid}`, {
    uid,
    studentId,
    email: `${uid}@ssu.edu.ph`,
    role: "student",
    accountStatus: "approved",
    isActive: true,
    schoolProvisioned: true,
    isVerifiedStudent: true,
    studentStanding: "active",
    fullName: `Student ${uid}`,
    college: "College of Computing",
    program: "BS Information Technology",
    yearLevel: "4th Year"
  });
}

function registrationData(uid = "u1", studentId = "123456", eventId = "e1") {
  return {
    eventId,
    studentUid: uid,
    studentId,
    fullName: `Student ${uid}`,
    schoolEmail: `${uid}@ssu.edu.ph`,
    college: "College of Computing",
    program: "BS Information Technology",
    yearLevel: "4th Year",
    status: "registered",
    registeredAt: serverTimestamp()
  };
}

test("student can self-register only for an internal event before its deadline", async () => {
  await seedStudent();
  await seed("events/e1", {
    status: "Published",
    registrationMode: "internal",
    registrationDeadline: new Date(Date.now() + 60 * 60 * 1000)
  });

  const db = env.authenticatedContext("u1", { role: "student" }).firestore();
  await assertSucceeds(setDoc(doc(db, "events/e1/registrations/u1"), registrationData()));
});

test("student cannot create somebody else's registration or use a mismatched Student ID", async () => {
  await seedStudent();
  await seed("events/e1", {
    status: "Published",
    registrationMode: "internal",
    registrationDeadline: new Date(Date.now() + 60 * 60 * 1000)
  });

  const db = env.authenticatedContext("u1", { role: "student" }).firestore();
  await assertFails(setDoc(doc(db, "events/e1/registrations/u2"), registrationData("u1", "123456")));
  await assertFails(setDoc(doc(db, "events/e1/registrations/u1"), registrationData("u1", "999999")));
});

test("internal registration closes at the officer-defined deadline", async () => {
  await seedStudent();
  await seed("events/e1", {
    status: "Published",
    registrationMode: "internal",
    registrationDeadline: new Date(Date.now() - 60 * 1000)
  });

  const db = env.authenticatedContext("u1", { role: "student" }).firestore();
  await assertFails(setDoc(doc(db, "events/e1/registrations/u1"), registrationData()));
});

test("external registration cannot be forged as a website registration", async () => {
  await seedStudent();
  await seed("events/e1", {
    status: "Published",
    registrationMode: "external",
    registrationDeadline: new Date(Date.now() + 60 * 60 * 1000),
    externalRegistrationUrl: "https://example.com/form"
  });

  const db = env.authenticatedContext("u1", { role: "student" }).firestore();
  await assertFails(setDoc(doc(db, "events/e1/registrations/u1"), registrationData()));
});

test("student can cancel their own website registration before the deadline", async () => {
  await seedStudent();
  await seed("events/e1", {
    status: "Published",
    registrationMode: "internal",
    registrationDeadline: new Date(Date.now() + 60 * 60 * 1000)
  });
  await seed("events/e1/registrations/u1", {
    ...registrationData(),
    registeredAt: new Date(Date.now() - 1000)
  });

  const db = env.authenticatedContext("u1", { role: "student" }).firestore();
  await assertSucceeds(deleteDoc(doc(db, "events/e1/registrations/u1")));
});
