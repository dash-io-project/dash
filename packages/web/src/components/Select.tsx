import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "~/lib/cn";
import { moveIndex, typeaheadIndex } from "~/lib/listbox";
import { ICON_STROKE } from "./ui";

export type SelectOption<T extends string = string> = {
  value: T;
  label: string;
  /** A muted second line in the list. The button shows only the label. */
  description?: string;
  disabled?: boolean;
};

export type SelectProps<T extends string> = {
  value: T;
  options: readonly SelectOption<T>[];
  onValueChange: (value: T) => void;
  /** The muted text of the button when no option has the value. */
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  title?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
};

/** The space between the button and the list, and between the list and the window edge. */
const GAP = 4;
const MARGIN = 8;
const MAX_LIST_HEIGHT = 320;
/** The maximum time between two key presses of one type-ahead search. */
const TYPEAHEAD_MS = 500;

/**
 * Puts the list below the button. If the window has more space above the button and the list
 * does not fit below, the list goes above. The list is at least as wide as the button.
 */
function listPosition(trigger: DOMRect, count: number): { side: "top" | "bottom"; style: CSSProperties } {
  const estimate = Math.min(count * 40 + 12, MAX_LIST_HEIGHT);
  const below = window.innerHeight - trigger.bottom - GAP - MARGIN;
  const above = trigger.top - GAP - MARGIN;
  const side = below < estimate && above > below ? "top" : "bottom";
  const left = Math.max(MARGIN, Math.min(trigger.left, window.innerWidth - MARGIN - trigger.width));
  const style: CSSProperties = {
    left,
    minWidth: Math.min(trigger.width, window.innerWidth - 2 * MARGIN),
    maxWidth: window.innerWidth - left - MARGIN,
    maxHeight: Math.min(MAX_LIST_HEIGHT, side === "top" ? above : below),
  };
  if (side === "top") style.bottom = window.innerHeight - trigger.top + GAP;
  else style.top = trigger.bottom + GAP;
  return { side, style };
}

/**
 * A select: a button that opens a list of options. It follows the WAI-ARIA select-only
 * combobox pattern. The focus stays on the button, and `aria-activedescendant` tells
 * assistive technology which option is active.
 */
