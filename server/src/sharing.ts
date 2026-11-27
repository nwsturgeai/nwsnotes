import {
  allows,
  higherPermission,
  isLifetimeTag,
  detailsPagesOf,
  isLongForm,
  isValidLoginName,
  lifetimeOf,
  LIFETIME_CATEGORY,
  LIFETIME_NEW,
  LIFETIME_WAITING,
  LIFETIME_ARCHIVED,
  SHARE_PERMISSIONS,
  SHARED_CATEGORY_ID,
  SHARED_CATEGORY_NAME,
  stylusNoteLimitOf,
  tagLabel,
  type Category,
  type Note,
  type NoteDetails,
  type NotesData,
  type NoteTitle,
  type SharePermission,
  type SharePerson,
  type Tab,
  type Tag,
  type TagShare,
} from "@nwsnotes/shared";
import type { Db } from "./db.js";
import { RequestError } from "./errors.js";
import type { Notebooks } from "./notebooks.js";
import type { NoteStore } from "./store.js";
import { noteLimitOf, type User } from "./users.js";

/*
 * Sharing tags (see Specs/sharing.md). An owner shares one of their tags with other users (recipients),
 * each with a permission level. The notes stay in the owner's notebook: a recipient's view of the notes
 * (GET /api/notes) is their own notebook with the owner's notes that have a tag shared with them added,
 * and every change a recipient makes to one of those notes is checked here, then made in the owner's
 * notebook (its History says who made it). Note and tag ids are unique across all users, so the two
 * kinds of notes can sit in one list.
 */

/** One tag shared with one recipient, as stored in the `shares` table. */
interface ShareRow {
  tagId: number;
  recipientId: number;
  ownerId: number;
  permission: SharePermission;
  /** The recipient's own order of the tags shared with them. */
  position: number;
  /** The recipient's own colour for the tag. */
  hue?: number;
  /** Waiting for the recipient to accept it (see `setSharesOfTag`): it gives them nothing until then. */
  pending: boolean;
}

/** A note as the user sees it: their own, or another user's shared with them. */
export type ResolvedNote =
  | { kind: "own"; store: NoteStore; note: Note }
  | { kind: "shared"; store: NoteStore; note: Note; view: Note; owner: User; permission: SharePermission };

/** What a recipient can see of one owner's notebook. */
interface SharedNotebook {
  owner: User;
  store: NoteStore;
  /** The owner's tags shared with this recipient, with the recipient's permission for each. */
  permissions: Map<number, SharePermission>;
}

/** The tags shared with someone, as one category: their "Shared with me". */
function sharedCategoryOf(tags: Tag[]): Category {
  return { id: SHARED_CATEGORY_ID, name: SHARED_CATEGORY_NAME, multiSelect: true, shared: true, tags };
}

/** The tab filters left once tags no longer shared with the user are taken out (a filter left with none is dropped). */
function withoutLostShares(tabs: Tab[], shared: Category | undefined): Tab[] {
  const ids = new Set(shared?.tags.map((tag) => tag.id) ?? []);
  return tabs.map((tab) => {
    if (!tab.categories.some((filter) => filter.categoryId === SHARED_CATEGORY_ID)) return tab;
    return {
      ...tab,
      categories: tab.categories
        .map((filter) => (filter.categoryId === SHARED_CATEGORY_ID ? { ...filter, tagIds: filter.tagIds.filter((id) => ids.has(id)) } : filter))
        .filter((filter) => filter.tagIds.length > 0),
    };
  });
}

/** A list of note ids from a request, or undefined if none was sent. */
function noteIdList(raw: unknown): number[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || !raw.every((id) => Number.isInteger(id))) throw new RequestError(400, '"noteIds" must be a list of ids.');
  return raw as number[];
}

const sameSet = (a: number[], b: number[]) => a.length === b.length && a.every((id) => b.includes(id));

export class Sharing {
  private rows: ShareRow[] = [];
  private loaded: Promise<void> | undefined;

  constructor(
    private readonly db: Db,
    private readonly notebooks: Notebooks,
  ) {}

  private get users() {
    return this.notebooks.users;
  }

