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
}

export function isLongForm(note: Note): boolean {
  return note.detailsText !== undefined || note.detailsImage !== undefined;
}

/** A tag within a category. */
export interface Tag {
  /** Unique across all categories, assigned by the server, starting at 1. */
  id: number;
  name: string;
}

/** A group of tags. Tags can be added and renamed, but not deleted. */
export interface Category {
  /** Unique id assigned by the server, starting at 1. */
  id: number;
  name: string;
  /** True: a note can have several tags from this category. False: at most one. */
  multiSelect: boolean;
  /** In the order they were created (id order). */
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
  /**
   * Note ids in the order this tab lists them; notes not in it follow, in creation order. Set with
   * PUT /api/tabs/:id/order (not by the tab editor). Empty for tabs saved before ordering existed.
   */
  noteOrder: number[];
}

/** Body of PUT /api/tabs/:id/order. */
export interface TabOrderRequest {
  noteOrder: number[];
}

/** Notes in a tab's order: those in `noteOrder` first (in that order), then the rest as given. */
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
}

/** Response of GET /api/notes. */
export interface NotesData {
  notes: Note[];
  categories: Category[];
  tabs: Tab[];
}

/** A new note's title: typed text or a handwritten image. */
export type NoteTitle = { titleText: string; titleImage?: never } | { titleImage: string; titleText?: never };

/** A long-form note's details: typed text or a drawing (either may be empty). */
export type NoteDetails = { detailsText: string; detailsImage?: never } | { detailsImage: string; detailsText?: never };

/**
 * Body of POST /api/notes and PUT /api/notes/:id. Details make it a long-form note;
 * parentId (POST only) makes it a child of an open long-form note.
 */
export type NewNoteRequest = NoteTitle & { tagIds: number[]; parentId?: number } & (NoteDetails | { detailsText?: never; detailsImage?: never });

/** Body of POST /api/categories and PUT /api/categories/:id. Tags without an id are new. */
export interface CategoryRequest {
  name: string;
  multiSelect: boolean;
  tags: { id?: number; name: string }[];
}

/** Body of POST /api/login. */
export interface LoginRequest {
  password: string;
}

/** Shape of every error response from the API. */
export interface ApiErrorBody {
  error: string;
}

/** Address of the live-updates WebSocket. The website adds `?id=<connection id>`. */
export const LIVE_UPDATES_PATH = "/ws";

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
  if (existing?.multiSelect && !input.multiSelect) {
    return { ok: false, error: "A multi-select category can't be changed back to single-select." };
  }

  if (!Array.isArray(input.tags)) {
    return { ok: false, error: "The category's tags are missing." };
  }
  const tags: CategoryRequest["tags"] = [];
  for (const rawTag of input.tags as unknown[]) {
    const tag = (typeof rawTag === "object" && rawTag !== null ? rawTag : {}) as { id?: unknown; name?: unknown };
    if (tag.id === undefined) {
      // A new tag row left empty is ignored.
      if (typeof tag.name === "string" && tag.name.trim() === "") continue;
      const tagName = validateName(tag.name, "A tag name");
      if (!tagName.ok) return tagName;
      tags.push({ name: tagName.value });
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
      tags.push({ id: current.id, name: tagName.value });
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
  const input = raw as Partial<Record<keyof TabRequest, unknown>>;

  const name = validateName(input.name, "The tab name", TAB_NAME_MAX_LENGTH);
  if (!name.ok) return name;
  if (sameName(name.value, ALL_TAB_NAME)) {
    return { ok: false, error: `The name "${ALL_TAB_NAME}" is used by the built-in tab that shows every note.` };
  }
  const clash = tabs.find((other) => other.id !== existing?.id && sameName(other.name, name.value));
  if (clash) {
    return { ok: false, error: `There is already a tab called "${clash.name}".` };
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
    filters.push({ categoryId: category.id, tagIds: (tagIds as number[]).slice().sort((a, b) => a - b) });
  }
  if (filters.length === 0) {
    return { ok: false, error: `A tab needs at least one tag; otherwise it would show the same notes as "${ALL_TAB_NAME}".` };
  }
  filters.sort((a, b) => a.categoryId - b.categoryId);

  return { ok: true, tab: { name: name.value, categories: filters } };
}
