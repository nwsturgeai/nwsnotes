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
}

/** Response of GET /api/notes. */
export interface NotesData {
  notes: Note[];
  categories: Category[];
}

/** A new note's title: typed text or a handwritten image. */
export type NoteTitle = { titleText: string; titleImage?: never } | { titleImage: string; titleText?: never };

/** Body of POST /api/notes. */
export type NewNoteRequest = NoteTitle & { tagIds: number[] };

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

/** Checks a handwritten note's image: a PNG data URL within the size limit. */
export function validateTitleImage(raw: unknown): Check<string> {
  if (typeof raw !== "string" || !raw.startsWith(PNG_DATA_URL_PREFIX)) {
    return { ok: false, error: "The handwritten note must be a PNG image." };
  }
  const base64 = raw.slice(PNG_DATA_URL_PREFIX.length);
  if (!base64.startsWith(PNG_BASE64_START) || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    return { ok: false, error: "The handwritten note must be a PNG image." };
  }
  if (raw.length > TITLE_IMAGE_MAX_LENGTH) {
    return {
      ok: false,
      error: `The handwritten note is too large (${Math.ceil(raw.length / 1024)} KB); the maximum is ${TITLE_IMAGE_MAX_LENGTH / 1024} KB.`,
    };
  }
  return { ok: true, value: raw };
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

/** Trims and checks a category or tag name. `what` is e.g. "The category name". */
function validateName(raw: unknown, what: string): Check<string> {
  if (typeof raw !== "string") {
    return { ok: false, error: `${what} must be text.` };
  }
  const name = raw.trim();
  if (name.length === 0) {
    return { ok: false, error: `${what} can't be empty.` };
  }
  if (name.length > NAME_MAX_LENGTH) {
    return { ok: false, error: `${what} "${name}" is ${name.length} characters long; the maximum is ${NAME_MAX_LENGTH}.` };
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
          ? { ok: false, error: `The tag "${current.name}" can't be given an empty name, as tags can't be deleted.` }
          : tagName;
      }
      tags.push({ id: current.id, name: tagName.value });
    }
  }

  for (const current of existing?.tags ?? []) {
    if (!tags.some((t) => t.id === current.id)) {
      return { ok: false, error: `The tag "${current.name}" is missing; tags can't be deleted.` };
    }
  }
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
