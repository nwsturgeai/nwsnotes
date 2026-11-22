import { mergeNoteOrders, type Category, type HistoryChange, type Note, type Tab, type TabPlacement } from "@nwsnotes/shared";
import type { Db, Query } from "./db.js";

/*
 * The database's tables, and writing a change with its history. Each note, category and tab is stored
 * as JSON in exactly the shape the API uses; categories and tabs also have their position (their order).
 * The history keeps, for every change, each item it touched as it was *before* the change, so going
 * back only needs the changes being undone.
 */

/** The most changes kept in each user's history (besides only keeping HISTORY_DAYS' worth). */
export const HISTORY_MAX_CHANGES = 500;

/** Everything the store keeps. */
export interface Snapshot {
  notes: Note[];
  categories: Category[];
  tabs: Tab[];
  lastNoteId: number;
  /** Where the built-in "All" tab shows. */
  allTabPlacement: TabPlacement;
  /** The shared order of the notes (every tab's, "All" included). */
  noteOrder: number[];
}

/** "setting": a small setting such as the All tab's placement (item id 1) or the note order (2), kept in `meta`. */
type Kind = "note" | "category" | "tab" | "setting";

/** The settings kept in `meta` that the history covers, with their item ids. */
const ALL_TAB_PLACEMENT_ID = 1;
const NOTE_ORDER_ID = 2;

/** Tabs once kept their own note order (`noteOrder`); it's no longer part of a tab. */
export function withoutNoteOrder(tab: Tab): Tab {
  if (!("noteOrder" in tab)) return tab;
  const { noteOrder: _old, ...rest } = tab as Tab & { noteOrder?: unknown };
  return rest;
}

/** The note ids in tabs' old `noteOrder`s, one list per tab, in the tabs' order. */
export function oldTabOrders(tabs: Tab[]): number[][] {
  return tabs.map((tab) => {
    const order = (tab as { noteOrder?: unknown }).noteOrder;
    return Array.isArray(order) ? order.filter((id): id is number => Number.isInteger(id)) : [];
  });
}

/** A stored note order, keeping only whole numbers. */
function readOrder(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((id): id is number => Number.isInteger(id)) : [];
}

/** An item as stored in the history: a note's JSON, or a category's or tab's position and JSON. */
type Copy = Note | { position: number; data: Category | Tab } | { value: unknown };

/** One history entry, as the API sends it. */
export type ChangeSummary = HistoryChange;

/** What a change says about itself; without one, a save isn't in the history (e.g. a reminder being sent). */
export interface ChangeRecord {
  summary: string;
  revertedTo?: string;
  undone?: number;
}

/** The tables, as they are now: every notebook's rows carry their user's id. */
const TABLES = [
  "CREATE TABLE IF NOT EXISTS nwsnotes.notes (user_id integer NOT NULL, id integer NOT NULL, data jsonb NOT NULL, PRIMARY KEY (user_id, id))",
  `CREATE TABLE IF NOT EXISTS nwsnotes.categories (
     user_id integer NOT NULL, id integer NOT NULL, position integer NOT NULL, data jsonb NOT NULL, PRIMARY KEY (user_id, id)
   )`,
  `CREATE TABLE IF NOT EXISTS nwsnotes.tabs (
     user_id integer NOT NULL, id integer NOT NULL, position integer NOT NULL, data jsonb NOT NULL, PRIMARY KEY (user_id, id)
   )`,
  "CREATE TABLE IF NOT EXISTS nwsnotes.meta (user_id integer NOT NULL, name text NOT NULL, value jsonb NOT NULL, PRIMARY KEY (user_id, name))",
  `CREATE TABLE IF NOT EXISTS nwsnotes.changes (
     id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
     user_id integer NOT NULL,
     time timestamptz NOT NULL,
     summary text NOT NULL,
     item_count integer NOT NULL,
     reverted_to timestamptz,
     undone integer
   )`,
  `CREATE TABLE IF NOT EXISTS nwsnotes.change_items (
     change_id integer NOT NULL REFERENCES nwsnotes.changes (id) ON DELETE CASCADE,
     kind text NOT NULL,
     item_id integer NOT NULL,
     "before" jsonb,
     PRIMARY KEY (change_id, kind, item_id)
   )`,
  "CREATE INDEX IF NOT EXISTS changes_time ON nwsnotes.changes (time)",
  "CREATE INDEX IF NOT EXISTS changes_user ON nwsnotes.changes (user_id, id)",
];

