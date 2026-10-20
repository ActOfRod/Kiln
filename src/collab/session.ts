import { create } from "zustand";
import {
  applyRemoteProject,
  replaceProject,
  suspendAutosave,
  useStudio,
  type StudioState,
} from "../studio/store";
import { engine } from "../studio/engine";
import { idbGet } from "../studio/samples";
import { requiredAssets } from "../studio/audio-clip";
import { projectSchema } from "../studio/project-file";
import type { Project } from "../studio/types";
import {
  applyEntities,
  applyOps,
  describeOps,
  diffProject,
  isOp,
  maxCounter,
  mergeDocs,
  type Clocks,
  type Op,
} from "./doc";
import type { ChannelStatus, CollabBackend, Presence, RoomChannel, RoomSnapshot } from "./backend";

export const PEER_COLORS = [
  "#7cc4ff",
  "#f28fb1",
  "#9be08a",
  "#c9a2ff",
  "#ffd36e",
  "#6ee7d8",
  "#ff9f6e",
  "#b5c0ff",
];

const CHUNK_BYTES = 512 * 1024;
const MAX_LIVE_MESSAGE = 200_000;

export interface Activity {
  id: string;
  name: string;
  color: number;
  text: string;
  at: number;
}

export type CollabStatus = "idle" | "connecting" | "live" | "offline" | "error";

interface CollabState {
  status: CollabStatus;
  room: { id: string; secret: string } | null;
  invite: { id: string; secret: string } | null;
  name: string;
  clientId: string;
  color: number;
  peers: Presence[];
  activity: Activity[];
  error: string | null;
  busy: string | null;
  dialog: boolean;
  dirty: boolean;
}

function storedName(): string {
  try {
    return localStorage.getItem("kiln-collab-name") ?? "";
  } catch {
    return "";
  }
}

const clientId = typeof crypto !== "undefined" ? crypto.randomUUID() : "server";

export const useCollab = create<CollabState>(() => ({
  status: "idle",
  room: null,
  invite: null,
  name: typeof window === "undefined" ? "" : storedName(),
  clientId,
  color: Number.parseInt(clientId.slice(0, 2), 16) % PEER_COLORS.length || 0,
  peers: [],
  activity: [],
  error: null,
  busy: null,
  dialog: false,
  dirty: false,
}));

let backendPromise: Promise<CollabBackend | null> | null = null;

export function collabMode(): "cloud" | "local" | "unavailable" {
  if (import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY)
    return "cloud";
  return import.meta.env.DEV ? "local" : "unavailable";
}

function getBackend(): Promise<CollabBackend | null> {
  backendPromise ??= (async () => {
    const mode = collabMode();
    if (mode === "cloud") {
      const { supabaseBackend } = await import("./supabase-backend");
      return supabaseBackend(
        import.meta.env.VITE_SUPABASE_URL as string,
        import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
      );
    }
    if (mode === "local") return (await import("./local-backend")).localBackend();
    return null;
  })();
  return backendPromise;
}

async function requireBackend(): Promise<CollabBackend> {
  const backend = await getBackend();
  if (!backend)
    throw new Error(
      "Live collaboration isn't configured for this site yet. Add the Supabase publishable key to enable it.",
    );
  return backend;
}

// Session runtime state (not rendered directly).
let channel: RoomChannel | null = null;
let clocks: Clocks = {};
let revision = 0;
let lamport = 0;
let applyingRemote = false;
let stopWatching: (() => void) | null = null;
let localBackup: Project | null = null;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saveChain: Promise<void> = Promise.resolve();
let needsResync = false;
let presenceTimer: ReturnType<typeof setTimeout> | undefined;
let heartbeat: ReturnType<typeof setInterval> | undefined;
let selection: { regionId: string | null; cursor: Presence["cursor"] } = {
  regionId: null,
  cursor: null,
};
const uploaded = new Set<string>();
const inflight = new Set<string>();

