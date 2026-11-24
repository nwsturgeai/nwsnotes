import { request as newRequest, type APIRequestContext } from "@playwright/test";
import { expect, test } from "./fixtures";

/*
 * Sharing tags, through the API: what each permission level allows on the owner's notes, and what it
 * doesn't. The seed is the admin's: "Buy milk" (note 2) has Home (tag 2) and Shopping (tag 4); "Garden
 * ideas" (9) has Home and Ideas (3); Shopping is orange (hue 30).
 */

const SHOPPING = 4;
const HOME = 2;
const BUY_MILK = 2;
const GARDEN_IDEAS = 9;
const SHARED = -2;

interface ApiNote {
  id: number;
  titleText?: string;
  tagIds: number[];
  dueDateTime?: string;
  shared?: { ownerId: number; ownerName: string; permission: string };
}
interface ApiData {
  notes: ApiNote[];
  categories: { id: number; name: string; tags: { id: number; name: string; hue?: number; ownerName?: string; permission?: string }[] }[];
  tabs: { id: number; name: string; categories: { categoryId: number; tagIds: number[] }[] }[];
  noteOrder: number[];
}

/** A new user (made by the admin), logged in through the API. */
async function userSession(admin: APIRequestContext, baseURL: string, displayName: string, loginName: string): Promise<APIRequestContext> {
  const made = await admin.post("/api/users", { data: { displayName, loginName } });
  expect(made.status()).toBe(201);
  const { password } = (await made.json()) as { password: string };
  const session = await newRequest.newContext({ baseURL });
  expect((await session.post("/api/login", { data: { loginName, password } })).ok()).toBe(true);
  return session;
}

async function share(admin: APIRequestContext, tagId: number, shares: { loginName: string; permission: string }[]) {
  const response = await admin.put(`/api/tags/${tagId}/shares`, { data: { shares } });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as { userId: number; displayName: string; loginName: string; permission: string }[];
}

const data = async (session: APIRequestContext) => (await (await session.get("/api/notes")).json()) as ApiData;
const edit = (session: APIRequestContext, note: ApiNote, change: Partial<ApiNote>) =>
  session.put(`/api/notes/${note.id}`, { data: { titleText: note.titleText, tagIds: note.tagIds, dueDateTime: note.dueDateTime, ...change } });

test("a shared tag's notes, as each permission level allows", async ({ page, baseURL }) => {
  const admin = page.request;
  const sam = await userSession(admin, baseURL!, "Sam Smith", "sam@example.com");

  // Nothing is shared yet: no "Shared with me", and the admin's notes can't be reached.
  expect((await data(sam)).categories.map((c) => c.name)).toEqual(["Lifetime"]);
  expect((await sam.put(`/api/notes/${BUY_MILK}/lifetime`, { data: { lifetime: "Waiting" } })).status()).toBe(404);

  // Read-only: Sam sees Buy milk, with only the shared tag (and its Lifetime), and can't change it.
  expect(await share(admin, SHOPPING, [{ loginName: "sam@example.com", permission: "read" }])).toEqual([
    expect.objectContaining({ displayName: "Sam Smith", loginName: "sam@example.com", permission: "read" }),
  ]);
  let view = await data(sam);
  expect(view.categories.map((c) => c.name)).toEqual(["Shared with me", "Lifetime"]);
  expect(view.categories[0]!.tags).toEqual([{ id: SHOPPING, name: "Shopping", ownerName: "Admin", ownerId: 1, permission: "read" }]);
  expect(view.notes.map((n) => [n.id, n.titleText, n.tagIds, n.shared?.permission])).toEqual([[BUY_MILK, "Buy milk", [SHOPPING, -1], "read"]]);
  let milk = view.notes[0]!;
  expect((await edit(sam, milk, { titleText: "Buy oat milk" })).status()).toBe(403);
  expect((await sam.put(`/api/notes/${BUY_MILK}/lifetime`, { data: { lifetime: "Waiting" } })).status()).toBe(403);
  expect((await sam.post("/api/notes", { data: { titleText: "Eggs", tagIds: [SHOPPING] } })).status()).toBe(403);
  // Other notes of the admin's stay out of reach, even by id.
  expect((await sam.put(`/api/notes/${GARDEN_IDEAS}/lifetime`, { data: { lifetime: "Waiting" } })).status()).toBe(404);

  // Edit: Sam edits the title and changes the Lifetime, but not the tags, the due date, or to the Bin.
  await share(admin, SHOPPING, [{ loginName: "sam@example.com", permission: "edit" }]);
  milk = (await data(sam)).notes[0]!;
  const edited = await edit(sam, milk, { titleText: "Buy oat milk" });
  expect(edited.ok(), await edited.text()).toBe(true);
  expect(((await edited.json()) as ApiNote).tagIds).toEqual([SHOPPING, -1]);
  expect((await edit(sam, milk, { titleText: "Buy oat milk", tagIds: [-1] })).status()).toBe(400);
  expect((await edit(sam, milk, { titleText: "Buy oat milk", dueDateTime: "2030-01-01T09:00:00.000Z" })).status()).toBe(400);
  expect((await sam.put(`/api/notes/${BUY_MILK}/lifetime`, { data: { lifetime: "Waiting" } })).ok()).toBe(true);
  expect((await sam.put(`/api/notes/${BUY_MILK}/lifetime`, { data: { lifetime: "Archived" } })).ok()).toBe(true);
  expect((await sam.put(`/api/notes/${BUY_MILK}/lifetime`, { data: { lifetime: "Bin" } })).status()).toBe(403);
  // Multi-select can't change a shared note's tags.
  expect((await sam.put("/api/notes/bulk-tags", { data: { noteIds: [BUY_MILK], addTagIds: [], removeTagIds: [SHOPPING] } })).status()).toBe(400);

  // The admin's note keeps its Home tag, which Sam never saw; the History says Sam made the changes.
  const adminMilk = (await data(admin)).notes.find((n) => n.id === BUY_MILK)!;
  expect([adminMilk.titleText, adminMilk.tagIds]).toEqual(["Buy oat milk", [HOME, SHOPPING, -3]]);
  const history = (await (await admin.get("/api/history")).json()) as { changes: { summary: string }[] };
  expect(history.changes.slice(0, 3).map((c) => c.summary)).toEqual([
    'Archived "Buy oat milk" (by Sam Smith)',
    'Set "Buy oat milk" to Waiting (by Sam Smith)',
    'Edited "Buy oat milk" (by Sam Smith)',
  ]);

  // Edit and delete: Move to bin too. Emptying the Bin is still only the admin's own.
  await share(admin, SHOPPING, [{ loginName: "sam@example.com", permission: "delete" }]);
  expect((await sam.put(`/api/notes/${BUY_MILK}/lifetime`, { data: { lifetime: "Bin" } })).ok()).toBe(true);
  expect(await (await sam.post("/api/notes/empty-bin")).json()).toEqual({ count: 0 });
  expect((await data(admin)).notes.some((n) => n.id === BUY_MILK)).toBe(true);

  // Stopping sharing takes the note away again.
  await share(admin, SHOPPING, []);
  view = await data(sam);
  expect(view.notes).toEqual([]);
  expect(view.categories.map((c) => c.name)).toEqual(["Lifetime"]);
  expect((await sam.put(`/api/notes/${BUY_MILK}/lifetime`, { data: { lifetime: "Active" } })).status()).toBe(404);
  await sam.dispose();
});

