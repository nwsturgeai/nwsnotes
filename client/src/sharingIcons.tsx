import { useId } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTrashCan } from "@fortawesome/free-regular-svg-icons";
import { faPencil, faUsers } from "@fortawesome/free-solid-svg-icons";
import { higherPermission, type Category, type SharePermission, type Tab, type Tag } from "@nwsnotes/shared";

/** What the icons say, for hovering and screen readers. */
const SHARED_TITLES: Record<SharePermission, string> = {
  read: "Shared by you, to read only",
  edit: "Shared by you; someone can edit",
  delete: "Shared by you; someone can edit and delete",
};

/** The most any recipient may do with a tab's notes: the highest of its filters' shared tags, if any. */
export function tabSharedOut(tab: Tab, categories: Category[]): SharePermission | undefined {
  const tagIds = new Set(tab.categories.flatMap((filter) => filter.tagIds));
  return categories
    .flatMap((category) => category.tags)
    .filter((tag): tag is Tag & { sharedOut: SharePermission } => tagIds.has(tag.id) && tag.sharedOut !== undefined)
    .map((tag) => tag.sharedOut)
    .reduce<SharePermission | undefined>((most, permission) => (most ? higherPermission(most, permission) : permission), undefined);
}

/**
 * "Shared by you": the people icon, a "/", then what the most generous share allows: a trash can for
 * edit and delete, a pencil for edit, or a crossed-out pencil for read only.
 */
export function SharingIcons({ permission }: { permission: SharePermission }) {
  return (
    <span className="sharing-icons" role="img" aria-label={SHARED_TITLES[permission]} title={SHARED_TITLES[permission]}>
      <FontAwesomeIcon icon={faUsers} />
      {/* Drawn by the stylesheet, so it isn't part of the tag's or tab's text. */}
      <span className="sharing-slash" aria-hidden />
      {permission === "delete" ? (
        <FontAwesomeIcon icon={faTrashCan} />
      ) : permission === "edit" ? (
        <FontAwesomeIcon icon={faPencil} />
      ) : (
        <PenSlash />
      )}
    </span>
  );
}

/**
 * A crossed-out pencil, in the style of Font Awesome's "-slash" icons (its pen-slash is Pro only): the
 * free pencil, with a diagonal line through it and a gap cut either side of the line.
 */
function PenSlash() {
  const [width, height, , , path] = faPencil.icon;
  // Each copy has its own mask, so hiding one (e.g. in a closed menu) doesn't affect the others.
  const maskId = `pen-slash-gap-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <svg className="svg-inline--fa pen-slash" viewBox="0 0 640 512" aria-hidden focusable="false">
      <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="640" height="512">
        <rect width="640" height="512" fill="white" />
        <line x1="40" y1="24" x2="600" y2="488" stroke="black" strokeWidth="128" strokeLinecap="round" />
      </mask>
      <g mask={`url(#${maskId})`}>
        <path
          transform={`translate(${(640 - Number(width)) / 2} ${(512 - Number(height)) / 2})`}
          fill="currentColor"
          d={String(path)}
        />
      </g>
      <line x1="40" y1="24" x2="600" y2="488" stroke="currentColor" strokeWidth="48" strokeLinecap="round" />
    </svg>
  );
}
