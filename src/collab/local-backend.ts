import type { CollabBackend, Presence, RoomSnapshot } from "./backend";

/**
 * Development-only stand-in for Supabase: rooms live in this browser's
 * localStorage and tabs talk over BroadcastChannel. It exercises the same
 * session code without a cloud project, e.g. for automated two-tab tests.
 */
interface StoredRoom extends RoomSnapshot {
  secret: string;
  assets: Record<string, string[]>;
}

const key = (room: string) => `kiln-local-room:${room}`;

function read(room: string, secret: string): StoredRoom {
  const raw = localStorage.getItem(key(room));
  const stored = raw ? (JSON.parse(raw) as StoredRoom) : null;
  if (!stored || stored.secret !== secret)
    throw new Error("KILN room not found or link is invalid");
  return stored;
}

export function localBackend(): CollabBackend {
  return {
    kind: "local",
    createRoom: async (name, secret, project, clocks) => {
      const id = crypto.randomUUID();
      const room: StoredRoom = { name, project, clocks, revision: 1, secret, assets: {} };
      localStorage.setItem(key(id), JSON.stringify(room));
      return id;
    },
    getRoom: async (room, secret) => {
      const { name, project, clocks, revision } = read(room, secret);
      return { name, project, clocks, revision };
    },
    saveRoom: async (room, secret, project, clocks, expected) => {
      const stored = read(room, secret);
      if (stored.revision !== expected) return null;
      const next = { ...stored, project, clocks, name: project.name, revision: expected + 1 };
      localStorage.setItem(key(room), JSON.stringify(next));
      return next.revision;
    },
    putAssetChunk: async (room, secret, asset, index, count, base64) => {
      const stored = read(room, secret);
      const chunks = stored.assets[asset] ?? Array.from({ length: count }, () => "");
      if (!chunks[index]) chunks[index] = base64;
      stored.assets[asset] = chunks;
      localStorage.setItem(key(room), JSON.stringify(stored));
    },
    getAssetChunk: async (room, secret, asset, index) => {
      const chunks = read(room, secret).assets[asset];
      const data = chunks?.[index];
      return chunks && data ? { count: chunks.length, data } : null;
    },
    listAssets: async (room, secret) =>
      Object.entries(read(room, secret).assets)
        .filter(([, chunks]) => chunks.every(Boolean))
        .map(([id]) => id),
    connect: (name, clientId, handlers) => {
      const bus = new BroadcastChannel(`kiln-local:${name}`);
      const peers = new Map<string, Presence>();
      let me: Presence | null = null;
      const publish = () => handlers.onPresence([...(me ? [me] : []), ...peers.values()]);
      const sweep = window.setInterval(() => {
        const now = Date.now();
        for (const [id, peer] of peers) if (now - peer.at > 6000) peers.delete(id);
        if (me) bus.postMessage({ presence: { ...me, at: now } });
        publish();
      }, 1500);
      bus.onmessage = ({
        data,
      }: MessageEvent<{ presence?: Presence; leave?: string; message?: unknown }>) => {
        if (data.presence && data.presence.clientId !== clientId) {
          const known = peers.has(data.presence.clientId);
          peers.set(data.presence.clientId, { ...data.presence, at: Date.now() });
          if (!known && me) bus.postMessage({ presence: me });
          publish();
        } else if (data.leave) {
          peers.delete(data.leave);
          publish();
        } else if (data.message !== undefined) handlers.onMessage(data.message);
      };
      handlers.onStatus("connecting");
      queueMicrotask(() => handlers.onStatus("live"));
      return {
        send: async (message) => bus.postMessage({ message }),
        track: async (presence) => {
          me = { ...presence, at: Date.now() };
          bus.postMessage({ presence: me });
          publish();
        },
        close: async () => {
          window.clearInterval(sweep);
          bus.postMessage({ leave: clientId });
          bus.close();
        },
      };
    },
  };
}
