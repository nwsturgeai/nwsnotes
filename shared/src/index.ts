import { nameClashesWithSpokenName, spokenNameError } from "./sms";

export * from "./sms";

/** A single note, as stored on the server and sent to the website. */
export interface Note {
  /** Unique id assigned by the server, starting at 1. */
  id: number;
  /** Set on typed notes. Exactly one of titleText and titleImage is set. */
  titleText?: string;
  /** Set on handwritten notes: a PNG data URL, at 2× pixel density. */
  titleImage?: string;
  /** ISO 8601, UTC, set by the server. */
  createdDateTime: string;
  /** ISO 8601, UTC, set by the server. */
  lastModifiedDateTime: string;
  /**
   * ISO 8601, UTC: when the note's tags (Lifetime included) were last set or really changed. Set by
   * the server, or the time of a change made offline.
   */
  tagsChangedDateTime: string;
  /** Ids of the note's tags. Tag ids are unique across all categories. */
  tagIds: number[];
  /**
   * Long-form notes have exactly one of detailsText (at most 10,000 characters) or detailsImage
   * (a PNG data URL); having one is what makes a note long-form. Both start empty ("").
   */
  detailsText?: string;
  detailsImage?: string;
  /** For a note added while a long-form note was open: that long-form note's id. */
  parentId?: number;
  /** ISO 8601, UTC: when the note is due. Regular notes only. */
  dueDateTime?: string;
  /** The due date a reminder has been sent for (or that was already past when set), so it's sent once. Set by the server. */
  reminderSentFor?: string;
  /**
   * The random id the page sent when adding the note. An add sent again with the same one (e.g. an
   * offline add retried after its reply was lost) returns this note instead of making a second.
   */
  clientId?: string;
}

/** Longest `clientId` the server accepts. */
export const CLIENT_ID_MAX_LENGTH = 64;

export function isLongForm(note: Note): boolean {
  return note.detailsText !== undefined || note.detailsImage !== undefined;
}

/** A tag within a category. */
export interface Tag {
  /** Unique across all categories, assigned by the server, starting at 1. */
  id: number;
  name: string;
  /** The tag's colour, as a hue in whole degrees (0-359); notes with the tag are tinted with it. */
  hue?: number;
}

/** A group of tags. Tags can be added and renamed, but not deleted. */
export interface Category {
  /** Unique id assigned by the server, starting at 1. */
  id: number;
  name: string;
  /** True: a note can have several tags from this category. False: at most one. */
  multiSelect: boolean;
  /** In the category's tag order: the order set with the arrows on the category page. */
  tags: Tag[];
  /** True for the built-in Lifetime category, which can't be edited and has no new-note dropdown. */
  system?: boolean;
}

/*
 * The built-in Lifetime category. It isn't stored; the server adds it to the categories it sends.
 * Negative ids can never clash with user categories and tags, whose ids start at 1.
 */
export const LIFETIME_CATEGORY_ID = -1;
export const LIFETIME_NEW = -1;
export const LIFETIME_ACTIVE = -2;
export const LIFETIME_ARCHIVED = -3;
export const LIFETIME_BIN = -4;
/** Added after the others, so its id can't follow the listed order (ids are stored on notes). */
export const LIFETIME_WAITING = -5;
export const LIFETIME_NAME = "Lifetime";

export const LIFETIME_CATEGORY: Category = {
  id: LIFETIME_CATEGORY_ID,
  name: LIFETIME_NAME,
  multiSelect: false,
  system: true,
  tags: [
    { id: LIFETIME_NEW, name: "New" },
    { id: LIFETIME_ACTIVE, name: "Active" },
    { id: LIFETIME_WAITING, name: "Waiting" },
    { id: LIFETIME_ARCHIVED, name: "Archived" },
    { id: LIFETIME_BIN, name: "Bin" },
  ],
};

/** The Lifetime values the note buttons can set (a note only becomes New by being created). */
export type LifetimeChange = "Active" | "Waiting" | "Archived" | "Bin";
export const LIFETIME_CHANGES: Record<LifetimeChange, number> = {
  Active: LIFETIME_ACTIVE,
  Waiting: LIFETIME_WAITING,
  Archived: LIFETIME_ARCHIVED,
  Bin: LIFETIME_BIN,
};

export function isLifetimeTag(id: number): boolean {
  return LIFETIME_CATEGORY.tags.some((tag) => tag.id === id);
}

