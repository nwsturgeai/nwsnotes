import { useId } from "react";
import { faUsers } from "@fortawesome/free-solid-svg-icons";
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

/*
 * The icons are drawn on a 660 x 532 canvas: Font Awesome's people (640 x 512) at the top left, with room
 * for a badge to stand a little past its bottom right corner.
 */
const WIDTH = 660;
const HEIGHT = 532;
/** How wide the gap cut out of the people round a badge is, both sides together. */
const GAP = 120;

/** A badge's shape, its transform onto the canvas, and that transform's scale (so the gap stays the same width). */
interface Badge {
  d: string;
  transform: string;
  scale: number;
  evenOdd?: boolean;
}

/** A pencil drawn lying flat, centred on 0,0, and turned to point down and to the left: a tip, a body, and an eraser apart from it. */
function pencilBadge(): Badge {
  const length = 620;
  const width = 125;
  const [eraserX, eraserY] = [612, 92];
  const half = width / 2;
  const start = -length / 2;
  const end = length / 2;
  const tip = width * 1.05;
  const eraser = width * 0.62;
  const gap = width * 0.16;
  const round = width * 0.22;
  const bodyEnd = end - eraser - gap;
  const d =
    `M${start} 0 L${start + tip} ${-half} H${bodyEnd} V${half} H${start + tip} Z ` +
    `M${bodyEnd + gap} ${-half} H${end - round} Q${end} ${-half} ${end} ${-half + round} ` +
    `V${half - round} Q${end} ${half} ${end - round} ${half} H${bodyEnd + gap} Z`;
  const centreX = eraserX - (length / 2) * Math.SQRT1_2;
  const centreY = eraserY + (length / 2) * Math.SQRT1_2;
  return { d, transform: `translate(${centreX} ${centreY}) rotate(-45)`, scale: 1 };
}

/** A trash can (448 x 512) with its lid joined on and two slots, in a 360-unit box at the bottom right. */
function trashCanBadge(): Badge {
  const slot = (x: number) => `M${x} 168 a24 24 0 0 1 24 24 V392 a24 24 0 0 1 -48 0 V192 a24 24 0 0 1 24 -24 Z`;
  const d =
    "M24 40 H140 L156 8 Q160 0 170 0 H278 Q288 0 292 8 L308 40 H424 Q448 40 448 64 V80 Q448 104 424 104 H416 " +
    `V432 Q416 480 368 480 H80 Q32 480 32 432 V104 H24 Q0 104 0 80 V64 Q0 40 24 40 Z ${slot(166)} ${slot(282)}`;
  const box = 360;
  const scale = box / 512;
  return { d, transform: `translate(${WIDTH - 20 - box + (box - 448 * scale) / 2} ${HEIGHT - 20 - box}) scale(${scale})`, scale, evenOdd: true };
}

const BADGES: Partial<Record<SharePermission, Badge>> = { edit: pencilBadge(), delete: trashCanBadge() };

/**
 * "Shared by you": one icon for what the most generous share allows: people for read only, people with a
 * pencil for edit, or people with a trash can for edit and delete.
 */
export function SharingIcons({ permission }: { permission: SharePermission }) {
  // Each copy has its own mask, so hiding one (e.g. in a closed menu) doesn't affect the others.
  const maskId = `sharing-gap-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const badge = BADGES[permission];
  const people = String(faUsers.icon[4]);
  return (
    <span className="sharing-icons" role="img" aria-label={SHARED_TITLES[permission]} title={SHARED_TITLES[permission]}>
      <svg className="svg-inline--fa sharing-icon" data-permission={permission} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-hidden focusable="false">
        {badge && (
          <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width={WIDTH} height={HEIGHT}>
            <rect width={WIDTH} height={HEIGHT} fill="white" />
            {/* The badge with a thick outline, cutting the people away round it. */}
            <path
              transform={badge.transform}
              d={badge.d}
              fill="black"
              stroke="black"
              strokeWidth={GAP / badge.scale}
              strokeLinejoin="round"
            />
          </mask>
        )}
        <path fill="currentColor" d={people} mask={badge ? `url(#${maskId})` : undefined} />
        {badge && <path transform={badge.transform} d={badge.d} fill="currentColor" fillRule={badge.evenOdd ? "evenodd" : undefined} />}
      </svg>
    </span>
  );
}
