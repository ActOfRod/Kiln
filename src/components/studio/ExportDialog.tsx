import { useState } from "react";
import { Download } from "lucide-react";
import { useStudio } from "@/studio/store";
import type { ExportOptions } from "@/studio/export";
import { Sheet } from "./ui";

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const bars = useStudio((s) => s.project.bars);
  const [options, setOptions] = useState<ExportOptions>({
    format: "mp3",
    bitrate: 320,
    source: "arrange",
    startBar: 1,
    endBar: bars,
    tail: true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const valid =
    Number.isInteger(options.startBar) &&
    Number.isInteger(options.endBar) &&
    options.startBar >= 1 &&
    options.endBar >= options.startBar &&
    options.endBar <= bars;
  return (
    <Sheet
      title="Export audio"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="text-sm text-muted mb-5">
        Render your mix locally, with track levels, pan, mute / solo and effects.
      </p>
      <fieldset disabled={busy} className="space-y-4">
        <label className="dialog-field">
          Source
          <select
            aria-label="Export source"
            value={options.source}
            onChange={(event) =>
              setOptions({
                ...options,
                source: event.target.value === "session" ? "session" : "arrange",
              })
            }
          >
            <option value="arrange">Arrangement</option>
            <option value="session">Currently launched session clips</option>
          </select>
        </label>
        <label className="dialog-field">
          Format
          <select
            aria-label="Export format"
            value={options.format}
            onChange={(event) =>
              setOptions({ ...options, format: event.target.value === "mp3" ? "mp3" : "wav" })
            }
          >
            <option value="mp3">MP3 · compressed stereo</option>
            <option value="wav">WAV · 16-bit PCM stereo</option>
          </select>
        </label>
        {options.format === "mp3" && (
          <label className="dialog-field">
            MP3 quality
            <select
              aria-label="MP3 bitrate"
              value={options.bitrate}
              onChange={(event) => {
                const bitrate = Number(event.target.value);
                if (bitrate === 128 || bitrate === 192 || bitrate === 320)
                  setOptions({ ...options, bitrate });
              }}
            >
              <option value={320}>320 kbps · highest quality</option>
              <option value={192}>192 kbps · balanced</option>
              <option value={128}>128 kbps · smaller file</option>
            </select>
          </label>
        )}
        <div className="grid grid-cols-2 gap-3">
          <label className="dialog-field">
            From bar
            <input
              type="number"
              aria-label="Export start bar"
              min={1}
              max={bars}
              value={options.startBar}
              onChange={(event) => setOptions({ ...options, startBar: Number(event.target.value) })}
            />
          </label>
          <label className="dialog-field">
            Through bar
            <input
              type="number"
              aria-label="Export end bar"
              min={options.startBar}
              max={bars}
              value={options.endBar}
              onChange={(event) => setOptions({ ...options, endBar: Number(event.target.value) })}
            />
          </label>
        </div>
        <label className="flex gap-2 items-center text-sm">
          <input
            type="checkbox"
            checked={options.tail}
            onChange={(event) => setOptions({ ...options, tail: event.target.checked })}
          />
          Include 2-second effect tail
        </label>
        <p className="text-xs text-muted">
          44.1 kHz · no metronome · session clips repeat from bar 1. Export does not change
          playback.
        </p>
        {!valid && (
          <p className="text-sm text-record">Choose a whole-bar range between 1 and {bars}.</p>
        )}
        <button
          disabled={!valid}
          className="studio-button primary w-full h-11"
          onClick={() => {
            setBusy(true);
            setError(null);
            setDone(false);
            void useStudio
              .getState()
              .exportSong(options)
              .then(() => setDone(true))
              .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
              .finally(() => setBusy(false));
          }}
        >
          <Download size={16} />
          {busy ? "Rendering and encoding…" : `Export ${options.format.toUpperCase()}`}
        </button>
      </fieldset>
      {error && (
        <p className="panel-error" role="alert">
          {error}
        </p>
      )}
      {done && (
        <p className="text-sm text-accent mt-3" role="status">
          Your audio file has been downloaded.
        </p>
      )}
      <a
        className="mt-4 block text-xs text-faint underline"
        href="/licenses/mp3-encoder.txt"
        target="_blank"
        rel="noreferrer"
      >
        MP3 encoding by LAME · license and source
      </a>
    </Sheet>
  );
}
