import { useEffect, useRef, useState } from "react";
import { CalendarDays, Clock3 } from "lucide-react";
import {
  OrganatoDatePicker,
  OrganatoSelect,
  quarterHourOptions,
} from "../../components/OrganatoControls";
import { useDialogFocus } from "../../components/useDialogFocus";

function timeFromMinutes(minutes: number | null): string {
  const value = minutes ?? 9 * 60;
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(
    value % 60,
  ).padStart(2, "0")}`;
}

export function CalendarQuickCreate({
  dateKey,
  initialMinutes,
  onCancel,
  onSave,
}: {
  dateKey: string;
  initialMinutes: number | null;
  onCancel(): void;
  onSave(input: { name: string; dateKey: string; time: string | null }): void;
}) {
  const [name, setName] = useState("");
  const [date, setDate] = useState(dateKey);
  const [hasTime, setHasTime] = useState(initialMinutes !== null);
  const [time, setTime] = useState(() => timeFromMinutes(initialMinutes));
  const dialogRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useDialogFocus(true, dialogRef, titleRef, dateKey);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onCancel]);

  return (
    <div
      className="oc-quick-create-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onCancel();
      }}
    >
      <section
        ref={dialogRef}
        className="oc-quick-create"
        role="dialog"
        aria-modal="true"
        aria-labelledby="oc-quick-create-title"
      >
        <header>
          <div>
            <span className="oc-quick-create__mark" aria-hidden="true">
              ✓
            </span>
            <div>
              <h2 id="oc-quick-create-title">New todo</h2>
              <p>Add it quietly. Refine the details later.</p>
            </div>
          </div>
          <button type="button" onClick={onCancel} aria-label="Close">
            ×
          </button>
        </header>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = name.trim();
            if (!trimmed) return;
            onSave({
              name: trimmed,
              dateKey: date,
              time: hasTime ? time : null,
            });
          }}
        >
          <input
            ref={titleRef}
            className="oc-quick-create__title"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="What needs doing?"
            aria-label="Todo title"
            required
          />
          <div className="oc-quick-create__fields">
            <label>
              <CalendarDays size={15} aria-hidden="true" />
              <span>Date</span>
              <OrganatoDatePicker
                ariaLabel="Date"
                value={date}
                onChange={setDate}
              />
            </label>
            <label>
              <Clock3 size={15} aria-hidden="true" />
              <span>Time</span>
              <input
                type="checkbox"
                checked={hasTime}
                onChange={(event) => setHasTime(event.target.checked)}
                aria-label="Set an exact time"
              />
              {hasTime ? (
                <OrganatoSelect
                  ariaLabel="Due time"
                  options={quarterHourOptions.slice(1)}
                  value={time}
                  onChange={setTime}
                />
              ) : (
                <small>All day</small>
              )}
            </label>
          </div>
          <footer>
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
            <button
              type="submit"
              className="oc-quick-create__submit"
              disabled={!name.trim()}
            >
              Create todo
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
