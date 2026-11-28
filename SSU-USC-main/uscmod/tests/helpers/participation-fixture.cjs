const { historyFixture } = require("./officer-history-fixture.cjs");
const {
  createEventParticipationHandlers,
} = require("../../server/event-participation.cjs");
function participationFixture() {
  const f = historyFixture();
  const originalDoc = f.db.doc;
  function ref(path) {
    const base = originalDoc(path);
    return { ...base, collection: (name) => query(path + "/" + name) };
  }
  function query(
    path,
    filters = [],
    take = Infinity,
    after = null,
    group = false,
    fields = null,
  ) {
    const q = {
      doc: (id = "audit-" + String(f.records.size)) => ref(path + "/" + id),
      where: (key, op, value) =>
        query(
          path,
          [...filters, { key, op, value }],
          take,
          after,
          group,
          fields,
        ),
      orderBy: () => q,
      limit: (n) => query(path, filters, n, after, group, fields),
      startAfter: (value) =>
        query(path, filters, take, value?.path || value, group, fields),
      select: (...names) => query(path, filters, take, after, group, names),
      get: async () => {
        const paths = [...f.records.keys()]
          .filter((key) =>
            group
              ? key.split("/").at(-2) === path
              : key.startsWith(path + "/") &&
                key.split("/").length === path.split("/").length + 1,
          )
          .sort();
        const docs = paths
          .filter(
            (key) =>
              (!after || (group ? key : key.split("/").at(-1)) > after) &&
              filters.every(({ key: field, op, value }) =>
                op === ">="
                  ? f.records.get(key)[field] >= value
                  : f.records.get(key)[field] === value,
              ),
          )
          .slice(0, take)
          .map((key) => ({
            id: key.split("/").at(-1),
            ref: ref(key),
            exists: true,
            data: () => {
              const data = structuredClone(f.records.get(key));
              return fields
                ? Object.fromEntries(
                    fields
                      .filter((field) => data[field] !== undefined)
                      .map((field) => [field, data[field]]),
                  )
                : data;
            },
          }));
        return { docs, size: docs.length, empty: !docs.length };
      },
      count: () => ({ get: async () => ({ data: () => ({ count: 0 }) }) }),
    };
    q.count = () => ({
      get: async () => {
        const page = await q.get();
        return { data: () => ({ count: page.size }) };
      },
    });
    return q;
  }
  f.db.doc = ref;
  f.db.collection = (path) => query(path);
  f.db.collectionGroup = (name) => query(name, [], Infinity, null, true);
  f.records.set("users/operator", {
    role: "officer",
    fullName: "Attendance Officer",
    accountStatus: "approved",
    isActive: true,
    studentStanding: "active",
    officerPermissionSource: "custom",
    officerPermissions: ["events.manage", "programs.manage"],
  });
  for (const uid of ["first", "second", "other"])
    Object.assign(f.records.get("users/" + uid), {
      schoolProvisioned: true,
      college: "College of Arts and Sciences",
      program: "Bachelor of Science in Information Technology",
      yearLevel: "4th Year",
      section: "4A",
    });
  const schedule = {
    participationVersion: 1,
    registrationMode: "internal",
    registrationOpensAtMs: f.now - 1000,
    registrationClosesAtMs: f.now + 5000,
    timeInOpensAtMs: f.now - 1000,
    timeInClosesAtMs: f.now + 10000,
    timeOutOpensAtMs: f.now - 1000,
    timeOutClosesAtMs: f.now + 20000,
    targetParticipants: {
      college: [],
      program: [],
      yearLevel: [],
      section: [],
    },
  };
  f.records.set("events/assembly", {
    title: "Synthetic General Assembly",
    eventDate: new Date(f.now).toISOString().slice(0, 10),
    status: "Published",
    ...schedule,
  });
  f.records.set("programs/service", {
    title: "Synthetic Service Program",
    status: "Published",
    ...schedule,
  });
  const h = createEventParticipationHandlers({
    db: f.db,
    ...f.authorization,
    history: f.history,
    clock: () => f.now,
  });
  const originalRequest = f.req;
  const req = (uid, data = {}) =>
    originalRequest(uid, { eventId: "assembly", source: "events", ...data });
  return Object.assign(f, {
    h,
    req,
    schedule,
    register: (uid) => h.participationRegister(req(uid)),
    lookup: (payload, mode = "in", uid = "operator") =>
      h.participationLookup(req(uid, { qr: payload, mode })),
    confirm: (ticket, uid = "operator") =>
      h.participationConfirm(
        req(uid, {
          confirmation: ticket.confirmation,
          identityConfirmed: true,
        }),
      ),
  });
}
module.exports = { participationFixture };