  /** Loads the shares from the database the first time they're needed (and again if that failed). */
  private ready(): Promise<void> {
    if (!this.loaded) {
      this.loaded = this.db
        .query<{ tag_id: number; recipient_id: number; owner_id: number; permission: string; position: number; hue: number | null; pending: boolean }>(
          "SELECT tag_id, recipient_id, owner_id, permission, position, hue, pending FROM nwsnotes.shares",
        )
        .then((rows) => {
          this.rows = rows.map((row) => ({
            tagId: Number(row.tag_id),
            recipientId: Number(row.recipient_id),
            ownerId: Number(row.owner_id),
            permission: SHARE_PERMISSIONS.includes(row.permission as SharePermission) ? (row.permission as SharePermission) : "read",
            position: Number(row.position),
            ...(row.hue !== null && { hue: Number(row.hue) }),
            pending: row.pending === true,
          }));
        });
      this.loaded.catch(() => (this.loaded = undefined));
    }
    return this.loaded;
  }

  /** Everyone an owner's notebook is shared with, in part (for live updates). Empty until the shares are loaded. */
  recipientsOf(ownerId: number): number[] {
    return [...new Set(this.rows.filter((row) => row.ownerId === ownerId && !row.pending).map((row) => row.recipientId))];
  }

  /** Whether two users are linked by sharing: one has a share of the other's that's in use (not waiting to be accepted). */
  private linked(a: number, b: number): boolean {
    return this.rows.some(
      (row) => !row.pending && ((row.ownerId === a && row.recipientId === b) || (row.ownerId === b && row.recipientId === a)),
    );
  }

  // --- What a recipient sees ----------------------------------------------------

  /**
   * The owners whose tags are shared with this user, each with the tags (that still exist) and their
   * permissions, and the user's "Shared with me" category (undefined if nothing is shared with them).
   */
  private async sharedWith(userId: number): Promise<{ notebooks: SharedNotebook[]; category: Category | undefined }> {
    await this.ready();
    const rows = this.rows.filter((row) => row.recipientId === userId && !row.pending).sort((a, b) => a.position - b.position || a.tagId - b.tagId);
    const notebooks = new Map<number, SharedNotebook>();
    const tags: Tag[] = [];
    for (const row of rows) {
      const owner = this.users.byId(row.ownerId);
      if (!owner) continue;
      const store = await this.notebooks.for(owner.id);
      const tag = store
        .getAll()
        .categories.filter((category) => !category.system)
        .flatMap((category) => category.tags)
        .find((t) => t.id === row.tagId);
      if (!tag) continue;
      tags.push({
        id: tag.id,
        name: tag.name,
        ...(row.hue !== undefined && { hue: row.hue }),
        ownerName: owner.displayName,
        ownerId: owner.id,
        permission: row.permission,
      });
      const shared = notebooks.get(owner.id) ?? { owner, store, permissions: new Map() };
      shared.permissions.set(tag.id, row.permission);
      notebooks.set(owner.id, shared);
    }
    return { notebooks: [...notebooks.values()], category: tags.length > 0 ? sharedCategoryOf(tags) : undefined };
  }

  /** An owner's note as a recipient sees it, or undefined if none of its tags are shared with them. */
  private present(note: Note, shared: SharedNotebook): Note | undefined {
    const visible = note.tagIds.filter((id) => shared.permissions.has(id));
    if (visible.length === 0) return undefined;
    const permission = visible.map((id) => shared.permissions.get(id)!).reduce(higherPermission);
    const { reminderSentFor: _sent, ...rest } = note;
    return {
      ...rest,
      tagIds: [...visible, lifetimeOf(note)],
      shared: { ownerId: shared.owner.id, ownerName: shared.owner.displayName, permission },
    };
  }

  // --- What an owner sees ---------------------------------------------------------------

  /** The owner's categories, each shared tag marked with the most any of its recipients may do (`sharedOut`). */
  async withSharedOut<C extends Category>(ownerId: number, categories: C[]): Promise<C[]> {
    await this.ready();
    const most = new Map<number, SharePermission>();
    const pending = new Set<number>();
    for (const row of this.rows) {
      if (row.ownerId !== ownerId || !this.users.byId(row.recipientId)) continue;
      if (row.pending) {
        pending.add(row.tagId);
        continue;
      }
      const before = most.get(row.tagId);
      most.set(row.tagId, before ? higherPermission(before, row.permission) : row.permission);
    }
    if (most.size === 0 && pending.size === 0) return categories;
    return categories.map((category) =>
      category.system || category.shared
        ? category
        : {
            ...category,
            tags: category.tags.map((tag) => {
              const sharedOut = most.get(tag.id);
              return sharedOut || pending.has(tag.id)
                ? { ...tag, ...(sharedOut && { sharedOut }), ...(pending.has(tag.id) && { sharePending: true }) }
                : tag;
            }),
          },
    );
  }

