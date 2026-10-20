import { createClient, type RealtimeChannel } from "@supabase/supabase-js";
import type { Project } from "../studio/types";
import type { Clocks } from "./doc";
import type { CollabBackend, Presence } from "./backend";

/**
 * Supabase transport: Postgres functions persist rooms and audio, Realtime
 * broadcast carries live edits and Realtime presence carries who is doing what.
 * Uses only the public publishable key; access to a room requires its secret.
 */
export function supabaseBackend(url: string, publishableKey: string): CollabBackend {
  const client = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    realtime: { params: { eventsPerSecond: 20 } },
  });
  async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await client.rpc(fn, args);
    if (error) throw new Error(error.message || "The collaboration service is unavailable.");
    return data as T;
  }
  return {
    kind: "supabase",
    createRoom: (name, secret, project, clocks) =>
      call<string>("kiln_create_room", {
        p_name: name,
        p_secret: secret,
        p_project: project,
        p_clocks: clocks,
      }),
    getRoom: async (room, secret) => {
      const rows = await call<
        Array<{ name: string; project: Project; clocks: Clocks; revision: number | string }>
      >("kiln_get_room", { p_room: room, p_secret: secret });
      const row = rows[0];
      if (!row) throw new Error("This shared song no longer exists.");
      return { ...row, revision: Number(row.revision) };
    },
    saveRoom: async (room, secret, project, clocks, expectedRevision) => {
      const revision = await call<number | string | null>("kiln_save_room", {
        p_room: room,
        p_secret: secret,
        p_project: project,
        p_clocks: clocks,
        p_expected_revision: expectedRevision,
      });
      return revision == null ? null : Number(revision);
    },
    putAssetChunk: (room, secret, asset, index, count, base64) =>
      call<void>("kiln_put_asset_chunk", {
        p_room: room,
        p_secret: secret,
        p_asset: asset,
        p_index: index,
        p_count: count,
        p_data: base64,
      }),
    getAssetChunk: async (room, secret, asset, index) => {
      const rows = await call<Array<{ chunk_count: number; data: string }>>(
        "kiln_get_asset_chunk",
        { p_room: room, p_secret: secret, p_asset: asset, p_index: index },
      );
      return rows[0] ? { count: rows[0].chunk_count, data: rows[0].data } : null;
    },
    listAssets: (room, secret) =>
      call<string[]>("kiln_list_assets", { p_room: room, p_secret: secret }),
    connect: (name, clientId, handlers) => {
      const channel: RealtimeChannel = client.channel(name, {
        config: { broadcast: { self: false }, presence: { key: clientId } },
      });
      let current: Presence | null = null;
      channel
        .on("broadcast", { event: "kiln" }, ({ payload }) => handlers.onMessage(payload))
        .on("presence", { event: "sync" }, () => {
          const state = channel.presenceState<Presence>();
          handlers.onPresence(Object.values(state).flatMap((metas) => metas.slice(-1)));
        })
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            handlers.onStatus("live");
            if (current) void channel.track(current);
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED")
            handlers.onStatus("offline");
        });
      handlers.onStatus("connecting");
      return {
        send: async (message) => {
          const result = await channel.send({ type: "broadcast", event: "kiln", payload: message });
          if (result !== "ok") throw new Error("Live update could not be sent.");
        },
        track: async (presence) => {
          current = presence;
          await channel.track(presence);
        },
        close: async () => {
          await client.removeChannel(channel);
        },
      };
    },
  };
}
