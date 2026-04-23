import nodemailer, { type Transporter } from "nodemailer";

let cached: Transporter | null = null;

function getTransporter(): Transporter {
  if (cached) return cached;
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || "587");
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) {
    throw new Error("EMAIL_NOT_CONFIGURED");
  }
  cached = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
  return cached;
}

export type EmailAttachment = {
  filename: string;
  content: Buffer;
  contentType: string;
};

export async function sendReportEmail(opts: {
  to: string[];
  subject: string;
  text: string;
  html?: string;
  attachments?: EmailAttachment[];
}): Promise<void> {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  if (!from) throw new Error("EMAIL_NOT_CONFIGURED");
  const transporter = getTransporter();
  await transporter.sendMail({
    from,
    to: opts.to.join(", "),
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
    attachments: opts.attachments,
  });
}

export function isEmailConfigured(): boolean {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}
