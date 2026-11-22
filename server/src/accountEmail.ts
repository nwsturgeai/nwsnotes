import type { Email } from "./email.js";
import { escapeHtml } from "./tabEmail.js";

/** The email telling someone an admin has confirmed the account they asked for, with the link to log in. */
export function accountConfirmedEmail(to: { email: string; name: string }, loginUrl: string): Email {
  const text = [
    `Hello ${to.name},`,
    "",
    "Your nwsnotes account has been confirmed.",
    "",
    `Log in at ${loginUrl} with this email address (${to.email}) and the password you chose.`,
    "",
  ].join("\n");
  const html =
    `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.4;color:#222">` +
    `<p>Hello ${escapeHtml(to.name)},</p>` +
    `<p>Your nwsnotes account has been confirmed.</p>` +
    `<p><a href="${escapeHtml(loginUrl)}">Log in to nwsnotes</a> with this email address (${escapeHtml(to.email)}) and the password you chose.</p>` +
    `</body></html>`;
  return { to: to.email, toName: to.name, subject: "Your nwsnotes account is ready", text, html };
}