  /** The user's "Shared with me" category, as a list (empty if nothing is shared with them), for checking tabs. */
  async sharedCategories(userId: number): Promise<Category[]> {
    const { category } = await this.sharedWith(userId);
    return category ? [category] : [];
  }

  /** GET /api/notes: the user's own notebook, with the notes and tags shared with them added. */
  async dataFor(userId: number): Promise<NotesData> {
    const own = (await this.notebooks.for(userId)).getAll();
    const { notebooks, category } = await this.sharedWith(userId);
    const sharedNotes = notebooks.flatMap((shared) =>
      shared.store.getAll().notes.flatMap((note) => {
        const view = this.present(note, shared);
        return view ? [view] : [];
      }),
    );
    const userCategories = await this.withSharedOut(userId, own.categories.filter((c) => !c.system));
    return {
      ...own,
      notes: [...own.notes, ...sharedNotes],
      categories: [...userCategories, ...(category ? [category] : []), LIFETIME_CATEGORY],
      tabs: withoutLostShares(own.tabs, category),
    };
  }

  /** The ids of other users' notes the user can see. */
  async sharedNoteIds(userId: number): Promise<Set<number>> {
    const { notebooks } = await this.sharedWith(userId);
    const ids = new Set<number>();
    for (const shared of notebooks) {
      for (const note of shared.store.getAll().notes) if (this.present(note, shared)) ids.add(note.id);
    }
    return ids;
  }

  /** A note the user can see: their own, or one shared with them. 404 for anything else, so ids can't be probed. */
  async resolve(userId: number, noteId: number): Promise<ResolvedNote> {
    const store = await this.notebooks.for(userId);
    const own = store.getAll().notes.find((note) => note.id === noteId);
    if (own) return { kind: "own", store, note: own };
    const { notebooks } = await this.sharedWith(userId);
    for (const shared of notebooks) {
      const note = shared.store.getAll().notes.find((n) => n.id === noteId);
      const view = note && this.present(note, shared);
      if (note && view) return { kind: "shared", store: shared.store, note, view, owner: shared.owner, permission: view.shared!.permission };
    }
    throw new RequestError(404, `There is no note with id ${noteId}.`);
  }

  /** Refuses unless the user's permission for a shared note includes `needed`. */
  private require(resolved: Extract<ResolvedNote, { kind: "shared" }>, needed: SharePermission): void {
    if (allows(resolved.permission, needed)) return;
    const owner = resolved.owner.displayName;
    throw new RequestError(
      403,
      resolved.permission === "read"
        ? `${owner} has shared this note with you to read only.`
        : `Only ${owner} can move their notes to the bin.`,
    );
  }

  /** An owner's note, changed in their notebook, as the recipient now sees it. */
  private async viewAfter(userId: number, note: Note): Promise<Note> {
    const { notebooks } = await this.sharedWith(userId);
    const shared = notebooks.find((s) => s.store.getAll().notes.some((n) => n.id === note.id));
    return (shared && this.present(note, shared)) ?? note;
  }

  // --- Changes a recipient makes ----------------------------------------------------

