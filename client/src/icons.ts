import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";

/**
 * "Finish ordering": a bold tick (a rounded stroke 72 units thick, a touch heavier than the arrow's
 * 64) to the left of Font Awesome's arrow-down-wide-short, the "Edit order" icon, in one path. It's wider than it is tall, so
 * show it in a wide button.
 */
export const faFinishOrdering: IconDefinition = {
  prefix: "fas",
  iconName: "finish-ordering" as IconDefinition["iconName"],
  icon: [
    952,
    512,
    [],
    "",
    "M10.5 313.5L102.5 405.5A36 36 0 0 0 157.4 400.7L329.4 156.7A36 36 0 0 0 270.6 115.3L123.2 324.3L61.5 262.5A36 36 0 0 0 10.5 313.5zM622.6 374.6l-96 96c-12.5 12.5 -32.8 12.5 -45.3 0l-96 -96c-12.5 -12.5 -12.5 -32.8 0 -45.3s32.8 -12.5 45.3 0L472 370.7 472 64c0 -17.7 14.3 -32 32 -32s32 14.3 32 32l0 306.7 41.4 -41.4c12.5 -12.5 32.8 -12.5 45.3 0s12.5 32.8 0 45.3zM696 480c-17.7 0 -32 -14.3 -32 -32s14.3 -32 32 -32l32 0c17.7 0 32 14.3 32 32s-14.3 32 -32 32l-32 0zm0 -128c-17.7 0 -32 -14.3 -32 -32s14.3 -32 32 -32l96 0c17.7 0 32 14.3 32 32s-14.3 32 -32 32l-96 0zm0 -128c-17.7 0 -32 -14.3 -32 -32s14.3 -32 32 -32l160 0c17.7 0 32 14.3 32 32s-14.3 32 -32 32l-160 0zm0 -128c-17.7 0 -32 -14.3 -32 -32s14.3 -32 32 -32l224 0c17.7 0 32 14.3 32 32s-14.3 32 -32 32L696 96z",
  ],
};