test("adding notes with a shared tag puts them in the owner's notebook, under the owner's limit", async ({ page, baseURL }) => {
  const admin = page.request;
  const sam = await userSession(admin, baseURL!, "Sam", "sam@example.com");
  await share(admin, SHOPPING, [{ loginName: "sam@example.com", permission: "edit" }]);
  await share(admin, HOME, [{ loginName: "sam@example.com", permission: "read" }]);
  const samCategory = await sam.post("/api/categories", { data: { name: "Mine", multiSelect: false, tags: [{ name: "Errands" }] } });
  const errands = ((await samCategory.json()) as { tags: { id: number }[] }).tags[0]!.id;

  const added = await sam.post("/api/notes", { data: { titleText: "Eggs", tagIds: [SHOPPING] } });
  expect(added.status()).toBe(201);
  const eggs = (await added.json()) as ApiNote;
  expect([eggs.tagIds, eggs.shared?.ownerName]).toEqual([[SHOPPING, -1], "Admin"]);
  // It's the admin's note, in the admin's notebook and History.
  expect((await data(admin)).notes.find((n) => n.id === eggs.id)?.tagIds).toEqual([SHOPPING, -1]);
  const history = (await (await admin.get("/api/history")).json()) as { changes: { summary: string }[] };
  expect(history.changes[0]!.summary).toBe('Added "Eggs" (by Sam)');

  // Refused: with one of Sam's own tags too, with a read-only shared tag, with a due date.
  const refused = async (body: object) => {
    const response = await sam.post("/api/notes", { data: { titleText: "No", ...body } });
    return [response.status(), ((await response.json()) as { error: string }).error];
  };
  expect(await refused({ tagIds: [SHOPPING, errands] })).toEqual([400, "A note with a tag shared with you can't also have your own tags."]);
  expect(await refused({ tagIds: [SHOPPING, HOME] })).toEqual([403, '"Home (Admin)" is shared with you to read only, so you can\'t add notes to it.']);
  expect(await refused({ tagIds: [SHOPPING], dueDateTime: "2030-01-01T09:00:00.000Z" })).toEqual([400, "Only Admin can set due dates on their notes."]);
  // Sam's own notes can't have the admin's tags added later either.
  const own = (await (await sam.post("/api/notes", { data: { titleText: "Sam's", tagIds: [errands] } })).json()) as ApiNote;
  expect((await sam.put(`/api/notes/${own.id}`, { data: { titleText: "Sam's", tagIds: [errands, SHOPPING] } })).status()).toBe(400);

  // The admin's note limit applies, with a message naming whose notebook is full.
  expect((await admin.put("/api/users/1", { data: { noteLimit: 10 } })).ok()).toBe(true);
  expect(await refused({ tagIds: [SHOPPING] })).toEqual([409, "Admin's notebook is full, so this note can't be added."]);
  await sam.dispose();
});