  /**
   * Adds a note. If its tags include tags shared with the user, it's made in their owner's notebook
   * (subject to the owner's limits): it may then have only tags shared by that owner, all of them ones
   * the user may edit, and no due date. Otherwise it's an ordinary add to the user's own notebook.
   */
  async addNote(
    user: User,
    title: NoteTitle,
    rawTagIds: unknown,
    details: NoteDetails | undefined,
    rawParentId: unknown,
    options: { dueDateTime?: string; clientId?: unknown; createdDateTime?: unknown; tagsChangedDateTime?: unknown; source?: "sms" },
  ): Promise<{ note: Note; created: boolean; ownerId?: number }> {
    const { category, notebooks } = await this.sharedWith(user.id);
    const sharedTags = category?.tags ?? [];
    const tagIds = Array.isArray(rawTagIds) ? rawTagIds.filter((id) => typeof id !== "number" || !isLifetimeTag(id)) : [];
    const chosen = sharedTags.filter((tag) => tagIds.includes(tag.id));
    if (chosen.length === 0) {
      // A child note in a shared long-form note must have one of its owner's shared tags too.
      if (rawParentId !== undefined && rawParentId !== null && Number.isInteger(rawParentId)) {
        const parent = await this.resolve(user.id, rawParentId as number).catch(() => undefined);
        if (parent?.kind === "shared") {
          throw new RequestError(400, `A note added to ${parent.owner.displayName}'s long-form note needs one of the tags they've shared with you.`);
        }
      }
      const store = await this.notebooks.for(user.id);
      return store.add(title, rawTagIds, details, rawParentId, {
        ...options,
        createdByUserId: user.id,
        noteLimit: noteLimitOf(user),
        stylusNoteLimit: stylusNoteLimitOf(noteLimitOf(user)),
      });
    }

    if (tagIds.length !== chosen.length) {
      throw new RequestError(400, "A note with a tag shared with you can't also have your own tags.");
    }
    const ownerIds = new Set(chosen.map((tag) => tag.ownerId));
    if (ownerIds.size > 1) throw new RequestError(400, "A note can only have tags shared with you by one person.");
    const shared = notebooks.find((s) => s.owner.id === chosen[0]!.ownerId)!;
    const owner = shared.owner;
    const readOnly = chosen.find((tag) => !allows(tag.permission!, "edit"));
    if (readOnly) {
      throw new RequestError(403, `"${tagLabel(readOnly)}" is shared with you to read only, so you can't add notes to it.`);
    }
    if (options.dueDateTime !== undefined) throw new RequestError(400, `Only ${owner.displayName} can set due dates on their notes.`);
    let parentId: number | undefined;
    if (rawParentId !== undefined && rawParentId !== null) {
      const parent = Number.isInteger(rawParentId) ? await this.resolve(user.id, rawParentId as number).catch(() => undefined) : undefined;
      if (!parent || parent.kind !== "shared" || parent.owner.id !== owner.id) {
        throw new RequestError(400, `Note ${String(rawParentId)} isn't one of ${owner.displayName}'s long-form notes shared with you.`);
      }
      this.require(parent, "edit");
      parentId = parent.note.id;
    }
    const { note, created } = await shared.store.add(title, chosen.map((tag) => tag.id), details, parentId, {
      clientId: options.clientId,
      createdDateTime: options.createdDateTime,
      tagsChangedDateTime: options.tagsChangedDateTime,
      source: options.source,
      noteLimit: noteLimitOf(owner),
      stylusNoteLimit: stylusNoteLimitOf(noteLimitOf(owner)),
      ownerName: owner.displayName,
      createdByUserId: user.id,
    });
    return { note: this.present(note, shared) ?? note, created, ownerId: owner.id };
  }

  /**
   * Edits a note's title and details. A shared note needs edit permission, and keeps its tags (all of
   * them, including the owner's that the user can't see) and its due date: only the owner changes those.
   */
  async updateNote(
    user: User,
    id: number,
    title: NoteTitle,
    rawTagIds: unknown,
    details: NoteDetails | undefined,
    options: { dueDateTime?: string; tagsChangedDateTime?: unknown; baseModifiedDateTime?: unknown; parentId?: number | null },
  ): Promise<Note> {
    const resolved = await this.resolve(user.id, id);
    // A note's parent must be in the same notebook: a child note always has the same owner as its parent.
    const newParent = options.parentId ?? undefined;
    const parent =
      newParent === undefined || newParent === resolved.note.parentId ? undefined : await this.resolve(user.id, newParent).catch(() => undefined);
    if (resolved.kind === "own") {
      if (parent?.kind === "shared") {
        throw new RequestError(400, `Your note can't go inside ${parent.owner.displayName}'s long-form note: a note's parent must belong to the same person.`);
      }
      return resolved.store.updateNote(id, title, rawTagIds, details, { ...options, stylusNoteLimit: stylusNoteLimitOf(noteLimitOf(user)) });
    }
    this.require(resolved, "edit");
    const owner = resolved.owner;
    if (newParent !== undefined && newParent !== resolved.note.parentId) {
      if (!parent || parent.kind !== "shared" || parent.owner.id !== owner.id) {
        throw new RequestError(400, `${owner.displayName}'s note can only go inside one of their own long-form notes shared with you.`);
      }
      this.require(parent, "edit");
    }
    const withoutLifetime = (ids: number[]) => ids.filter((tagId) => !isLifetimeTag(tagId));
    const sent = Array.isArray(rawTagIds) ? withoutLifetime(rawTagIds.filter((tagId): tagId is number => typeof tagId === "number")) : undefined;
    if (sent && !sameSet(sent, withoutLifetime(resolved.view.tagIds))) {
      throw new RequestError(400, `You can't change the tags of ${owner.displayName}'s notes.`);
    }
    if (details === undefined && options.dueDateTime !== resolved.note.dueDateTime) {
      throw new RequestError(400, `Only ${owner.displayName} can change the due dates of their notes.`);
    }
    const note = await resolved.store.updateNote(id, title, withoutLifetime(resolved.note.tagIds), details, {
      // Converting to a long-form note (details) needs no due date; otherwise it keeps the owner's.
      dueDateTime: details === undefined ? resolved.note.dueDateTime : undefined,
      tagsChangedDateTime: options.tagsChangedDateTime,
      baseModifiedDateTime: options.baseModifiedDateTime,
      stylusNoteLimit: stylusNoteLimitOf(noteLimitOf(owner)),
      ownerName: owner.displayName,
      parentId: options.parentId,
    });
    return this.viewAfter(user.id, note);
  }

