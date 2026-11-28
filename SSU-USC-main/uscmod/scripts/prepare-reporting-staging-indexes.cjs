"use strict";
// Run from uscmod. Credentials stay on the user's computer. Never targets production.
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const STAGING = "ssu-usc-email-staging";
const composites = [
  ["officer_records", "createdAtMs", "COLLECTION"],
  ["attendance_audit", "recordedAtMs", "COLLECTION_GROUP"],
  ["reporting_audit", "createdAtMs", "COLLECTION"],
].map(([group, time, queryScope]) => ({
  group,
  queryScope,
  fields: [
    { fieldPath: "officerUid", order: "ASCENDING" },
    { fieldPath: time, order: "ASCENDING" },
  ],
}));
const fields = ["officerUid", "recordedAtMs"].map((field) => ({
  group: "attendance_audit",
  field,
  indexes: [
    { order: "ASCENDING", queryScope: "COLLECTION_GROUP" },
    { order: "ASCENDING", queryScope: "COLLECTION" },
    { order: "DESCENDING", queryScope: "COLLECTION" },
  ].map(({ order, queryScope }) => ({
    queryScope,
    fields: [{ fieldPath: field, order }],
  })),
}));
function verifyAccount(account) {
  if (account?.project_id !== STAGING || account?.type !== "service_account")
    throw Error(
      "Only an ssu-usc-email-staging service-account file is accepted. No changes made.",
    );
}
const signature = (index) =>
  JSON.stringify({
    queryScope: index.queryScope,
    fields: (index.fields || [])
      .filter((f) => f.fieldPath !== "__name__")
      .map((f) => ({
        fieldPath: f.fieldPath,
        order: f.order,
        arrayConfig: f.arrayConfig,
        vectorConfig: f.vectorConfig,
      })),
  });
function mergeFieldIndexes(current, required) {
  const result = [...current];
  for (const item of required)
    if (!result.some((saved) => signature(saved) === signature(item)))
      result.push(item);
  return result;
}
async function main() {
  const apply = process.argv.includes("--apply");
  if (process.argv.slice(2).some((v) => !["--apply", "--check"].includes(v)))
    throw Error("Use --check (read-only) or --apply.");
  const file = String(process.env.SSU_STAGING_KEY_FILE || "")
    .trim()
    .replace(/^"|"$/g, "");
  if (!file)
    throw Error(
      "Set SSU_STAGING_KEY_FILE to your local staging service-account JSON path.",
    );
  const account = JSON.parse(fs.readFileSync(file, "utf8"));
  verifyAccount(account);
  const localRequire = createRequire(path.join(process.cwd(), "package.json"));
  const { cert } = localRequire("firebase-admin/app");
  const credential = cert(account),
    token = (await credential.getAccessToken()).access_token;
  async function api(url, method = "GET", body) {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 409) return { alreadyExists: true };
      throw Error(
        `Staging Firestore API ${response.status}: ${data.error?.message || "Request failed"}`,
      );
    }
    return data;
  }
  const root = `https://firestore.googleapis.com/v1/projects/${STAGING}/databases/(default)`,
    database = await api(root);
  console.log(
    "Confirmed staging database:",
    STAGING,
    "edition:",
    database.databaseEdition || "not returned by API",
  );
  let missing = 0,
    building = 0;
  for (const wanted of composites) {
    const url = `${root}/collectionGroups/${wanted.group}/indexes`;
    let indexes = [],
      pageToken = "";
    do {
      const data = await api(
        url + (pageToken ? "?pageToken=" + encodeURIComponent(pageToken) : ""),
      );
      indexes.push(...(data.indexes || []));
      pageToken = data.nextPageToken || "";
    } while (pageToken);
    const found = indexes.find((i) => signature(i) === signature(wanted));
    if (found) {
      console.log(
        wanted.group,
        wanted.fields.map((f) => f.fieldPath).join(" + "),
        found.state,
      );
      if (found.state !== "READY") building++;
    } else {
      missing++;
      if (apply) {
        await api(url, "POST", {
          queryScope: wanted.queryScope,
          fields: wanted.fields,
        });
        console.log("Requested staging index:", wanted.group);
        building++;
      } else console.log("Missing staging index:", wanted.group);
    }
  }
  for (const wanted of fields) {
    const url = `${root}/collectionGroups/${wanted.group}/fields/${wanted.field}`,
      current = await api(url),
      saved = current.indexConfig?.indexes || [],
      merged = mergeFieldIndexes(saved, wanted.indexes);
    if (merged.length !== saved.length) {
      missing++;
      if (apply) {
        await api(url + "?updateMask=indexConfig", "PATCH", {
          name: current.name,
          indexConfig: {
            indexes: merged.map((index) => ({
              queryScope: index.queryScope,
              ...(index.apiScope ? { apiScope: index.apiScope } : {}),
              fields: index.fields,
            })),
          },
        });
        console.log(
          "Requested staging collection-group field index:",
          wanted.field,
        );
        building++;
      } else
        console.log(
          "Missing staging collection-group field index:",
          wanted.field,
        );
    } else {
      const pending = saved.some((i) => i.state && i.state !== "READY");
      if (pending) building++;
      console.log(
        "Staging field index:",
        wanted.field,
        pending ? "BUILDING" : "READY",
      );
    }
  }
  console.log(
    apply
      ? "Applied additions only. Existing indexes were preserved."
      : "Read-only check complete. No changes made.",
  );
  console.log(
    building
      ? "Indexes are still building. Run --check again after they finish."
      : missing && !apply
        ? "Required staging indexes are missing."
        : "REPORTING STAGING INDEXES READY.",
  );
}
module.exports = { verifyAccount, mergeFieldIndexes, composites, fields };
if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