function fail(error: unknown) {
  useCollab.setState({ error: error instanceof Error ? error.message : String(error) });
}

function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function channelName(room: string, secret: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`kiln-channel:${secret}`),
  );
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `kiln-${room}-${hex.slice(0, 24)}`;
}

export function shareLink(room: { id: string; secret: string }): string {
  return `${location.origin}${location.pathname}${location.search}#room=${room.id}.${room.secret}`;
}

function setHash(room: { id: string; secret: string } | null) {
  const url = room ? shareLink(room) : `${location.pathname}${location.search}`;
  history.replaceState(history.state, "", url);
}

export function parseInvite(hash: string): { id: string; secret: string } | null {
  const match = /^#room=([0-9a-f-]{36})\.([A-Za-z0-9_-]{32,200})$/i.exec(hash);
  return match ? { id: match[1]!, secret: match[2]! } : null;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

function fromBase64(data: string): Uint8Array {
  return Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
}

function addActivity(peerId: string, text: string) {
  const peer = useCollab.getState().peers.find((p) => p.clientId === peerId);
  const entry: Activity = {
    id: crypto.randomUUID(),
    name: peer?.name || "A collaborator",
    color: peer?.color ?? 0,
    text,
    at: Date.now(),
  };
  useCollab.setState((s) => ({ activity: [entry, ...s.activity].slice(0, 30) }));
}

function sanitizePresence(value: unknown): Presence | null {
  if (!value || typeof value !== "object") return null;
  const p = value as Partial<Presence>;
  if (typeof p.clientId !== "string") return null;
  const finite = (n: unknown, fallback = 0) =>
    typeof n === "number" && Number.isFinite(n) ? n : fallback;
  const cursor =
    p.cursor && typeof p.cursor.trackId === "string"
      ? { trackId: p.cursor.trackId, beat: finite(p.cursor.beat) }
      : null;
  return {
    clientId: p.clientId.slice(0, 64),
    name: (typeof p.name === "string" && p.name.trim().slice(0, 40)) || "Guest",
    color: Math.abs(Math.round(finite(p.color))) % PEER_COLORS.length,
    view: typeof p.view === "string" ? p.view.slice(0, 20) : "arrange",
    trackId: typeof p.trackId === "string" ? p.trackId : null,
    regionId: typeof p.regionId === "string" ? p.regionId : null,
    cursor,
    playing: !!p.playing,
    beat: finite(p.beat),
    bpm: finite(p.bpm, 120) || 120,
    at: finite(p.at, Date.now()),
  };
}

function presenceNow(): Presence {
  const studio = useStudio.getState();
  const me = useCollab.getState();
  return {
    clientId,
    name: me.name || "Guest",
    color: me.color,
    view: studio.view,
    trackId: studio.selectedTrackId,
    regionId: selection.regionId,
    cursor: selection.cursor,
    playing: studio.playing,
    beat: studio.playing ? engine.currentBeat() : studio.beat,
    bpm: studio.project.bpm,
    at: Date.now(),
  };
}

function publishPresence(delay = 90) {
  if (!channel || presenceTimer) return;
  presenceTimer = setTimeout(() => {
    presenceTimer = undefined;
    void channel?.track(presenceNow()).catch(() => {});
  }, delay);
}

export function setSelection(regionId: string | null) {
  if (selection.regionId === regionId) return;
  selection = { ...selection, regionId };
  publishPresence();
}

export function setCursor(cursor: Presence["cursor"]) {
  selection = { ...selection, cursor };
  publishPresence(70);
}

async function broadcast(message: Record<string, unknown>) {
  if (!channel) return;
  if (JSON.stringify(message).length > MAX_LIVE_MESSAGE) {
    // Too large for a live message: peers reload the saved song instead.
    needsResync = true;
    return;
  }
  await channel.send(message).catch(() => {
    needsResync = true;
  });
}

function applyFromCollaborators(project: Project, changes: Array<{ k: string; v: unknown }>) {
  applyingRemote = true;
  try {
    applyRemoteProject(project, (snapshot) => applyEntities(snapshot, changes));
  } finally {
    applyingRemote = false;
  }
}

function receiveOps(ops: Op[], from: string) {
  const result = applyOps({ project: useStudio.getState().project, clocks }, ops);
  if (!result.changed.length) return;
  lamport = Math.max(lamport, ...result.changed.map((op) => op.s.c));
  if (!projectSchema.safeParse(result.project).success) {
    void pullAndMerge().catch(fail);
    return;
  }
  clocks = result.clocks;
  applyFromCollaborators(result.project, result.changed);
  addActivity(from, describeOps(result.changed, result.project));
  scheduleAssets();
}

function onMessage(message: unknown) {
  if (!message || typeof message !== "object") return;
  const msg = message as { type?: string; ops?: unknown; from?: unknown };
  if (msg.type === "ops" && Array.isArray(msg.ops))
    receiveOps(msg.ops.filter(isOp), typeof msg.from === "string" ? msg.from : "");
  else if (msg.type === "resync") void pullAndMerge().catch(fail);
  else if (msg.type === "asset") scheduleAssets();
}

function onPresence(list: Presence[]) {
  const before = useCollab.getState().peers;
  const peers = list
    .map(sanitizePresence)
    .filter((p): p is Presence => !!p && p.clientId !== clientId);
  for (const peer of peers)
    if (!before.some((p) => p.clientId === peer.clientId)) {
      useCollab.setState({ peers: [...useCollab.getState().peers, peer] });
      addActivity(peer.clientId, "joined the session");
    }
  for (const peer of before)
    if (!peers.some((p) => p.clientId === peer.clientId)) addActivity(peer.clientId, "left");
  useCollab.setState({ peers });
  // Give everyone a distinct color: the later client ID yields when colors clash.
  const mine = useCollab.getState().color;
  if (peers.some((p) => p.color === mine && p.clientId < clientId)) {
    const taken = new Set(peers.map((p) => p.color));
    const free = PEER_COLORS.findIndex((_, i) => !taken.has(i));
    if (free >= 0) {
      useCollab.setState({ color: free });
      publishPresence(0);
    }
  }
}

function onStatus(status: ChannelStatus) {
  const previous = useCollab.getState().status;
  useCollab.setState({ status });
  if (status === "live") {
    publishPresence(0);
    // Catch up on anything missed while disconnected, then share local edits.
    if (previous === "offline") void pullAndMerge().catch(fail);
  }
}

/** Load the saved room and merge it with local state, entity by entity. */
async function pullAndMerge() {
  const room = useCollab.getState().room;
  if (!room) return;
  const backend = await requireBackend();
  const snapshot = await backend.getRoom(room.id, room.secret);
  const current = useStudio.getState().project;
  const merged = mergeDocs({ project: current, clocks }, snapshot);
  if (!projectSchema.safeParse(merged.project).success)
    throw new Error("The shared song could not be merged. Reload to rejoin.");
  revision = snapshot.revision;
  clocks = merged.clocks;
  lamport = Math.max(lamport, maxCounter(clocks));
  const changes = diffProject(current, merged.project);
  if (changes.length) applyFromCollaborators(merged.project, changes);
  if (diffProject(snapshot.project, merged.project).length) scheduleSave();
  scheduleAssets();
}

async function save() {
  const room = useCollab.getState().room;
  if (!room) return;
  const backend = await requireBackend();
  for (let attempt = 0; attempt < 6; attempt++) {
    const next = await backend.saveRoom(
      room.id,
      room.secret,
      useStudio.getState().project,
      clocks,
      revision,
    );
    if (next != null) {
      revision = next;
      useCollab.setState({ dirty: false, error: null });
      if (needsResync) {
        needsResync = false;
        await broadcast({ type: "resync", from: clientId });
      }
      return;
    }
    // Someone else saved first: merge their snapshot and try again.
    await pullAndMerge();
  }
  throw new Error("The shared song is very busy. Your changes will be retried.");
}

function scheduleSave(delay = 900) {
  useCollab.setState({ dirty: true });
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveChain = saveChain.then(save).catch((error: unknown) => {
      fail(error);
      scheduleSave(4000);
    });
  }, delay);
}

let assetTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleAssets() {
  clearTimeout(assetTimer);
  assetTimer = setTimeout(() => void syncAssets().catch(fail), 150);
}

/** Upload audio this browser has that the room lacks; download audio the room has. */
async function syncAssets() {
  const room = useCollab.getState().room;
  if (!room) return;
  const backend = await requireBackend();
  const needed = [...requiredAssets(useStudio.getState().project).keys()].filter(
    (id) => !inflight.has(id),
  );
  const local = await Promise.all(
    needed.map(async (id) => engine.hasAsset(id) || (await idbGet(id)) !== null),
  );
  const uploads = needed.filter((id, i) => local[i] && !uploaded.has(id));
  const downloads = needed.filter((_, i) => !local[i]);
  if (!uploads.length && !downloads.length) return;
  useCollab.setState({
    busy: uploads.length
      ? `Sharing ${uploads.length} audio file${uploads.length > 1 ? "s" : ""}…`
      : `Receiving ${downloads.length} audio file${downloads.length > 1 ? "s" : ""}…`,
  });
  try {
    for (const id of uploads) {
      inflight.add(id);
      try {
        const data = await idbGet(id);
        if (!data) continue;
        const bytes = new Uint8Array(data);
        const count = Math.max(1, Math.ceil(bytes.length / CHUNK_BYTES));
        if (count > 120) throw new Error("Audio files over 60 MB can't be shared.");
        for (let index = 0; index < count; index++)
          await backend.putAssetChunk(
            room.id,
            room.secret,
            id,
            index,
            count,
            toBase64(bytes.subarray(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES)),
          );
        uploaded.add(id);
        await broadcast({ type: "asset", id, from: clientId });
      } finally {
        inflight.delete(id);
      }
    }
    for (const id of downloads) {
      inflight.add(id);
      try {
        const first = await backend.getAssetChunk(room.id, room.secret, id, 0);
        if (!first) continue; // Not uploaded yet; an "asset" message will retry.
        const parts = [fromBase64(first.data)];
        for (let index = 1; index < first.count; index++) {
          const chunk = await backend.getAssetChunk(room.id, room.secret, id, index);
          if (!chunk) throw new Error("Shared audio is still uploading.");
          parts.push(fromBase64(chunk.data));
        }
        const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
        let offset = 0;
        for (const part of parts) {
          bytes.set(part, offset);
          offset += part.length;
        }
        await engine.loadSample(id, bytes.buffer);
        uploaded.add(id);
      } finally {
        inflight.delete(id);
      }
    }
  } finally {
    useCollab.setState({ busy: null });
  }
}