test("a recipient's own order and colours for shared tags, and tabs on them", async ({ page, baseURL }) => {
  const admin = page.request;
  const sam = await userSession(admin, baseURL!, "Sam", "sam@example.com");
  await share(admin, SHOPPING, [{ loginName: "sam@example.com", permission: "read" }]);
  await share(admin, HOME, [{ loginName: "sam@example.com", permission: "read" }]);
  let tags = (await data(sam)).categories[0]!.tags;
  // In the order they were shared, without the owner's colours.
  expect(tags.map((t) => [t.name, t.hue])).toEqual([["Shopping", undefined], ["Home", undefined]]);

  const layout = await sam.put("/api/shared-tags", { data: { tags: [{ id: HOME, hue: 200 }, { id: SHOPPING }] } });
  expect(layout.ok(), await layout.text()).toBe(true);
  tags = (await data(sam)).categories[0]!.tags;
  expect(tags.map((t) => [t.name, t.hue])).toEqual([["Home", 200], ["Shopping", undefined]]);
  // The admin's own colours are untouched.
  const adminTags = (await data(admin)).categories.flatMap((c) => c.tags);
  expect(adminTags.find((t) => t.id === SHOPPING)?.hue).toBe(30);
  expect(adminTags.find((t) => t.id === HOME)?.hue).toBe(120);
  expect((await sam.put("/api/shared-tags", { data: { tags: [{ id: HOME }] } })).status()).toBe(400);

  // A tab on a shared tag, and Sam's own order of the shared notes.
  const tab = await sam.post("/api/tabs", { data: { name: "Admin's", categories: [{ categoryId: SHARED, tagIds: [HOME] }] } });
  expect(tab.ok(), await tab.text()).toBe(true);
  const order = await sam.put("/api/notes/order", { data: { noteOrder: [GARDEN_IDEAS, BUY_MILK] } });
  expect(await order.json()).toEqual({ noteOrder: [GARDEN_IDEAS, BUY_MILK] });
  expect((await data(admin)).noteOrder).toEqual([]);

  // When Home stops being shared, the tab's filter on it goes (as for a deleted tag).
  await share(admin, HOME, []);
  expect((await data(sam)).tabs.map((t) => [t.name, t.categories])).toEqual([["Admin's", []]]);
  await sam.dispose();
});

test("choosing who to share with, and what can't be shared", async ({ page, baseURL }) => {
  const admin = page.request;
  const sam = await userSession(admin, baseURL!, "Sam", "sam@example.com");
  const robin = await userSession(admin, baseURL!, "Robin", "robin@example.com");
  const error = async (response: Awaited<ReturnType<APIRequestContext["put"]>>) => [response.status(), ((await response.json()) as { error: string }).error];

  expect(await error(await admin.put(`/api/tags/${SHOPPING}/shares`, { data: { shares: [{ loginName: "nobody@example.com", permission: "read" }] } }))).toEqual([
    400,
    "There's no nwsnotes account for nobody@example.com.",
  ]);
  expect((await admin.put(`/api/tags/${SHOPPING}/shares`, { data: { shares: [{ loginName: "admin@example.com", permission: "read" }] } })).status()).toBe(400);
  // Only the owner can share a tag.
  expect((await sam.put(`/api/tags/${SHOPPING}/shares`, { data: { shares: [{ loginName: "robin@example.com", permission: "read" }] } })).status()).toBe(404);
  expect((await sam.get(`/api/tags/${SHOPPING}/shares`)).status()).toBe(404);

  // People: those you've shared with, and those who've shared with you.
  expect(await (await admin.get("/api/shares/people")).json()).toEqual([]);
  await share(admin, SHOPPING, [{ loginName: "sam@example.com", permission: "read" }]);
  expect(await (await admin.get("/api/shares/people")).json()).toEqual([{ id: expect.any(Number), displayName: "Sam", loginName: "sam@example.com" }]);
  expect(await (await sam.get("/api/shares/people")).json()).toEqual([{ id: 1, displayName: "Admin", loginName: "admin@example.com" }]);
  expect(await (await robin.get("/api/shares/people")).json()).toEqual([]);

  // Deleting the tag ends its shares.
  const topic = (await data(admin)).categories.find((c) => c.name === "Topic")!;
  const kept = topic.tags.filter((t) => t.id !== SHOPPING).map((t) => ({ id: t.id, name: t.name }));
  expect((await admin.put(`/api/categories/${topic.id}`, { data: { name: "Topic", multiSelect: true, tags: kept } })).ok()).toBe(true);
  expect((await data(sam)).notes).toEqual([]);
  expect(await (await admin.get("/api/shares/people")).json()).toEqual([]);
  await sam.dispose();
  await robin.dispose();
});