/** A note's Lifetime tag id. Every note has exactly one; Active is assumed if it's missing. */
export function lifetimeOf(note: Note): number {
  return note.tagIds.find(isLifetimeTag) ?? LIFETIME_ACTIVE;
}

/** One category in a tab's filter: a note matches it if it has at least one of these tags. */
export interface TabFilter {
  categoryId: number;
  /** One or more tags from that category. */
  tagIds: number[];
}

/** A named filter. Notes are shown when they match every category in `categories`. */
export interface Tab {
  /** Unique id assigned by the server, starting at 1. The built-in "All" tab isn't stored and has no id. */
  id: number;
  name: string;
  categories: TabFilter[];
  /** "left": shown in the left strip. Missing: along the top (the usual place). */
  placement?: TabPlacement;
  /** An easier name to say when adding notes by text message. Missing: none. */
  spokenName?: string;
}

/** Body of PUT /api/notes/order: the shared order of the notes, for every tab. */
export interface NoteOrderRequest {
  noteOrder: number[];
}

/** Body of PUT /api/notes/bulk-tags: tags to add to and remove from every listed note (multi-select). */
export interface BulkTagsRequest {
  noteIds: number[];
  addTagIds: number[];
  removeTagIds: number[];
}

/** Notes in the shared order: those in `noteOrder` first (in that order), then the rest as given (creation order). */
export function orderNotes<T extends { id: number }>(notes: T[], noteOrder: number[]): T[] {
  const position = new Map(noteOrder.map((id, index) => [id, index]));
  const listed = notes.filter((note) => position.has(note.id));
  listed.sort((a, b) => position.get(a.id)! - position.get(b.id)!);
  return [...listed, ...notes.filter((note) => !position.has(note.id))];
}

/** Body of POST /api/tabs and PUT /api/tabs/:id. */
export interface TabRequest {
  name: string;
  categories: TabFilter[];
  /** Where the tab shows: "left" for the left strip; missing means the top strip. */
  placement?: TabPlacement;
  /** An easier name to say when adding notes by text message; missing or empty means none. */
  spokenName?: string;
}

/** Where a tab shows on the notes page: along the top, or down the left-hand side. */
export type TabPlacement = "top" | "left";

/** Body of PUT /api/tabs/all: where the built-in "All" tab shows. */
export interface AllTabRequest {
  placement: TabPlacement;
}

/** Response of GET /api/notes. */
export interface NotesData {
  notes: Note[];
  categories: Category[];
  tabs: Tab[];
  /** Where the built-in "All" tab shows. */
  allTabPlacement: TabPlacement;
  /** The shared order of the notes, used by every tab ("All" included); notes not in it follow, oldest first. */
  noteOrder: number[];
}

/**
 * Makes one shared note order from tabs' own orders (as they were kept before the order was shared),
 * taking the tabs in their order: each tab's order is kept wherever it doesn't conflict with a tab above.
 * Each note not yet placed goes straight after the nearest note before it in that tab's order that is
 * already placed, or, if none is, straight before the first one after it that is (else at the end).
 */
export function mergeNoteOrders(orders: number[][]): number[] {
  const merged: number[] = [];
  const placed = new Set<number>();
  for (const order of orders) {
    const ids = [...new Set(order)];
    ids.forEach((id, index) => {
      if (placed.has(id)) return;
      const before = ids.slice(0, index).findLast((other) => placed.has(other));
      const after = ids.slice(index + 1).find((other) => placed.has(other));
      if (before !== undefined) merged.splice(merged.indexOf(before) + 1, 0, id);
      else if (after !== undefined) merged.splice(merged.indexOf(after), 0, id);
      else merged.push(id);
      placed.add(id);
    });
  }
  return merged;
}

/** A new note's title: typed text or a handwritten image. */
export type NoteTitle = { titleText: string; titleImage?: never } | { titleImage: string; titleText?: never };

/** A long-form note's details: typed text or a drawing (either may be empty). */
export type NoteDetails = { detailsText: string; detailsImage?: never } | { detailsImage: string; detailsText?: never };

/**
 * Body of POST /api/notes and PUT /api/notes/:id. Details make it a long-form note;
 * parentId (POST only) makes it a child of an open long-form note. Also POST only: clientId (see
 * Note), and createdDateTime for a note created offline (used if it's valid and not in the future).
 * Both: tagsChangedDateTime, when the tags were changed offline (used the same way), and
 * dueDateTime (regular notes only; leaving it out of a PUT clears it).
 */
