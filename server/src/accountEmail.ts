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

/** The email to a new login email, with the link that makes the change. */
export function emailChangeLinkEmail(to: { email: string; name: string }, currentEmail: string, link: string): Email {
  const body = emailBody([
    { text: `Hello ${to.name},`, html: `Hello ${escapeHtml(to.name)},` },
    {
      text: `You asked to change the email you log in to nwsnotes with, from ${currentEmail} to this address, ${to.email}.`,
      html: `You asked to change the email you log in to nwsnotes with, from ${escapeHtml(currentEmail)} to this address, ${escapeHtml(to.email)}.`,
    },
    { text: `Confirm the new email: ${link}`, html: `<a href="${escapeHtml(link)}">Confirm the new email</a>` },
    {
      text: `The link works once, for 24 hours. Until it's used, keep logging in with ${currentEmail}. If you didn't ask for this, ignore this email: nothing has changed.`,
      html: `The link works once, for 24 hours. Until it's used, keep logging in with ${escapeHtml(currentEmail)}. If you didn't ask for this, ignore this email: nothing has changed.`,
    },
  ]);
  return { to: to.email, toName: to.name, subject: "Confirm your new nwsnotes email", ...body };
}

/** The email to the old login email once it has been changed, so they'd notice if it wasn't them. */
export function emailChangedEmail(to: { email: string; name: string }, newEmail: string): Email {
  const body = emailBody([
    { text: `Hello ${to.name},`, html: `Hello ${escapeHtml(to.name)},` },
    {
      text: `The email you log in to nwsnotes with has just been changed from this address, ${to.email}, to ${newEmail}.`,
      html: `The email you log in to nwsnotes with has just been changed from this address, ${escapeHtml(to.email)}, to ${escapeHtml(newEmail)}.`,
    },
    { text: `From now on, log in with ${newEmail}.`, html: `From now on, log in with ${escapeHtml(newEmail)}.` },
    {
      text: "If this wasn't you, tell the admin straight away.",
      html: "If this wasn't you, tell the admin straight away.",
    },
  ]);
  return { to: to.email, toName: to.name, subject: "Your nwsnotes email was changed", ...body };
}

/** "Shopping", or "Shopping" and "Home", or "Shopping", "Home" and "Work". */
function quotedList(names: string[]): string {
  const quoted = names.map((name) => `"${name}"`);
  return quoted.length <= 1 ? (quoted[0] ?? "") : `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1)}`;
}

/**
 * The email asking someone if they're happy to see notes shared by someone they aren't linked with by
 * sharing yet. The link opens a page to accept or turn it down.
 */
export function shareInviteEmail(to: { email: string; name: string }, owner: { name: string; email: string }, tagNames: string[], link: string): Email {
  const tags = quotedList(tagNames);
  const what = `their notes tagged ${tags}`;
  const body = emailBody([
    { text: `Hello ${to.name},`, html: `Hello ${escapeHtml(to.name)},` },
    {
      text: `${owner.name} (${owner.email}) would like to share ${what} with you on nwsnotes.`,
      html: `${escapeHtml(owner.name)} (${escapeHtml(owner.email)}) would like to share ${escapeHtml(what)} with you on nwsnotes.`,
    },
    {
      text: `Are you happy to see notes shared by ${owner.name}? Answer here: ${link}`,
      html: `Are you happy to see notes shared by ${escapeHtml(owner.name)}? <a href="${escapeHtml(link)}">Accept or turn down the sharing</a>`,
    },
    {
      text: `You won't see any of their notes unless you accept. If you turn it down, ${owner.name} will be told.`,
      html: `You won't see any of their notes unless you accept. If you turn it down, ${escapeHtml(owner.name)} will be told.`,
    },
  ]);
  return { to: to.email, toName: to.name, subject: `${owner.name} wants to share notes with you on nwsnotes`, ...body };
}

/** The email telling an owner that the person they asked turned their sharing down. */
export function shareDeclinedEmail(to: { email: string; name: string }, recipient: { name: string; email: string }, tagNames: string[]): Email {
  const tags = quotedList(tagNames);
  const body = emailBody([
    { text: `Hello ${to.name},`, html: `Hello ${escapeHtml(to.name)},` },
    {
      text: `${recipient.name} (${recipient.email}) chose not to accept your request to share ${tags} with them on nwsnotes.`,
      html: `${escapeHtml(recipient.name)} (${escapeHtml(recipient.email)}) chose not to accept your request to share ${escapeHtml(tags)} with them on nwsnotes.`,
    },
    { text: "They can't see any of your notes.", html: "They can't see any of your notes." },
  ]);
  return { to: to.email, toName: to.name, subject: `${recipient.name} didn't accept your sharing on nwsnotes`, ...body };
}

/** The email telling an owner that someone has stopped viewing a tag they shared with them. */
export function shareLeftEmail(to: { email: string; name: string }, recipient: { name: string; email: string }, tagName: string): Email {
  const body = emailBody([
    { text: `Hello ${to.name},`, html: `Hello ${escapeHtml(to.name)},` },
    {
      text: `${recipient.name} (${recipient.email}) has stopped viewing your shared tag "${tagName}" on nwsnotes.`,
      html: `${escapeHtml(recipient.name)} (${escapeHtml(recipient.email)}) has stopped viewing your shared tag "${escapeHtml(tagName)}" on nwsnotes.`,
    },
    {
      text: "They can no longer see your notes with that tag. You can share it with them again from the tag's category in Settings.",
      html: "They can no longer see your notes with that tag. You can share it with them again from the tag's category in Settings.",
    },
  ]);
  return { to: to.email, toName: to.name, subject: `${recipient.name} stopped viewing "${tagName}" on nwsnotes`, ...body };
}
