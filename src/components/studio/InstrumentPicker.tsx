import { Check, Drum, KeyboardMusic, Music, Piano, Waves, Zap } from "lucide-react";
import { engine } from "@/studio/engine";
import { instrumentOf, instrumentsFor, type InstrumentDef } from "@/studio/instruments";
import { useStudio } from "@/studio/store";
import type { Track } from "@/studio/types";
import { cx } from "./ui";

const ICONS: Record<InstrumentDef["family"], typeof Piano> = {
  Keys: Piano,
  "Strings & pads": Waves,
  "Plucked & mallets": Music,
  Bass: KeyboardMusic,
  Synth: Zap,
  Drums: Drum,
};

/** Play a short phrase so the new sound can be heard immediately. */
async function audition(track: Track) {
  try {
    await engine.ensure();
  } catch {
    return;
  }
  const hits: Array<[number, number]> =
    track.kind === "drums"
      ? [
          [36, 0],
          [42, 180],
          [38, 360],
          [46, 540],
        ]
      : track.kind === "bass"
        ? [
            [36, 0],
            [43, 260],
          ]
        : track.kind === "lead"
          ? [
              [72, 0],
              [76, 200],
              [79, 400],
            ]
          : [
              [60, 0],
              [64, 0],
              [67, 0],
            ];
  for (const [pitch, at] of hits)
    window.setTimeout(() => {
      engine.previewDown(track.id, pitch, 0.8);
      window.setTimeout(() => engine.previewUp(track.id, pitch), 550);
    }, at);
}

export function InstrumentPicker({ track, compact = false }: { track: Track; compact?: boolean }) {
  const current = instrumentOf(track.kind, track.device);
  const options = instrumentsFor(track.kind);
  if (!options.length) return null;
  const families = [...new Set(options.map((item) => item.family))];
  return (
    <section className={cx("instrument-picker", compact && "compact")} aria-label="Instrument">
      {families.map((family) => {
        const Icon = ICONS[family];
        return (
          <div key={family} className="instrument-family">
            <p className="section-label">{family}</p>
            <div className="instrument-grid" role="radiogroup" aria-label={`${family} instruments`}>
              {options
                .filter((item) => item.family === family)
                .map((item) => {
                  const active = item.id === current.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      className={cx("instrument-card", active && "active")}
                      title={item.description}
                      onClick={() => {
                        if (!active) useStudio.getState().setInstrument(track.id, item.id);
                        const updated = useStudio
                          .getState()
                          .project.tracks.find((t) => t.id === track.id);
                        if (updated) void audition(updated);
                      }}
                    >
                      <Icon size={16} />
                      <span>
                        <strong>{item.name}</strong>
                        {!compact && <small>{item.description}</small>}
                      </span>
                      {active && <Check size={14} className="instrument-check" />}
                    </button>
                  );
                })}
            </div>
          </div>
        );
      })}
    </section>
  );
}