  /**
   * Deletes a note: only used when a new long-form note is cancelled. A shared one can only be deleted
   * that way, while its details are still empty, with edit permission (nobody else can delete an owner's notes).
   */
  async deleteNote(user: User, id: number): Promise<void> {
    const resolved = await this.resolve(user.id, id);
    if (resolved.kind === "shared") {
      this.require(resolved, "edit");
      const note = resolved.note;
      const empty = isLongForm(note) && (note.detailsText !== undefined ? note.detailsText === "" : detailsPagesOf(note).every((page) => page === ""));
      if (!empty) throw new RequestError(403, `Only ${resolved.owner.displayName} can delete their notes.`);
    }
    await resolved.store.deleteNote(id);
  }

  /** Waiting, Archive and Reinstate need edit permission on a shared note; Move to bin needs edit-and-delete. */
  async setLifetime(user: User, id: number, raw: unknown, rawTagsChanged: unknown): Promise<Note> {
    const resolved = await this.resolve(user.id, id);
    if (resolved.kind === "own") return resolved.store.setLifetime(id, raw, rawTagsChanged);
    this.require(resolved, raw === "Bin" ? "delete" : "edit");
    return this.viewAfter(user.id, await resolved.store.setLifetime(id, raw, rawTagsChanged));
  }

  /** Dragging a note onto another tab: only the user's own notes' tags can be changed. */
  async moveToTab(user: User, id: number, raw: unknown): Promise<Note> {
    const resolved = await this.resolve(user.id, id);
    if (resolved.kind === "shared") throw new RequestError(400, `You can't change the tags of ${resolved.owner.displayName}'s notes.`);
    return resolved.store.moveToTab(id, raw);
  }

  /** Multi-select: only the user's own notes' tags can be changed. */
  async bulkTags(user: User, raw: unknown): Promise<Note[]> {
    const noteIds = (raw as { noteIds?: unknown } | undefined)?.noteIds;
    if (Array.isArray(noteIds)) {
      const shared = await this.sharedNoteIds(user.id);
      if (noteIds.some((id) => shared.has(id as number))) throw new RequestError(400, "The tags of notes shared with you can't be changed.");
    }
    return (await this.notebooks.for(user.id)).bulkTags(raw);
  }

  /** The user's note order: their own notes and the shared ones they can see. */
  async setNoteOrder(user: User, raw: unknown): Promise<number[]> {
    return (await this.notebooks.for(user.id)).setNoteOrder(raw, await this.sharedNoteIds(user.id));
  }

