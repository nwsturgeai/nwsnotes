import {
  CONNECTION_ID_HEADER,
  NOTE_CHANGED_STATUS,
  USER_ID_HEADER,
  type AccountRequest,
  type AccountRequestBody,
  type AllTabRequest,
  type ApiErrorBody,
  type BulkTagsRequest,
  type Category,
  type CategoryRequest,
  type HistoryPage,
  type LifetimeChange,
  type LifetimeRequest,
  type TabMoveRequest,
  type LoginRequest,
  type Me,
  type NewUserRequest,
  type PasswordChangeRequest,
  type EmailChangeLink,
  type ShareInviteLink,
  type EmailChangeRequest,
  type NameChangeRequest,
  type PasswordResetConfirmRequest,
  type PasswordResetRequest,
  type ServerLogEntry,
  type UserSummary,
  type UserUpdateRequest,
  type NewNoteRequest,
  type Note,
  type NotesData,
  type Tab,
  type NoteOrderRequest,
  type NoteStats,
  type SmsLinkCode,
  type SmsStatus,
  type TabRequest,
  type SharedTagsRequest,
  type SharePerson,
  type TagShare,
  type TagSharesRequest,
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

  /** A note edit refused because the note changed elsewhere since the edit started (see baseModifiedDateTime). */
  get isNoteChanged(): boolean {
    return this.status === NOTE_CHANGED_STATUS;
  }

  /** 401: not logged in (the session expired, this user's logins were stopped, or another tab logged in as someone else). */
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

/** Who this page is showing, once it knows: sent with every request (see USER_ID_HEADER). */
let pageUserId: number | undefined;

/** Who this page now shows (undefined: nobody, e.g. after logging out). Set by `offline.ts`, which keeps each user's copy apart. */
export function setPageUser(id: number | undefined) {
  pageUserId = id;
}

async function request<T>(method: string, url: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<T> {
  const headers: Record<string, string> = { ...extraHeaders };
  if (pageUserId !== undefined) headers[USER_ID_HEADER] = String(pageUserId);
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

  // An answer with nothing to say (204).
  if (text === "") return undefined as T;
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
  /** `base`: the note's lastModifiedDateTime when the edit started; refused (isNoteChanged) if it has changed since. */
  updateNote: (id: number, body: NewNoteRequest, base?: string) =>
    request<Note>("PUT", `/api/notes/${id}`, { ...body, ...(base !== undefined && { baseModifiedDateTime: base }) }, changeHeaders()),
  deleteNote: (id: number) => request<{ ok: true }>("DELETE", `/api/notes/${id}`, undefined, changeHeaders()),
  /** Multi-select: add and remove tags on several notes in one save; returns the updated notes. */
  bulkTags: (body: BulkTagsRequest) => request<Note[]>("PUT", "/api/notes/bulk-tags", body, changeHeaders()),
  /** Edit-order mode: a note dragged onto another tab gets that tab's tags (refused, isNoteChanged, if it has changed since `base`). */
  moveNoteToTab: (id: number, body: TabMoveRequest) => request<Note>("PUT", `/api/notes/${id}/tab-move`, body, changeHeaders()),
  /** `tagsChangedDateTime`: only for a change made offline, the time it was made. */
  setLifetime: (id: number, lifetime: LifetimeChange, tagsChangedDateTime?: string) =>
    request<Note>(
      "PUT",
      `/api/notes/${id}/lifetime`,
      { lifetime, ...(tagsChangedDateTime && { tagsChangedDateTime }) } satisfies LifetimeRequest,
      changeHeaders(),
    ),
  /**
   * The Settings Lifetime buttons, and edit-order mode's (with `noteIds`: only those notes); each
   * returns how many notes changed (or were deleted).
   */
  bulkLifetime: (action: "reset-new" | "archived-to-bin" | "waiting-to-archived" | "empty-bin", noteIds?: number[]) =>
    request<{ count: number }>("POST", `/api/notes/${action}`, noteIds && { noteIds }, changeHeaders()),
  addCategory: (body: CategoryRequest) => request<Category>("POST", "/api/categories", body, changeHeaders()),
  updateCategory: (id: number, body: CategoryRequest) =>
    request<Category>("PUT", `/api/categories/${id}`, body, changeHeaders()),
  /** The user categories' order (every id, once each); returns all categories, Lifetime last. */
  tagShares: (tagId: number) => request<TagShare[]>("GET", `/api/tags/${tagId}/shares`),
  setTagShares: (tagId: number, body: TagSharesRequest) => request<TagShare[]>("PUT", `/api/tags/${tagId}/shares`, body, changeHeaders()),
  sharePeople: () => request<SharePerson[]>("GET", "/api/shares/people"),
  setSharedTags: (body: SharedTagsRequest) => request<Category | null>("PUT", "/api/shared-tags", body, changeHeaders()),
  /** Stops seeing a tag shared with you (its owner is emailed). */
  leaveSharedTag: (tagId: number) => request<{ ok: true }>("DELETE", `/api/shared-tags/${tagId}`, undefined, changeHeaders()),
  reorderCategories: (ids: number[]) => request<Category[]>("PUT", "/api/categories/order", { ids }, changeHeaders()),
  /** The tabs' order (every id, once each). */
  reorderTabs: (ids: number[]) => request<Tab[]>("PUT", "/api/tabs/order", { ids }, changeHeaders()),
  addTab: (body: TabRequest) => request<Tab>("POST", "/api/tabs", body, changeHeaders()),
  updateTab: (id: number, body: TabRequest) => request<Tab>("PUT", `/api/tabs/${id}`, body, changeHeaders()),
  setAllTabPlacement: (body: AllTabRequest) => request<AllTabRequest>("PUT", "/api/tabs/all", body, changeHeaders()),
  setNoteOrder: (body: NoteOrderRequest) => request<NoteOrderRequest>("PUT", "/api/notes/order", body, changeHeaders()),
  deleteTab: (id: number) => request<{ ok: true }>("DELETE", `/api/tabs/${id}`, undefined, changeHeaders()),
  /** Reminders: the server's public push key, and registering or forgetting this device. */
  history: (before?: number) => request<HistoryPage>("GET", `/api/history${before === undefined ? "" : `?before=${before}`}`),
  revert: (toChangeId: number) => request<{ undone: number }>("POST", "/api/history/revert", { toChangeId }, changeHeaders()),

  pushKey: () => request<{ publicKey: string }>("GET", "/api/push/key"),
  pushSubscribe: (subscription: PushSubscriptionJSON) => request<{ ok: true }>("POST", "/api/push/subscribe", subscription),
  pushUnsubscribe: (endpoint: string) => request<{ ok: true }>("POST", "/api/push/unsubscribe", { endpoint }),
  /** Sends "Test reminder" to every device; returns how many it reached. */
  pushTest: () => request<{ count: number }>("POST", "/api/push/test"),
  login: (body: LoginRequest) => {
    // Whoever logs in, this page then finds out who it's showing (api.me) before saying so again.
    setPageUser(undefined);
    return request<{ ok: true }>("POST", "/api/login", body, changeHeaders());
  },
  logout: () => request<{ ok: true }>("POST", "/api/logout", undefined, changeHeaders()),
  /** Who is logged in. */
  me: () => request<Me>("GET", "/api/me"),
  myStats: () => request<NoteStats>("GET", "/api/me/stats"),
  /** Adding notes by text message: whether a phone is linked, a code to link one, and unlinking it. */
  smsStatus: () => request<SmsStatus>("GET", "/api/me/sms"),
  smsLinkCode: () => request<SmsLinkCode>("POST", "/api/me/sms/link-code"),
  smsUnlink: () => request<SmsStatus>("DELETE", "/api/me/sms"),
  /** Changing your own password: this page stays logged in, your other devices are logged out. */
  changePassword: (body: PasswordChangeRequest) => request<{ ok: true }>("PUT", "/api/me/password", body, changeHeaders()),
  changeName: (body: NameChangeRequest) => request<Me>("PUT", "/api/me/name", body, changeHeaders()),
  /** Emails a link to the new email; the change is made once it's opened. Returns the new email as the server took it. */
  askToChangeEmail: (body: EmailChangeRequest) => request<{ loginName: string }>("POST", "/api/me/email", body),
  checkEmailLink: (token: string) => request<EmailChangeLink>("POST", "/api/email-change/check", { token }),
  confirmEmailChange: (token: string) => request<{ loginName: string }>("POST", "/api/email-change/confirm", { token }),
  /** The page a sharing request's emailed link opens. */
  checkShareInvite: (token: string) => request<ShareInviteLink>("POST", "/api/share-invite/check", { token }),
  answerShareInvite: (token: string, accept: boolean) => request<{ ok: true }>("POST", `/api/share-invite/${accept ? "accept" : "decline"}`, { token }),
  /** The users page (admin only). */
  users: (changesSince: Date) => request<UserSummary[]>("GET", `/api/users?changesSince=${encodeURIComponent(changesSince.toISOString())}`),
  /** The whole database's size (bytes), from pg_database_size. */
  databaseSize: () => request<{ bytes: number }>("GET", "/api/users/database-size"),
  addUser: (body: NewUserRequest) => request<{ user: UserSummary; password: string }>("POST", "/api/users", body),
  updateUser: (id: number, body: UserUpdateRequest) => request<UserSummary>("PUT", `/api/users/${id}`, body),
  resetPassword: (id: number) => request<{ password: string }>("POST", `/api/users/${id}/reset-password`),
  /** The public sign-up page: asking for an account, which an admin then confirms. */
  requestAccount: (body: AccountRequestBody) => request<{ ok: true }>("POST", "/api/account-requests", body),
  /** Forgotten passwords (public): asking for the emailed link, checking it, and choosing the new password. */
  askForPasswordLink: (body: PasswordResetRequest) => request<void>("POST", "/api/password-reset", body),
  checkPasswordLink: (token: string) => request<{ loginName: string }>("POST", "/api/password-reset/check", { token }),
  resetPasswordByLink: (body: PasswordResetConfirmRequest) => request<void>("POST", "/api/password-reset/confirm", body),
  /** Account requests waiting to be confirmed (admin only). */
  accountRequests: () => request<AccountRequest[]>("GET", "/api/users/requests"),
  /** Makes the user; `emailed` says whether they were emailed that it's ready. */
  confirmAccountRequest: (id: number) => request<{ user: UserSummary; emailed: boolean }>("POST", `/api/users/requests/${id}/confirm`),
  declineAccountRequest: (id: number) => request<{ ok: true }>("DELETE", `/api/users/requests/${id}`),
  /** The server's recent errors and warnings, the most recently seen first (admins only). */
  serverLog: () => request<ServerLogEntry[]>("GET", "/api/server-log"),
  clearServerLog: () => request<{ ok: true }>("DELETE", "/api/server-log"),
};
