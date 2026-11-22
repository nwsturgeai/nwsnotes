import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";

/**
 * "Finish ordering": Font Awesome's check (scaled to 70% and centred vertically) to the left of
 * arrow-down-wide-short, the "Edit order" icon, in one path. It's wider than it is tall, so
 * show it in a wide button.
 */
export const faFinishOrdering: IconDefinition = {
  prefix: "fas",
  iconName: "finish-ordering" as IconDefinition["iconName"],
  icon: [
    930,
    512,
    [],
    "",
    "M304.4 125.9c10 7.3 12.3 21.3 5 31.3l-179.2 246.4c-3.8 5.3 -9.8 8.6 -16.4 9.2s-12.9 -1.9 -17.6 -6.5l-89.6 -89.6c-8.8 -8.8 -8.8 -23 0 -31.7s23 -8.8 31.7 0l71 71 163.8 -225.2c7.3 -10 21.3 -12.3 31.3 -5zM600.6 374.6l-96 96c-12.5 12.5 -32.8 12.5 -45.3 0l-96 -96c-12.5 -12.5 -12.5 -32.8 0 -45.3s32.8 -12.5 45.3 0L450 370.7 450 64c0 -17.7 14.3 -32 32 -32s32 14.3 32 32l0 306.7 41.4 -41.4c12.5 -12.5 32.8 -12.5 45.3 0s12.5 32.8 0 45.3zM674 480c-17.7 0 -32 -14.3 -32 -32s14.3 -32 32 -32l32 0c17.7 0 32 14.3 32 32s-14.3 32 -32 32l-32 0zm0 -128c-17.7 0 -32 -14.3 -32 -32s14.3 -32 32 -32l96 0c17.7 0 32 14.3 32 32s-14.3 32 -32 32l-96 0zm0 -128c-17.7 0 -32 -14.3 -32 -32s14.3 -32 32 -32l160 0c17.7 0 32 14.3 32 32s-14.3 32 -32 32l-160 0zm0 -128c-17.7 0 -32 -14.3 -32 -32s14.3 -32 32 -32l224 0c17.7 0 32 14.3 32 32s-14.3 32 -32 32L674 96z",
  ],
};
