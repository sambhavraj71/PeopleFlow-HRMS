
import nodemailer from "nodemailer";

export const mailConfigured = () =>
  Boolean(
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS &&
    process.env.SMTP_FROM
  );

let transport;

export async function sendMail(to, subject, text) {
  if (!mailConfigured()) {
    console.log(`[email disabled] ${subject} -> ${to}`);
    return false;
  }

  try {
    transport ??= nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT || 587) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });

    await transport.sendMail({
      from: process.env.SMTP_FROM,
      to,
      subject,
      text
    });

    return true;
  } catch (error) {
    console.error("Email delivery failed:", error.message);
    return false;
  }
}
