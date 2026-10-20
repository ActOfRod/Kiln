import { useEffect, useRef, useState } from "react";
import { Check, Copy, LogOut, Radio, Users } from "lucide-react";
import {
  collabMode,
  joinRoom,
  leaveRoom,
  PEER_COLORS,
  shareLink,
  startSharing,
  useCollab,
} from "@/collab/session";
import type { Presence } from "@/collab/backend";
import { useStudio } from "@/studio/store";
import { formatPosition } from "@/studio/theory";
import { Sheet, cx } from "./ui";

const VIEW_LABELS: Record<string, string> = {
  arrange: "Arrangement",
  session: "Session",
  mix: "Mixer",
  play: "Instruments",
};

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join("") || "?"
  );
}

export function Avatar({ name, color, size = 26 }: { name: string; color: number; size?: number }) {
  return (
    <span
      className="collab-avatar"
      title={name}
      style={{ width: size, height: size, background: PEER_COLORS[color] }}
    >
      {initials(name)}
    </span>
  );
}

/** What a collaborator is doing, in plain words. */
function describePeer(peer: Presence): string {
  const project = useStudio.getState().project;
  const track = project.tracks.find((t) => t.id === peer.trackId);
  const region = track?.arrangement.find((r) => r.id === peer.regionId);
  const where = region ? `${region.name} on ${track!.name}` : (track?.name ?? "the song");
  const view = VIEW_LABELS[peer.view] ?? "Studio";
  const playing = peer.playing ? ` · playing at ${formatPosition(peer.beat)}` : "";
  return `${view} · ${where}${playing}`;
}

export function CollabButton() {
  const room = useCollab((s) => s.room);
  const status = useCollab((s) => s.status);
  const peers = useCollab((s) => s.peers);
  const myName = useCollab((s) => s.name);
  const myColor = useCollab((s) => s.color);
  return (
    <div className="collab-header">
      {room && (
        <div className="collab-stack" aria-label={`${peers.length + 1} people in this session`}>
          {peers.slice(0, 4).map((peer) => (
            <Avatar key={peer.clientId} name={peer.name} color={peer.color} />
          ))}
          <Avatar name={myName || "You"} color={myColor} />
        </div>
      )}
      <button
        className={cx("studio-button", room && "collab-live")}
        aria-label={room ? "Live session" : "Share song"}
        onClick={() => useCollab.setState({ dialog: true })}
      >
        {room ? <Radio size={14} /> : <Users size={14} />}
        {room
          ? status === "live"
            ? "Live"
            : status === "offline"
              ? "Offline"
              : "Joining…"
          : "Share"}
        {room && <span className={cx("collab-dot", status)} aria-hidden="true" />}
      </button>
    </div>
  );
}

