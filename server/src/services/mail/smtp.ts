import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../../config.js';

/**
 * Real outbound transport (MAIL_PROVIDER=smtp). Works with an internal
 * relay (no auth) or an authenticated mailbox like smtp.office365.com:587.
 * Activation is env-only — see docs/EMAIL.md.
 */

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (!transporter) {
    if (!env.smtpHost) {
      throw new Error('MAIL_PROVIDER=smtp but SMTP_HOST is not set — see docs/EMAIL.md');
    }
    transporter = nodemailer.createTransport({
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpSecure,
      ...(env.smtpUser ? { auth: { user: env.smtpUser, pass: env.smtpPass } } : {}),
    });
  }
  return transporter;
}

export async function deliverSmtp(input: { to: string; subject: string; body: string }) {
  await getTransporter().sendMail({
    from: env.smtpFrom,
    to: input.to,
    subject: input.subject,
    text: input.body,
  });
}
