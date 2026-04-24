import nodemailer from "nodemailer";
import { getCallerProfile, getAdminClient } from "./_lib/auth.js";

const MAX_BASE64_BYTES = 2_000_000;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const caller = await getCallerProfile(req);
  if (!caller) return res.status(401).json({ error: "Not authenticated" });

  const { subject, body, filename, contentBase64 } = req.body || {};

  if (!subject || !filename || !contentBase64) {
    return res.status(400).json({ error: "Missing required fields: subject, filename, contentBase64" });
  }
  if (typeof contentBase64 !== "string" || contentBase64.length > MAX_BASE64_BYTES) {
    return res.status(413).json({ error: "Attachment too large" });
  }

  let recipient;
  try {
    const admin = getAdminClient();
    const { data } = await admin
      .from("admin_settings")
      .select("setting_value")
      .eq("setting_key", "quote_recipient_email")
      .single();
    recipient = data?.setting_value;
  } catch (e) {
    return res.status(502).json({ error: "Failed to look up recipient" });
  }

  if (!recipient) {
    return res.status(500).json({ error: "Quote recipient email not configured in admin_settings" });
  }

  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;
  if (!gmailUser || !gmailPass) {
    return res.status(500).json({ error: "GMAIL_USER and GMAIL_APP_PASSWORD must be set" });
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: gmailUser, pass: gmailPass.replace(/\s+/g, "") },
  });

  const fromName = process.env.GMAIL_FROM_NAME || "Enfuze Atlanta";

  try {
    const info = await transporter.sendMail({
      from: `"${fromName}" <${gmailUser}>`,
      to: recipient,
      subject,
      text: body || `Attached: ${filename}`,
      attachments: [
        {
          filename,
          content: Buffer.from(contentBase64, "base64"),
        },
      ],
    });
    return res.status(200).json({ ok: true, id: info.messageId, to: recipient });
  } catch (e) {
    return res.status(502).json({ error: e.message || "Send failed" });
  }
}