export function ShareDialog() {
  const open = useCollab((s) => s.dialog);
  const room = useCollab((s) => s.room);
  const invite = useCollab((s) => s.invite);
  const status = useCollab((s) => s.status);
  const peers = useCollab((s) => s.peers);
  const activity = useCollab((s) => s.activity);
  const error = useCollab((s) => s.error);
  const busy = useCollab((s) => s.busy);
  const dirty = useCollab((s) => s.dirty);
  const savedName = useCollab((s) => s.name);
  const color = useCollab((s) => s.color);
  const songName = useStudio((s) => s.project.name);
  const [name, setName] = useState(savedName);
  const [copied, setCopied] = useState(false);
  const [working, setWorking] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => setName(savedName), [savedName]);
  if (!open) return null;
  const close = () => {
    if (invite && !room) {
      useCollab.setState({ invite: null });
      history.replaceState(history.state, "", `${location.pathname}${location.search}`);
    }
    useCollab.setState({ dialog: false, error: null });
  };
  const act = (work: () => Promise<void>) => {
    setWorking(true);
    useCollab.setState({ error: null });
    void work()
      .catch((err: unknown) =>
        useCollab.setState({ error: err instanceof Error ? err.message : String(err) }),
      )
      .finally(() => setWorking(false));
  };
  const mode = collabMode();
  const nameField = (
    <label className="collab-field">
      Your name, shown to collaborators
      <input
        ref={input}
        aria-label="Your name"
        value={name}
        maxLength={40}
        placeholder="e.g. Sam"
        onChange={(event) => setName(event.target.value)}
      />
    </label>
  );
  const disabled = working || !!busy || !name.trim();
  return (
    <Sheet
      title={room ? "Live session" : invite ? "Join a live session" : "Share this song"}
      onClose={close}
      wide
    >
      <div className="collab-dialog">
        {!room && invite && (
          <>
            <p className="collab-lede">
              You’ve been invited to work on a shared song in real time. Your own song stays saved
              in this browser and comes back when you leave.
            </p>
            {nameField}
            <button
              className="studio-button primary"
              disabled={disabled}
              onClick={() => act(() => joinRoom(invite, name))}
            >
              Join session
            </button>
          </>
        )}
        {!room && !invite && (
          <>
            <p className="collab-lede">
              Start a live session for <strong>{songName}</strong>. Anyone with the link can open
              and edit it with you, and you’ll see each other’s cursors, selections and playheads as
              you work.
            </p>
            <ul className="collab-points">
              <li>Edits to tracks, regions, clips and mixer settings sync instantly.</li>
              <li>Two people can work on different regions at once without overwriting.</li>
              <li>Audio files used by the song are uploaded so everyone can hear them.</li>
              <li>Everyone plays back on their own speakers; export works for anyone.</li>
            </ul>
            {mode === "unavailable" ? (
              <p className="collab-error">
                Live collaboration isn’t configured for this site yet. The site owner needs to add
                the Supabase publishable key.
              </p>
            ) : (
              <>
                {nameField}
                {mode === "local" && (
                  <p className="collab-note">
                    Development mode: sessions only connect tabs in this browser.
                  </p>
                )}
                <button
                  className="studio-button primary"
                  disabled={disabled}
                  onClick={() => act(() => startSharing(name))}
                >
                  <Users size={14} /> Start live session
                </button>
              </>
            )}
          </>
        )}
        {room && (
          <>
            <div className="collab-link">
              <input
                aria-label="Share link"
                readOnly
                value={shareLink(room)}
                onFocus={(e) => e.target.select()}
              />
              <button
                className="studio-button primary"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(shareLink(room))
                    .then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1600);
                    })
                    .catch(() => input.current?.select())
                }
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? "Copied" : "Copy link"}
              </button>
            </div>
            <p className="collab-note">
              Anyone with this link can edit the song. Start a new session to stop sharing an old
              link.{" "}
              <span className={cx("collab-status", status)}>
                {status === "live"
                  ? dirty
                    ? "Saving…"
                    : "All changes saved"
                  : status === "offline"
                    ? "Offline — your edits will sync when you reconnect"
                    : "Connecting…"}
              </span>
            </p>
            <h3 className="section-label">In this session</h3>
            <ul className="collab-people">
              <li>
                <Avatar name={savedName || "You"} color={color} />
                <span>
                  <strong>{savedName || "You"} (you)</strong>
                </span>
              </li>
              {peers.map((peer) => (
                <li key={peer.clientId}>
                  <Avatar name={peer.name} color={peer.color} />
                  <span>
                    <strong>{peer.name}</strong>
                    <small>{describePeer(peer)}</small>
                  </span>
                </li>
              ))}
              {!peers.length && <li className="collab-note">Waiting for someone to join…</li>}
            </ul>
            {activity.length > 0 && (
              <>
                <h3 className="section-label">Recent activity</h3>
                <ul className="collab-activity">
                  {activity.slice(0, 8).map((item) => (
                    <li key={item.id}>
                      <span
                        className="collab-swatch"
                        style={{ background: PEER_COLORS[item.color] }}
                      />
                      <strong>{item.name}</strong> {item.text}
                    </li>
                  ))}
                </ul>
              </>
            )}
            <div className="collab-leave">
              <button
                className="studio-button"
                disabled={working}
                onClick={() =>
                  act(async () => {
                    await leaveRoom("keep");
                    close();
                  })
                }
              >
                <LogOut size={14} /> Leave and keep this version
              </button>
              <button
                className="studio-button"
                disabled={working}
                onClick={() =>
                  act(async () => {
                    await leaveRoom("return");
                    close();
                  })
                }
              >
                Leave and return to my song
              </button>
            </div>
          </>
        )}
        {busy && <p className="collab-note">{busy}</p>}
        {error && (
          <p className="collab-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Sheet>
  );
}
