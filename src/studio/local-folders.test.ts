import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  collectSounds,
  formatBytes,
  groupPath,
  isAudioName,
  soundLabel,
  type SampleDirectoryHandle,
  type SampleFileHandle,
  type SampleHandle,
} from "./local-folders.ts";

function file(name: string, size: number): SampleFileHandle {
  return {
    kind: "file",
    name,
    async getFile() {
      return new File([new Uint8Array(size)], name);
    },
  };
}

function directory(name: string, entries: Record<string, SampleHandle>): SampleDirectoryHandle {
  return {
    kind: "directory",
    name,
    async *entries() {
      for (const [entryName, handle] of Object.entries(entries)) yield [entryName, handle];
    },
  };
}

describe("linked sample folders", () => {
  it("recognizes audio file names and ignores everything else", () => {
    assert.equal(isAudioName("Kick 01.WAV"), true);
    assert.equal(isAudioName("loop.aiff"), true);
    assert.equal(isAudioName("notes.txt"), false);
    assert.equal(soundLabel("Kick 01.WAV"), "Kick 01");
    assert.equal(groupPath("Drums/Kicks/Kick 01.wav"), "Drums / Kicks");
    assert.equal(groupPath("room.wav"), undefined);
  });

  it("lists audio in nested folders without keeping non-audio files", async () => {
    const root = directory("Pack", {
      "readme.txt": file("readme.txt", 12),
      "room.wav": file("room.wav", 1500),
      Kicks: directory("Kicks", {
        ".hidden.wav": file(".hidden.wav", 10),
        "kick.mp3": file("kick.mp3", 900),
      }),
    });
    const seen: number[] = [];
    const sounds = await collectSounds("folder-1", root, (count) => seen.push(count), new Map());
    assert.deepEqual(
      sounds.map((sound) => [sound.name, sound.group, sound.size]),
      [
        ["kick", "Kicks", 900],
        ["room", undefined, 1500],
      ],
    );
    assert.deepEqual(seen, [sounds.length]);
    assert.equal(formatBytes(900), "900 B");
    assert.equal(formatBytes(1500), "1 KB");
    assert.equal(formatBytes(2.5 * 1024 * 1024), "2.5 MB");
  });
});
