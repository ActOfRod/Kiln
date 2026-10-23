import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { Maximize2, Minimize2 } from "lucide-react";
import { clamp } from "@/studio/theory";

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

/** Sizes are null until the user drags, so CSS breakpoints keep choosing the defaults. */
type Layout = {
  libraryWidth: number | null;
  inspectorWidth: number | null;
  editorHeight: number | null;
  editorMax: boolean;
  sheetMax: boolean;
  set: (patch: Partial<Omit<Layout, "set">>) => void;
};

const memory = new Map<string, string>();

export const useLayout = create<Layout>()(
  persist(
    (set) => ({
      libraryWidth: null,
      inspectorWidth: null,
      editorHeight: null,
      editorMax: false,
      sheetMax: false,
      set: (patch) => set(patch),
    }),
    {
      name: "kiln-layout-v1",
      skipHydration: true,
      storage: createJSONStorage(() =>
        typeof window === "undefined"
          ? {
              getItem: (key) => memory.get(key) ?? null,
              setItem: (key, value) => void memory.set(key, value),
              removeItem: (key) => void memory.delete(key),
            }
          : localStorage,
      ),
      partialize: ({ set: _set, ...rest }) => rest,
    },
  ),
);

/** Largest a side pane may grow while leaving the timeline at least 360px wide. */
export function sidePaneRoom(handle: HTMLElement, pane: Element | null): number {
  const main = handle.closest(".studio-workspace")?.querySelector(".studio-main");
  if (!main || !pane) return 400;
  return pane.getBoundingClientRect().width + main.getBoundingClientRect().width - 360;
}

/**
 * A draggable divider between panes. Drag, use arrow keys, or double-click to reset.
 * `measure` reads the pane's current size; `bounds` returns the allowed [min, max] at drag start.
 */
export function ResizeHandle({
  axis,
  label,
  value,
  direction = 1,
  measure,
  bounds,
  onChange,
  onReset,
  className,
}: {
  axis: "x" | "y";
  label: string;
  value: number | null;
  /** +1 when dragging right/down grows the pane, -1 when it shrinks it. */
  direction?: 1 | -1;
  measure: (handle: HTMLElement) => number;
  bounds: (handle: HTMLElement) => [number, number];
  onChange: (size: number) => void;
  onReset: () => void;
  className?: string;
}) {
  const [dragging, setDragging] = useState(false);
  const fit = (handle: HTMLElement, size: number) => {
    const [min, max] = bounds(handle);
    return Math.round(clamp(size, min, Math.max(min, max)));
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const origin = axis === "x" ? event.clientX : event.clientY;
    const start = measure(handle);
    setDragging(true);
    document.body.classList.add(axis === "x" ? "resizing-x" : "resizing-y");
    const move = (e: PointerEvent) => {
      const delta = (axis === "x" ? e.clientX : e.clientY) - origin;
      onChange(fit(handle, start + delta * direction));
    };
    const up = () => {
      setDragging(false);
      document.body.classList.remove("resizing-x", "resizing-y");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      aria-valuenow={value ?? undefined}
      title={`${label} · drag to resize, double-click to reset`}
      className={cx("pane-resizer", axis, dragging && "dragging", className)}
      onPointerDown={onPointerDown}
      onDoubleClick={onReset}
      onKeyDown={(event) => {
        const keys =
          axis === "x" ? { ArrowLeft: -1, ArrowRight: 1 } : { ArrowUp: -1, ArrowDown: 1 };
        const step = keys[event.key as keyof typeof keys];
        if (!step) return;
        event.preventDefault();
        event.stopPropagation();
        const handle = event.currentTarget;
        onChange(fit(handle, measure(handle) + step * direction * (event.shiftKey ? 64 : 16)));
      }}
    />
  );
}

/** Toggles the clip editor between docked and filling the studio workspace. */
export function MaximizeButton({
  active,
  onToggle,
  what = "editor",
  hint = true,
}: {
  active: boolean;
  onToggle: () => void;
  what?: string;
  hint?: boolean;
}) {
  const Icon = active ? Minimize2 : Maximize2;
  const label = active ? `Restore ${what} size` : `Expand ${what} to full window`;
  return (
    <button
      type="button"
      className={cx("icon-button", active && "active")}
      aria-label={label}
      aria-pressed={active}
      title={active && hint ? `${label} (Esc)` : label}
      onClick={onToggle}
    >
      <Icon size={14} />
    </button>
  );
}

/** Expand / restore button for the docked clip editor. */
export function EditorMaximize() {
  const maximized = useLayout((s) => s.editorMax);
  return (
    <MaximizeButton
      active={maximized}
      what="clip editor"
      onToggle={() => useLayout.getState().set({ editorMax: !maximized })}
    />
  );
}

/** Esc leaves full-window mode before the studio's global Esc (stop) handler sees it. */
export function useEscapeToRestore(active: boolean, restore: () => void) {
  const latest = useRef(restore);
  latest.current = restore;
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || document.querySelector("[role=dialog]")) return;
      event.preventDefault();
      event.stopPropagation();
      latest.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active]);
}

/** Tracks an element's content box so editors can grow their grid to fill the space. */
export function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize((prev) =>
        prev.width === Math.round(width) && prev.height === Math.round(height)
          ? prev
          : { width: Math.round(width), height: Math.round(height) },
      );
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}
