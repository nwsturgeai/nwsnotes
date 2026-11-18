import type { Category, HistoryChange, Note, Tab } from "@nwsnotes/shared";
import type { Db, Query } from "./db.js";

/*
 * The database's tables, and writing a change with its history. Each note, category and tab is stored
 * as JSON in exactly the shape the API uses; categories and tabs also have their position (their order).
 * The history keeps, for every change, each item it touched as it was *before* the change, so going
 * back only needs the changes being undone.
 */

/** Everything the store keeps. */
export interface Snapshot {
  notes: Note[];
  categories: Category[];
  tabs: Tab[];
  lastNoteId: number;
}

type Kind = "note" | "category" | "tab";

/** An item as stored in the history: a note's JSON, or a category's or tab's position and JSON. */
type Copy = Note | { position: number; data: Category | Tab };

/** One history entry, as the API sends it. */
export type ChangeSummary = HistoryChange;

/** What a change says about itself; without one, a save isn't in the history (e.g. a reminder being sent). */
export interface ChangeRecord {
  summary: string;
  revertedTo?: string;
  undone?: number;
}

const SCHEMA = [
  "CREATE SCHEMA IF NOT EXISTS nwsnotes",
  "CREATE TABLE IF NOT EXISTS nwsnotes.notes (id integer PRIMARY KEY, data jsonb NOT NULL)",
  "CREATE TABLE IF NOT EXISTS nwsnotes.categories (id integer PRIMARY KEY, position integer NOT NULL, data jsonb NOT NULL)",
  "CREATE TABLE IF NOT EXISTS nwsnotes.tabs (id integer PRIMARY KEY, position integer NOT NULL, data jsonb NOT NULL)",
  "CREATE TABLE IF NOT EXISTS nwsnotes.meta (name text PRIMARY KEY, value jsonb NOT NULL)",
  `CREATE TABLE IF NOT EXISTS nwsnotes.changes (
     id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
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
];

/** Creates the schema and tables if they don't exist yet. */
export async function ensureSchema(db: Db): Promise<void> {
  for (const sql of SCHEMA) await db.query(sql);
}

/** Everything in the database, or undefined if it has no data yet (it's never been given any). */
export async function loadSnapshot(db: Db): Promise<Snapshot | undefined> {
  const meta = await db.query<{ value: unknown }>("SELECT value FROM nwsnotes.meta WHERE name = 'lastNoteId'");
  if (meta.length === 0) return undefined;
  const notes = await db.query<{ data: Note }>("SELECT data FROM nwsnotes.notes ORDER BY id");
  const categories = await db.query<{ data: Category }>("SELECT data FROM nwsnotes.categories ORDER BY position, id");
  const tabs = await db.query<{ data: Tab }>("SELECT data FROM nwsnotes.tabs ORDER BY position, id");
  return {
    notes: notes.map((row) => row.data),
    categories: categories.map((row) => row.data),
    tabs: tabs.map((row) => row.data),
    lastNoteId: Number(meta[0]!.value),
  };
}

/** End-to-end tests only: deletes everything, history included. */
export async function emptyAll(query: Query): Promise<void> {
  for (const table of ["change_items", "changes", "notes", "categories", "tabs", "meta"]) {
    await query(`DELETE FROM nwsnotes.${table}`);
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
  if (befores.length === 0 && before.lastNoteId === after.lastNoteId) return joinChangeId;

  return db.transaction(async (query) => {
    for (const [table, changes] of Object.entries(tables)) {
      if (changes.deletes.length > 0) {
        await query(`DELETE FROM nwsnotes.${table} WHERE id IN (SELECT (jsonb_array_elements_text($1::jsonb))::int)`, [
          JSON.stringify(changes.deletes),
        ]);
      }
      if (changes.upserts.length === 0) continue;
      const rows = JSON.stringify(changes.upserts);
      if (table === "notes") {
        await query(
          `INSERT INTO nwsnotes.notes (id, data)
           SELECT (e->>'id')::int, e->'data' FROM jsonb_array_elements($1::jsonb) e
           ON CONFLICT (id) DO UPDATE SET data = excluded.data`,
          [rows],
        );
      } else {
        await query(
          `INSERT INTO nwsnotes.${table} (id, position, data)
           SELECT (e->>'id')::int, (e->>'position')::int, e->'data' FROM jsonb_array_elements($1::jsonb) e
           ON CONFLICT (id) DO UPDATE SET position = excluded.position, data = excluded.data`,
          [rows],
        );
      }
    }
    if (before.lastNoteId !== after.lastNoteId) {
      await query(
        `INSERT INTO nwsnotes.meta (name, value) VALUES ('lastNoteId', $1::jsonb)
         ON CONFLICT (name) DO UPDATE SET value = excluded.value`,
        [JSON.stringify(after.lastNoteId)],
      );
    }

    if (joinChangeId !== undefined) {
      await query("UPDATE nwsnotes.changes SET time = $1 WHERE id = $2", [time.toISOString(), joinChangeId]);
      return joinChangeId;
    }
    if (!record || befores.length === 0) return undefined;
    const [change] = await query<{ id: number }>(
      `INSERT INTO nwsnotes.changes (time, summary, item_count, reverted_to, undone) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [time.toISOString(), record.summary, befores.length, record.revertedTo ?? null, record.undone ?? null],
    );
    await query(
      `INSERT INTO nwsnotes.change_items (change_id, kind, item_id, "before")
       SELECT $1, e->>'kind', (e->>'id')::int, e->'before' FROM jsonb_array_elements($2::jsonb) e`,
      [change!.id, JSON.stringify(befores)],
    );
    return change!.id;
  });
}

