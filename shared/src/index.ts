/** A single note, as stored on the server and sent to the website. */
export interface Note {
  /** Unique id assigned by the server, starting at 1. */
  id: number;
  titleText: string;
  /** ISO 8601, UTC, set by the server. */
  createdDateTime: string;
  /** ISO 8601, UTC, set by the server. */
  lastModifiedDateTime: string;
}

/** Body of POST /api/notes. */
export interface NewNoteRequest {
  titleText: string;
}

/** Body of POST /api/login. */
export interface LoginRequest {
  password: string;
}

/** Shape of every error response from the API. */
export interface ApiErrorBody {
  error: string;
}

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
