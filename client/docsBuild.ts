import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Marked, type Tokens } from "marked";

/*
 * The help pages: Markdown files in the repository's `docs/` folder, turned into static HTML pages
 * under /docs/ (see Specs/docs.md). Used by the Vite build, which adds them to the built site (so the
 * service worker saves them for offline use), and by the dev server, which builds them on each request.
 */

const DOCS_DIR = fileURLToPath(new URL("../docs/", import.meta.url));
/** The app's font, so the pages look like the app. */
const FONT_FILE = fileURLToPath(
  new URL("../node_modules/@fontsource-variable/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-wght-normal.woff2", import.meta.url),
);

/** A file of the built help pages: its path in the built site (e.g. "docs/tabs/index.html") and contents. */
export interface DocsFile {
  fileName: string;
  source: string | Uint8Array;
}

/** A page's address: /docs/ for the introduction (index.md), /docs/<name>/ for the others. */
function pageUrl(name: string): string {
  return name === "index" ? "/docs/" : `/docs/${name}/`;
}

/** A page's built file. */
function pageFile(name: string): string {
  return name === "index" ? "docs/index.html" : `docs/${name}/index.html`;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** A page's title: its first "# heading". */
function titleOf(name: string, markdown: string): string {
  const heading = /^#\s+(.+)$/m.exec(markdown);
  if (!heading) throw new Error(`docs/${name}.md has no "# title" line.`);
  return heading[1]!.trim();
}

/** The whole page, in the help pages' shared layout. */
function layout(title: string, body: string, previous?: { url: string; title: string }, next?: { url: string; title: string }): string {
  const prevNext =
    previous || next
      ? `<nav class="docs-prevnext" aria-label="Previous and next pages">
      ${previous ? `<a class="docs-previous" href="${previous.url}">← ${escapeHtml(previous.title)}</a>` : "<span></span>"}
      ${next ? `<a class="docs-next" href="${next.url}">${escapeHtml(next.title)} →</a>` : "<span></span>"}
    </nav>`
      : "";
  return `<!doctype html>
<html lang="en-GB">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)} – nwsnotes help</title>
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="/docs/docs.css" />
  </head>
  <body>
    <header class="docs-header">
      <a class="docs-home" href="/docs/">nwsnotes help</a>
      <nav aria-label="Help">
        <a href="/docs/contents/">Contents</a>
        <a href="/">← Back to the app</a>
      </nav>
    </header>
    <main class="docs-page">
${body}
    </main>
    ${prevNext}
  </body>
</html>
`;
}

/**
 * Builds every help page, with its stylesheet, images and font. Throws, listing every problem, if a
 * page links to a page or image that doesn't exist, or a page isn't in the contents (docs/contents.md).
 */
export function buildDocs(): DocsFile[] {
  const pages = readdirSync(DOCS_DIR)
    .filter((file) => file.endsWith(".md"))
    .map((file) => file.slice(0, -3));
  const markdownOf = new Map(pages.map((name) => [name, readFileSync(path.join(DOCS_DIR, `${name}.md`), "utf8")]));
  const titles = new Map(pages.map((name) => [name, titleOf(name, markdownOf.get(name)!)]));
  const problems: string[] = [];

  // The contents' links set the pages' order, for each page's previous and next links.
  if (!markdownOf.has("contents")) throw new Error("docs/contents.md is missing.");
  const order = [...markdownOf.get("contents")!.matchAll(/\]\(([\w-]+)\.md(?:#[^)]*)?\)/g)].map((match) => match[1]!);
  for (const name of pages) {
    if (name !== "contents" && !order.includes(name)) problems.push(`docs/${name}.md isn't listed in docs/contents.md.`);
  }

  const files: DocsFile[] = [];
  for (const name of pages) {
    const marked = new Marked({
      walkTokens(token) {
        if (token.type !== "link" && token.type !== "image") return;
        const target = token as Tokens.Link | Tokens.Image;
        if (/^[a-z]+:|^\/|^#/i.test(target.href)) return;
        const [file, anchor] = target.href.split("#", 2) as [string, string | undefined];
        if (file.endsWith(".md")) {
          const linked = file.slice(0, -3);
          if (!markdownOf.has(linked)) problems.push(`docs/${name}.md links to ${file}, which doesn't exist.`);
          target.href = pageUrl(linked) + (anchor ? `#${anchor}` : "");
        } else {
          if (!existsSync(path.join(DOCS_DIR, file))) problems.push(`docs/${name}.md uses ${file}, which doesn't exist.`);
          target.href = `/docs/${file}`;
        }
      },
    });
    const body = marked.parse(markdownOf.get(name)!, { async: false });
    const at = order.indexOf(name);
    const neighbour = (other: string | undefined) => (other ? { url: pageUrl(other), title: titles.get(other) ?? other } : undefined);
    files.push({
      fileName: pageFile(name),
      source: layout(titles.get(name)!, body, at >= 0 ? neighbour(order[at - 1]) : undefined, at >= 0 ? neighbour(order[at + 1]) : undefined),
    });
  }
  if (problems.length > 0) throw new Error(`Help pages:\n${problems.join("\n")}`);

  files.push({
    fileName: "docs/404.html",
    source: layout(
      "Page not found",
      `<h1>Page not found</h1>\n<p>This help page doesn't exist.</p>\n<p><a href="/docs/contents/">See all the help pages</a></p>`,
    ),
  });
  files.push({ fileName: "docs/docs.css", source: readFileSync(path.join(DOCS_DIR, "docs.css"), "utf8") });
  files.push({ fileName: "docs/font.woff2", source: readFileSync(FONT_FILE) });
  const imagesDir = path.join(DOCS_DIR, "images");
  if (existsSync(imagesDir)) {
    for (const image of readdirSync(imagesDir)) {
      if (!image.startsWith(".")) files.push({ fileName: `docs/images/${image}`, source: readFileSync(path.join(imagesDir, image)) });
    }
  }
  return files;
}

/** The Content-Type for a built help file, by its extension. */
export function docsContentType(fileName: string): string {
  const types: Record<string, string> = {
    html: "text/html; charset=utf-8",
    css: "text/css; charset=utf-8",
    woff2: "font/woff2",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    svg: "image/svg+xml",
    webp: "image/webp",
    gif: "image/gif",
  };
  return types[fileName.split(".").pop()!.toLowerCase()] ?? "application/octet-stream";
}