export type NewNoteRequest = NoteTitle & {
  tagIds: number[];
  parentId?: number;
  dueDateTime?: string;
  clientId?: string;
  createdDateTime?: string;
  tagsChangedDateTime?: string;
} & (NoteDetails | { detailsText?: never; detailsImage?: never });

/** Body of PUT /api/notes/:id/lifetime. tagsChangedDateTime: when it was changed offline (used if valid and not in the future). */
export interface LifetimeRequest {
  lifetime: LifetimeChange;
  tagsChangedDateTime?: string;
}

/** Whether two notes' tag lists hold the same tags, in any order. */
export function sameTags(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

/** Body of POST /api/categories and PUT /api/categories/:id. Tags without an id are new. */
export interface CategoryRequest {
  name: string;
  multiSelect: boolean;
  tags: { id?: number; name: string; hue?: number }[];
}

/** Body of POST /api/login. */
export interface LoginRequest {
  /** The login name (an email address), compared ignoring case. */
  loginName: string;
  password: string;
}

/** GET /api/me: who is logged in. */
export interface Me {
  id: number;
  loginName: string;
  displayName: string;
  admin: boolean;
  /** The admin only: how many accounts asked for on the sign-up page are waiting to be confirmed. */
  waitingUserCount?: number;
}

/** Body of POST /api/signup: asking for an account on the public sign-up page. */
export interface SignUpRequest {
  /** An email address, to log in with. */
  loginName: string;
  password: string;
}

/** Body of PUT /api/me/password. */
export interface PasswordChangeRequest {
  currentPassword: string;
  newPassword: string;
}

/** A user, as the users page (admin only) lists them. */
export interface UserSummary extends Me {
  disabled: boolean;
  /** Asked for on the sign-up page and not yet confirmed by the admin: can't log in until it is. */
  waitingForConfirmation: boolean;
  createdDateTime: string;
  /** Missing if they've never logged in. */
  lastLoginDateTime?: string;
  /** How many notes their notebook has. */
  noteCount: number;
  /** The space their notes take in the database, in bytes. */
  noteBytes: number;
  /** The space their History's earlier copies take, in bytes. */
  historyBytes: number;
  /** The most notes they can have. */
  noteLimit: number;
  /** How many of their notes are stylus (handwritten) notes, and the most they can have (see stylusNoteLimitOf). */
  stylusNoteCount: number;
  stylusNoteLimit: number;
  /** Whether they've linked a phone for adding notes by text message. */
  smsLinked: boolean;
}

/** GET /api/me/sms: adding notes by text message. */
export type SmsStatus =
  | { smsNumber: string; linked: false }
  | { smsNumber: string; linked: true; phoneNumber: string; linkedDateTime: string };

/** POST /api/me/sms/link-code: the code to text to the nwsnotes number, from the phone being linked. */
export interface SmsLinkCode {
  code: string;
  smsNumber: string;
  /** ISO 8601, UTC. */
  expiresDateTime: string;
}

/** Everyone's maximum number of notes until the admin changes it, and the highest it can be set to. */
export const NOTE_LIMIT_DEFAULT = 1000;
export const NOTE_LIMIT_MAX = 100_000;

/** At least this share of their limit used, a user is told their limit. */
export const NOTE_LIMIT_SHOWN_FROM = 0.8;

/** A user's stylus notes are limited to this share of their note limit. */
export const STYLUS_NOTE_SHARE = 0.05;

/** The most stylus notes a user can have: 5% of their note limit (rounded down), and at least 1. */
export function stylusNoteLimitOf(noteLimit: number): number {
  return Math.max(1, Math.floor(noteLimit * STYLUS_NOTE_SHARE));
}

/** A stylus note: a handwritten title, or a long-form note with handwritten details (even while they're still empty). */
export function isStylusNote(note: Pick<Note, "titleImage" | "detailsImage">): boolean {
  return note.titleImage !== undefined || note.detailsImage !== undefined;
}

/** GET /api/me/stats: the logged-in user's number of notes, and the space they take in the database (bytes). */
export interface NoteStats {
  noteCount: number;
  noteBytes: number;
  /** The space their History's earlier copies take (bytes). */
  historyBytes: number;
  /** The most notes they can have (shown to them only once they're near it). */
  noteLimit: number;
  /** How many of them are stylus notes, and the most they can have (likewise shown only once they're near it). */
  stylusNoteCount: number;
  stylusNoteLimit: number;
}

/** Body of POST /api/users (adding a user). */
export interface NewUserRequest {
  loginName: string;
  displayName: string;
}

/** Body of PUT /api/users/:id: only the parts given change. */
export interface UserUpdateRequest {
  loginName?: string;
  displayName?: string;
  disabled?: boolean;
  /** The most notes they can have: a whole number from 1 to NOTE_LIMIT_MAX. */
  noteLimit?: number;
}

/**
 * Login names are email addresses: something before an "@", and a domain with a dot after it, with no
 * spaces, at most 254 characters. (Accounts made before this rule may still have other names until the
 * admin changes them; those still log in.)
 */
export const LOGIN_NAME_MAX_LENGTH = 254;
export const LOGIN_NAME_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
export const LOGIN_NAME_RULE = "A login name must be an email address, e.g. pat@example.com.";

/** Whether a login name follows the rule (it's an email address). */
export function isValidLoginName(name: string): boolean {
  return name.length <= LOGIN_NAME_MAX_LENGTH && LOGIN_NAME_PATTERN.test(name);
}
export const DISPLAY_NAME_MAX_LENGTH = 60;
/** Passwords people choose. */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 200;

/** Shape of every error response from the API. */
export interface ApiErrorBody {
  error: string;
}

/** Address of the live-updates WebSocket. The website adds `?id=<connection id>`. */
export const LIVE_UPDATES_PATH = "/ws";

/** The close code the server ends a live-updates connection with when its user's logins stop working. */
export const LIVE_LOGGED_OUT_CLOSE_CODE = 4001;

/** Header the website sends with every change, so the server doesn't notify the page that made it. */
export const CONNECTION_ID_HEADER = "X-Connection-Id";

/** Messages the server sends over the live-updates WebSocket. */
export interface LiveMessage {
  /** Notes or categories were changed by another page; reload them. */
  type: "data-changed";
}

type Check<T> = { ok: true; value: T } | { ok: false; error: string };

export const TITLE_MAX_LENGTH = 500;

/**
 * Trims and checks a note title.
 * Returns the cleaned title, or an error message if it isn't allowed.
 */
export function validateTitle(raw: unknown): { ok: true; title: string } | { ok: false; error: string } {
  if (typeof raw !== "string") {
    return { ok: false, error: "The note title must be text." };
  }
  const title = raw.trim();
  if (title.length === 0) {
    return { ok: false, error: "The note title can't be empty." };
  }
  if (title.length > TITLE_MAX_LENGTH) {
    return {
      ok: false,
      error: `The note title is ${title.length} characters long; the maximum is ${TITLE_MAX_LENGTH}.`,
    };
  }
  return { ok: true, title };
}

const PNG_DATA_URL_PREFIX = "data:image/png;base64,";
/** Every PNG starts with the same 8 bytes, which are "iVBORw0KGgo" in base64. */
const PNG_BASE64_START = "iVBORw0KGgo";
/** Maximum length of a handwritten title's data URL, in characters. */
export const TITLE_IMAGE_MAX_LENGTH = 200 * 1024;

/** Maximum length of a long-form note's details drawing (data URL), in characters. */
export const DETAILS_IMAGE_MAX_LENGTH = 2 * 1024 * 1024;
export const DETAILS_TEXT_MAX_LENGTH = 10_000;

/** Checks a handwritten image: a PNG data URL within the size limit. `what` is e.g. "The handwritten note". */
export function validateTitleImage(raw: unknown, maxLength = TITLE_IMAGE_MAX_LENGTH, what = "The handwritten note"): Check<string> {
  if (typeof raw !== "string" || !raw.startsWith(PNG_DATA_URL_PREFIX)) {
    return { ok: false, error: `${what} must be a PNG image.` };
  }
  const base64 = raw.slice(PNG_DATA_URL_PREFIX.length);
  if (!base64.startsWith(PNG_BASE64_START) || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    return { ok: false, error: `${what} must be a PNG image.` };
  }
  if (raw.length > maxLength) {
    const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);
    return { ok: false, error: `${what} is too large (${kb(raw.length)}); the maximum is ${kb(maxLength)}.` };
  }
  return { ok: true, value: raw };
}

