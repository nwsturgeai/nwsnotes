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

/** The plain-text and HTML forms of a short email, from its paragraphs (HTML already escaped where needed). */
function emailBody(paragraphs: { text: string; html: string }[]): { text: string; html: string } {
  return {
    text: paragraphs.map((paragraph) => `${paragraph.text}\n`).join("\n"),
    html:
      `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.4;color:#222">` +
      paragraphs.map((paragraph) => `<p>${paragraph.html}</p>`).join("") +
      `</body></html>`,
  };
}

/** The email with the link to choose a new password, for someone who has forgotten theirs. */
export function passwordResetEmail(to: { email: string; name: string }, link: string): Email {
  const body = emailBody([
    { text: `Hello ${to.name},`, html: `Hello ${escapeHtml(to.name)},` },
    {
      text: `Someone (hopefully you) asked to reset the password for your nwsnotes account, ${to.email}.`,
      html: `Someone (hopefully you) asked to reset the password for your nwsnotes account, ${escapeHtml(to.email)}.`,
    },
    { text: `Choose a new password: ${link}`, html: `<a href="${escapeHtml(link)}">Choose a new password</a>` },
    {
      text: "The link works once, for an hour. If you didn't ask for it, ignore this email: your password hasn't changed.",
      html: "The link works once, for an hour. If you didn't ask for it, ignore this email: your password hasn't changed.",
    },
  ]);
  return { to: to.email, toName: to.name, subject: "Choose a new nwsnotes password", ...body };
}

/** How the password was changed, as the "password changed" email says it. */
export type PasswordChangedHow = "link" | "settings";

/** The email telling someone their password has just been changed, so they'd notice if it wasn't them. */
export function passwordChangedEmail(to: { email: string; name: string }, how: PasswordChangedHow, forgotPasswordUrl: string): Email {
  const way = how === "link" ? "using a link emailed to you" : "in Settings";
  const body = emailBody([
    { text: `Hello ${to.name},`, html: `Hello ${escapeHtml(to.name)},` },
    {
      text: `The password for your nwsnotes account, ${to.email}, has just been changed, ${way}.`,
      html: `The password for your nwsnotes account, ${escapeHtml(to.email)}, has just been changed, ${way}.`,
    },
    { text: "Your other devices have been logged out.", html: "Your other devices have been logged out." },
    {
      text: `If this wasn't you, choose a new password straight away at ${forgotPasswordUrl}, and tell the admin.`,
      html: `If this wasn't you, <a href="${escapeHtml(forgotPasswordUrl)}">choose a new password</a> straight away, and tell the admin.`,
    },
  ]);
  return { to: to.email, toName: to.name, subject: "Your nwsnotes password was changed", ...body };
}
