import type { MouseEvent } from "react";
import type { Category } from "@nwsnotes/shared";
import { pathFor, type Page } from "./route";

interface Props {
  categories: Category[];
  onNavigate: (page: Page) => void;
  onLogout: () => void;
}

export function SettingsPage({ categories, onNavigate, onLogout }: Props) {
  function go(event: MouseEvent, target: Page) {
    event.preventDefault();
    onNavigate(target);
  }

  return (
    <main className="settings-page">
      <h1>Settings</h1>

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
        <h2>Backup</h2>
        <p>Download the latest save-file from the server. It contains all your notes, categories and tags.</p>
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