function watchStudio(state: StudioState, prev: StudioState) {
  if (state.project !== prev.project && !applyingRemote) {
    const changes = diffProject(prev.project, state.project);
    if (changes.length) {
      const stamp = { c: ++lamport, a: clientId };
      const ops: Op[] = changes.map((change) => ({ ...change, s: stamp }));
      for (const op of ops) clocks[op.k] = op.s;
      void broadcast({ type: "ops", ops, from: clientId });
      scheduleSave();
      scheduleAssets();
    }
  }
  if (
    state.selectedTrackId !== prev.selectedTrackId ||
    state.view !== prev.view ||
    state.playing !== prev.playing ||
    state.project.bpm !== prev.project.bpm ||
    (!state.playing && state.beat !== prev.beat)
  )
    publishPresence();
}

async function enterRoom(room: { id: string; secret: string }, snapshot: RoomSnapshot) {
  const backend = await requireBackend();
  const parsed = projectSchema.safeParse(snapshot.project);
  if (!parsed.success) throw new Error("The shared song is damaged and can't be opened.");
  await leaveRoom("return", false);
  localBackup ??= useStudio.getState().project;
  suspendAutosave(true);
  clocks = { ...snapshot.clocks };
  revision = snapshot.revision;
  lamport = maxCounter(clocks);
  uploaded.clear();
  applyingRemote = true;
  try {
    replaceProject(snapshot.project);
  } finally {
    applyingRemote = false;
  }
  useCollab.setState({
    room,
    invite: null,
    status: "connecting",
    error: null,
    activity: [],
    peers: [],
    dirty: false,
  });
  setHash(room);
  stopWatching = useStudio.subscribe(watchStudio);
  channel = backend.connect(await channelName(room.id, room.secret), clientId, {
    onMessage,
    onPresence,
    onStatus,
  });
  heartbeat = setInterval(() => {
    if (useStudio.getState().playing) publishPresence(0);
  }, 1000);
  publishPresence(0);
  for (const id of await backend.listAssets(room.id, room.secret)) uploaded.add(id);
  scheduleAssets();
}