/** The users: `data` holds everything apart from the id and login name (see users.ts). */
const USERS_TABLE = [
  "CREATE TABLE IF NOT EXISTS nwsnotes.users (id integer PRIMARY KEY, login_name text NOT NULL, data jsonb NOT NULL)",
  "CREATE UNIQUE INDEX IF NOT EXISTS users_login_name ON nwsnotes.users (lower(login_name))",
  // People who asked for an account on the sign-up page, until an admin confirms (they become users) or declines.
  "CREATE TABLE IF NOT EXISTS nwsnotes.account_requests (id integer PRIMARY KEY, login_name text NOT NULL, data jsonb NOT NULL)",
  "CREATE UNIQUE INDEX IF NOT EXISTS account_requests_login_name ON nwsnotes.account_requests (lower(login_name))",
];

/**
 * Creates the schema and tables if they don't exist yet, and with `firstUser` makes user 1 when there
 * are no users yet, all in one transaction.
 */
export async function ensureSchema(db: Db, firstUser: (query: Query) => Promise<void>): Promise<void> {
  await db.query("CREATE SCHEMA IF NOT EXISTS nwsnotes");
  await db.transaction(async (query) => {
    for (const sql of USERS_TABLE) await query(sql);
    for (const sql of TABLES) await query(sql);
    const [{ count } = { count: 0 }] = await query<{ count: number }>("SELECT count(*)::int AS count FROM nwsnotes.users");
    if (Number(count) === 0) await firstUser(query);
  });
}

/**
 * Everything in the database, or undefined if it has no data yet (it's never been given any). With
 * `stored`, when the data is from before the note order was shared: as it is in the database (tabs with
 * their own orders), for saving the shared order made from them.
 */
export async function loadSnapshot(db: Db, userId: number): Promise<{ snapshot: Snapshot; stored?: Snapshot } | undefined> {
  const metaValue = (name: string) =>
    db.query<{ value: unknown }>("SELECT value FROM nwsnotes.meta WHERE user_id = $1 AND name = $2", [userId, name]);
  const meta = await metaValue("lastNoteId");
  if (meta.length === 0) return undefined;
  const [placement] = await metaValue("allTabPlacement");
  const [order] = await metaValue("noteOrder");
  const notes = await db.query<{ data: Note }>("SELECT data FROM nwsnotes.notes WHERE user_id = $1 ORDER BY id", [userId]);
  const categories = await db.query<{ data: Category }>("SELECT data FROM nwsnotes.categories WHERE user_id = $1 ORDER BY position, id", [userId]);
  const tabs = await db.query<{ data: Tab }>("SELECT data FROM nwsnotes.tabs WHERE user_id = $1 ORDER BY position, id", [userId]);
  const snapshot: Snapshot = {
    notes: notes.map((row) => row.data),
    categories: categories.map((row) => row.data),
    tabs: tabs.map((row) => withoutNoteOrder(row.data)),
    lastNoteId: Number(meta[0]!.value),
    allTabPlacement: placement?.value === "left" ? "left" : "top",
    noteOrder: readOrder(order?.value),
  };
  if (order) return { snapshot };
  // From before the order was shared: make it from the tabs' own orders (the higher tab wins).
  const ids = new Set(snapshot.notes.map((note) => note.id));
  const stored: Snapshot = { ...snapshot, tabs: tabs.map((row) => row.data), noteOrder: [] };
  return {
    snapshot: { ...snapshot, noteOrder: mergeNoteOrders(oldTabOrders(stored.tabs)).filter((id) => ids.has(id)) },
    stored,
  };
}

