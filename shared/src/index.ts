import { nameClashesWithSpokenName, spokenNameError } from "./sms";

export * from "./sms";
export * from "./spokenDue";
export * from "./calendarText";

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
  /** Handwritten details: the first page. Any further pages are in detailsMorePages. */
  detailsImage?: string;
  /**
   * Handwritten details' pages after the first, in order, each a PNG data URL or "" (a blank page).
   * Only with detailsImage, and left out when there's just the one page; at most MAX_DETAILS_PAGES - 1.
   */
  detailsMorePages?: string[];
  /**
   * For a child note: its parent's id, a long-form note in the same notebook. Any note can have one,
   * long-form notes included, so long-form notes can form a tree (never a loop).
   */
  parentId?: number;
  /**
   * The id of the user who added the note: its owner, or someone a tag is shared with who added it in
   * the owner's notebook. Set by the server; missing on notes added before it was recorded.
   */
  createdByUserId?: number;
  /** ISO 8601, UTC: when the note is due. Regular and long-form notes. */
  dueDateTime?: string;
  /**
   * From an all-day event in Google Calendar (see Specs/google-calendar.md): its event stays all-day
   * while the note is due at 20:00 (UK time). Set by the server, and dropped when the time changes.
   */
  allDay?: true;
  /** The due date a reminder has been sent for (or that was already past when set), so it's sent once. Set by the server. */
  reminderSentFor?: string;
  /**
   * The random id the page sent when adding the note. An add sent again with the same one (e.g. an
   * offline add retried after its reply was lost) returns this note instead of making a second.
   */
  clientId?: string;
  /**
   * Only on another user's note in a recipient's view (GET /api/notes): whose it is, and what the
   * recipient may do with it. Never stored. Such a note's `tagIds` hold only the tags shared with the
   * recipient (and its Lifetime).
   */
  shared?: NoteShare;
}

/** What a recipient may do with notes that have a tag shared with them. Each level includes the ones before it. */
export type SharePermission = "read" | "edit" | "delete";
export const SHARE_PERMISSIONS: SharePermission[] = ["read", "edit", "delete"];
export const SHARE_PERMISSION_NAMES: Record<SharePermission, string> = {
  read: "Read-only",
  edit: "Edit",
  delete: "Edit and delete",
};

/** Whether `permission` includes `needed`. */
export function allows(permission: SharePermission, needed: SharePermission): boolean {
  return SHARE_PERMISSIONS.indexOf(permission) >= SHARE_PERMISSIONS.indexOf(needed);
}

/** The higher of two permission levels. */
export function higherPermission(a: SharePermission, b: SharePermission): SharePermission {
  return allows(a, b) ? a : b;
}

/** On a note shared with the logged-in user: whose it is, and the most they may do with it (from its shared tags). */
export interface NoteShare {
  ownerId: number;
  ownerName: string;
  permission: SharePermission;
}

/** The built-in "Shared with me" category, holding every tag shared with the user (only when there are any). */
export const SHARED_CATEGORY_ID = -2;
export const SHARED_CATEGORY_NAME = "Shared with me";

/** Owners' display names are shortened to this many characters (then "…") beside shared tags. */
export const OWNER_NAME_SHOWN = 10;

/** An owner's display name as shown beside their shared tags: "Christophe…" for "Christopher". */
export function shortOwnerName(name: string): string {
  return name.length > OWNER_NAME_SHOWN ? `${name.slice(0, OWNER_NAME_SHOWN)}…` : name;
}

/** A tag's name with its owner's, for a shared tag ("Shopping (Pat)"); other tags' names as they are. */
export function tagLabel(tag: Tag): string {
  return tag.ownerName === undefined ? tag.name : `${tag.name} (${shortOwnerName(tag.ownerName)})`;
}

