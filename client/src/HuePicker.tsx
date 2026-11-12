import { useEffect, useRef, useState } from "react";
import { hueColour, type Shade } from "./colours";

interface Props {
  tagName: string;
  /** The tag's current colour, if it has one. */
  hue: number | undefined;
  /** A chosen hue, or undefined for "No colour". */
  onSet: (hue: number | undefined) => void;
  onCancel: () => void;
}

/** 36 swatches, one every 10°, around a ring. */
const HUES = Array.from({ length: 36 }, (_, index) => index * 10);
/** The ring's radius and each swatch's size, in px. */
const RING_RADIUS = 104;
const SWATCH_PX = 26;

const PREVIEWS: { shade: Shade; label: string }[] = [
  { shade: "active", label: "New / Active" },
  { shade: "waiting", label: "Waiting" },
  { shade: "archived", label: "Archived" },
];

/** The app's own pop-up for choosing a tag's colour, as a hue. */
export function HuePicker({ tagName, hue, onSet, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  // A hue between the swatches (from elsewhere) still starts selected at its nearest one.
  const [chosen, setChosen] = useState(hue === undefined ? undefined : (Math.round(hue / 10) * 10) % 360);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      className="confirm-dialog hue-picker"
      aria-label={`Colour for ${tagName}`}
      // Escape (or the browser's own close) counts as Cancel.
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <p className="due-date-title">Colour for “{tagName}”</p>
      <div className="hue-ring" style={{ width: 2 * RING_RADIUS + SWATCH_PX, height: 2 * RING_RADIUS + SWATCH_PX }}>
        {HUES.map((value) => {
          // 0° (red) at the top, going clockwise.
          const angle = ((value - 90) * Math.PI) / 180;
          return (
            <button
              key={value}
              type="button"
              className={value === chosen ? "hue-swatch chosen" : "hue-swatch"}
              style={{
                left: RING_RADIUS + RING_RADIUS * Math.cos(angle),
                top: RING_RADIUS + RING_RADIUS * Math.sin(angle),
                width: SWATCH_PX,
                height: SWATCH_PX,
                background: hueColour(value, "swatch"),
              }}
              aria-label={`Hue ${value}°`}
              aria-pressed={value === chosen}
              onClick={() => setChosen(value)}
            />
          );
        })}
        {/* In the middle: how notes with this colour look. */}
        <div className="hue-previews">
          {PREVIEWS.map(({ shade, label }) => (
            <div
              key={shade}
              className={chosen === undefined ? "hue-preview none" : "hue-preview"}
              style={chosen === undefined ? undefined : { background: hueColour(chosen, shade) }}
            >
              {label}
            </div>
          ))}
        </div>
      </div>
      <div className="form-buttons">
        <button type="button" className="button primary" disabled={chosen === undefined} onClick={() => onSet(chosen)}>
          Set colour
        </button>
        {hue !== undefined && (
          <button type="button" className="button" onClick={() => onSet(undefined)}>
            No colour
          </button>
        )}
        <button type="button" className="button" onClick={onCancel} autoFocus>
          Cancel
        </button>
      </div>
    </dialog>
  );
}
