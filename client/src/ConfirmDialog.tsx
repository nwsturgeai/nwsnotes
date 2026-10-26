import { useEffect, useRef } from "react";

interface Props {
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** The confirm button is red (for deleting); otherwise it's the usual accent colour. */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** The app's own confirmation pop-up (a modal <dialog>), used instead of the browser's confirm box. */
export function ConfirmDialog({ message, confirmLabel, cancelLabel = "Cancel", danger = true, onConfirm, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      className="confirm-dialog"
      // Escape (or the browser's own close) counts as Cancel.
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <p>{message}</p>
      <div className="form-buttons">
        <button type="button" className={danger ? "button danger-filled" : "button primary"} onClick={onConfirm} autoFocus>
          {confirmLabel}
        </button>
        <button type="button" className="button" onClick={onCancel}>
          {cancelLabel}
        </button>
      </div>
    </dialog>
  );
}
