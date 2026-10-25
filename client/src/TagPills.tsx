import { LIFETIME_ACTIVE, type Category } from "@nwsnotes/shared";

interface Props {
  tagIds: number[];
  categories: Category[];
  /** Show the Lifetime "Active" tag, which notes don't show (it's the usual state). Tab filters do. */
  showActive?: boolean;
  /** Extra pills after the tags, in their own colour ("Long Form", or a child note's parent title). */
  extra?: string[];
}

/** Tags shown as small pills, in category order then tag order. Hovering a pill shows its category. */
export function TagPills({ tagIds, categories, showActive, extra = [] }: Props) {
  const pills = categories.flatMap((category) =>
    category.tags
      .filter((tag) => tagIds.includes(tag.id) && (showActive || tag.id !== LIFETIME_ACTIVE))
      .map((tag) => ({ tag, category })),
  );
  if (pills.length === 0 && extra.length === 0) return null;
  return (
    <ul className="pills">
      {pills.map(({ tag, category }) => (
        <li key={tag.id} title={category.name}>
          {tag.name}
        </li>
      ))}
      {extra.map((text, index) => (
        <li key={`extra-${index}`} className="special">
          {text}
        </li>
      ))}
    </ul>
  );
}
