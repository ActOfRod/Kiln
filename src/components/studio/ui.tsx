import type { ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ClipColor } from "@/studio/types";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export const CLIP_BG: Record<ClipColor, string> = {
  ember: "bg-clip-ember text-accent-ink",
  clay: "bg-clip-clay text-accent-ink",
  gold: "bg-clip-gold text-accent-ink",
  sage: "bg-clip-sage text-accent-ink",
};

export function Sheet({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-bg/80" />
        <Dialog.Content
          aria-label={title}
          aria-describedby={undefined}
          className={cx(
            "safe-bottom shadow-sheet fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[88dvh] w-full flex-col rounded-t-lg bg-surface md:top-1/2 md:bottom-auto md:-translate-y-1/2",
            wide ? "max-w-3xl" : "max-w-lg",
          )}
        >
          <div className="flex h-14 shrink-0 items-center justify-between gap-3 px-4">
            <Dialog.Title className="text-base font-semibold text-balance">{title}</Dialog.Title>
            <button
              type="button"
              aria-label="Close"
              className="press grid h-11 w-11 place-items-center rounded-md bg-surface-2 text-fg"
              onClick={onClose}
            >
              <X className="size-5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Field({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex flex-col py-1">
      <span className="flex items-baseline justify-between gap-3 text-sm">
        <span>{label}</span>
        <span className="font-mono text-xs text-muted tabular-nums">{display}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

export function Fader({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const setFromY = (clientY: number, el: HTMLDivElement) => {
    const rect = el.getBoundingClientRect();
    const next = 1 - (clientY - rect.top) / rect.height;
    onChange(Math.min(1, Math.max(0, next)));
  };

  return (
    <div
      role="slider"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      tabIndex={0}
      className="relative min-h-36 w-12 flex-1 touch-none rounded-md bg-surface-3"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        setFromY(event.clientY, event.currentTarget);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          setFromY(event.clientY, event.currentTarget);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowUp") onChange(Math.min(1, value + 0.04));
        if (event.key === "ArrowDown") onChange(Math.max(0, value - 0.04));
      }}
    >
      <div
        className="absolute inset-x-2 bottom-0 rounded-sm bg-accent"
        style={{ height: `${value * 100}%` }}
      />
      <div
        className="absolute inset-x-1 h-1 rounded-full bg-fg"
        style={{ bottom: `calc(${value * 100}% - 2px)` }}
      />
    </div>
  );
}
