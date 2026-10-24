import {
  CONNECTION_ID_HEADER,
  type ApiErrorBody,
  type Category,
  type CategoryRequest,
  type LoginRequest,
  type NewNoteRequest,
  type Note,
  type NotesData,
} from "@nwsnotes/shared";
import { connectionId } from "./live";

/** An API call that failed, with everything needed to show the error in full. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly method: string,
    readonly url: string,
    /** HTTP status, or undefined if the server couldn't be reached at all. */
    readonly status?: number,
    readonly statusText?: string,
    readonly responseBody?: string,
    readonly underlying?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

async function request<T>(method: string, url: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<T> {
  const headers: Record<string, string> = { ...extraHeaders };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      credentials: "same-origin",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ApiError(`Couldn't reach the server (${reason}).`, method, url, undefined, undefined, undefined, error);
  }

  const text = await response.text();
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`.trim();
    try {
      const parsed = JSON.parse(text) as Partial<ApiErrorBody>;
      if (parsed.error) message = parsed.error;
    } catch {
      // Not JSON; keep the status as the message.
    }
    throw new ApiError(message, method, url, response.status, response.statusText, text);
  }

  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new ApiError("The server sent a response that isn't valid JSON.", method, url, response.status, response.statusText, text, error);
  }
}

/** Changes send this page's connection id, so the server doesn't notify this page about them. */
const changeHeaders = () => ({ [CONNECTION_ID_HEADER]: connectionId });

export const api = {
  getNotes: () => request<NotesData>("GET", "/api/notes"),
  addNote: (body: NewNoteRequest) => request<Note>("POST", "/api/notes", body, changeHeaders()),
  addCategory: (body: CategoryRequest) => request<Category>("POST", "/api/categories", body, changeHeaders()),
  updateCategory: (id: number, body: CategoryRequest) =>
    request<Category>("PUT", `/api/categories/${id}`, body, changeHeaders()),
  login: (body: LoginRequest) => request<{ ok: true }>("POST", "/api/login", body),
  logout: () => request<{ ok: true }>("POST", "/api/logout"),
};