/** Deletes one user's whole notebook, history included (their change items go with their changes). */
export async function emptyNotebook(query: Query, userId: number): Promise<void> {
  for (const table of ["changes", "notes", "categories", "tabs", "meta"]) {
    await query(`DELETE FROM nwsnotes.${table} WHERE user_id = $1`, [userId]);
  }
}

/** One table's differences: rows to write, ids to delete, and the changed items' "before" copies. */
interface TableDiff {
  upserts: { id: number; position: number; data: unknown }[];
  deletes: number[];
  befores: { kind: Kind; id: number; before: Copy | null }[];
}

function diff<T extends { id: number }>(kind: Kind, before: T[], after: T[], positioned: boolean): TableDiff {
  const result: TableDiff = { upserts: [], deletes: [], befores: [] };
  const old = new Map(before.map((item, position) => [item.id, { item, position }]));
  const copy = (item: T, position: number): Copy => (positioned ? { position, data: item as unknown as Category } : (item as unknown as Note));
  after.forEach((item, position) => {
    const previous = old.get(item.id);
    old.delete(item.id);
    const same = previous && JSON.stringify(previous.item) === JSON.stringify(item) && (!positioned || previous.position === position);
    if (same) return;
    result.upserts.push({ id: item.id, position, data: item });
    result.befores.push({ kind, id: item.id, before: previous ? copy(previous.item, previous.position) : null });
  });
  for (const [id, { item, position }] of old) {
    result.deletes.push(id);
    result.befores.push({ kind, id, before: copy(item, position) });
  }
  return result;
}

/**
 * Writes the change from `before` to `after` in one transaction: only the rows that differ, and (with a
 * `record`) a history entry holding each changed item's "before" copy. With `joinChangeId`, it joins that
 * earlier change instead (a long-form note's autosave): the change's time is updated, and nothing more is
 * kept, since that change already has the note's earlier copy. Returns the change's id, if there is one.
 */
