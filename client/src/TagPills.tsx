import {
  LIFETIME_ACTIVE,
  LIFETIME_ARCHIVED,
  LIFETIME_BIN,
  LIFETIME_NEW,
  LIFETIME_WAITING,
  tagLabel,
  type Category,
} from "@nwsnotes/shared";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconDefinition } from "@fortawesome/free-solid-svg-icons";
import { SharingIcons } from "./sharingIcons";

/**
 * A pill after a note's tags that isn't a tag, each kind in its own colour: "Long Form" (amber), a
 * child note's parent (purple), and a long-form note's child count (purple, after an icon).
 */
export interface ExtraPill {
  kind: "long-form" | "parent" | "children";
  text: string;
  icon?: IconDefinition;
  /** Shown on hover. */
  title?: string;
  /** Makes the pill a button. */
  onClick?: () => void;
  disabled?: boolean;
  /** Its accessible name, when the text alone doesn't say enough (e.g. a bare count). */
  label?: string;
}

/** Lifetime tags notes don't show: Active is the usual state, and Waiting, Archived and Bin rows have their own colour. */
const HIDDEN_ON_NOTES = [LIFETIME_ACTIVE, LIFETIME_WAITING, LIFETIME_ARCHIVED, LIFETIME_BIN];

interface Props {
  tagIds: number[];
  categories: Category[];
  /** Show every Lifetime tag, as tab filters do. Notes only show New. */
  allLifetime?: boolean;
  /** Extra pills after the tags, in their own colours ("Long Form", a child note's parent, a long-form note's children). */
  extra?: ExtraPill[];
  /** Tags that aren't shown (e.g. a tag the selected tab filters on alone in its category). */
  hideTagIds?: number[];
  /** Makes the "New" pill a button (the notes list's "reset the New tags"). */
  onNewClick?: () => void;
  newClickDisabled?: boolean;
  /** Your own shared tags show the sharing icons after their names (on notes). */
  showSharing?: boolean;
}

/** Tags shown as small pills, in category order then tag order. Hovering a pill shows its category. */
export function TagPills({
  tagIds,
  categories,
  allLifetime,
  extra = [],
  hideTagIds = [],
  onNewClick,
  newClickDisabled,
  showSharing,
}: Props) {
  const pills = categories.flatMap((category) =>
    category.tags
      .filter((tag) => tagIds.includes(tag.id) && !hideTagIds.includes(tag.id) && (allLifetime || !HIDDEN_ON_NOTES.includes(tag.id)))
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
            {tagLabel(tag)}
            {showSharing && tag.sharedOut && <SharingIcons permission={tag.sharedOut} />}
          </li>
        ),
      )}
      {extra.map((pill, index) => {
        const content = (
          <>
            {pill.icon && <FontAwesomeIcon icon={pill.icon} className="pill-icon" />}
            {pill.text}
          </>
        );
        return (
          <li key={`extra-${index}`} className={`special ${pill.kind}${pill.onClick ? " clickable" : ""}`} title={pill.onClick ? undefined : (pill.title ?? pill.label)}>
            {pill.onClick ? (
              <button type="button" title={pill.title} aria-label={pill.label} disabled={pill.disabled} onClick={pill.onClick}>
                {content}
              </button>
            ) : (
              content
            )}
          </li>
        );
      })}
    </ul>
  );
}
