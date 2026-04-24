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

  const { subject, body, html, filename, contentBase64, attachments: extraAttachments, logoBase64 } = req.body || {};

  if (!subject) return res.status(400).json({ error: "Missing required field: subject" });

  // Normalize into an attachments array. Accepts either the legacy
  // { filename, contentBase64 } shape (single file) OR an attachments array
  // of { filename, contentBase64 } objects. Both together are fine too.
  const inputAttachments = [];
  if (filename && contentBase64) {
    inputAttachments.push({ filename, contentBase64 });
  }
  if (Array.isArray(extraAttachments)) {
    for (const a of extraAttachments) {
      if (a && a.filename && a.contentBase64) inputAttachments.push({ filename: a.filename, contentBase64: a.contentBase64 });
    }
  }
  if (inputAttachments.length === 0) {
    return res.status(400).json({ error: "At least one attachment required" });
  }
  for (const a of inputAttachments) {
    if (typeof a.contentBase64 !== "string" || a.contentBase64.length > MAX_BASE64_BYTES) {
      return res.status(413).json({ error: `Attachment "${a.filename}" too large` });
    }
  }
  if (logoBase64 && (typeof logoBase64 !== "string" || logoBase64.length > 800_000)) {
    return res.status(413).json({ error: "Logo too large" });
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

  const attachments = inputAttachments.map((a) => ({
    filename: a.filename,
    content: Buffer.from(a.contentBase64, "base64"),
  }));

  // If a logo data URL was provided, attach it inline with CID "companylogo"
  // so the HTML body can reference it via <img src="cid:companylogo">.
  let logoCid = null;
  if (logoBase64) {
    const match = /^data:(image\/[^;]+);base64,(.+)$/.exec(logoBase64);
    if (match) {
      const mime = match[1];
      const ext = mime.split("/")[1].split("+")[0];
      logoCid = "companylogo";
      attachments.push({
        filename: "logo." + ext,
        content: Buffer.from(match[2], "base64"),
        cid: logoCid,
        contentType: mime,
      });
    }
  }

  try {
    const info = await transporter.sendMail({
      from: `"${fromName}" <${gmailUser}>`,
      to: recipient,
      subject,
      text: body || `Attached: ${inputAttachments.map((a) => a.filename).join(", ")}`,
      html: html || undefined,
      attachments,
    });
    return res.status(200).json({ ok: true, id: info.messageId, to: recipient, logo: !!logoCid });
  } catch (e) {
    return res.status(502).json({ error: e.message || "Send failed" });
  }
}