export async function writeChange(
  db: Db,
  userId: number,
  before: Snapshot,
  after: Snapshot,
  time: Date,
  record: ChangeRecord | undefined,
  joinChangeId?: number,
): Promise<number | undefined> {
  const tables = {
    notes: diff("note", before.notes, after.notes, false),
    categories: diff("category", before.categories, after.categories, true),
    tabs: diff("tab", before.tabs, after.tabs, true),
  };
  const befores = Object.values(tables).flatMap((table) => table.befores);
  const placementChanged = before.allTabPlacement !== after.allTabPlacement;
  if (placementChanged) befores.push({ kind: "setting", id: ALL_TAB_PLACEMENT_ID, before: { value: before.allTabPlacement } });
  // Written whenever it differs, or isn't stored yet (`stored` from loadSnapshot has an empty one).
  const orderChanged = JSON.stringify(before.noteOrder) !== JSON.stringify(after.noteOrder);
  if (orderChanged) befores.push({ kind: "setting", id: NOTE_ORDER_ID, before: { value: before.noteOrder } });
  if (befores.length === 0 && before.lastNoteId === after.lastNoteId) return joinChangeId;

  return db.transaction(async (query) => {
    for (const [table, changes] of Object.entries(tables)) {
      if (changes.deletes.length > 0) {
        await query(`DELETE FROM nwsnotes.${table} WHERE user_id = $2 AND id IN (SELECT (jsonb_array_elements_text($1::jsonb))::int)`, [
          JSON.stringify(changes.deletes),
          userId,
        ]);
      }
      if (changes.upserts.length === 0) continue;
      const rows = JSON.stringify(changes.upserts);
      if (table === "notes") {
        await query(
          `INSERT INTO nwsnotes.notes (user_id, id, data)
           SELECT $2, (e->>'id')::int, e->'data' FROM jsonb_array_elements($1::jsonb) e
           ON CONFLICT (user_id, id) DO UPDATE SET data = excluded.data`,
          [rows, userId],
        );
      } else {
        await query(
          `INSERT INTO nwsnotes.${table} (user_id, id, position, data)
           SELECT $2, (e->>'id')::int, (e->>'position')::int, e->'data' FROM jsonb_array_elements($1::jsonb) e
           ON CONFLICT (user_id, id) DO UPDATE SET position = excluded.position, data = excluded.data`,
          [rows, userId],
        );
      }
    }
    if (before.lastNoteId !== after.lastNoteId) {
      await query(
        `INSERT INTO nwsnotes.meta (user_id, name, value) VALUES ($2, 'lastNoteId', $1::jsonb)
         ON CONFLICT (user_id, name) DO UPDATE SET value = excluded.value`,
        [JSON.stringify(after.lastNoteId), userId],
      );
    }

    if (placementChanged) {
      await query(
        `INSERT INTO nwsnotes.meta (user_id, name, value) VALUES ($2, 'allTabPlacement', $1::jsonb)
         ON CONFLICT (user_id, name) DO UPDATE SET value = excluded.value`,
        [JSON.stringify(after.allTabPlacement), userId],
      );
    }

    if (orderChanged) {
      await query(
        `INSERT INTO nwsnotes.meta (user_id, name, value) VALUES ($2, 'noteOrder', $1::jsonb)
         ON CONFLICT (user_id, name) DO UPDATE SET value = excluded.value`,
        [JSON.stringify(after.noteOrder), userId],
      );
    }

    if (joinChangeId !== undefined) {
      await query("UPDATE nwsnotes.changes SET time = $1 WHERE id = $2 AND user_id = $3", [time.toISOString(), joinChangeId, userId]);
      return joinChangeId;
    }
    if (!record || befores.length === 0) return undefined;
    const [change] = await query<{ id: number }>(
      `INSERT INTO nwsnotes.changes (user_id, time, summary, item_count, reverted_to, undone) VALUES ($6, $1, $2, $3, $4, $5) RETURNING id`,
      [time.toISOString(), record.summary, befores.length, record.revertedTo ?? null, record.undone ?? null, userId],
    );
    await query(
      `INSERT INTO nwsnotes.change_items (change_id, kind, item_id, "before")
       SELECT $1, e->>'kind', (e->>'id')::int, e->'before' FROM jsonb_array_elements($2::jsonb) e`,
      [change!.id, JSON.stringify(befores)],
    );
    // Only the newest HISTORY_MAX_CHANGES are kept: older ones go (and their items with them). Going back
    // only uses changes after the one gone back to, so every change still listed can still be gone back to.
    await query(
      `DELETE FROM nwsnotes.changes WHERE user_id = $1 AND id <= (
         SELECT id FROM nwsnotes.changes WHERE user_id = $1 ORDER BY id DESC OFFSET $2 LIMIT 1
       )`,
      [userId, HISTORY_MAX_CHANGES],
    );
    return change!.id;
  });
}

/** The newest changes (older than `beforeId`, if given), newest first, and whether there are more. */
export async function listChanges(db: Db, userId: number, beforeId: number | undefined, limit: number): Promise<{ changes: ChangeSummary[]; more: boolean }> {
  const rows = await db.query<{
    id: number;
    time: Date | string;
    summary: string;
    item_count: number;
    reverted_to: Date | string | null;
    undone: number | null;
  }>(
    `SELECT id, time, summary, item_count, reverted_to, undone FROM nwsnotes.changes
     WHERE user_id = $3 AND ($1::int IS NULL OR id < $1::int) ORDER BY id DESC LIMIT $2`,
    [beforeId ?? null, limit + 1, userId],
  );
  return {
    changes: rows.slice(0, limit).map((row) => ({
      id: Number(row.id),
      time: new Date(row.time).toISOString(),
      summary: row.summary,
      itemCount: Number(row.item_count),
      ...(row.reverted_to !== null && { revertedTo: new Date(row.reverted_to).toISOString() }),
      ...(row.undone !== null && { undone: Number(row.undone) }),
    })),
    more: rows.length > limit,
  };
}

