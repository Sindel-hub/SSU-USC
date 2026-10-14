import {
  activeEmailProfile,
  adminClient,
  env,
  errorText,
  escapeHtml,
  firestoreCollection,
  firestoreGet,
  logDelivery,
  ms,
  sendEmail,
} from "../_shared/usc-email-common.ts";

const supabase = adminClient();

function unique<T>(items: T[]): T[] { return [...new Set(items)]; }

function roleName(profile: Record<string, any> | null): "student" | "officer" {
  return String(profile?.role || "").toLowerCase() === "officer" ? "officer" : "student";
}

function studentComplaintUpdates(uid: string, complaints: any[], since: number, now: number): string[] {
  const lines: string[] = [];
  for (const complaint of complaints.filter((item) => String(item.studentUid || "") === uid)) {
    const changed = ms(complaint.updatedAt);
    if (changed <= since || changed > now || String(complaint.status || "") === "Submitted") continue;
    const feedback = Array.isArray(complaint.thread) && complaint.thread.some((item: any) => String(item?.by || "").toLowerCase() === "officer" && (item?.kind === "feedback" || item?.message));
    lines.push(feedback ? "An officer updated your complaint or provided feedback. Open Student Tracklist to read it." : "Your complaint status was updated. Open Student Tracklist to view its progress.");
  }
  return lines;
}

function officerComplaintUpdates(complaints: any[], since: number, now: number): string[] {
  const changed = complaints.filter((item) => {
    const timestamp = ms(item.updatedAt || item.createdAt || item.submittedAt);
    return timestamp > since && timestamp <= now;
  });
  if (!changed.length) return [];
  const newCases = changed.filter((item) => String(item.status || "").toLowerCase() === "submitted").length;
  if (newCases > 0) return [`${newCases} new complaint ${newCases === 1 ? "case is" : "cases are"} waiting in Officer Complaints Management.`];
  return ["Complaint activity was updated. Open Officer Complaints Management to review the latest cases."];
}

function updatesFor(args: { uid: string; role: "student" | "officer"; prefs: any; complaints: any[]; election: any; news: any[]; since: number; now: number }) {
  const { uid, role, prefs, complaints, election, news, since, now } = args;
  const lines: string[] = [];
  if (prefs.complaints) {
    lines.push(...(role === "officer" ? officerComplaintUpdates(complaints, since, now) : studentComplaintUpdates(uid, complaints, since, now)));
  }
  if (prefs.elections && election && !election.archived) {
    const opens = ms(election.votingStart), closes = ms(election.votingEnd);
    const available = election.candidateReviewComplete === true && !election.finalized && !election.resultsPublished && opens <= now && closes > now;
    if (available && prefs.election_open_key !== `${election._id}:${opens}`) lines.push(role === "officer" ? "The configured election voting period is now open. Open Election Management to monitor the election." : "Voting is now open. Visit Election in the portal to view candidates and vote.");
    if (election.resultsPublished === true && ms(election.resultPublicationStart) <= now && prefs.election_results_key !== election._id) lines.push(role === "officer" ? "Official election results are now published. Open Election Management to review them." : "Official election results are now available. Open Election in the portal.");
  }
  if (prefs.news && news.some((item) => {
    const time = ms(item.publishedAt || item.publishedAtMs || item.createdAt || item.createdAtMs);
    return time > since && time <= now;
  })) {
    lines.push(role === "officer" ? "New announcements, events, or external programs were published. Open the Officer Portal to review them." : "New announcements, events, or external programs are available. Check the Bulletin Board and Events / Programs in the portal.");
  }
  return unique(lines);
}

Deno.serve(async (req) => {
  try {
    const expected = String(Deno.env.get("EMAIL_WORKER_SECRET") || "");
    if (!expected || req.headers.get("x-worker-secret") !== expected) return new Response("Unauthorized", { status: 401 });

    const now = Date.now();
    const [{ data: accounts, error }, complaints, announcements, events, programs, pointer] = await Promise.all([
      supabase.from("student_email_accounts").select("*").not("verified_email", "is", null),
      firestoreCollection("complaints", 1000),
      firestoreCollection("announcements", 500),
      firestoreCollection("events", 500),
      firestoreCollection("programs", 500),
      firestoreGet("election_config/current"),
    ]);
    if (error) throw error;
    const election = pointer?.electionId ? await firestoreGet(`elections/${pointer.electionId}`) : null;
    const news = [...announcements, ...events, ...programs];
    let sent = 0;

    for (const account of accounts || []) {
      if (!account.requested_email || account.requested_email !== account.verified_email) continue;
      const profile = await firestoreGet(`users/${account.firebase_uid}`);
      if (!activeEmailProfile(profile)) continue;
      const role = roleName(profile);
      const since = account.last_scan_at ? new Date(account.last_scan_at).getTime() : now;
      const lines = updatesFor({ uid: account.firebase_uid, role, prefs: account, complaints, election, news, since, now });
      let deliverySucceeded = true;
      if (lines.length) {
        const portalPath = role === "officer" ? "/usc-admin/overview/overview.html" : "/dashboard/dashboard.html";
        const portal = `${env().portalUrl}${portalPath}`;
        const profileLabel = role === "officer" ? "Officer Profile" : "Student Profile";
        const portalLabel = role === "officer" ? "officer portal" : "student portal";
        const text = `${lines.map((line) => `• ${line}`).join("\n\n")}\n\nOpen your ${portalLabel}:\n${portal}\n\nManage email alerts in ${profileLabel}.`;
        const html = `<ul>${lines.map((line) => `<li style="margin:0 0 10px">${escapeHtml(line)}</li>`).join("")}</ul><p><a href="${escapeHtml(portal)}">Open your ${escapeHtml(portalLabel)}</a></p><p>Manage email alerts in ${escapeHtml(profileLabel)}.</p>`;
        try {
          const providerId = await sendEmail(account.verified_email, "SSU USC: updates for you", html, text);
          await logDelivery({ uid: account.firebase_uid, recipient: account.verified_email, kind: "portal_updates", sourceKey: new Date(now).toISOString().slice(0, 16), status: "sent", providerId });
          sent++;
        } catch (mailError) {
          deliverySucceeded = false;
          await logDelivery({ uid: account.firebase_uid, recipient: account.verified_email, kind: "portal_updates", status: "failed", error: errorText(mailError) });
        }
      }
      if (!deliverySucceeded) continue;
      const changes: Record<string, unknown> = { account_role: role, last_scan_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString() };
      if (account.elections && election) {
        const opens = ms(election.votingStart), closes = ms(election.votingEnd);
        if (election.candidateReviewComplete === true && !election.finalized && !election.resultsPublished && opens <= now && closes > now) changes.election_open_key = `${election._id}:${opens}`;
        if (election.resultsPublished === true && ms(election.resultPublicationStart) <= now) changes.election_results_key = election._id;
      }
      await supabase.from("student_email_accounts").update(changes).eq("firebase_uid", account.firebase_uid);
    }

    return new Response(JSON.stringify({ ok: true, accounts: (accounts || []).length, sent }), { headers: { "Content-Type": "application/json" } });
  } catch (error) {
    console.error("usc-email-worker error", error);
    return new Response(JSON.stringify({ ok: false, message: errorText(error, "Worker failed") }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