/** A tag shared with the user, as the share dialog lists who it's shared with. */
export interface TagShare {
  userId: number;
  displayName: string;
  loginName: string;
  permission: SharePermission;
  /**
   * True while the share waits for the person to accept it: they hadn't been linked with the owner by
   * sharing (either way), so they were emailed to ask. Until they accept, they see nothing of it.
   */
  pending?: boolean;
  /** Only in the answer to PUT /api/tags/:id/shares: this save emailed them to ask. */
  asked?: boolean;
}

/** Body of PUT /api/tags/:id/shares: everyone the tag is shared with (a person by login email), replacing the list. */
export interface TagSharesRequest {
  shares: { loginName: string; permission: SharePermission }[];
}

/** GET /api/shares/people: users the logged-in user is already linked with by sharing, either way. */
export interface SharePerson {
  id: number;
  displayName: string;
  loginName: string;
}

/** Body of PUT /api/shared-tags: the recipient's own order and colours for the tags shared with them (every one, once). */
export interface SharedTagsRequest {
  tags: { id: number; hue?: number }[];
}

/** Longest `clientId` the server accepts. */
export const CLIENT_ID_MAX_LENGTH = 64;

export function isLongForm(note: Note): boolean {
  return note.detailsText !== undefined || note.detailsImage !== undefined;
}

/**
 * Whether `ancestorId` is `noteId`'s parent, its parent's parent, and so on up the chain (among `notes`).
 * A note can't be given a parent that is itself or one of its own descendants, which would make a loop.
 */
export function isAncestor(notes: readonly Note[], ancestorId: number, noteId: number): boolean {
  const byId = new Map(notes.map((note) => [note.id, note]));
  const seen = new Set<number>();
  let parentId = byId.get(noteId)?.parentId;
  while (parentId !== undefined && !seen.has(parentId)) {
    if (parentId === ancestorId) return true;
    seen.add(parentId);
    parentId = byId.get(parentId)?.parentId;
  }
  return false;
}

/** The ids of every note below `noteId` (its children, their children, and so on), among `notes`. */
export function descendantIds(notes: readonly Note[], noteId: number): Set<number> {
  const children = new Map<number, number[]>();
  for (const note of notes) {
    if (note.parentId !== undefined) children.set(note.parentId, [...(children.get(note.parentId) ?? []), note.id]);
  }
  const found = new Set<number>();
  const queue = [...(children.get(noteId) ?? [])];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (found.has(id) || id === noteId) continue;
    found.add(id);
    queue.push(...(children.get(id) ?? []));
  }
  return found;
}

