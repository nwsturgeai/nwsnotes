import type { MouseEvent } from "react";
import { ALL_TAB_NAME, type Category, type Tab } from "@nwsnotes/shared";
import { pathFor, type Page } from "./route";
import { TagPills } from "./TagPills";

interface Props {
  categories: Category[];
  tabs: Tab[];
  stylusMode: boolean;
  onStylusModeChange: (on: boolean) => void;
  onNavigate: (page: Page) => void;
  onLogout: () => void;
}

export function SettingsPage({ categories, tabs, stylusMode, onStylusModeChange, onNavigate, onLogout }: Props) {
  function go(event: MouseEvent, target: Page) {
    event.preventDefault();
    onNavigate(target);
  }

  return (
    <main className="settings-page">
      <h1>Settings</h1>

      <section>
        <label className="switch">
          <input
            type="checkbox"
            role="switch"
            checked={stylusMode}
            onChange={(event) => onStylusModeChange(event.target.checked)}
          />
          <span className="switch-track" aria-hidden="true" />
          <span className="switch-label">Stylus mode</span>
        </label>
        <p>Write new notes with a stylus instead of typing them. Remembered on this device only.</p>
      </section>

      <section>
        <h2>Categories</h2>
        <p>Tags are arranged into categories. Click a category to rename it or its tags, or to add tags.</p>
        {categories.length > 0 && (
          <ul className="category-list">
            {categories.map((category) => {
              const page: Page = { name: "category", id: category.id };
              return (
                <li key={category.id}>
                  <a href={pathFor(page)} onClick={(event) => go(event, page)}>
                    <span className="category-name">{category.name}</span>
                    {category.multiSelect && <span className="category-kind">multi-select</span>}
                    <span className="category-tags">{category.tags.map((tag) => tag.name).join(", ")}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        )}
        <a
          className="button"
          href={pathFor({ name: "category", id: "new" })}
          onClick={(event) => go(event, { name: "category", id: "new" })}
        >
          Add category
        </a>
      </section>

      <section>
        <h2>Tabs</h2>
        <p>A tab shows only the notes with the tags it lists. Click a tab to change or delete it.</p>
        <ul className="category-list">
          <li>
            {/* The built-in tab can't be edited, so it isn't a link. */}
            <span className="tab-entry">
              <span className="category-name">{ALL_TAB_NAME}</span>
              <span className="category-tags">Always shows every note</span>
            </span>
          </li>
          {tabs.map((tab) => {
            const page: Page = { name: "tab", id: tab.id };
            return (
              <li key={tab.id}>
                <a href={pathFor(page)} onClick={(event) => go(event, page)}>
                  <span className="category-name">{tab.name}</span>
                  <div className="category-tags">
                    <TagPills tagIds={tab.categories.flatMap((filter) => filter.tagIds)} categories={categories} />
                  </div>
                </a>
              </li>
            );
          })}
        </ul>
        <a
          className="button"
          href={pathFor({ name: "tab", id: "new" })}
          onClick={(event) => go(event, { name: "tab", id: "new" })}
        >
          Add tab
        </a>
      </section>

      <section>
        <h2>Backup</h2>
        <p>Download the latest save-file from the server. It contains all your notes, categories, tags and tabs.</p>
        {/* A plain link: the session cookie is sent with it, and the server names the file. */}
        <a className="button" href="/api/notes/download" download>
          Download backup
        </a>
      </section>

      <section>
        <h2>Account</h2>
        <button type="button" className="button" onClick={onLogout}>
          Log out
        </button>
      </section>
    </main>
  );
}
