import {
  CONNECTION_ID_HEADER,
  type ApiErrorBody,
  type BulkTagsRequest,
  type Category,
  type CategoryRequest,
  type LifetimeChange,
  type LoginRequest,
  type NewNoteRequest,
  type Note,
  type NotesData,
  type Tab,
  type TabOrderRequest,
  type TabRequest,
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

  /**
   * The server couldn't be reached (no connection, or no reply in time), or the proxy in front of it
   * says it's down (502, 503, 504): the app is offline.
   */
  get isNetworkError(): boolean {
    return this.status === undefined || this.status === 502 || this.status === 503 || this.status === 504;
  }
}

/** A change, or a ping, with no reply in this long counts as the server being unreachable. */
const CHANGE_TIMEOUT_MS = 10_000;

async function request<T>(method: string, url: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<T> {
  const headers: Record<string, string> = { ...extraHeaders };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  // Loading every note can take a while on a slow connection, so only changes and pings time out.
  const timesOut = method !== "GET" || url === PING_URL;
  const controller = new AbortController();
  const timer = timesOut ? window.setTimeout(() => controller.abort(), CHANGE_TIMEOUT_MS) : undefined;
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      credentials: "same-origin",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    const reason = controller.signal.aborted ? "no reply in time" : error instanceof Error ? error.message : String(error);
    throw new ApiError(`Couldn't reach the server (${reason}).`, method, url, undefined, undefined, undefined, error);
  } finally {
    window.clearTimeout(timer);
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

const PING_URL = "/api/notes/ping";

/**
 * The server API. The note changes here always go to the server; the notes page and long-form editor
 * make them through `offline.ts` instead, which queues them while offline.
 */
export const api = {
  getNotes: () => request<NotesData>("GET", "/api/notes"),
  /** Whether the server can be reached (and the session is still valid), without loading every note. */
  ping: () => request<{ ok: true }>("GET", PING_URL),
  addNote: (body: NewNoteRequest) => request<Note>("POST", "/api/notes", body, changeHeaders()),
  updateNote: (id: number, body: NewNoteRequest) => request<Note>("PUT", `/api/notes/${id}`, body, changeHeaders()),
  deleteNote: (id: number) => request<{ ok: true }>("DELETE", `/api/notes/${id}`, undefined, changeHeaders()),
  /** Multi-select: add and remove tags on several notes in one save; returns the updated notes. */
  bulkTags: (body: BulkTagsRequest) => request<Note[]>("PUT", "/api/notes/bulk-tags", body, changeHeaders()),
  setLifetime: (id: number, lifetime: LifetimeChange) =>
    request<Note>("PUT", `/api/notes/${id}/lifetime`, { lifetime }, changeHeaders()),
  /** The Settings Lifetime buttons; each returns how many notes changed (or were deleted). */
  bulkLifetime: (action: "reset-new" | "archived-to-bin" | "empty-bin") =>
    request<{ count: number }>("POST", `/api/notes/${action}`, undefined, changeHeaders()),
  addCategory: (body: CategoryRequest) => request<Category>("POST", "/api/categories", body, changeHeaders()),
  updateCategory: (id: number, body: CategoryRequest) =>
    request<Category>("PUT", `/api/categories/${id}`, body, changeHeaders()),
  /** The user categories' order (every id, once each); returns all categories, Lifetime last. */
  reorderCategories: (ids: number[]) => request<Category[]>("PUT", "/api/categories/order", { ids }, changeHeaders()),
  /** The tabs' order (every id, once each). */
  reorderTabs: (ids: number[]) => request<Tab[]>("PUT", "/api/tabs/order", { ids }, changeHeaders()),
  addTab: (body: TabRequest) => request<Tab>("POST", "/api/tabs", body, changeHeaders()),
  updateTab: (id: number, body: TabRequest) => request<Tab>("PUT", `/api/tabs/${id}`, body, changeHeaders()),
  setTabOrder: (id: number, body: TabOrderRequest) => request<Tab>("PUT", `/api/tabs/${id}/order`, body, changeHeaders()),
  deleteTab: (id: number) => request<{ ok: true }>("DELETE", `/api/tabs/${id}`, undefined, changeHeaders()),
  login: (body: LoginRequest) => request<{ ok: true }>("POST", "/api/login", body),
  logout: () => request<{ ok: true }>("POST", "/api/logout"),
};
