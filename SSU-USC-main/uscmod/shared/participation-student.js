import { hostedManagementCall as call } from "./hosted-management-client.js";
import { auth } from "../firebase/firebase-config.js";
import { showParticipationHistory } from "./participation-history.js";
const authorized = await (globalThis.USC_AUTH_READY || Promise.resolve(false));
const host = document.getElementById("myStudentQR");
const message = document.getElementById("studentQRMessage");
if (authorized === true && auth.currentUser) {
  try {
    const uid = auth.currentUser.uid;
    const result = await call("participationQR");
    if (auth.currentUser?.uid !== uid)
      throw Error("Your account changed. Refresh to continue.");
    if (host) {
      const code = globalThis.qrcode(0, "M");
      code.addData(result.payload);
      code.make();
      host.innerHTML = code.createSvgTag({
        cellSize: 6,
        margin: 24,
        scalable: true,
        alt: "Student QR code",
      });
      document.getElementById("downloadStudentQR").disabled = false;
      document.getElementById("expandStudentQR").disabled = false;
      const info = document.getElementById("studentQRIdentity");
      info.replaceChildren();
      for (const [key, label] of Object.entries({
        fullName: "Full name",
        studentId: "Student ID",
        college: "Department",
        program: "Program",
        yearLevel: "Year level",
        section: "Section",
      })) {
        const item = document.createElement("p");
        const title = document.createElement("strong");
        title.textContent = label + ": ";
        item.append(
          title,
          document.createTextNode(result.student[key] || "Not recorded"),
        );
        info.append(item);
      }
      document.getElementById("downloadStudentQR").onclick = () => {
        const blob = new Blob([host.innerHTML], { type: "image/svg+xml" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "my-student-qr.svg";
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      };
      document.getElementById("expandStudentQR").onclick = () => {
        const dialog = document.getElementById("expandedStudentQR");
        dialog.querySelector(".participation-qr").innerHTML = host.innerHTML;
        dialog.showModal();
      };
      document.querySelector("#expandedStudentQR button").onclick = () =>
        document.getElementById("expandedStudentQR").close();
      message.textContent =
        "Present this code together with your physical school ID.";
    }
  } catch (error) {
    if (message) message.textContent = error.message;
  }
}
document
  .getElementById("studentParticipationHistory")
  ?.addEventListener("click", () => showParticipationHistory());