/**
 * Checks a long-form note's details, if any: exactly one of detailsText or detailsImage, either of
 * which may be empty. Returns undefined details for a regular note.
 */
export function validateNoteDetails(body: unknown): { ok: true; details?: NoteDetails } | { ok: false; error: string } {
  const { detailsText, detailsImage } = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  if (detailsText !== undefined && detailsImage !== undefined) {
    return { ok: false, error: "A long-form note has typed or handwritten details, not both." };
  }
  if (detailsText !== undefined) {
    if (typeof detailsText !== "string") return { ok: false, error: "The details must be text." };
    if (detailsText.length > DETAILS_TEXT_MAX_LENGTH) {
      return {
        ok: false,
        error: `The details are ${detailsText.length} characters long; the maximum is ${DETAILS_TEXT_MAX_LENGTH}.`,
      };
    }
    return { ok: true, details: { detailsText } };
  }
  if (detailsImage !== undefined) {
    if (detailsImage === "") return { ok: true, details: { detailsImage: "" } };
    const image = validateTitleImage(detailsImage, DETAILS_IMAGE_MAX_LENGTH, "The handwritten details");
    return image.ok ? { ok: true, details: { detailsImage: image.value } } : image;
  }
  return { ok: true };
}

/** Checks a note's due date, if any: a valid date-time, returned as ISO 8601 UTC. */
export function validateDueDate(body: unknown): { ok: true; dueDateTime?: string } | { ok: false; error: string } {
  const { dueDateTime } = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  if (dueDateTime === undefined || dueDateTime === null) return { ok: true };
  const ms = typeof dueDateTime === "string" ? Date.parse(dueDateTime) : NaN;
  if (Number.isNaN(ms)) return { ok: false, error: "The due date must be a valid date and time." };
  return { ok: true, dueDateTime: new Date(ms).toISOString() };
}

