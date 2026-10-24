import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { LIVE_UPDATES_PATH, type LiveMessage } from "@nwsnotes/shared";
import { SESSION_COOKIE, isValidSessionToken, readCookie } from "./auth.js";

const PING_INTERVAL_MS = 30_000;

/**
 * Live updates: each open website keeps a WebSocket to /ws. When one page changes
 * the notes, every other page is told to reload them.
 */
export class LiveUpdates {
  private readonly wss = new WebSocketServer({ noServer: true });
  /** Open connections, with the connection id each page sent and whether it answered the last ping. */
  private readonly clients = new Map<WebSocket, { id: string | undefined; alive: boolean }>();

  constructor(private readonly sessionSecret: string) {
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
    if (!isValidSessionToken(readCookie(req, SESSION_COOKIE), this.sessionSecret)) {
      refuse(socket, 401, "Unauthorized");
      return;
    }
    const id = url.searchParams.get("id") || undefined;
    this.wss.handleUpgrade(req, socket, head, (ws) => this.add(ws, id));
  };

  /** Tells every page except the one that made the change to reload the notes. */
  notifyChanged(senderId: string | undefined): void {
    const message: LiveMessage = { type: "data-changed" };
    const text = JSON.stringify(message);
    for (const [ws, client] of this.clients) {
      if (senderId && client.id === senderId) continue;
      if (ws.readyState === ws.OPEN) ws.send(text);
    }
  }

  private add(ws: WebSocket, id: string | undefined): void {
    this.clients.set(ws, { id, alive: true });
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
