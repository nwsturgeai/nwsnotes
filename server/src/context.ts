import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Who a request (or a texted note) is acting for, kept for everything it starts. A notebook uses it to
 * mark changes made by someone else (a user a tag is shared with) as "by <name>" in its History, and to
 * leave out that person's page (`senderId`) when telling other pages to reload.
 */
export interface ActingUser {
  userId: number;
  displayName: string;
  /** The page that sent the request (the live-updates connection id), if it said. */
  senderId?: string;
}

export const actingUser = new AsyncLocalStorage<ActingUser>();