/** Checks a new note's title: exactly one of typed text or a handwritten image. */
export function validateNoteTitle(body: unknown): { ok: true; title: NoteTitle } | { ok: false; error: string } {
  const { titleText, titleImage } = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  if (titleText !== undefined && titleImage !== undefined) {
    return { ok: false, error: "A note can have typed text or a handwritten image, not both." };
  }
  if (titleImage !== undefined) {
    const image = validateTitleImage(titleImage);
    return image.ok ? { ok: true, title: { titleImage: image.value } } : image;
  }
  if (titleText === undefined) {
    return { ok: false, error: "A note needs typed text or a handwritten image." };
  }
  const text = validateTitle(titleText);
  return text.ok ? { ok: true, title: { titleText: text.title } } : text;
}

export const NAME_MAX_LENGTH = 40;

/** The most categories (not counting the built-in one), tags in a category, and tabs (not counting "All") a user can have. */
export const CATEGORIES_MAX = 20;
export const TAGS_PER_CATEGORY_MAX = 40;
export const TABS_MAX = 40;

/** Category and tag names count as the same if they differ only in upper/lower case. */
export function sameName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** Trims and checks a category, tag or tab name. `what` is e.g. "The category name". */
function validateName(raw: unknown, what: string, maxLength = NAME_MAX_LENGTH): Check<string> {
  if (typeof raw !== "string") {
    return { ok: false, error: `${what} must be text.` };
  }
  const name = raw.trim();
  if (name.length === 0) {
    return { ok: false, error: `${what} can't be empty.` };
  }
  if (name.length > maxLength) {
    return { ok: false, error: `${what} "${name}" is ${name.length} characters long; the maximum is ${maxLength}.` };
  }
  return { ok: true, value: name };
}

/**
 * Checks a category being added (`existing` undefined) or edited, against all current categories.
 * Returns the cleaned request: names trimmed and empty new tag rows dropped.
 */
