import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
test(
  "Firestore emulator: actual capture transactions, snapshot membership, metadata pagination and default-denied private reports",
  { skip: !enabled },
  async () => {
    const { initializeApp, deleteApp } = require("firebase-admin/app"),
      { getFirestore, Timestamp } = require("firebase-admin/firestore"),
      { createAuthorization } = require("../server/authorization.cjs"),
      { createOfficerHistory } = require("../server/officer-history.cjs"),
      {
        createEligibilityHandlers,
        queueEligibility,
      } = require("../server/reporting-eligibility.cjs"),
      { createReportingHandlers } = require("../server/reporting.cjs"),
      {
        createEventParticipationHandlers,
      } = require("../server/event-participation.cjs");
    const project = "demo-ssu-reporting",
      app = initializeApp({ projectId: project }, "reporting-emulator"),
      db = getFirestore(app),
      clock = () => Date.now(),
      authorization = createAuthorization({ db, clock }),
      dependencies = { db, ...authorization, clock },
      history = createOfficerHistory(dependencies),
      capture = createEligibilityHandlers({ ...dependencies, history }),
      reporting = createReportingHandlers({ ...dependencies, history }),
      participation = createEventParticipationHandlers({
        ...dependencies,
        history,
      }),
      req = (uid, data, role = "officer") => ({
        auth: { uid, token: { role, email_verified: true } },
        data,
      });
    try {
      await db.doc("users/reporting-operator").set({
        role: "officer",
        fullName: "Synthetic operator",
        accountStatus: "approved",
        isActive: true,
        officerPermissionSource: "custom",
        officerPermissions: [
          "reports.generate",
          "events.manage",
          "complaints.view",
          "complaints.review",
          "complaints.report",
        ],
      });
      const batch = db.batch();
      for (let i = 0; i < 205; i++)
        batch.set(db.doc("users/student-" + String(i).padStart(3, "0")), {
          role: "student",
          schoolProvisioned: true,
          accountStatus: "approved",
          isActive: true,
          studentId: String(i).padStart(6, "0"),
          fullName: "Synthetic " + i,
          college: "CAS",
          program: "BSIT",
          yearLevel: "4th Year",
          section: "4A",
        });
      await batch.commit();
      const ref = db.doc("events/assembly"),
        now = clock(),
        event = {
          title: "Emulator assembly",
          venue: "Synthetic Hall",
          eventDate: new Date(now).toISOString().slice(0, 10),
          status: "Published",
          participationVersion: 1,
          registrationMode: "internal",
          registrationOpensAtMs: now - 10000,
          registrationClosesAtMs: now + 100000,
          timeInOpensAtMs: now - 10000,
          timeInClosesAtMs: now + 200000,
          timeOutOpensAtMs: now,
          timeOutClosesAtMs: now + 300000,
          targetParticipants: {},
        };
      await db.runTransaction(async (tx) => {
        const queued = queueEligibility(
          tx,
          db,
          ref,
          event,
          "reporting-operator",
          clock,
        );
        tx.set(ref, { ...event, ...queued });
      });
      const first = await capture.reportingCaptureEligibility(
        req("reporting-operator", { source: "events", eventId: "assembly" }),
      );
      assert.equal(first.state, "building");
      assert.equal(first.count, 100);
      const repeat = await capture.reportingCaptureEligibility(
        req("reporting-operator", { source: "events", eventId: "assembly" }),
      );
      assert.equal(repeat.count, 100);
      const second = await capture.reportingCaptureEligibility(
        req("reporting-operator", {
          source: "events",
          eventId: "assembly",
          after: first.next,
        }),
      );
      const final = await capture.reportingCaptureEligibility(
        req("reporting-operator", {
          source: "events",
          eventId: "assembly",
          after: second.next,
        }),
      );
      assert.equal(final.count, 205);
      assert.equal(final.state, "ready");
      await db.doc("users/student-000").update({ section: "NEW" });
      await participation.participationRegister(
        req(
          "student-000",
          { source: "events", eventId: "assembly" },
          "student",
        ),
      );
      const reg = (
        await ref.collection("registrations").doc("student-000").get()
      ).data();
      assert.equal(reg.academicSnapshot.section, "4A");
      let cursor = null;
      const unregistered = [];
      do {
        const page = await participation.participationRoster(
          req("reporting-operator", {
            source: "events",
            eventId: "assembly",
            unregistered: true,
            after: cursor,
          }),
        );
        unregistered.push(...page.rows);
        cursor = page.next;
      } while (cursor);
      assert.equal(unregistered.length, 204);
      assert.equal(new Set(unregistered.map((row) => row.uid)).size, 204);
      const population = await reporting.reportingPage(
        req("reporting-operator", {
          section: "attendance",
          source: "events",
          eventId: "assembly",
          phase: "population",
        }),
      );
      assert.equal(population.rows.length, 205);
      assert.equal(population.complete, true);
      const updates = await reporting.reportingPage(
        req("reporting-operator", {
          section: "attendance",
          source: "events",
          eventId: "assembly",
          phase: "registrations",
          since: now - 1000,
        }),
      );
      assert.equal(updates.rows.length, 1);
      await db.doc("complaints/case").set({
        complaintRef: "USC-REAL-QUERY",
        subject: "Synthetic",
        studentDepartment: "CAS",
        status: "Resolved",
        createdAt: Timestamp.fromMillis(now - 5000),
        updatedAt: Timestamp.fromMillis(now),
        resolvedAt: Timestamp.fromMillis(now),
        studentName: "PRIVATE",
        details: "PRIVATE",
      });
      const complaints = await reporting.reportingPage(
        req("reporting-operator", { section: "complaints", since: now - 1000 }),
      );
      assert.equal(complaints.rows[0].college, "CAS");
      assert.ok(!JSON.stringify(complaints).includes("PRIVATE"));
      await db.doc("officer_records/record").set({
        officerUid: "reporting-operator",
        module: "Events",
        action: "Published",
        createdAtMs: now,
      });
      await db.doc("events/assembly/attendance_audit/audit").set({
        officerUid: "reporting-operator",
        source: "events",
        eventId: "assembly",
        mode: "in",
        recordedAtMs: now,
      });
      for (const phase of ["officers", "attendance"]) {
        const rows = await reporting.reportingPage(
          req("reporting-operator", {
            section: "activities",
            phase,
            since: now - 1000,
          }),
        );
        assert.equal(rows.rows.length, 1);
      }
      const { initializeTestEnvironment, assertFails } =
          await import("@firebase/rules-unit-testing"),
        { doc, getDoc, setDoc } = await import("firebase/firestore"),
        { readFile } = await import("node:fs/promises");
      const env = await initializeTestEnvironment({
        projectId: project,
        firestore: {
          rules: await readFile(
            new URL("../firestore.rules", import.meta.url),
            "utf8",
          ),
        },
      });
      try {
        for (const context of [
          env.unauthenticatedContext(),
          env.authenticatedContext("student-000", { role: "student" }),
          env.authenticatedContext("reporting-operator", { role: "officer" }),
        ])
          for (const path of [
            "reporting_eligibility/private",
            "reporting_audit/private",
          ]) {
            await assertFails(getDoc(doc(context.firestore(), path)));
            await assertFails(
              setDoc(doc(context.firestore(), path), { public: true }),
            );
          }
      } finally {
        await env.cleanup();
      }
    } finally {
      await db.recursiveDelete(db.collection("users"));
      await db.recursiveDelete(db.collection("events"));
      await db.recursiveDelete(db.collection("reporting_eligibility"));
      await db.recursiveDelete(db.collection("complaints"));
      await db.recursiveDelete(db.collection("officer_records"));
      await deleteApp(app);
    }
  },
);