/**
 * Going back to just after change `toId`: that change's time, how many later changes there are, and
 * `after` (the snapshot) with every item they touched put back as it was then.
 */
export async function revertedSnapshot(db: Db, userId: number, toId: number, current: Snapshot): Promise<{ time: string; undone: number; snapshot: Snapshot } | undefined> {
  const [target] = await db.query<{ time: Date | string }>("SELECT time FROM nwsnotes.changes WHERE id = $1 AND user_id = $2", [toId, userId]);
  if (!target) return undefined;
  const [{ count } = { count: 0 }] = await db.query<{ count: number }>("SELECT count(*)::int AS count FROM nwsnotes.changes WHERE id > $1 AND user_id = $2",
    [toId, userId],
  );
  // For each item, its copy from the earliest change after the target: how it was just after it.
  const items = await db.query<{ kind: Kind; item_id: number; before: Copy | null }>(
    `SELECT DISTINCT ON (kind, item_id) kind, item_id, "before" FROM nwsnotes.change_items
     WHERE change_id IN (SELECT id FROM nwsnotes.changes WHERE id > $1 AND user_id = $2) ORDER BY kind, item_id, change_id`,
    [toId, userId],
  );

  const notes = new Map(current.notes.map((note) => [note.id, note]));
  const positioned = {
    category: new Map(current.categories.map((item, position) => [item.id, { position, data: item as Category | Tab }])),
    tab: new Map(current.tabs.map((item, position) => [item.id, { position, data: item as Category | Tab }])),
  };
  let allTabPlacement = current.allTabPlacement;
  let noteOrder = current.noteOrder;
  for (const item of items) {
    const id = Number(item.item_id);
    if (item.kind === "setting") {
      if (id === ALL_TAB_PLACEMENT_ID) allTabPlacement = (item.before as { value: unknown } | null)?.value === "left" ? "left" : "top";
      else if (id === NOTE_ORDER_ID) noteOrder = readOrder((item.before as { value: unknown } | null)?.value);
    } else if (item.kind === "note") {
      if (item.before === null) notes.delete(id);
      else notes.set(id, item.before as Note);
    } else {
      const table = positioned[item.kind];
      if (item.before === null) table.delete(id);
      else table.set(id, item.before as { position: number; data: Category | Tab });
    }
  }
  const ordered = (table: Map<number, { position: number; data: Category | Tab }>) =>
    [...table.values()].sort((a, b) => a.position - b.position).map((entry) => entry.data);
  return {
    time: new Date(target.time).toISOString(),
    undone: Number(count),
    snapshot: {
      notes: [...notes.values()].sort((a, b) => a.id - b.id),
      categories: ordered(positioned.category) as Category[],
      // Tabs from before the order was shared come back without their own order.
      tabs: (ordered(positioned.tab) as Tab[]).map(withoutNoteOrder),
      // Ids are never reused, so this isn't taken back.
      lastNoteId: current.lastNoteId,
      allTabPlacement,
      // Notes that have gone (going back to before they were added) are left out.
      noteOrder: noteOrder.filter((id) => notes.has(id)),
    },
  };
}

/** Deletes every user's changes older than `days` days. */
export async function pruneHistory(db: Db, days: number): Promise<number> {
  const rows = await db.query<{ id: number }>(
    "DELETE FROM nwsnotes.changes WHERE time < now() - make_interval(days => $1) RETURNING id",
    [days],
  );
  return rows.length;
}