export function validateCategory(
  raw: unknown,
  categories: Category[],
  existing?: Category,
): { ok: true; category: CategoryRequest } | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: "The category is missing." };
  }
  if (!existing && categories.filter((category) => !category.system).length >= CATEGORIES_MAX) {
    return { ok: false, error: `You can have at most ${CATEGORIES_MAX} categories.` };
  }
  const input = raw as Partial<Record<keyof CategoryRequest, unknown>>;

  const name = validateName(input.name, "The category name");
  if (!name.ok) return name;
  if (sameName(name.value, LIFETIME_NAME)) {
    return { ok: false, error: `The name "${LIFETIME_NAME}" is used by the built-in category.` };
  }
  const clash = categories.find((other) => other.id !== existing?.id && sameName(other.name, name.value));
  if (clash) {
    return { ok: false, error: `There is already a category called "${clash.name}".` };
  }

  if (typeof input.multiSelect !== "boolean") {
    return { ok: false, error: "Multi-select must be true or false." };
  }

  if (!Array.isArray(input.tags)) {
    return { ok: false, error: "The category's tags are missing." };
  }
  const tags: CategoryRequest["tags"] = [];
  for (const rawTag of input.tags as unknown[]) {
    const tag = (typeof rawTag === "object" && rawTag !== null ? rawTag : {}) as { id?: unknown; name?: unknown; hue?: unknown };
    if (tag.hue !== undefined && tag.hue !== null && !(Number.isInteger(tag.hue) && (tag.hue as number) >= 0 && (tag.hue as number) < 360)) {
      return { ok: false, error: "A tag's colour must be a hue from 0 to 359." };
    }
    const hue = typeof tag.hue === "number" ? { hue: tag.hue } : {};
    if (tag.id === undefined) {
      // A new tag row left empty is ignored.
      if (typeof tag.name === "string" && tag.name.trim() === "") continue;
      const tagName = validateName(tag.name, "A tag name");
      if (!tagName.ok) return tagName;
      tags.push({ name: tagName.value, ...hue });
    } else {
      const current = existing?.tags.find((t) => t.id === tag.id);
      if (!current) {
        return { ok: false, error: `Tag ${String(tag.id)} isn't in this category.` };
      }
      if (tags.some((t) => t.id === current.id)) {
        return { ok: false, error: `The tag "${current.name}" appears twice.` };
      }
      const tagName = validateName(tag.name, `The new name for "${current.name}"`);
      if (!tagName.ok) {
        return typeof tag.name === "string" && tag.name.trim() === ""
          ? { ok: false, error: `The tag "${current.name}" can't be given an empty name; use its bin button to delete it.` }
          : tagName;
      }
      tags.push({ id: current.id, name: tagName.value, ...hue });
    }
  }
  // Existing tags left out are deleted (the server removes them from notes and tabs).
  for (const [index, tag] of tags.entries()) {
    if (tags.slice(0, index).some((earlier) => sameName(earlier.name, tag.name))) {
      return { ok: false, error: `There is more than one tag called "${tag.name}".` };
    }
    // An unset dropdown shows the category name, so a tag with that name would look the same.
    if (sameName(tag.name, name.value)) {
      return {
        ok: false,
        error: `The tag "${tag.name}" has the same name as the category. Rename the tag or the category.`,
      };
    }
  }
  if (tags.length === 0) {
    return { ok: false, error: "A category needs at least one tag." };
  }
  if (tags.length > TAGS_PER_CATEGORY_MAX) {
    return { ok: false, error: `A category can have at most ${TAGS_PER_CATEGORY_MAX} tags; this one has ${tags.length}.` };
  }

  return { ok: true, category: { name: name.value, multiSelect: input.multiSelect, tags } };
}

/** Checks a new note's tag ids: each must exist, with at most one from each single-select category. */
export function validateTagIds(raw: unknown, categories: Category[]): Check<number[]> {
  if (raw === undefined) return { ok: true, value: [] };
  if (!Array.isArray(raw) || !raw.every((id) => Number.isInteger(id))) {
    return { ok: false, error: "The note's tags must be a list of tag ids." };
  }
  const tagIds = raw as number[];
  for (const [index, id] of tagIds.entries()) {
    if (tagIds.indexOf(id) !== index) {
      return { ok: false, error: `Tag ${id} appears twice.` };
    }
    if (!categories.some((category) => category.tags.some((tag) => tag.id === id))) {
      return { ok: false, error: `Tag ${id} doesn't exist.` };
    }
  }
  for (const category of categories) {
    const chosen = category.tags.filter((tag) => tagIds.includes(tag.id));
    if (!category.multiSelect && chosen.length > 1) {
      return { ok: false, error: `Only one tag can be chosen from "${category.name}".` };
    }
  }
  return { ok: true, value: tagIds };
}

/** Name of the built-in tab, which shows every note. It can't be used for another tab. */
export const ALL_TAB_NAME = "All";
export const TAB_NAME_MAX_LENGTH = 20;

