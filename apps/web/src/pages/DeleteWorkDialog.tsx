import { memo, useRef, useState } from "react";
import type { OrganatoItem } from "@organato/domain";
import { useDialogFocus } from "../components/useDialogFocus";

interface DeleteWorkDialogProps {
  candidate: OrganatoItem;
  itemNoun: "assignment" | "checkpoint";
  onCancel(): void;
  onDelete(confirmation: string): void;
}

/** Keep per-keystroke confirmation state away from the work table. */
export const DeleteWorkDialog = memo(function DeleteWorkDialog({
  candidate,
  itemNoun,
  onCancel,
  onDelete,
}: DeleteWorkDialogProps) {
  const [matchesDelete, setMatchesDelete] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const confirmationRef = useRef<HTMLInputElement>(null);
  useDialogFocus(true, dialogRef, closeRef, candidate.id);

  return (
    <div
      className="delete-item-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onCancel();
      }}
    >
      <section
        ref={dialogRef}
        className="delete-item-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-item-title"
      >
        <header>
          <h2 id="delete-item-title">Delete {itemNoun}?</h2>
          <button
            ref={closeRef}
            type="button"
            className="icon-button"
            aria-label="Close delete dialog"
            onClick={onCancel}
          >
            ×
          </button>
        </header>
        <p>
          This permanently removes <strong>{candidate.displayName}</strong> from
          Organato. This cannot be undone.
        </p>
        <label>
          <span>
            Type <strong>delete</strong> to confirm
          </span>
          <input
            ref={confirmationRef}
            aria-label={`Type delete to confirm ${itemNoun} deletion`}
            autoComplete="off"
            onChange={(event) => {
              const matches =
                event.target.value.trim().toLowerCase() === "delete";
              setMatchesDelete((current) =>
                current === matches ? current : matches,
              );
            }}
          />
        </label>
        <footer>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="danger-button"
            disabled={!matchesDelete}
            onClick={() => onDelete("delete")}
          >
            Delete {itemNoun}
          </button>
        </footer>
      </section>
    </div>
  );
});