function rememberName(name: string) {
  const clean = name.trim().slice(0, 40);
  useCollab.setState({ name: clean });
  try {
    localStorage.setItem("kiln-collab-name", clean);
  } catch {
    /* Name still works for this visit. */
  }
}

/** Upload the open song and its audio, and start a live session with a share link. */
export async function startSharing(name: string) {
  rememberName(name);
  const backend = await requireBackend();
  useCollab.setState({ busy: "Creating a shared copy of your song…", error: null });
  try {
    const project = useStudio.getState().project;
    const secret = randomSecret();
    const id = await backend.createRoom(project.name, secret, project, {});
    await enterRoom({ id, secret }, { name: project.name, project, clocks: {}, revision: 1 });
    await syncAssets();
  } finally {
    useCollab.setState({ busy: null });
  }
}

export async function joinRoom(invite: { id: string; secret: string }, name: string) {
  rememberName(name);
  const backend = await requireBackend();
  useCollab.setState({ busy: "Opening the shared song…", error: null });
  try {
    await enterRoom(invite, await backend.getRoom(invite.id, invite.secret));
  } finally {
    useCollab.setState({ busy: null });
  }
}

/**
 * Leave the room. "keep" makes the shared version your own browser song;
 * "return" restores the song you had open before joining.
 */
export async function leaveRoom(mode: "keep" | "return", updateHash = true) {
  if (!useCollab.getState().room) return;
  clearTimeout(saveTimer);
  if (useCollab.getState().dirty) await save().catch(() => {});
  await saveChain;
  stopWatching?.();
  stopWatching = null;
  clearInterval(heartbeat);
  await channel?.close().catch(() => {});
  channel = null;
  suspendAutosave(false);
  if (mode === "keep") useStudio.setState((s) => ({ project: s.project }));
  else if (localBackup) replaceProject(localBackup);
  localBackup = null;
  selection = { regionId: null, cursor: null };
  useCollab.setState({ room: null, status: "idle", peers: [], dirty: false });
  if (updateHash) setHash(null);
}

/** Read an invite link (call after the local song has been restored). */
export function initCollab() {
  const read = () => {
    const invite = parseInvite(location.hash);
    const room = useCollab.getState().room;
    if (invite && (!room || room.id !== invite.id))
      useCollab.setState({ invite, dialog: true, error: null });
  };
  read();
  window.addEventListener("hashchange", read);
  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (useCollab.getState().dirty) event.preventDefault();
  };
  window.addEventListener("beforeunload", beforeUnload);
  return () => {
    window.removeEventListener("hashchange", read);
    window.removeEventListener("beforeunload", beforeUnload);
  };
}
