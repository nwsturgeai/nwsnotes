import { AsyncLocalStorage } from "node:async_hooks";
import type { MadeChange } from "@nwsnotes/shared";

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
  /**
   * The History changes this request has made so far (a request's own context only): sent back in the
   * CHANGES_HEADER, so the notes page can offer to undo them.
   */
  madeChanges?: MadeChange[];
}

export const actingUser = new AsyncLocalStorage<ActingUser>();