  /**
   * The bulk Lifetime buttons. Reset New covers the user's own notes and the shared ones they may edit.
   * With `noteIds` (edit-order mode), Waiting → Archive includes shared notes the user may edit, and
   * Archived → Bin those they may edit and delete. Without them (Settings), only the user's own notes.
   * Empty Bin is only ever the user's own. Returns how many notes changed, and whose notebooks did.
   */
  async bulkLifetime(user: User, action: "reset-new" | "archived-to-bin" | "waiting-to-archived" | "empty-bin", rawNoteIds: unknown): Promise<number> {
    const store = await this.notebooks.for(user.id);
    if (action === "empty-bin") return store.emptyBin();
    const noteIds = noteIdList(rawNoteIds);
    const own =
      action === "reset-new" ? await store.resetNew(noteIds) : action === "archived-to-bin" ? await store.archivedToBin(noteIds) : await store.waitingToArchived(noteIds);
    if (action !== "reset-new" && noteIds === undefined) return own;
    const needed: SharePermission = action === "archived-to-bin" ? "delete" : "edit";
    const from = action === "reset-new" ? LIFETIME_NEW : action === "archived-to-bin" ? LIFETIME_ARCHIVED : LIFETIME_WAITING;
    let count = own;
    const { notebooks } = await this.sharedWith(user.id);
    for (const shared of notebooks) {
      const ids = shared.store
        .getAll()
        .notes.filter((note) => lifetimeOf(note) === from && (noteIds === undefined || noteIds.includes(note.id)))
        .filter((note) => {
          const view = this.present(note, shared);
          return view !== undefined && allows(view.shared!.permission, needed);
        })
        .map((note) => note.id);
      if (ids.length === 0) continue;
      count +=
        action === "reset-new"
          ? await shared.store.resetNew(ids)
          : action === "archived-to-bin"
            ? await shared.store.archivedToBin(ids)
            : await shared.store.waitingToArchived(ids);
    }
    return count;
  }

  /** PUT /api/shared-tags: the user's own order and colours for the tags shared with them (every one, once). */
  async setSharedTagLayout(userId: number, raw: unknown): Promise<Category | undefined> {
    const { category } = await this.sharedWith(userId);
    const current = category?.tags.map((tag) => tag.id) ?? [];
    const tags = (raw as { tags?: unknown } | undefined)?.tags;
    if (!Array.isArray(tags)) throw new RequestError(400, '"tags" must be a list.');
    const parsed = tags.map((item) => {
      const tag = (typeof item === "object" && item !== null ? item : {}) as { id?: unknown; hue?: unknown };
      if (!Number.isInteger(tag.id)) throw new RequestError(400, "Each tag needs its id.");
      if (tag.hue !== undefined && tag.hue !== null && !(Number.isInteger(tag.hue) && (tag.hue as number) >= 0 && (tag.hue as number) < 360)) {
        throw new RequestError(400, "A tag's colour must be a hue from 0 to 359.");
      }
      return { id: tag.id as number, hue: typeof tag.hue === "number" ? tag.hue : undefined };
    });
    if (!sameSet(parsed.map((tag) => tag.id), current) || new Set(parsed.map((tag) => tag.id)).size !== parsed.length) {
      throw new RequestError(400, "List every tag shared with you exactly once.");
    }
    await this.db.transaction(async (query) => {
      for (const [position, tag] of parsed.entries()) {
        await query("UPDATE nwsnotes.shares SET position = $3, hue = $4 WHERE tag_id = $1 AND recipient_id = $2", [tag.id, userId, position, tag.hue ?? null]);
      }
    });
    for (const [position, tag] of parsed.entries()) {
      const row = this.rows.find((r) => r.tagId === tag.id && r.recipientId === userId)!;
      row.position = position;
      if (tag.hue === undefined) delete row.hue;
      else row.hue = tag.hue;
    }
    return (await this.sharedWith(userId)).category;
  }

  // --- Sharing an owner's tags --------------------------------------------------------

  /** One of the owner's own tags, or 404. */
  private async ownTag(ownerId: number, tagId: number): Promise<Tag> {
    const tag = (await this.notebooks.for(ownerId))
      .getAll()
      .categories.filter((category) => !category.system)
      .flatMap((category) => category.tags)
      .find((t) => t.id === tagId);
    if (!tag) throw new RequestError(404, `There is no tag with id ${tagId}.`);
    return tag;
  }

