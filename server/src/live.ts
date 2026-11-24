import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { LIVE_LOGGED_OUT_CLOSE_CODE, LIVE_UPDATES_PATH, type LiveMessage } from "@nwsnotes/shared";
import { readCookie, SESSION_COOKIE, sessionUser } from "./auth.js";
import type { Users } from "./users.js";

const PING_INTERVAL_MS = 30_000;

/**
 * Live updates: each open website keeps a WebSocket to /ws. When one page changes
 * the notes, every other page of the same user is told to reload them. Each connection belongs to the user
 * whose cookie opened it.
 */
export class LiveUpdates {
  private readonly wss = new WebSocketServer({ noServer: true });
  /**
   * Open connections, with the connection id each page sent, the session cookie that opened it (shared by
   * a browser's tabs) and whether it answered the last ping.
   */
  private readonly clients = new Map<WebSocket, { id: string | undefined; userId: number; session: string | undefined; alive: boolean }>();

  constructor(
    private readonly users: Users,
    private readonly sessionSecret: string,
  ) {
    // Ping regularly so idle connections aren't silently dropped, and close any that stopped answering.
    setInterval(() => this.ping(), PING_INTERVAL_MS).unref();
  }

  /** "upgrade" listener for the HTTP(S) server: accepts or refuses a WebSocket connection. */
  readonly handleUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== LIVE_UPDATES_PATH) {
      refuse(socket, 404, "Not Found");
      return;
    }
    // Browsers send cookies with WebSocket requests from any website, so check where it came from.
    if (!isSameOrigin(req)) {
      refuse(socket, 403, "Forbidden");
      return;
    }
    const user = this.users.isReady() ? sessionUser(req, this.users, this.sessionSecret) : undefined;
    if (!user) {
      refuse(socket, 401, "Unauthorized");
      return;
    }
    const id = url.searchParams.get("id") || undefined;
    const session = readCookie(req, SESSION_COOKIE);
    this.wss.handleUpgrade(req, socket, head, (ws) => this.add(ws, id, user.id, session));
  };

  /** Tells every page of this user, except the one that made the change, to reload the notes. */
  notifyChanged(userId: number, senderId: string | undefined): void {
    const message: LiveMessage = { type: "data-changed" };
    const text = JSON.stringify(message);
    for (const [ws, client] of this.clients) {
      if (client.userId !== userId || (senderId && client.id === senderId)) continue;
      if (ws.readyState === ws.OPEN) ws.send(text);
    }
  }

  /**
   * The user's logins stopped working (turned off, or the session version raised): closes their
   * connections, apart from `exceptId`'s (the page that changed its own password, which has a fresh
   * cookie). The pages then check their session, and show the login page.
   */
  logOut(userId: number, exceptId?: string): void {
    for (const [ws, client] of this.clients) {
      if (client.userId !== userId || (exceptId && client.id === exceptId)) continue;
      ws.close(LIVE_LOGGED_OUT_CLOSE_CODE, "Logged out");
      this.clients.delete(ws);
    }
  }

  /**
   * A browser's session cookie stopped being used there (it logged out, or logged in again, maybe as
   * someone else): closes the connections it opened, i.e. that browser's other tabs, apart from
   * `exceptId`'s. Those pages then check their session, and show the login page if it's not theirs.
   * Other devices, with their own cookies, aren't affected.
   */
  sessionEnded(session: string | undefined, exceptId?: string): void {
    if (!session) return;
    for (const [ws, client] of this.clients) {
      if (client.session !== session || (exceptId && client.id === exceptId)) continue;
      ws.close(LIVE_LOGGED_OUT_CLOSE_CODE, "Logged out");
      this.clients.delete(ws);
    }
  }

  /** End-to-end tests only: closes every connection (the database was replaced). */
  logOutEveryone(): void {
    for (const ws of this.clients.keys()) ws.close(LIVE_LOGGED_OUT_CLOSE_CODE, "Logged out");
    this.clients.clear();
  }

  private add(ws: WebSocket, id: string | undefined, userId: number, session: string | undefined): void {
    this.clients.set(ws, { id, userId, session, alive: true });
    ws.on("pong", () => {
      const client = this.clients.get(ws);
      if (client) client.alive = true;
    });
    ws.on("close", () => this.clients.delete(ws));
    ws.on("error", (error) => console.error("WebSocket error:", error));
  }

  private ping(): void {
    for (const [ws, client] of this.clients) {
      if (!client.alive) {
        ws.terminate();
        continue;
      }
      client.alive = false;
      ws.ping();
    }
  }
}

/** True if the request's Origin header names this same site. */
function isSameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function refuse(socket: Duplex, status: number, text: string): void {
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}
