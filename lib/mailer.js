// Outgoing email (verification codes) via SMTP/nodemailer.
//
// If SMTP is not configured (see config.mail), codes are logged to the server
// console instead of emailed — dev mode. This keeps `npm start` working with
// zero setup while making the missing config loud and obvious.
const nodemailer = require('nodemailer');
const config = require('../config');

let transporter = null;

function getTransporter() {
  if (!config.mail.configured) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.mail.host,
      port: config.mail.port,
      secure: config.mail.secure,
      auth: { user: config.mail.user, pass: config.mail.pass },
    });
  }
  return transporter;
}

async function sendVerificationEmail(to, code) {
  const t = getTransporter();
  if (!t) {
    console.log(
      `[DEV] Verification code for ${to}: ${code} ` +
        `(SMTP not configured — set SMTP_HOST/SMTP_USER/SMTP_PASS to email it)`
    );
    return { delivered: false, dev: true };
  }
  const site = config.siteName;
  await t.sendMail({
    from: config.mail.from,
    to,
    subject: `Your ${site} verification code`,
    text:
      `Hi,\n\n` +
      `Your ${site} verification code is:\n\n    ${code}\n\n` +
      `Enter it on the site to confirm your email. It expires in 15 minutes.\n\n` +
      `If you didn't create this account, you can ignore this email.`,
    html:
      `<p>Hi,</p>` +
      `<p>Your ${site} verification code is:</p>` +
      `<p style="font-size:28px; font-weight:800; letter-spacing:.35em;">${code}</p>` +
      `<p>Enter it on the site to confirm your email. It expires in 15 minutes.</p>` +
      `<p style="color:#888; font-size:12px;">If you didn't create this account, you can ignore this email.</p>`,
  });
  return { delivered: true, dev: false };
}

module.exports = { sendVerificationEmail, mailConfigured: () => config.mail.configured };
