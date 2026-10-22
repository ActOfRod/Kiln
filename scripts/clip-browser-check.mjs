// Clip View and drag-and-drop checks against the dev server.
// Usage: node scripts/clip-browser-check.mjs [http://127.0.0.1:8080/]
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const url = process.argv[2] ?? "http://127.0.0.1:8080/";
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+\/$/.test(url))
  throw new Error("Use a local development server URL.");
mkdirSync("screenshots", { recursive: true });

function tone(seconds, frequency) {
  const n = Math.round(44100 * seconds);
  const wav = Buffer.alloc(44 + n * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + n * 2, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(44100, 24);
  wav.writeUInt32LE(88200, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++)
    wav.writeInt16LE(
      Math.round(Math.sin((i * 2 * Math.PI * frequency) / 44100) * 9000),
      44 + i * 2,
    );
  return wav;
}
const fixture = resolve("screenshots/Drag tone.wav");
writeFileSync(fixture, tone(1, 330));

const modules = `
  const app = await (await fetch("/src/components/studio/StudioApp.tsx")).text();
  const storeUrl = app.match(/from "([^"]*\\/studio\\/store\\.ts[^"]*)"/)[1];
  const { useStudio } = await import(storeUrl);
  const storeSource = await (await fetch(storeUrl)).text();
  const { engine } = await import(storeSource.match(/from "([^"]*\\/studio\\/engine\\.ts[^"]*)"/)[1]);
  const s = useStudio.getState();
  const regions = (name) => s.project.tracks.flatMap((t) => t.arrangement.filter((r) => r.name === name).map((r) => ({ ...r, trackId: t.id })));
`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const run = (body, arg) =>
  page.evaluate(`(async (arg) => { ${modules} ${body} })(${JSON.stringify(arg ?? null)})`);
const checks = [];
const check = async (name, body) => {
  assert.equal(await run(body), true, name);
  checks.push(name);
};
const place = (name, frequency, trackId = null, start = 0) =>
  run(
    `const n = 44100; const b = new ArrayBuffer(44 + n * 2); const v = new DataView(b);
     const w = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
     w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true);
     v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 44100, true); v.setUint32(28, 88200, true);
     v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * 2, true);
     for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.round(Math.sin(i * 2 * Math.PI * arg.f / 44100) * 9000), true);
     return useStudio.getState().placeAudio(arg.trackId, b, arg.name, arg.start);`,
    { name, f: frequency, trackId, start },
  );

try {
  await page.goto(url);
  await page.waitForSelector(".studio-header");
  await run(`s.resetDemo(); s.setBpm(120); return true;`);
  const first = await place("Tone A", 220);
  const second = await place("Tone B", 440);
  await check(
    "audio lands as Ableton-style clips with their own sources",
    `const [a] = regions("Tone A"); const [b] = regions("Tone B");
     return a.assetId !== b.assetId && Math.abs(a.length - 2) < 0.01 && a.trackId !== b.trackId;`,
  );

  await page.locator('[aria-label="Region Tone A"]').click();
  const clipView = page.getByRole("region", { name: "Audio clip editor" });
  await clipView.waitFor();
  await clipView.getByRole("slider", { name: "Transpose" }).fill("12");
  await clipView.getByRole("slider", { name: "Gain" }).fill("-6");
  await clipView.getByRole("button", { name: "Reverse" }).click();
  await clipView.getByRole("spinbutton", { name: "Fade in" }).fill("120");
  await check(
    "clicking a sample opens clip controls that edit the clip",
    `const [a] = regions("Tone A"); return a.transpose === 12 && a.gain === -6 && a.reverse === true && Math.abs(a.fadeIn - 0.12) < 1e-9;`,
  );
  const wave = await clipView.locator(".clip-wave").boundingBox();
  const marker = await clipView.locator(".clip-marker").first().boundingBox();
  await page.mouse.move(marker.x + marker.width / 2, wave.y + wave.height / 2);
  await page.mouse.down();
  await page.mouse.move(wave.x + wave.width * 0.25, wave.y + wave.height / 2, { steps: 5 });
  await page.mouse.up();
  await check(
    "dragging the start marker trims the clip",
    `const [a] = regions("Tone A"); return a.sampleStart > 0.2 && a.sampleStart < 0.3 && Math.abs(a.sampleEnd - 1) < 0.01;`,
  );
  await page.screenshot({ path: resolve("screenshots/clip-view.png") });
  await check(
    "rendered clip follows transpose, trim and gain",
    `const [a] = regions("Tone A");
     const project = { ...s.project, tracks: s.project.tracks.filter((t) => t.id === a.trackId).map((t) => ({ ...t, mute: false, solo: false, device: { ...t.device, reverb: 0, delayMix: 0 } })) };
     const blob = await engine.bounce({ project, follow: "arrange", launched: {}, metronome: false }, { format: "wav", source: "arrange", bitrate: 192, startBar: 1, endBar: 1, tail: false });
     const ctx = new AudioContext(); const audio = await ctx.decodeAudioData(await blob.arrayBuffer()); await ctx.close();
     const data = audio.getChannelData(0); const rms = (from, to) => { let sum = 0; for (let i = from; i < to; i++) sum += data[i] * data[i]; return Math.sqrt(sum / (to - from)); };
     // 0.75 s of source at double speed lasts 0.375 s, then silence.
     return rms(8820, 13230) > 0.02 && rms(22050, 44100) < 0.002;`,
  );

  await page.getByRole("button", { name: "Close clip editor" }).click();
  await page.locator(`[data-track-id="${second.trackId}"]`).scrollIntoViewIfNeeded();
  // Keep the start of the song visible beside the sticky track headers.
  await page.evaluate(() => (document.querySelector(".timeline-scroll").scrollLeft = 0));
  const regionA = page.locator('[aria-label="Region Tone A"]');
  const box = await regionA.boundingBox();
  const laneB = await page.locator(`[data-track-id="${second.trackId}"]`).boundingBox();
  await page.mouse.move(box.x + 30, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + 60, laneB.y + laneB.height / 2, { steps: 8 });
  await page.mouse.move(box.x + 30 + 96, laneB.y + laneB.height / 2, { steps: 4 });
  await page.mouse.up();
  await check(
    "dragging a sample to another audio track keeps its sound and settings",
    `const [a] = regions("Tone A");
     return a.trackId === ${JSON.stringify(second.trackId)} && a.start === 4 && a.transpose === 12 && !!a.assetId;`,
  );
  await run(`s.undo(); return true;`);
  await check(
    "undo returns the dragged sample",
    `const [a] = regions("Tone A"); return a.trackId === ${JSON.stringify(first.trackId)} && a.start === 0;`,
  );

  const copyFrom = await page.locator('[aria-label="Region Tone A"]').boundingBox();
  await page.keyboard.down("Alt");
  await page.mouse.move(copyFrom.x + 20, copyFrom.y + 30);
  await page.mouse.down();
  await page.mouse.move(copyFrom.x + 20 + 24 * 6, copyFrom.y + 30, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await check(
    "Alt-drag copies a region",
    `const copies = regions("Tone A"); return copies.length === 2 && copies.some((r) => r.start === 6) && copies.some((r) => r.start === 0);`,
  );

  const fadeRegion = page.locator('[aria-label="Region Tone B"]');
  await fadeRegion.hover();
  const handle = await fadeRegion.locator(".region-fade-handle.out").boundingBox();
  await page.mouse.move(handle.x + 5, handle.y + 5);
  await page.mouse.down();
  await page.mouse.move(handle.x - 19, handle.y + 5, { steps: 4 });
  await page.mouse.up();
  await check(
    "dragging a fade handle sets the fade",
    `const [b] = regions("Tone B"); return b.fadeOut > 0.4 && b.fadeOut < 0.6;`,
  );

  await page.locator('input[type="file"][multiple]').setInputFiles(fixture);
  await page.getByText("Drag tone").first().waitFor();
  await page.dragAndDrop(
    '.library-item:has-text("Drag tone")',
    `[data-track-id="${second.trackId}"]`,
    { targetPosition: { x: 24 * 8 + 5, y: 20 } },
  );
  await page.waitForFunction(
    async () => !!document.querySelector('[aria-label="Region Drag tone"]'),
  );
  await check(
    "dragging a library sample onto a track places it at the drop point",
    `const [d] = regions("Drag tone"); return d.trackId === ${JSON.stringify(second.trackId)} && d.start === 8 && !!d.assetId;`,
  );

  await page.evaluate(
    async ({ bytes }) => {
      const file = new File([new Uint8Array(bytes)], "Desktop file.wav", { type: "audio/wav" });
      const data = new DataTransfer();
      data.items.add(file);
      const target = document.querySelector(".timeline-empty");
      const rect = target.getBoundingClientRect();
      for (const type of ["dragover", "drop"])
        target.dispatchEvent(
          new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            dataTransfer: data,
            clientX: rect.left + 24 * 4 + 2,
            clientY: rect.top + 10,
          }),
        );
    },
    { bytes: [...tone(0.5, 550)] },
  );
  await page.waitForFunction(() => !!document.querySelector('[aria-label="Region Desktop file"]'));
  await check(
    "dropping an audio file from the computer creates a new audio track",
    `const [f] = regions("Desktop file"); const track = s.project.tracks.find((t) => t.id === f.trackId);
     return track.kind === "sample" && f.start === 4 && s.project.tracks.length === 11;`,
  );

  await page.locator('[aria-label="Region Ostinato 8ths"]').click();
  await check(
    "MIDI clip transpose is available from clip tools",
    `window.__before = regions("Ostinato 8ths")[0].notes.map((n) => n.pitch); return true;`,
  );
  await page.getByRole("button", { name: "Transpose up 1", exact: true }).click();
  await check(
    "MIDI clip transpose moves every note",
    `return regions("Ostinato 8ths")[0].notes.every((n, i) => n.pitch === window.__before[i] + 1);`,
  );
  await page.screenshot({ path: resolve("screenshots/clip-tools.png") });
  await check(
    "portable projects carry per-clip audio and remap it on open",
    `const before = s.project.tracks.flatMap((t) => t.arrangement).filter((r) => r.assetId).map((r) => r.assetId);
     let blob; const create = URL.createObjectURL.bind(URL); URL.createObjectURL = (b) => { blob = b; return create(b); };
     await s.saveProject(); URL.createObjectURL = create;
     const file = JSON.parse(await blob.text());
     const shipped = before.every((id) => typeof file.samples[id] === "string");
     await useStudio.getState().openProject(new File([blob], "clips.kiln"));
     const after = useStudio.getState().project.tracks.flatMap((t) => t.arrangement).filter((r) => r.assetId);
     return shipped && after.length === before.length && after.every((r) => !before.includes(r.assetId) && engine.hasAsset(r.assetId));`,
  );
  assert.deepEqual(errors, [], "No uncaught page errors");
  console.log(JSON.stringify({ ok: true, checks }, null, 2));
} finally {
  await browser.close();
}
