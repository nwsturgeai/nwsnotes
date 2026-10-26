import {
  LIFETIME_ACTIVE,
  LIFETIME_ARCHIVED,
  LIFETIME_BIN,
  LIFETIME_NEW,
  LIFETIME_WAITING,
  type Category,
} from "@nwsnotes/shared";

/** Lifetime tags notes don't show: Active is the usual state, and Waiting, Archived and Bin rows have their own colour. */
const HIDDEN_ON_NOTES = [LIFETIME_ACTIVE, LIFETIME_WAITING, LIFETIME_ARCHIVED, LIFETIME_BIN];

interface Props {
  tagIds: number[];
  categories: Category[];
  /** Show every Lifetime tag, as tab filters do. Notes only show New. */
  allLifetime?: boolean;
  /** Extra pills after the tags, in their own colour ("Long Form", or a child note's parent title). */
  extra?: string[];
  /** Categories whose tags aren't shown (e.g. single-select categories the selected tab filters on). */
  hideCategoryIds?: number[];
  /** Makes the "New" pill a button (the notes list's "reset the New tags"). */
  onNewClick?: () => void;
  newClickDisabled?: boolean;
}

/** Tags shown as small pills, in category order then tag order. Hovering a pill shows its category. */
export function TagPills({
  tagIds,
  categories,
  allLifetime,
  extra = [],
  hideCategoryIds = [],
  onNewClick,
  newClickDisabled,
}: Props) {
  const pills = categories
    .filter((category) => !hideCategoryIds.includes(category.id))
    .flatMap((category) =>
    category.tags
      .filter((tag) => tagIds.includes(tag.id) && (allLifetime || !HIDDEN_ON_NOTES.includes(tag.id)))
      .map((tag) => ({ tag, category })),
  );
  if (pills.length === 0 && extra.length === 0) return null;
  return (
    <ul className="pills">
      {pills.map(({ tag, category }) =>
        tag.id === LIFETIME_NEW && onNewClick ? (
          <li key={tag.id} className="clickable">
            <button type="button" title="Reset the New tags" disabled={newClickDisabled} onClick={onNewClick}>
              {tag.name}
            </button>
          </li>
        ) : (
          <li key={tag.id} title={category.name}>
            {tag.name}
          </li>
        ),
      )}
      {extra.map((text, index) => (
        <li key={`extra-${index}`} className="special">
          {text}
        </li>
      ))}
    </ul>
  );
}
