import { ALL_TAB_NAME, isLongForm, noteMatchesFilters, orderNotes, withoutMarkers, type Note, type NotesData, type Tab } from "@nwsnotes/shared";
import type { Email } from "./email.js";

/** Dates are shown in UK time, as everyone using nwsnotes is in the UK. */
const TIME_ZONE = "Europe/London";

/** A due date as shown in the email, e.g. "Tue, 3 Dec 2026, 14:00". */
function formatDue(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TIME_ZONE,
  }).format(new Date(iso));
}

function formatDay(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: TIME_ZONE }).format(date);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** One note's line: its title (handwritten ones can't be shown in an email), and what kind of note it is. */
interface Line {
  title: string;
  handwritten: boolean;
  extras: string[];
}

function lineOf(note: Note, notes: Note[], now: Date): Line {
  const extras: string[] = [];
  if (isLongForm(note)) extras.push("long-form note");
  // A note added inside a long-form note says which, as its pill does on the notes page.
  const parent = note.parentId === undefined ? undefined : notes.find((other) => other.id === note.parentId);
  if (parent?.titleText !== undefined) extras.push(`in ${withoutMarkers(parent.titleText)}`);
  if (note.dueDateTime) extras.push(`${new Date(note.dueDateTime) < now ? "was due" : "due"} ${formatDue(note.dueDateTime)}`);
  return note.titleText !== undefined
    ? { title: withoutMarkers(note.titleText), handwritten: false, extras }
    : { title: "Handwritten note", handwritten: true, extras };
}

/** The notes a tab shows, as the notes page lists them (in the shared order, Bin notes hidden unless it ticks Bin). */
export function notesShownIn(tab: Tab | "all", data: Pick<NotesData, "notes" | "noteOrder">): Note[] {
  const filters = tab === "all" ? [] : tab.categories;
  return orderNotes(
    data.notes.filter((note) => noteMatchesFilters(note, filters)),
    data.noteOrder,
  );
}

/** The email summarising a tab: every note it shows, in its order, with any due date. */
export function tabSummaryEmail(
  tab: Tab | "all",
  data: Pick<NotesData, "notes" | "noteOrder">,
  to: { email: string; name: string },
  siteUrl: string,
  now = new Date(),
): Email & { noteCount: number } {
  const tabName = tab === "all" ? ALL_TAB_NAME : tab.name;
  const lines = notesShownIn(tab, data).map((note) => lineOf(note, data.notes, now));
  const count = lines.length === 1 ? "1 note" : `${lines.length} notes`;
  const subject = `nwsnotes: ${tabName} (${count})`;
  const intro = `Your ${tabName} tab on ${formatDay(now)}: ${count}.`;

  const textLines = lines.map(({ title, handwritten, extras }) => {
    const shown = handwritten ? `[${title}]` : title;
    return `- ${shown}${extras.length > 0 ? ` (${extras.join(", ")})` : ""}`;
  });
  const text = [intro, "", ...(lines.length > 0 ? textLines : ["This tab shows no notes."]), "", `Open nwsnotes: ${siteUrl}`, ""].join("\n");

  const htmlItems = lines
    .map(({ title, handwritten, extras }) => {
      const shown = handwritten ? `<em style="color:#666">${escapeHtml(title)}</em>` : escapeHtml(title);
      const after = extras.length > 0 ? ` <span style="color:#666">(${escapeHtml(extras.join(", "))})</span>` : "";
      return `<li style="margin:0 0 6px">${shown}${after}</li>`;
    })
    .join("");
  const html =
    `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.4;color:#222">` +
    `<p>${escapeHtml(intro)}</p>` +
    (lines.length > 0 ? `<ul style="padding-left:20px">${htmlItems}</ul>` : `<p>This tab shows no notes.</p>`) +
    `<p><a href="${escapeHtml(siteUrl)}">Open nwsnotes</a></p>` +
    `</body></html>`;

  return { to: to.email, toName: to.name, subject, text, html, noteCount: lines.length };
}
