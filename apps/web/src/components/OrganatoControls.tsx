import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
} from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

export interface OrganatoSelectOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

interface FloatingMenuPosition {
  top: number;
  left: number;
  width: number;
}

function useFloatingMenu(
  anchorRef: React.RefObject<HTMLElement | null>,
  open: boolean,
  minWidth: number,
  maxHeight: number,
) {
  const [position, setPosition] = useState<FloatingMenuPosition | null>(null);

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const bounds = anchor.getBoundingClientRect();
    const viewportPadding = 10;
    const gap = 6;
    const width = Math.max(bounds.width, minWidth);
    const availableBelow = window.innerHeight - bounds.bottom - viewportPadding;
    const availableAbove = bounds.top - viewportPadding;
    const opensAbove =
      availableBelow < Math.min(maxHeight, 280) &&
      availableAbove > availableBelow;
    const top = opensAbove
      ? Math.max(viewportPadding, bounds.top - Math.min(maxHeight, 340) - gap)
      : Math.min(
          Math.max(viewportPadding, bounds.bottom + gap),
          Math.max(
            viewportPadding,
            window.innerHeight - Math.min(maxHeight, 340) - viewportPadding,
          ),
        );
    const left = Math.min(
      Math.max(viewportPadding, bounds.left),
      Math.max(viewportPadding, window.innerWidth - width - viewportPadding),
    );
    setPosition((current) =>
      current &&
      current.top === top &&
      current.left === left &&
      current.width === width
        ? current
        : { top, left, width },
    );
  }, [anchorRef, maxHeight, minWidth]);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    updatePosition();
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    let frame: number | null = null;
    const handleViewportChange = () => {
      if (frame !== null || document.hidden) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        updatePosition();
      });
    };
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, {
      capture: true,
      passive: true,
    });
    document.addEventListener("visibilitychange", handleViewportChange);
    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
      document.removeEventListener("visibilitychange", handleViewportChange);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [open, updatePosition]);

  return position;
}

function menuStyle(
  position: FloatingMenuPosition | null,
  maxHeight: number,
): CSSProperties {
  if (!position) return { visibility: "hidden" };
  return {
    left: position.left,
    maxHeight,
    top: position.top,
    width: position.width,
  };
}

function nextEnabledIndex(
  options: OrganatoSelectOption[],
  current: number,
  direction: 1 | -1,
): number {
  if (!options.length) return -1;
  for (let offset = 1; offset <= options.length; offset += 1) {
    const index =
      (current + offset * direction + options.length) % options.length;
    if (!options[index]?.disabled) return index;
  }
  return current;
}

