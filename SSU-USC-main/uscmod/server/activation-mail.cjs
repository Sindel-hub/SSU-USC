"use strict";
const { readGmailSettings, ServiceError } = require("./settings.cjs");
function createActivationMailer({ publicOrigin, env = process.env, createTransport }) {
  let transport;
  return async function sendActivation({ email, token, studentId, messageId }) {
    const gmail = readGmailSettings(env);
    if (!transport) transport = createTransport({
      host: "smtp.gmail.com", port: 465, secure: true,
      auth: { user: gmail.user, pass: gmail.pass },
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
      logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true
    });
    const link = `${publicOrigin}/activate/index.html#token=${token}`;
    const result = await transport.sendMail({
      from: { name: "SSU-USC Notifications", address: gmail.user },
      to: email,
      subject: "Activate your SSU-USC student account",
      messageId: `<${messageId}@${new URL(publicOrigin).hostname}>`,
      text: `An authorized SSU-USC administrator provisioned Student ID ${studentId}. Verify this mailbox and set your own password using this single-use link within 24 hours:\n${link}\n\nIf this is not your Student ID, do not activate it; contact USC.`,
      html: `<p>An authorized SSU-USC administrator provisioned Student ID ${studentId}.</p><p><a href="${link}">Verify email and set your password</a></p><p>This single-use link expires in 24 hours. If this is not your Student ID, do not activate it; contact USC.</p>`,
      disableFileAccess: true, disableUrlAccess: true
    });
    if (!Array.isArray(result.accepted) || !result.accepted.some(address => String(address).toLowerCase() === email.toLowerCase()) || result.rejected?.length) throw new ServiceError("unavailable", "Activation email delivery was not confirmed.");
  };
}
module.exports = { createActivationMailer };