export function Select<T extends string>({
  value,
  options,
  onValueChange,
  placeholder = "Select",
  disabled = false,
  id,
  className,
  title,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
}: SelectProps<T>) {
  const ownId = useId();
  const triggerId = id ?? `${ownId}-trigger`;
  const listId = `${ownId}-list`;
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const search = useRef({ text: "", time: 0 });
  const [position, setPosition] = useState<ReturnType<typeof listPosition> | null>(null);
  const [active, setActive] = useState(-1);

  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = selectedIndex === -1 ? undefined : options[selectedIndex];
  // A disabled select does not show its list, for example while a change saves.
  const shown = disabled ? null : position;
  const open = shown !== null;
  const optionId = (index: number) => `${ownId}-option-${index}`;

  function show(index: number) {
    if (!trigger.current) return;
    setActive(index);
    setPosition(listPosition(trigger.current.getBoundingClientRect(), options.length));
  }

  function hide() {
    search.current = { text: "", time: 0 };
    setPosition(null);
  }

  function choose(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    hide();
    if (option.value !== value) onValueChange(option.value);
  }

  /** The selected option, or the first enabled option. */
  function startIndex(): number {
    return selected && !selected.disabled ? selectedIndex : moveIndex(options, -1, 1);
  }

  function searching(): boolean {
    return search.current.text !== "" && Date.now() - search.current.time < TYPEAHEAD_MS;
  }

  /** Adds a key to the type-ahead text and returns the matching option, or -1. */
  function typeahead(key: string, from: number): number {
    const text = (searching() ? search.current.text : "") + key;
    search.current = { text, time: Date.now() };
    return typeaheadIndex(options, text, from);
  }

  function isTypeaheadKey(event: KeyboardEvent): boolean {
    return event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
  }

  // A select that becomes disabled closes its list. It does not open again on enable.
  useEffect(() => {
    if (disabled) hide();
  }, [disabled]);

  // Close the list when a click starts outside it, the page scrolls, or the window changes size.
  useEffect(() => {
    if (!open) return;
    function outside(event: Event) {
      const target = event.target;
      if (target instanceof Node && (list.current?.contains(target) || trigger.current?.contains(target))) return;
      hide();
    }
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("scroll", outside, true);
    window.addEventListener("resize", hide);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("scroll", outside, true);
      window.removeEventListener("resize", hide);
    };
  }, [open]);

  // Keep the active option in view. Only the list scrolls, not the page.
  useEffect(() => {
    if (!open || !list.current) return;
    const item = list.current.children[active];
    if (!(item instanceof HTMLElement)) return;
    const box = list.current;
    if (item.offsetTop < box.scrollTop) {
      box.scrollTop = item.offsetTop - GAP;
    } else if (item.offsetTop + item.offsetHeight > box.scrollTop + box.clientHeight) {
      box.scrollTop = item.offsetTop + item.offsetHeight - box.clientHeight + GAP;
    }
  }, [open, active]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const { key } = event;
    if (!open) {
      if (key === "ArrowDown" || key === "ArrowUp" || key === "Enter" || key === " ") {
        event.preventDefault();
        show(startIndex());
      } else if (key === "Home" || key === "End") {
        event.preventDefault();
        show(key === "Home" ? moveIndex(options, -1, 1) : moveIndex(options, options.length, -1));
      } else if (isTypeaheadKey(event)) {
        event.preventDefault();
        const match = typeahead(key, selectedIndex);
        show(match === -1 ? startIndex() : match);
      }
      return;
    }

    let next: number | undefined;
    if (key === "ArrowDown") next = moveIndex(options, active, 1);
    else if (key === "ArrowUp") next = moveIndex(options, active, -1);
    else if (key === "PageDown") next = moveIndex(options, active, 10);
    else if (key === "PageUp") next = moveIndex(options, active, -10);
    else if (key === "Home") next = moveIndex(options, -1, 1);
    else if (key === "End") next = moveIndex(options, options.length, -1);
    else if (key === "Escape") {
      // Stop the key here, so that a dialog around the select stays open.
      event.preventDefault();
      event.stopPropagation();
      hide();
    } else if (key === "Tab") {
      hide();
    } else if (key === "Enter" || (key === " " && !searching())) {
      event.preventDefault();
      choose(active);
    } else if (key === " " || isTypeaheadKey(event)) {
      // A space continues a type-ahead search, for example "Amazon Redshift".
      event.preventDefault();
      const match = typeahead(key, active);
      if (match !== -1) next = match;
    }
    if (next !== undefined) {
      event.preventDefault();
      // A move with an arrow, Page, Home, or End key ends the search, so Space selects again.
      if (!isTypeaheadKey(event)) search.current = { text: "", time: 0 };
      setActive(next);
    }
  }

  return (
    <>
      <button
        ref={trigger}
        id={triggerId}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active !== -1 ? optionId(active) : undefined}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid || undefined}
        title={title}
        disabled={disabled}
        data-placeholder={selected ? undefined : ""}
        className={cn("select-trigger", className)}
        onClick={() => {
          if (open) {
            hide();
            return;
          }
          // Safari does not focus a button on a click. The keys need the focus.
          trigger.current?.focus({ preventScroll: true });
          show(startIndex());
        }}
        onKeyDown={onKeyDown}
        // Some browsers click a button on the release of the space key. The key down opened
        // or closed the list, so stop that click.
        onKeyUp={(event) => {
          if (event.key === " ") event.preventDefault();
        }}
        onBlur={hide}
      >
        <span className="select-value">{selected?.label ?? placeholder}</span>
        <ChevronDown size={16} strokeWidth={ICON_STROKE} aria-hidden="true" className="select-chevron" />
      </button>
      {shown
        ? createPortal(
            <div
              ref={list}
              id={listId}
              role="listbox"
              aria-labelledby={triggerId}
              data-side={shown.side}
              style={shown.style}
              className="menu-panel select-panel"
              // Keep the focus on the button during a click in the list.
              onMouseDown={(event) => event.preventDefault()}
            >
              {options.length === 0 ? (
                <div className="select-empty" role="presentation">
                  No options
                </div>
              ) : null}
              {options.map((option, index) => {
                const isSelected = index === selectedIndex;
                return (
                  <div
                    key={option.value}
                    id={optionId(index)}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={option.disabled || undefined}
                    data-active={index === active ? "" : undefined}
                    className="select-option"
                    onPointerMove={() => {
                      if (!option.disabled && index !== active) setActive(index);
                    }}
                    onClick={() => choose(index)}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{option.label}</span>
                      {option.description ? (
                        <span className="block text-xs text-muted-foreground">{option.description}</span>
                      ) : null}
                    </span>
                    <Check
                      size={16}
                      strokeWidth={ICON_STROKE}
                      aria-hidden="true"
                      className={cn("shrink-0", !isSelected && "invisible")}
                    />
                  </div>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