export function OrganatoSelect({
  ariaLabel,
  className = "",
  disabled = false,
  options,
  placeholder = "Select…",
  value,
  onChange,
}: {
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  options: OrganatoSelectOption[];
  placeholder?: ReactNode;
  value: string;
  onChange(value: string): void;
}) {
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(() =>
    Math.max(
      0,
      options.findIndex((option) => option.value === value),
    ),
  );
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const id = useId().replaceAll(":", "");
  const listboxId = `organato-select-${id}`;
  const position = useFloatingMenu(triggerRef, open, 150, 320);
  const selectedOption = options.find((option) => option.value === value);

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  const openMenu = useCallback(() => {
    if (disabled) return;
    const selectedIndex = options.findIndex((option) => option.value === value);
    setHighlightedIndex(
      selectedIndex >= 0 && !options[selectedIndex]?.disabled
        ? selectedIndex
        : Math.max(
            0,
            options.findIndex((option) => !option.disabled),
          ),
    );
    setOpen(true);
  }, [disabled, options, value]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !triggerRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [close, open]);

  const choose = (option: OrganatoSelectOption) => {
    if (option.disabled) return;
    onChange(option.value);
    close();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        openMenu();
        return;
      }
      setHighlightedIndex((current) =>
        nextEnabledIndex(options, current, event.key === "ArrowDown" ? 1 : -1),
      );
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      if (!open) return;
      event.preventDefault();
      const index =
        event.key === "Home"
          ? options.findIndex((option) => !option.disabled)
          : options.length -
            1 -
            [...options].reverse().findIndex((option) => !option.disabled);
      if (index >= 0) setHighlightedIndex(index);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!open) {
        openMenu();
        return;
      }
      const option = options[highlightedIndex];
      if (option) choose(option);
    }
  };

  return (
    <span className="organato-select">
      <button
        ref={triggerRef}
        type="button"
        className={`organato-select__trigger ${className}`.trim()}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        aria-controls={open ? listboxId : undefined}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          if (open) close();
          else openMenu();
        }}
        onKeyDown={handleKeyDown}
      >
        <span className="organato-select__value">
          {selectedOption?.label ?? placeholder}
        </span>
        <ChevronDown
          className={`organato-select__chevron${open ? " is-open" : ""}`}
          size={14}
          aria-hidden="true"
        />
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              id={listboxId}
              className="organato-select__menu"
              role="listbox"
              aria-label={ariaLabel}
              style={menuStyle(position, 320)}
            >
              {options.map((option, index) => (
                <button
                  key={option.value || "__empty"}
                  type="button"
                  className={`organato-select__option${
                    index === highlightedIndex ? " is-highlighted" : ""
                  }${option.value === value ? " is-selected" : ""}${
                    option.disabled ? " is-disabled" : ""
                  }`}
                  role="option"
                  aria-selected={option.value === value}
                  disabled={option.disabled}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onClick={(event) => {
                    event.stopPropagation();
                    choose(option);
                  }}
                >
                  <span>{option.label}</span>
                  {option.value === value ? (
                    <Check size={14} aria-hidden="true" />
                  ) : null}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}

export interface OrganatoActionMenuItem {
  label: string;
  onSelect(): void;
  icon?: ReactNode;
  danger?: boolean;
}

export function OrganatoActionMenu({
  ariaLabel,
  items,
}: {
  ariaLabel: string;
  items: OrganatoActionMenuItem[];
}) {
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const id = useId().replaceAll(":", "");
  const menuId = `organato-action-menu-${id}`;
  const position = useFloatingMenu(triggerRef, open, 190, 260);

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  const openMenu = useCallback(
    (index = 0) => {
      setHighlightedIndex(Math.max(0, Math.min(index, items.length - 1)));
      setOpen(true);
    },
    [items.length],
  );

  useEffect(() => {
    if (!open) return;
    itemRefs.current[highlightedIndex]?.focus();
  }, [highlightedIndex, open]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !triggerRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [close, open]);

  return (
    <span className="organato-action-menu">
      <button
        ref={triggerRef}
        className="row-menu"
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={open ? menuId : undefined}
        onClick={(event) => {
          event.stopPropagation();
          if (open) close();
          else openMenu();
        }}
        onKeyDown={(event) => {
          if (
            event.key === "ArrowDown" ||
            event.key === "Enter" ||
            event.key === " "
          ) {
            event.preventDefault();
            openMenu();
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            openMenu(items.length - 1);
          }
        }}
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              className="organato-action-menu__popover"
              role="menu"
              aria-label={ariaLabel}
              style={menuStyle(position, 260)}
            >
              {items.map((item, index) => (
                <button
                  key={item.label}
                  ref={(element) => {
                    itemRefs.current[index] = element;
                  }}
                  type="button"
                  className={item.danger ? "is-danger" : ""}
                  role="menuitem"
                  tabIndex={index === highlightedIndex ? 0 : -1}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                      event.preventDefault();
                      setHighlightedIndex(
                        (current) =>
                          (current +
                            (event.key === "ArrowDown" ? 1 : -1) +
                            items.length) %
                          items.length,
                      );
                    } else if (event.key === "Home" || event.key === "End") {
                      event.preventDefault();
                      setHighlightedIndex(
                        event.key === "Home" ? 0 : items.length - 1,
                      );
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      close();
                    } else if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      close();
                      item.onSelect();
                    }
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    close();
                    item.onSelect();
                  }}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}

function parseDateKey(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const result = new Date(year, month - 1, day, 12);
  return result.getFullYear() === year &&
    result.getMonth() === month - 1 &&
    result.getDate() === day
    ? result
    : null;
}

export function OrganatoDatePicker({
  ariaLabel,
  className = "",
  clearable = true,
  firstDayOfWeek = 1,
  placeholder = "Choose date",
  value,
  onChange,
}: {
  ariaLabel: string;
  className?: string;
  clearable?: boolean;
  firstDayOfWeek?: 0 | 1;
  placeholder?: ReactNode;
  value: string;
  onChange(value: string): void;
}) {
  const selectedDate = parseDateKey(value);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(
    () =>
      selectedDate ??
      new Date(new Date().getFullYear(), new Date().getMonth(), 1, 12),
  );
  const [activeDateKey, setActiveDateKey] = useState(() =>
    format(selectedDate ?? new Date(), "yyyy-MM-dd"),
  );
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const dateButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const id = useId().replaceAll(":", "");
  const popoverId = `organato-date-picker-${id}`;
  const position = useFloatingMenu(triggerRef, open, 320, 400);

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  const openPicker = () => {
    const nextDate = selectedDate ?? new Date();
    setMonth(new Date(nextDate.getFullYear(), nextDate.getMonth(), 1, 12));
    setActiveDateKey(format(nextDate, "yyyy-MM-dd"));
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !triggerRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [close, open]);

  const firstDate = startOfWeek(startOfMonth(month), {
    weekStartsOn: firstDayOfWeek,
  });
  const lastDate = endOfWeek(endOfMonth(month), {
    weekStartsOn: firstDayOfWeek,
  });
  const dates: Date[] = [];
  for (let date = firstDate; date <= lastDate; date = addDays(date, 1)) {
    dates.push(date);
  }
  const weekdays = dates.slice(0, 7);
  const todayKey = format(new Date(), "yyyy-MM-dd");

  useEffect(() => {
    if (!open) return;
    dateButtonRefs.current[activeDateKey]?.focus();
  }, [activeDateKey, open, month]);

  const moveActiveDate = (dateKey: string, amount: number) => {
    const current = parseDateKey(dateKey) ?? new Date();
    const next = new Date(current);
    next.setDate(next.getDate() + amount);
    const nextKey = format(next, "yyyy-MM-dd");
    setActiveDateKey(nextKey);
    if (!isSameMonth(next, month)) {
      setMonth(new Date(next.getFullYear(), next.getMonth(), 1, 12));
    }
  };

  return (
    <span className="organato-date-picker">
      <button
        ref={triggerRef}
        type="button"
        className={`organato-date-picker__trigger ${className}`.trim()}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? popoverId : undefined}
        onClick={(event) => {
          event.stopPropagation();
          if (open) close();
          else openPicker();
        }}
      >
        <CalendarDays size={15} aria-hidden="true" />
        <span>
          {selectedDate ? format(selectedDate, "d MMM yyyy") : placeholder}
        </span>
        <ChevronDown
          className={`organato-select__chevron${open ? " is-open" : ""}`}
          size={14}
          aria-hidden="true"
        />
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              id={popoverId}
              className="organato-date-picker__popover"
              role="dialog"
              aria-label={`${ariaLabel} calendar`}
              style={menuStyle(position, 400)}
            >
              <header className="organato-date-picker__header">
                <button
                  type="button"
                  aria-label="Previous month"
                  onClick={() => setMonth((current) => subMonths(current, 1))}
                >
                  <ChevronLeft size={16} aria-hidden="true" />
                </button>
                <strong>{format(month, "MMMM yyyy")}</strong>
                <button
                  type="button"
                  aria-label="Next month"
                  onClick={() => setMonth((current) => addMonths(current, 1))}
                >
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              </header>
              <div
                className="organato-date-picker__weekdays"
                aria-hidden="true"
              >
                {weekdays.map((date) => (
                  <span key={date.getDay()}>{format(date, "EEE")}</span>
                ))}
              </div>
              <div className="organato-date-picker__grid" role="grid">
                {dates.map((date) => {
                  const dateKey = format(date, "yyyy-MM-dd");
                  const selected = Boolean(
                    selectedDate && isSameDay(date, selectedDate),
                  );
                  return (
                    <button
                      key={dateKey}
                      ref={(element) => {
                        dateButtonRefs.current[dateKey] = element;
                      }}
                      type="button"
                      className={`${isSameMonth(date, month) ? "" : "is-outside"}${selected ? " is-selected" : ""}${dateKey === todayKey ? " is-today" : ""}`}
                      aria-label={format(date, "EEEE d MMMM yyyy")}
                      aria-selected={selected}
                      tabIndex={dateKey === activeDateKey ? 0 : -1}
                      onFocus={() => setActiveDateKey(dateKey)}
                      onKeyDown={(event) => {
                        const offsets: Record<string, number> = {
                          ArrowLeft: -1,
                          ArrowRight: 1,
                          ArrowUp: -7,
                          ArrowDown: 7,
                        };
                        const offset = offsets[event.key];
                        if (offset !== undefined) {
                          event.preventDefault();
                          moveActiveDate(dateKey, offset);
                        } else if (
                          event.key === "Home" ||
                          event.key === "End"
                        ) {
                          event.preventDefault();
                          const dayIndex =
                            (date.getDay() - firstDayOfWeek + 7) % 7;
                          const target = new Date(date);
                          target.setDate(
                            date.getDate() -
                              dayIndex +
                              (event.key === "End" ? 6 : 0),
                          );
                          const targetKey = format(target, "yyyy-MM-dd");
                          setActiveDateKey(targetKey);
                        } else if (
                          event.key === "PageUp" ||
                          event.key === "PageDown"
                        ) {
                          event.preventDefault();
                          const target =
                            event.key === "PageUp"
                              ? subMonths(date, 1)
                              : addMonths(date, 1);
                          const targetKey = format(target, "yyyy-MM-dd");
                          setMonth(
                            new Date(
                              target.getFullYear(),
                              target.getMonth(),
                              1,
                              12,
                            ),
                          );
                          setActiveDateKey(targetKey);
                        } else if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onChange(dateKey);
                          close();
                        }
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        setActiveDateKey(dateKey);
                        onChange(dateKey);
                        close();
                      }}
                    >
                      {format(date, "d")}
                    </button>
                  );
                })}
              </div>
              <footer className="organato-date-picker__footer">
                <button
                  type="button"
                  onClick={() => {
                    onChange(todayKey);
                    setMonth(new Date());
                    close();
                  }}
                >
                  Today
                </button>
                {clearable && value ? (
                  <button
                    type="button"
                    className="is-muted"
                    onClick={() => {
                      onChange("");
                      close();
                    }}
                  >
                    Clear date
                  </button>
                ) : null}
              </footer>
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}

function timeLabel(value: string): string {
  if (!value) return "No time";
  const [hourPart = "0", minutePart = "0"] = value.split(":");
  const hourValue = Number(hourPart);
  const minuteValue = Number(minutePart);
  const hour = hourValue % 12 || 12;
  return `${hour}:${String(minuteValue).padStart(2, "0")} ${hourValue >= 12 ? "PM" : "AM"}`;
}

export const quarterHourOptions: OrganatoSelectOption[] = [
  { value: "", label: "No time · all day" },
  ...Array.from({ length: 96 }, (_, index) => {
    const hour = Math.floor(index / 4);
    const minute = (index % 4) * 15;
    const value = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    return { value, label: timeLabel(value) };
  }),
];
