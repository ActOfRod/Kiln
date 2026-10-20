import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDemoProject } from "../studio/factory.ts";
import {
  applyEntities,
  applyOps,
  diffProject,
  explode,
  implode,
  isOp,
  mergeDocs,
  type Op,
  type Stamp,
} from "./doc.ts";

const base = createDemoProject();
const stampOps = (changes: Array<{ k: string; v: unknown }>, s: Stamp): Op[] =>
  changes.map((change) => ({ ...change, s }));

describe("collaborative document", () => {
  it("round-trips a song through entities", () => {
    assert.deepEqual(
      JSON.parse(JSON.stringify(implode(explode(base)))),
      JSON.parse(
        JSON.stringify({
          ...base,
          tracks: base.tracks.map((t) => ({
            ...t,
            arrangement: [...t.arrangement].sort((a, b) => a.start - b.start),
          })),
        }),
      ),
    );
  });

  it("diffs only the entities that changed", () => {
    const track = base.tracks[1]!;
    const next = {
      ...base,
      tracks: base.tracks.map((t) =>
        t.id === track.id
          ? {
              ...t,
              arrangement: t.arrangement.map((r, i) =>
                i === 0 ? { ...r, start: r.start + 4 } : r,
              ),
            }
          : t,
      ),
    };
    const changes = diffProject(base, next);
    assert.equal(changes.length, 1);
    assert.match(changes[0]!.k, new RegExp(`^region:${track.id}:`));
  });

  it("converges when two people edit different regions in any order", () => {
    const [a, b] = [base.tracks[0]!, base.tracks[1]!];
    const editA = {
      ...base,
      tracks: base.tracks.map((t) =>
        t.id === a.id ? { ...t, arrangement: t.arrangement.map((r) => ({ ...r, name: "A" })) } : t,
      ),
    };
    const editB = {
      ...base,
      bpm: 98,
      tracks: base.tracks.map((t) => (t.id === b.id ? { ...t, volume: 0.2 } : t)),
    };
    const opsA = stampOps(diffProject(base, editA), { c: 1, a: "alice" });
    const opsB = stampOps(diffProject(base, editB), { c: 1, a: "bob" });
    const start = { project: base, clocks: {} };
    const one = applyOps(applyOps(start, opsA), opsB);
    const two = applyOps(applyOps(start, opsB), opsA);
    assert.deepEqual(one.project, two.project);
    assert.equal(one.project.bpm, 98);
    assert.equal(one.project.tracks.find((t) => t.id === b.id)!.volume, 0.2);
    assert.ok(
      one.project.tracks.find((t) => t.id === a.id)!.arrangement.every((r) => r.name === "A"),
    );
  });

  it("resolves the same entity by newest stamp, and tombstones block stale edits", () => {
    const meta = (bpm: number) => ({
      k: "meta",
      v: { ...(explode(base).get("meta") as object), bpm },
    });
    const start = { project: base, clocks: {} };
    const x = applyOps(start, [
      { ...meta(100), s: { c: 2, a: "a" } },
      { ...meta(110), s: { c: 2, a: "b" } },
    ]);
    const y = applyOps(start, [
      { ...meta(110), s: { c: 2, a: "b" } },
      { ...meta(100), s: { c: 2, a: "a" } },
    ]);
    assert.equal(x.project.bpm, 110);
    assert.equal(y.project.bpm, 110);
    const region = base.tracks[0]!.arrangement[0]!;
    const key = `region:${base.tracks[0]!.id}:${region.id}`;
    const deleted = applyOps(start, [{ k: key, v: null, s: { c: 5, a: "a" } }]);
    const stale = applyOps(deleted, [
      { k: key, v: { ...region, name: "late" }, s: { c: 3, a: "b" } },
    ]);
    assert.equal(stale.changed.length, 0);
    assert.ok(!stale.project.tracks[0]!.arrangement.some((r) => r.id === region.id));
  });

  it("merges offline snapshots entity by entity", () => {
    const local = { project: { ...base, name: "Mine" }, clocks: { meta: { c: 4, a: "me" } } };
    const remoteTracks = base.tracks.map((t, i) => (i === 0 ? { ...t, mute: true } : t));
    const remote = {
      project: { ...base, tracks: remoteTracks },
      clocks: { meta: { c: 2, a: "them" }, [`track:${base.tracks[0]!.id}`]: { c: 3, a: "them" } },
    };
    const merged = mergeDocs(local, remote);
    assert.equal(merged.project.name, "Mine");
    assert.equal(merged.project.tracks[0]!.mute, true);
  });

  it("rebases history snapshots and drops orphaned regions of deleted tracks", () => {
    const gone = base.tracks[2]!.id;
    const next = applyEntities(base, [
      { k: `track:${gone}`, v: null },
      { k: "order", v: base.tracks.map((t) => t.id).filter((id) => id !== gone) },
    ]);
    assert.equal(next.tracks.length, base.tracks.length - 1);
    assert.ok(next.tracks.every((t) => t.clips.length === base.scenes.length));
  });

  it("rejects malformed operations", () => {
    assert.equal(isOp({ k: "meta", v: {}, s: { c: 1, a: "x" } }), true);
    assert.equal(isOp({ k: "__proto__", v: {}, s: { c: 1, a: "x" } }), false);
    assert.equal(isOp({ k: "meta", s: { c: "1", a: "x" } }), false);
  });
});
