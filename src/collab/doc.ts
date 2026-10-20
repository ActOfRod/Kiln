import type { ArrangeClip, Project, Track } from "../studio/types";

/**
 * Collaborative song document.
 *
 * A song is split into independently versioned entities: song settings, track
 * order, each track (mixer, device and session clips) and each arrangement
 * region. Every change carries a Lamport stamp; for each entity the newest stamp
 * wins (ties broken by client ID). Two people editing different regions or tracks
 * therefore never overwrite each other, and every client converges on the same
 * song regardless of message order. A deletion keeps its stamp as a tombstone so
 * an older edit cannot resurrect it.
 */
export interface Stamp {
  c: number;
  a: string;
}
export type Clocks = Record<string, Stamp>;
export interface Op {
  k: string;
  v: unknown;
  s: Stamp;
}
export interface DocState {
  project: Project;
  clocks: Clocks;
}

type Meta = Omit<Project, "tracks">;
type TrackBody = Omit<Track, "arrangement">;

export const regionKey = (trackId: string, regionId: string) => `region:${trackId}:${regionId}`;

export function compareStamps(a: Stamp, b: Stamp): number {
  return a.c !== b.c ? a.c - b.c : a.a < b.a ? -1 : a.a > b.a ? 1 : 0;
}

export function isNewer(candidate: Stamp, current: Stamp | undefined): boolean {
  return !current || compareStamps(candidate, current) > 0;
}

export function maxCounter(clocks: Clocks): number {
  let max = 0;
  for (const stamp of Object.values(clocks)) if (stamp.c > max) max = stamp.c;
  return max;
}

export function explode(project: Project): Map<string, unknown> {
  const { tracks, ...meta } = project;
  const entities = new Map<string, unknown>([
    ["meta", meta],
    ["order", tracks.map((track) => track.id)],
  ]);
  for (const { arrangement, ...body } of tracks) {
    entities.set(`track:${body.id}`, body);
    for (const region of arrangement) entities.set(regionKey(body.id, region.id), region);
  }
  return entities;
}

export function implode(entities: Map<string, unknown>): Project | null {
  const meta = entities.get("meta") as Meta | undefined;
  if (!meta) return null;
  const bodies = new Map<string, TrackBody>();
  const regions = new Map<string, ArrangeClip[]>();
  for (const [key, value] of entities) {
    if (key.startsWith("track:")) bodies.set(key.slice(6), value as TrackBody);
    else if (key.startsWith("region:")) {
      const trackId = key.slice(7, key.indexOf(":", 7));
      regions.set(trackId, [...(regions.get(trackId) ?? []), value as ArrangeClip]);
    }
  }
  const order = ((entities.get("order") as string[] | undefined) ?? []).filter((id) =>
    bodies.has(id),
  );
  const ids = [...new Set(order), ...[...bodies.keys()].filter((id) => !order.includes(id)).sort()];
  const sceneCount = meta.scenes.length;
  return {
    ...meta,
    tracks: ids.map((id) => {
      const body = bodies.get(id)!;
      return {
        ...body,
        clips: Array.from({ length: sceneCount }, (_, i) => body.clips[i] ?? null),
        arrangement: (regions.get(id) ?? []).sort(
          (a, b) => a.start - b.start || (a.id < b.id ? -1 : 1),
        ),
      };
    }),
  };
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item as Record<string, unknown>)
            .filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : item,
  );
}

function sameEntity(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (
    ka.length === kb.length &&
    ka.every((key) => (a as Record<string, unknown>)[key] === (b as Record<string, unknown>)[key])
  )
    return true;
  return canonical(a) === canonical(b);
}

/** Entity-level changes from `prev` to `next` (`v: null` deletes). */
export function diffProject(prev: Project, next: Project): Array<{ k: string; v: unknown }> {
  const before = explode(prev);
  const after = explode(next);
  const changes: Array<{ k: string; v: unknown }> = [];
  for (const [key, value] of after)
    if (!before.has(key) || !sameEntity(before.get(key), value)) changes.push({ k: key, v: value });
  for (const key of before.keys()) if (!after.has(key)) changes.push({ k: key, v: null });
  return changes;
}

/** Apply entity changes unconditionally (used to rebase undo snapshots). */
export function applyEntities(project: Project, ops: Array<{ k: string; v: unknown }>): Project {
  if (!ops.length) return project;
  const entities = explode(project);
  for (const op of ops) {
    if (op.v === null) entities.delete(op.k);
    else entities.set(op.k, op.v);
  }
  return implode(entities) ?? project;
}

/** Apply remote ops, keeping only those newer than the local stamp for each entity. */
export function applyOps(state: DocState, ops: Op[]): DocState & { changed: Op[] } {
  const clocks = { ...state.clocks };
  const changed: Op[] = [];
  for (const op of ops) {
    if (!isNewer(op.s, clocks[op.k])) continue;
    clocks[op.k] = op.s;
    changed.push(op);
  }
  if (!changed.length) return { ...state, changed };
  return { project: applyEntities(state.project, changed), clocks, changed };
}

/** Merge two snapshots entity by entity; unstamped entities prefer `remote`. */
export function mergeDocs(local: DocState, remote: DocState): DocState {
  const a = explode(local.project);
  const b = explode(remote.project);
  const keys = new Set([
    ...a.keys(),
    ...b.keys(),
    ...Object.keys(local.clocks),
    ...Object.keys(remote.clocks),
  ]);
  const entities = new Map<string, unknown>();
  const clocks: Clocks = {};
  for (const key of keys) {
    const sa = local.clocks[key];
    const sb = remote.clocks[key];
    const useLocal = !!sa && isNewer(sa, sb);
    const source = useLocal ? a : b;
    const stamp = useLocal ? sa : sb;
    if (stamp) clocks[key] = stamp;
    if (source.has(key)) entities.set(key, source.get(key));
  }
  return { project: implode(entities) ?? remote.project, clocks };
}

export function isOp(value: unknown): value is Op {
  if (!value || typeof value !== "object") return false;
  const op = value as Partial<Op>;
  return (
    typeof op.k === "string" &&
    op.k.length < 300 &&
    /^(meta|order|track:[^:]+|region:[^:]+:[^:]+)$/.test(op.k) &&
    "v" in op &&
    !!op.s &&
    typeof op.s.c === "number" &&
    Number.isFinite(op.s.c) &&
    typeof op.s.a === "string" &&
    op.s.a.length < 100
  );
}

/** Short human description of a batch of changes for the activity feed. */
export function describeOps(ops: Array<{ k: string; v: unknown }>, project: Project): string {
  const trackName = (id: string) => project.tracks.find((t) => t.id === id)?.name ?? "a track";
  for (const op of ops) {
    if (op.k.startsWith("region:")) {
      const trackId = op.k.slice(7, op.k.indexOf(":", 7));
      const name = (op.v as ArrangeClip | null)?.name;
      return op.v === null && !ops.some((o) => o.v !== null && o.k.startsWith("region:"))
        ? `removed a region on ${trackName(trackId)}`
        : `edited ${name ?? "a region"} on ${trackName(trackId)}`;
    }
  }
  for (const op of ops) {
    if (op.k.startsWith("track:"))
      return op.v === null ? "removed a track" : `changed ${(op.v as TrackBody).name ?? "a track"}`;
  }
  if (ops.some((op) => op.k === "meta")) return "changed song settings";
  return "reordered tracks";
}
