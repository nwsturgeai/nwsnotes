import type { Category } from "@nwsnotes/shared";

/** Tags shown as small pills, in category order then tag order. Hovering a pill shows its category. */
export function TagPills({ tagIds, categories }: { tagIds: number[]; categories: Category[] }) {
  const pills = categories.flatMap((category) =>
    category.tags.filter((tag) => tagIds.includes(tag.id)).map((tag) => ({ tag, category })),
  );
  if (pills.length === 0) return null;
  return (
    <ul className="pills">
      {pills.map(({ tag, category }) => (
        <li key={tag.id} title={category.name}>
          {tag.name}
        </li>
      ))}
    </ul>
  );
}