/** A tag within a category. */
export interface Tag {
  /** Unique across all categories, assigned by the server, starting at 1. */
  id: number;
  name: string;
  /** The tag's colour, as a hue in whole degrees (0-359); notes with the tag are tinted with it. */
  hue?: number;
  /** Only in "Shared with me": the owner's display name (in full), and what the user may do with its notes. */
  ownerName?: string;
  ownerId?: number;
  permission?: SharePermission;
  /**
   * Only on the user's own tags that they've shared, as the server sends them (never stored): the most
   * any of the people it's shared with may do. Shown as icons on the tag's pills on notes.
   */
  sharedOut?: SharePermission;
  /**
   * Only on the user's own tags, as the server sends them (never stored): true while one of its shares is
   * waiting for the person to accept it. Shown as an hourglass in Settings, in place of the sharing icon.
   */
  sharePending?: boolean;
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
  /** True for the built-in "Shared with me" category: only its tags' order and colours can be changed, by the user. */
  shared?: boolean;
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
export type NoteDetails =
  | { detailsText: string; detailsImage?: never; detailsMorePages?: never }
  | { detailsImage: string; detailsMorePages?: string[]; detailsText?: never };

/**
 * Body of POST /api/notes and PUT /api/notes/:id. Details make it a long-form note;
 * parentId makes it a child of a long-form note (in the same notebook). On a PUT, null takes it out of
 * its parent and leaving it out keeps the parent it has. Also POST only: clientId (see
 * Note), and createdDateTime for a note created offline (used if it's valid and not in the future).
 * Both: tagsChangedDateTime, when the tags were changed offline (used the same way), and
 * dueDateTime (leaving it out of a PUT clears it).
 */
export type NewNoteRequest = NoteTitle & {
  tagIds: number[];
  parentId?: number | null;
  dueDateTime?: string;
  clientId?: string;
  createdDateTime?: string;
  tagsChangedDateTime?: string;
  /**
   * PUT only: the note's lastModifiedDateTime when the edit started. If the note has changed since, the
   * edit is refused (412) rather than replacing that change. Left out (offline changes, or "keep mine"
   * after a refusal), the edit replaces whatever is there.
   */
  baseModifiedDateTime?: string;
} & (NoteDetails | { detailsText?: never; detailsImage?: never; detailsMorePages?: never });

/** Body of PUT /api/notes/:id/lifetime. tagsChangedDateTime: when it was changed offline (used if valid and not in the future). */
export interface LifetimeRequest {
  lifetime: LifetimeChange;
  tagsChangedDateTime?: string;
}

/**
 * Body of PUT /api/notes/:id/tab-move: dragging a note onto another tab in edit-order mode. The server
 * works out the tags with `tagsForTabMove`, from the note as it is then.
 */
export interface TabMoveRequest {
  toTabId: number;
  /** The tab it was dragged from; undefined for "All". */
  fromTabId?: number;
  /** The note's lastModifiedDateTime when it was dropped: refused if it has changed since. */
  baseModifiedDateTime?: string;
}

/** One category's tags before and after a move to a tab (only categories that change). */
export interface TabMoveChange {
  categoryId: number;
  removed: number[];
  added: number[];
}

export type TabMove = { ok: true; tagIds: number[]; changes: TabMoveChange[] } | { ok: false; error: string };

/**
 * The tags a note gets when it's dragged onto tab `to` from tab `from` (undefined: "All"). `categories`
 * includes Lifetime. For each of `to`'s filters the note keeps a tag it already has, or else gets the
 * filter's first tag (in a single-select category, replacing the one it had; Lifetime never becomes
 * New). Then the tags of `from`'s filters are taken off, in categories `to` doesn't filter on (never
 * Lifetime, which every note has one of), so the note leaves the tab it came from.
 */
export function tagsForTabMove(note: Note, categories: Category[], to: Tab, from: Tab | undefined): TabMove {
  let tagIds = note.tagIds.some(isLifetimeTag) ? [...note.tagIds] : [...note.tagIds, LIFETIME_ACTIVE];
  for (const filter of to.categories) {
    const category = categories.find((c) => c.id === filter.categoryId);
    if (!category || category.shared) {
      return { ok: false, error: `"${to.name}" shows tags shared with you, so your own notes can't be moved into it.` };
    }
    const options = filter.tagIds.filter((id) => category.tags.some((tag) => tag.id === id));
    if (options.some((id) => tagIds.includes(id))) continue;
    const pick = options.find((id) => id !== LIFETIME_NEW);
    if (pick === undefined) {
      return {
        ok: false,
        error: options.length > 0 ? `Notes can't be made New, so they can't be moved to "${to.name}".` : `"${to.name}" has no tags to give the note.`,
      };
    }
    if (!category.multiSelect) tagIds = tagIds.filter((id) => !category.tags.some((tag) => tag.id === id));
    tagIds.push(pick);
  }
  for (const filter of from?.categories ?? []) {
    if (filter.categoryId === LIFETIME_CATEGORY_ID || to.categories.some((f) => f.categoryId === filter.categoryId)) continue;
    tagIds = tagIds.filter((id) => !filter.tagIds.includes(id));
  }
  // The Lifetime tag stays last, as everywhere else.
  const lifetime = tagIds.find(isLifetimeTag)!;
  tagIds = [...tagIds.filter((id) => id !== lifetime), lifetime];
  const changes: TabMoveChange[] = [];
  for (const category of categories) {
    const inCategory = (ids: number[]) => category.tags.filter((tag) => ids.includes(tag.id)).map((tag) => tag.id);
    const before = inCategory(category.id === LIFETIME_CATEGORY_ID ? [lifetimeOf(note)] : note.tagIds);
    const after = inCategory(tagIds);
    const removed = before.filter((id) => !after.includes(id));
    const added = after.filter((id) => !before.includes(id));
    if (removed.length > 0 || added.length > 0) changes.push({ categoryId: category.id, removed, added });
  }
  return { ok: true, tagIds, changes };
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
  /** Admins only: how many account requests are waiting to be confirmed (from GET /api/me; missing elsewhere). */
  accountsWaiting?: number;
}

/** How serious a server log entry is: from console.error or console.warn. */
export type ServerLogLevel = "error" | "warning";

/**
 * Something that went wrong on the server, as GET /api/server-log lists them (admins only). The same error
 * seen again within an hour adds to `count` instead of making a new entry.
 */
export interface ServerLogEntry {
  id: number;
  level: ServerLogLevel;
  /** Its first line. */
  message: string;
  /** All of it (e.g. with the stack trace), when there's more than the message. */
  details?: string;
  /** The request it happened in, e.g. "PUT /api/notes/12", and who made it (the most recent time). */
  request?: string;
  userId?: number;
  /** ISO 8601, UTC: when it was first and last seen. */
  firstDateTime: string;
  lastDateTime: string;
  count: number;
}

/** Body of POST /api/account-requests: someone asking for an account, on the public sign-up page. */
export interface AccountRequestBody {
  /** Their email address, which they'll log in with. */
  loginName: string;
  displayName: string;
  password: string;
}

/** An account request waiting for an admin to confirm it, as the users page lists them. */
export interface AccountRequest {
  id: number;
  loginName: string;
  displayName: string;
  /** ISO 8601, UTC. */
  requestedDateTime: string;
}

/** At most this many account requests can be waiting at once, so the sign-up page can't fill the database. */
export const ACCOUNT_REQUESTS_MAX = 20;

/** Body of PUT /api/me/password. */
export interface PasswordChangeRequest {
  currentPassword: string;
  newPassword: string;
}

/** Body of PUT /api/me/name: changing your own display name. */
export interface NameChangeRequest {
  displayName: string;
}

/** Body of POST /api/me/email: asking to change your own login email, which is done once a link emailed to the new address is opened. */
export interface EmailChangeRequest {
  loginName: string;
  currentPassword: string;
}

/** The public page an email-change link opens, to confirm the new login email. */
export const CONFIRM_EMAIL_PATH = "/confirm-email";

/** What a working email-change link is for (POST /api/email-change/check). */
export interface EmailChangeLink {
  /** The login email now. */
  loginName: string;
  /** The one it changes to. */
  newLoginName: string;
}

/** An email-change link that has expired, been used, or been overtaken by another change to the account. */
export const EMAIL_LINK_NOT_WORKING = "This link has expired or has already been used. Ask for a new one in Settings.";

/** The public page a sharing request's emailed link opens, to accept or turn down notes shared by someone new. */
export const SHARE_INVITE_PATH = "/share-invite";

/** What a working sharing-request link is for (POST /api/share-invite/check). */
export interface ShareInviteLink {
  /** Who is sharing, and the email they log in with. */
  ownerName: string;
  ownerLoginName: string;
  /** The names of their tags waiting to be shared with the person the link is for. */
  tagNames: string[];
}

/** A sharing-request link that has already been answered, or whose sharing the owner has since stopped. */
export const SHARE_INVITE_NOT_WORKING = "This sharing request has already been answered, or is no longer waiting.";

/** Forgotten passwords: the public page that emails a link, and the one the link opens. */
export const FORGOT_PASSWORD_PATH = "/forgot-password";
export const RESET_PASSWORD_PATH = "/reset-password";

/** Asking for the emailed link (POST /api/password-reset). */
export interface PasswordResetRequest {
  loginName: string;
}

/** Choosing the new password with the link's token (POST /api/password-reset/confirm). */
export interface PasswordResetConfirmRequest {
  token: string;
  newPassword: string;
}

/** What an emailed link that doesn't work (expired, used, changed, or its account gone or turned off) says. */
export const PASSWORD_LINK_NOT_WORKING = "This link has expired or has already been used.";

/** A user, as the users page (admin only) lists them. */
export interface UserSummary extends Me {
  disabled: boolean;
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
  /** Whether each text they send that works gets a text back confirming it (set by the admin). */
  smsConfirmations: boolean;
  /**
   * How many changes they've made today and in the 6 days before (as their History lists them), counted from
   * the `changesSince` GET /api/users is given. `more` when their History has already dropped some of those
   * days' changes (it keeps only the newest 500), so there were at least `count`. Only in GET /api/users.
   */
  recentChanges?: { count: number; more: boolean };
}

/** GET /api/me/sms: adding notes by text message. */
export type SmsStatus =
  | { smsNumber: string; linked: false }
  | { smsNumber: string; linked: true; phoneNumber: string; linkedDateTime: string };

/** POST /api/me/sms/link-code: the code to text to the nwsnotes number, from the phone being linked. */
/** GET /api/google: whether the user's Google Calendar is connected, and any problem that has stopped the sync. */
export interface GoogleStatus {
  connected: boolean;
  problem?: string;
}

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

/** Handwritten details' pages, in order (each a PNG data URL, or "" for a blank page); empty for other notes. */
export function detailsPagesOf(note: Pick<Note, "detailsImage" | "detailsMorePages">): string[] {
  return note.detailsImage === undefined ? [] : [note.detailsImage, ...(note.detailsMorePages ?? [])];
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
  /** Text back a confirmation for each text of theirs that works. */
  smsConfirmations?: boolean;
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

/**
 * Header the website sends with every request once it knows who is logged in: that user's id. Tabs in one
 * browser share the session cookie, so logging in as someone else in one tab changes who the others are
 * logged in as. A request whose header doesn't match the cookie's user is refused (401), so such a tab
 * can't show or change the other person's notes as if they were its own.
 */
export const USER_ID_HEADER = "X-User-Id";
export const OTHER_USER_LOGGED_IN = "Someone else has logged in in another tab of this browser.";

/**
 * The status of a note edit refused because the note changed since the edit started (in another tab, on
 * another device, or by someone it's shared with): PUT /api/notes/:id with a baseModifiedDateTime that
 * isn't the note's lastModifiedDateTime any more.
 */
export const NOTE_CHANGED_STATUS = 412;
export const NOTE_CHANGED_ELSEWHERE = "This note was changed somewhere else (in another tab, or on another device) since you started editing it.";

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
/** The most pages handwritten details can have. Each page is one image, of up to DETAILS_IMAGE_MAX_LENGTH. */
export const MAX_DETAILS_PAGES = 10;
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
 * which may be empty. Handwritten details may also have detailsMorePages (more pages, each an image or
 * empty). Returns undefined details for a regular note.
 */
export function validateNoteDetails(body: unknown): { ok: true; details?: NoteDetails } | { ok: false; error: string } {
  const { detailsText, detailsImage, detailsMorePages } = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  if (detailsText !== undefined && detailsImage !== undefined) {
    return { ok: false, error: "A long-form note has typed or handwritten details, not both." };
  }
  if (detailsMorePages !== undefined && detailsImage === undefined) {
    return { ok: false, error: "Only handwritten details can have more than one page." };
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
    const first = checkDetailsPage(detailsImage, "The handwritten details");
    if (!first.ok) return first;
    if (detailsMorePages === undefined) return { ok: true, details: { detailsImage: first.value } };
    if (!Array.isArray(detailsMorePages)) return { ok: false, error: "The handwritten details' pages must be a list." };
    if (detailsMorePages.length > MAX_DETAILS_PAGES - 1) {
      return { ok: false, error: `The handwritten details have ${detailsMorePages.length + 1} pages; the most is ${MAX_DETAILS_PAGES}.` };
    }
    const more: string[] = [];
    for (const [index, page] of detailsMorePages.entries()) {
      const check = checkDetailsPage(page, `Page ${index + 2} of the handwritten details`);
      if (!check.ok) return check;
      more.push(check.value);
    }
    return { ok: true, details: more.length > 0 ? { detailsImage: first.value, detailsMorePages: more } : { detailsImage: first.value } };
  }
  return { ok: true };
}

/** One page of handwritten details: empty, or a PNG data URL within the size limit. */
function checkDetailsPage(raw: unknown, what: string): Check<string> {
  return raw === "" ? { ok: true, value: "" } : validateTitleImage(raw, DETAILS_IMAGE_MAX_LENGTH, what);
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
  for (const builtIn of [LIFETIME_NAME, SHARED_CATEGORY_NAME]) {
    if (sameName(name.value, builtIn)) return { ok: false, error: `The name "${builtIn}" is used by a built-in category.` };
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

/** A style the markers turn on: *bold*, _underline_, /italic/, -strikethrough- and #highlight#. */
export type TextStyle = "bold" | "underline" | "italic" | "strikethrough" | "highlight";

const STYLE_MARKERS: Record<string, TextStyle> = { "*": "bold", _: "underline", "/": "italic", "-": "strikethrough", "#": "highlight" };
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

// ---- Tickboxes (long-form details only) ------------------------------------

/** A tickbox at the start of a line of long-form details: "[ ]", "[]", "[x]" or "[X]", after any indent. */
export interface Tickbox {
  /** The spaces or tabs before it. */
  indent: string;
  /** The tickbox as typed, e.g. "[ ]". */
  box: string;
  ticked: boolean;
}

const TICKBOX = /^([ \t]*)(\[[ xX]?\])/;

/** The tickbox a line starts with, if any. */
export function tickboxOf(line: string): Tickbox | undefined {
  const match = TICKBOX.exec(line);
  if (!match) return undefined;
  const box = match[2]!;
  return { indent: match[1]!, box, ticked: box === "[x]" || box === "[X]" };
}

/** A change to make to some text: replace [from, to) with `insert`. */
export interface TextEdit {
  from: number;
  to: number;
  insert: string;
}

const lineStartOf = (text: string, lineIndex: number) => {
  let start = 0;
  for (let index = 0; index < lineIndex; index++) start = text.indexOf("\n", start) + 1;
  return start;
};

/** Ticking or unticking line `lineIndex`'s tickbox: "[ ]" and "[]" become "[x]", "[x]" and "[X]" become "[ ]". */
export function tickboxToggle(text: string, lineIndex: number): TextEdit | undefined {
  const lineStart = lineStartOf(text, lineIndex);
  const end = text.indexOf("\n", lineStart);
  const tickbox = tickboxOf(text.slice(lineStart, end < 0 ? undefined : end));
  if (!tickbox) return undefined;
  const inside = lineStart + tickbox.indent.length + 1;
  if (tickbox.box === "[]") return { from: inside, to: inside, insert: "x" };
  return { from: inside, to: inside + 1, insert: tickbox.ticked ? " " : "x" };
}

/**
 * The spaces a just-typed tickbox needs once text is typed after it, on the line starting at `lineStart`:
 * "[]Hello" and "[] Hello" become "[ ] Hello", and "[x]Done" becomes "[x] Done". Undefined if it needs none.
 */
export function tickboxSpacing(text: string, lineStart: number): TextEdit | undefined {
  const line = text.slice(lineStart).split("\n", 1)[0]!;
  const empty = /^([ \t]*)\[\] ?(?=\S)/.exec(line);
  if (empty) {
    const inside = lineStart + empty[1]!.length + 1;
    return { from: inside, to: lineStart + empty[0].length, insert: " ] " };
  }
  const filled = /^[ \t]*\[[ xX]\](?=\S)/.exec(line);
  if (filled) {
    const after = lineStart + filled[0].length;
    return { from: after, to: after, insert: " " };
  }
  return undefined;
}