/**
 * True if a note is shown under these filters (a tab's own plus any additional filters): it must have,
 * for every filter, at least one of that filter's tags. Bin notes are hidden unless a filter ticks Bin.
 */
export function noteMatchesFilters(note: Note, filters: TabFilter[], includeBin = false): boolean {
  const lifetimeFilter = filters.find((filter) => filter.categoryId === LIFETIME_CATEGORY_ID);
  if (!includeBin && lifetimeOf(note) === LIFETIME_BIN && !lifetimeFilter?.tagIds.includes(LIFETIME_BIN)) return false;
  return filters.every((filter) =>
    filter.categoryId === LIFETIME_CATEGORY_ID
      ? filter.tagIds.includes(lifetimeOf(note))
      : filter.tagIds.some((id) => note.tagIds.includes(id)),
  );
}

/**
 * Checks a tab being added (`existing` undefined) or edited, against all current tabs and categories.
 * Returns the cleaned request: name trimmed, filters in category order with their tags in tag order.
 */
export function validateTab(
  raw: unknown,
  tabs: Tab[],
  categories: Category[],
  existing?: Tab,
): { ok: true; tab: TabRequest } | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: "The tab is missing." };
  }
  if (!existing && tabs.length >= TABS_MAX) {
    return { ok: false, error: `You can have at most ${TABS_MAX} tabs, as well as "${ALL_TAB_NAME}".` };
  }
  const input = raw as Partial<Record<keyof TabRequest, unknown>>;

  const name = validateName(input.name, "The tab name", TAB_NAME_MAX_LENGTH);
  if (!name.ok) return name;
  if (sameName(name.value, ALL_TAB_NAME)) {
    return { ok: false, error: `The name "${ALL_TAB_NAME}" is used by the built-in tab that shows every note.` };
  }
  const others = tabs.filter((other) => other.id !== existing?.id);
  const clash = others.find((other) => sameName(other.name, name.value));
  if (clash) {
    return { ok: false, error: `There is already a tab called "${clash.name}".` };
  }
  const spokenClash = nameClashesWithSpokenName(name.value, others);
  if (spokenClash) {
    return { ok: false, error: `The tab "${spokenClash.name}" already uses that as its spoken name.` };
  }
  if (input.spokenName !== undefined && input.spokenName !== null && typeof input.spokenName !== "string") {
    return { ok: false, error: "The spoken name must be text." };
  }
  const spokenName = typeof input.spokenName === "string" ? input.spokenName.trim() : "";
  if (spokenName !== "") {
    const error = spokenNameError(spokenName, name.value, others);
    if (error) return { ok: false, error };
  }

  if (!Array.isArray(input.categories)) {
    return { ok: false, error: "The tab's filters are missing." };
  }
  const filters: TabFilter[] = [];
  for (const rawFilter of input.categories as unknown[]) {
    const filter = (typeof rawFilter === "object" && rawFilter !== null ? rawFilter : {}) as Partial<
      Record<keyof TabFilter, unknown>
    >;
    const category = categories.find((c) => c.id === filter.categoryId);
    if (!category) {
      return { ok: false, error: `Category ${String(filter.categoryId)} doesn't exist.` };
    }
    if (filters.some((f) => f.categoryId === category.id)) {
      return { ok: false, error: `The category "${category.name}" appears twice.` };
    }
    if (!Array.isArray(filter.tagIds) || filter.tagIds.length === 0) {
      return { ok: false, error: `Choose at least one "${category.name}" tag, or leave that category out.` };
    }
    const tagIds = filter.tagIds as unknown[];
    for (const [index, id] of tagIds.entries()) {
      if (!category.tags.some((tag) => tag.id === id)) {
        return { ok: false, error: `Tag ${String(id)} isn't in the category "${category.name}".` };
      }
      if (tagIds.indexOf(id) !== index) {
        return { ok: false, error: `Tag ${String(id)} appears twice in "${category.name}".` };
      }
    }
    filters.push({ categoryId: category.id, tagIds: category.tags.map((tag) => tag.id).filter((id) => tagIds.includes(id)) });
  }
  if (filters.length === 0) {
    return { ok: false, error: `A tab needs at least one tag; otherwise it would show the same notes as "${ALL_TAB_NAME}".` };
  }
  filters.sort((a, b) => a.categoryId - b.categoryId);

  if (input.placement !== undefined && input.placement !== "top" && input.placement !== "left") {
    return { ok: false, error: '"placement" must be "top" or "left".' };
  }
  // Top is the usual place, so only "left" is stored.
  return {
    ok: true,
    tab: {
      name: name.value,
      categories: filters,
      ...(input.placement === "left" && { placement: "left" }),
      ...(spokenName !== "" && { spokenName }),
    },
  };
}