/** The newest changes (older than `beforeId`, if given), newest first, and whether there are more. */
export async function listChanges(db: Db, beforeId: number | undefined, limit: number): Promise<{ changes: ChangeSummary[]; more: boolean }> {
  const rows = await db.query<{
    id: number;
    time: Date | string;
    summary: string;
    item_count: number;
    reverted_to: Date | string | null;
    undone: number | null;
  }>(
    `SELECT id, time, summary, item_count, reverted_to, undone FROM nwsnotes.changes
     WHERE $1::int IS NULL OR id < $1::int ORDER BY id DESC LIMIT $2`,
    [beforeId ?? null, limit + 1],
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
export async function revertedSnapshot(db: Db, toId: number, current: Snapshot): Promise<{ time: string; undone: number; snapshot: Snapshot } | undefined> {
  const [target] = await db.query<{ time: Date | string }>("SELECT time FROM nwsnotes.changes WHERE id = $1", [toId]);
  if (!target) return undefined;
  const [{ count } = { count: 0 }] = await db.query<{ count: number }>("SELECT count(*)::int AS count FROM nwsnotes.changes WHERE id > $1", [toId]);
  // For each item, its copy from the earliest change after the target: how it was just after it.
  const items = await db.query<{ kind: Kind; item_id: number; before: Copy | null }>(
    `SELECT DISTINCT ON (kind, item_id) kind, item_id, "before" FROM nwsnotes.change_items
     WHERE change_id > $1 ORDER BY kind, item_id, change_id`,
    [toId],
  );

  const notes = new Map(current.notes.map((note) => [note.id, note]));
  const positioned = {
    category: new Map(current.categories.map((item, position) => [item.id, { position, data: item as Category | Tab }])),
    tab: new Map(current.tabs.map((item, position) => [item.id, { position, data: item as Category | Tab }])),
  };
  for (const item of items) {
    const id = Number(item.item_id);
    if (item.kind === "note") {
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
      tabs: ordered(positioned.tab) as Tab[],
      // Ids are never reused, so this isn't taken back.
      lastNoteId: current.lastNoteId,
    },
  };
}

/** Deletes changes older than `days` days. */
export async function pruneHistory(db: Db, days: number): Promise<number> {
  const rows = await db.query<{ id: number }>(
    "DELETE FROM nwsnotes.changes WHERE time < now() - make_interval(days => $1) RETURNING id",
    [days],
  );
  return rows.length;
}
