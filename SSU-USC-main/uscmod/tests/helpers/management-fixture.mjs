import { createHash } from "node:crypto";
import { createManagementService } from "../../supabase/functions/usc-management/service.mjs";
export function fixture() {
  let serial = 0,
    clock = 2000,
    fail = false;
  const store = new Map(),
    auth = new Map();
  const seed = (path, data) =>
    store.set(path, { data: structuredClone(data), version: String(++serial) });
  seed("users/admin", {
    role: "admin",
    isActive: true,
    accountStatus: "approved",
  });
  seed("users/officer", {
    role: "officer",
    isActive: true,
    accountStatus: "approved",
    officerPermissions: ["dashboard.view", "needs.manage", "bulletin.manage"],
    officerPermissionSource: "custom",
  });
  const io = {
    now: () => clock,
    random: () => (++serial).toString(16).padStart(32, "0"),
    hash: async (s) => createHash("sha256").update(s).digest("hex"),
    portalUrl: "https://staging.example",
    get: async (path) => structuredClone(store.get(path) || null),
    list: async (collection, parent = "", limit = 10000) =>
      [...store]
        .filter(
          ([p]) =>
            p.startsWith((parent ? parent + "/" : "") + collection + "/") &&
            p.split("/").length === (parent ? parent.split("/").length : 0) + 2,
        )
        .slice(0, limit)
        .map(([p, v]) => ({ id: p.split("/").pop(), ...structuredClone(v) })),
    commit: async (ops) => {
      if (fail) {
        fail = false;
        throw Error("injected failure");
      }
      for (const op of ops) {
        const previous = store.get(op.path);
        if (op.version ? previous?.version !== op.version : !!previous)
          throw Error("version conflict");
      }
      for (const op of ops) {
        const previous = store.get(op.path);
        seed(op.path, { ...previous?.data, ...op.data });
      }
    },
    ensurePendingAccount: async (studentId) => {
      const uid = "import_" + studentId;
      auth.set(uid, { disabled: true });
      return uid;
    },
    activateAuth: async (uid, password) => {
      auth.set(uid, {
        disabled: false,
        passwordHash: createHash("sha256").update(password).digest("hex"),
      });
    },
    sendActivation: async () => {},
  };
  return {
    handle: createManagementService(io),
    io,
    store,
    auth,
    seed,
    setTime: (v) => (clock = v),
    failNext: () => {
      fail = true;
    },
  };
}