// ---- Text formatting -------------------------------------------------------

/** A style the markers turn on: *bold*, _underline_ and /italic/. */
export type TextStyle = "bold" | "underline" | "italic";

const STYLE_MARKERS: Record<string, TextStyle> = { "*": "bold", _: "underline", "/": "italic" };
/** What may come just before an opening marker, besides the start of the line or a space. */
const BEFORE_OPENING = "([{\"'";
/** What may come just after a closing marker, besides the end of the line or a space. */
const AFTER_CLOSING = ".,;:!?)]}\"'";

/** A run of a line's text: its styles, and whether it's one of the markers themselves. */
export interface FormattedRun {
  text: string;
  styles: TextStyle[];
  marker: boolean;
}

const isSpace = (char: string | undefined) => char !== undefined && /\s/.test(char);

/** `insideFrom`: where the enclosing span's text starts, so its own opening marker can come just before. */
function canOpen(line: string, at: number, insideFrom: number): boolean {
  const before = line[at - 1];
  const after = line[at + 1];
  const startsWord = before === undefined || isSpace(before) || BEFORE_OPENING.includes(before) || (at === insideFrom && at > 0);
  return startsWord && after !== undefined && !isSpace(after);
}

/** `insideTo`: where the enclosing span's closing marker is, so it can come just after. */
function canClose(line: string, at: number, insideTo: number): boolean {
  const before = line[at - 1];
  const after = line[at + 1];
  const endsWord = after === undefined || isSpace(after) || AFTER_CLOSING.includes(after) || at + 1 === insideTo;
  return before !== undefined && !isSpace(before) && endsWord;
}

/**
 * One line's runs (formatting never carries over a line break). A marker counts where it starts or
 * ends a word, as in Org-mode, so "and/or" or "12/11/2026" stay as typed; one without a partner on
 * the line is just text. Markers can be nested, e.g. "*_both_*". The runs' text adds up to the line.
 */
export function formatLine(line: string): FormattedRun[] {
  const runs: FormattedRun[] = [];
  const add = (text: string, styles: TextStyle[], marker = false) => {
    if (text === "") return;
    const last = runs.at(-1);
    if (last && !marker && !last.marker && last.styles.join() === styles.join()) last.text += text;
    else runs.push({ text, styles, marker });
  };
  const parse = (from: number, to: number, styles: TextStyle[]) => {
    let plainFrom = from;
    for (let at = from; at < to; at++) {
      const style = STYLE_MARKERS[line[at]!];
      if (!style || styles.includes(style) || !canOpen(line, at, from)) continue;
      let close = -1;
      for (let end = at + 2; end < to; end++) {
        if (line[end] === line[at] && canClose(line, end, styles.length > 0 ? to : -1)) {
          close = end;
          break;
        }
      }
      if (close < 0) continue;
      add(line.slice(plainFrom, at), styles);
      const inner = [...styles, style];
      add(line[at]!, inner, true);
      parse(at + 1, close, inner);
      add(line[close]!, inner, true);
      at = close;
      plainFrom = close + 1;
    }
    add(line.slice(plainFrom, to), styles);
  };
  parse(0, line.length, []);
  return runs;
}

/** Text with the formatting markers taken out, for places that show it plain (notifications, pills). */
export function withoutMarkers(text: string): string {
  return text
    .split("\n")
    .map((line) =>
      formatLine(line)
        .filter((run) => !run.marker)
        .map((run) => run.text)
        .join(""),
    )
    .join("\n");
}

/** One change in the history (GET /api/history). */
export interface HistoryChange {
  id: number;
  /** ISO 8601, UTC. */
  time: string;
  /** E.g. "Archived \"Buy milk\"". */
  summary: string;
  /** How many notes, categories and tabs it changed. */
  itemCount: number;
  /** For going back: the time of the change gone back to, and how many changes were undone. */
  revertedTo?: string;
  undone?: number;
}

/** A page of the history, newest first; `more` says whether there are older changes. */
export interface HistoryPage {
  changes: HistoryChange[];
  more: boolean;
}