  /** Who one of the owner's tags is shared with. */
  async sharesOfTag(ownerId: number, tagId: number): Promise<TagShare[]> {
    await this.ready();
    await this.ownTag(ownerId, tagId);
    return this.rows
      .filter((row) => row.tagId === tagId && row.ownerId === ownerId)
      .flatMap((row) => {
        const user = this.users.byId(row.recipientId);
        return user
          ? [{ userId: user.id, displayName: user.displayName, loginName: user.loginName, permission: row.permission, ...(row.pending && { pending: true }) }]
          : [];
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  /**
   * PUT /api/tags/:id/shares: replaces who one of the owner's tags is shared with, and at what level.
   * Someone new (not linked with the owner by sharing, either way) must accept first: with `askNewPeople`,
   * their share waits (`pending`) until they do. Returns the new list, every user whose view changed (to
   * tell their pages), and the people to email to ask (those with no other share of the owner's waiting).
   */
  async setSharesOfTag(
    owner: User,
    tagId: number,
    raw: unknown,
    askNewPeople: boolean,
  ): Promise<{ shares: TagShare[]; changed: number[]; toAsk: User[] }> {
    await this.ready();
    await this.ownTag(owner.id, tagId);
    const list = (raw as { shares?: unknown } | undefined)?.shares;
    if (!Array.isArray(list)) throw new RequestError(400, '"shares" must be a list.');
    const wanted = new Map<number, SharePermission>();
    for (const item of list as unknown[]) {
      const share = (typeof item === "object" && item !== null ? item : {}) as { loginName?: unknown; permission?: unknown };
      const loginName = typeof share.loginName === "string" ? share.loginName.trim() : "";
      if (!isValidLoginName(loginName)) throw new RequestError(400, "Give the email address of the person to share with.");
      const recipient = this.users.byLoginName(loginName);
      if (!recipient) throw new RequestError(400, `There's no nwsnotes account for ${loginName}.`);
      if (recipient.id === owner.id) throw new RequestError(400, "That's your own account: you can already see your notes.");
      if (wanted.has(recipient.id)) throw new RequestError(400, `${recipient.displayName} is in the list twice.`);
      if (!SHARE_PERMISSIONS.includes(share.permission as SharePermission)) {
        throw new RequestError(400, `Choose what ${recipient.displayName} may do: ${SHARE_PERMISSIONS.join(", ")}.`);
      }
      wanted.set(recipient.id, share.permission as SharePermission);
    }

    const existing = this.rows.filter((row) => row.tagId === tagId);
    const removed = existing.filter((row) => !wanted.has(row.recipientId));
    const added: ShareRow[] = [];
    const updated: ShareRow[] = [];
    const toAsk: User[] = [];
    for (const [recipientId, permission] of wanted) {
      const row = existing.find((r) => r.recipientId === recipientId);
      if (!row) {
        const last = Math.max(-1, ...this.rows.filter((r) => r.recipientId === recipientId).map((r) => r.position));
        const pending = askNewPeople && !this.linked(owner.id, recipientId);
        // Asked once: a second tag shared while the first still waits is accepted (or not) along with it.
        const asked = this.rows.some((r) => r.pending && r.ownerId === owner.id && r.recipientId === recipientId);
        if (pending && !asked) toAsk.push(this.users.byId(recipientId)!);
        added.push({ tagId, recipientId, ownerId: owner.id, permission, position: last + 1, pending });
      } else if (row.permission !== permission) {
        updated.push({ ...row, permission });
      }
    }
    await this.db.transaction(async (query) => {
      for (const row of removed) await query("DELETE FROM nwsnotes.shares WHERE tag_id = $1 AND recipient_id = $2", [tagId, row.recipientId]);
      for (const row of updated) {
        await query("UPDATE nwsnotes.shares SET permission = $3 WHERE tag_id = $1 AND recipient_id = $2", [tagId, row.recipientId, row.permission]);
      }
      for (const row of added) {
        await query("INSERT INTO nwsnotes.shares (tag_id, recipient_id, owner_id, permission, position, pending) VALUES ($1, $2, $3, $4, $5, $6)", [
          row.tagId,
          row.recipientId,
          row.ownerId,
          row.permission,
          row.position,
          row.pending,
        ]);
      }
    });
    this.rows = [
      ...this.rows.filter((row) => row.tagId !== tagId || (wanted.has(row.recipientId) && !updated.some((u) => u.recipientId === row.recipientId))),
      ...updated,
      ...added,
    ];
    // A waiting share changes nothing the recipient sees.
    const changed = [...removed, ...updated, ...added].filter((row) => !row.pending).map((row) => row.recipientId);
    return { shares: await this.sharesOfTag(owner.id, tagId), changed: [...new Set(changed)], toAsk };
  }

  // --- Asking someone new first ---------------------------------------------------------

  /** The names of the owner's tags waiting for this recipient to accept them (empty if none are). */
  async waitingTagNames(ownerId: number, recipientId: number): Promise<string[]> {
    await this.ready();
    const waiting = this.rows.filter((row) => row.pending && row.ownerId === ownerId && row.recipientId === recipientId);
    if (waiting.length === 0) return [];
    const tags = (await this.notebooks.for(ownerId)).getAll().categories.flatMap((category) => category.tags);
    return waiting.flatMap((row) => tags.find((tag) => tag.id === row.tagId)?.name ?? []);
  }

  /**
   * The recipient's answer to an owner's request: accepting puts every share of the owner's waiting for them
   * into use; turning it down removes them. Returns how many there were (0: nothing was waiting).
   */
  async answerInvite(ownerId: number, recipientId: number, accept: boolean): Promise<number> {
    await this.ready();
    const waiting = this.rows.filter((row) => row.pending && row.ownerId === ownerId && row.recipientId === recipientId);
    if (waiting.length === 0) return 0;
    await this.db.transaction(async (query) => {
      if (accept) {
        await query("UPDATE nwsnotes.shares SET pending = false WHERE owner_id = $1 AND recipient_id = $2 AND pending", [ownerId, recipientId]);
      } else {
        await query("DELETE FROM nwsnotes.shares WHERE owner_id = $1 AND recipient_id = $2 AND pending", [ownerId, recipientId]);
      }
    });
    if (accept) for (const row of waiting) row.pending = false;
    else this.rows = this.rows.filter((row) => !waiting.includes(row));
    return waiting.length;
  }

  /**
   * DELETE /api/shared-tags/:id: the recipient stops seeing a tag shared with them. Only its owner can
   * share it with them again. Returns the owner and the tag's name, to tell the owner.
   */
  async leaveSharedTag(userId: number, tagId: number): Promise<{ owner: User; tagName: string }> {
    const { category } = await this.sharedWith(userId);
    const tag = category?.tags.find((t) => t.id === tagId);
    const owner = tag?.ownerId === undefined ? undefined : this.users.byId(tag.ownerId);
    if (!tag || !owner) throw new RequestError(404, `There is no tag with id ${tagId} shared with you.`);
    await this.db.query("DELETE FROM nwsnotes.shares WHERE tag_id = $1 AND recipient_id = $2", [tagId, userId]);
    this.rows = this.rows.filter((row) => !(row.tagId === tagId && row.recipientId === userId));
    return { owner, tagName: tag.name };
  }

  /**
   * Ends the shares of the owner's tags that no longer exist (deleted on the category page, or gone back
   * past in the History). Returns the users whose view changed.
   */
  async pruneDeletedTags(ownerId: number): Promise<number[]> {
    await this.ready();
    const tagIds = new Set(
      (await this.notebooks.for(ownerId))
        .getAll()
        .categories.flatMap((category) => category.tags)
        .map((tag) => tag.id),
    );
    const gone = this.rows.filter((row) => row.ownerId === ownerId && !tagIds.has(row.tagId));
    if (gone.length === 0) return [];
    await this.db.transaction(async (query) => {
      for (const row of gone) await query("DELETE FROM nwsnotes.shares WHERE tag_id = $1 AND recipient_id = $2", [row.tagId, row.recipientId]);
    });
    this.rows = this.rows.filter((row) => !gone.includes(row));
    return [...new Set(gone.map((row) => row.recipientId))];
  }

  /** GET /api/shares/people: users the user has shared a tag with, and users who have shared one with them. */
  async people(userId: number): Promise<SharePerson[]> {
    await this.ready();
    const ids = new Set(
      // Someone whose share you haven't accepted yet isn't linked with you.
      this.rows.flatMap((row) => (row.ownerId === userId ? [row.recipientId] : row.recipientId === userId && !row.pending ? [row.ownerId] : [])),
    );
    return [...ids]
      .flatMap((id) => {
        const user = this.users.byId(id);
        return user ? [{ id: user.id, displayName: user.displayName, loginName: user.loginName }] : [];
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  /** End-to-end tests only: forgets every share (the reset removes every user but the admin). */
  async resetForTests(): Promise<void> {
    await this.db.query("DELETE FROM nwsnotes.shares");
    this.rows = [];
    this.loaded = Promise.resolve();
  }
}
