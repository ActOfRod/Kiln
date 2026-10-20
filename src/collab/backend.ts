import type { Project } from "../studio/types";
import type { Clocks } from "./doc";

export interface RoomSnapshot {
  name: string;
  project: Project;
  clocks: Clocks;
  revision: number;
}

/** What one collaborator shares with everyone else in the room. */
export interface Presence {
  clientId: string;
  name: string;
  color: number;
  view: string;
  trackId: string | null;
  regionId: string | null;
  cursor: { trackId: string; beat: number } | null;
  playing: boolean;
  beat: number;
  bpm: number;
  at: number;
}

export type ChannelStatus = "connecting" | "live" | "offline";

export interface ChannelHandlers {
  onMessage: (message: unknown) => void;
  onPresence: (peers: Presence[]) => void;
  onStatus: (status: ChannelStatus) => void;
}

export interface RoomChannel {
  send: (message: unknown) => Promise<void>;
  track: (presence: Presence) => Promise<void>;
  close: () => Promise<void>;
}

export interface CollabBackend {
  kind: "supabase" | "local";
  createRoom: (name: string, secret: string, project: Project, clocks: Clocks) => Promise<string>;
  getRoom: (room: string, secret: string) => Promise<RoomSnapshot>;
  saveRoom: (
    room: string,
    secret: string,
    project: Project,
    clocks: Clocks,
    expectedRevision: number,
  ) => Promise<number | null>;
  putAssetChunk: (
    room: string,
    secret: string,
    asset: string,
    index: number,
    count: number,
    base64: string,
  ) => Promise<void>;
  getAssetChunk: (
    room: string,
    secret: string,
    asset: string,
    index: number,
  ) => Promise<{ count: number; data: string } | null>;
  listAssets: (room: string, secret: string) => Promise<string[]>;
  connect: (channel: string, clientId: string, handlers: ChannelHandlers) => RoomChannel;
}
