import { hostedManagementCall as call } from "./hosted-management-client.js";
export async function prepareEventEligibility(
  source,
  eventId,
  onProgress = () => {},
) {
  let after = null;
  for (let page = 0; page < 10000; page++) {
    const result = await call("reportingCaptureEligibility", {
      source,
      eventId,
      after,
    });
    onProgress(result);
    if (result.state === "ready") return result;
    after = result.next;
  }
  throw Error(
    "Eligibility preparation is still pending. Reopen Reporting & Analytics to continue.",
  );
}
