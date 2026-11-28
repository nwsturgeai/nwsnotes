import { useEffect, useRef, type MouseEvent as ReactMouseEvent } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck } from "@fortawesome/free-solid-svg-icons";
import { PEN_COLOURS } from "./stylusMode";

interface Props {
  /** The pen colour now (ticked, if it's one of these). */
  colour: string;
  /** A colour was tapped (the event, so stylus mode can ignore finger taps). */
  onChoose: (colour: string, event: ReactMouseEvent) => void;
  onCancel: () => void;
}

/** A pop-up of pen colours for long-form notes' handwriting: tapping one chooses it. Black is in the pen menu. */
export function PenColourDialog({ colour, onChoose, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      className="confirm-dialog pen-colour-dialog"
      aria-labelledby="pen-colour-heading"
      // Escape (or the browser's own close) counts as Cancel.
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <p id="pen-colour-heading">Pen colour</p>
      <div className="pen-colours" role="group" aria-label="Pen colours">
        {PEN_COLOURS.map((option) => (
          <button
            key={option.value}
            type="button"
            className="pen-colour"
            aria-label={option.name}
            aria-pressed={colour === option.value}
            title={option.name}
            style={{ background: option.value }}
            onClick={(event) => onChoose(option.value, event)}
          >
            {colour === option.value && <FontAwesomeIcon icon={faCheck} />}
          </button>
        ))}
      </div>
      <div className="form-buttons">
        <button type="button" className="button" onClick={onCancel} autoFocus>
          Cancel
        </button>
      </div>
    </dialog>
  );
}
