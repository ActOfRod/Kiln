// Instrument picker checks against the dev server.
// Usage: node scripts/instrument-browser-check.mjs [http://127.0.0.1:8080/]
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const url = process.argv[2] ?? "http://127.0.0.1:8080/";
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+\/$/.test(url))
  throw new Error("Use a local development server URL.");
mkdirSync("screenshots", { recursive: true });

const modules = `
  const app = await (await fetch("/src/components/studio/StudioApp.tsx")).text();
  const storeUrl = app.match(/from "([^"]*\\/studio\\/store\\.ts[^"]*)"/)[1];
  const { useStudio } = await import(storeUrl);
  const storeSource = await (await fetch(storeUrl)).text();
  const { engine } = await import(storeSource.match(/from "([^"]*\\/studio\\/engine\\.ts[^"]*)"/)[1]);
  const s = useStudio.getState();
  const byName = (name) => s.project.tracks.find((t) => t.name === name);
  // Render bars [start, end] of one track alone and report loudness.
  const render = async (name, start, end) => {
    const track = byName(name);
    const project = { ...s.project, tracks: [{ ...track, mute: false, solo: false }] };
    const blob = await engine.bounce({ project, follow: "arrange", launched: {}, metronome: false },
      { format: "wav", source: "arrange", bitrate: 192, startBar: start, endBar: end, tail: false });
    const ctx = new AudioContext();
    const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
    await ctx.close();
    const data = audio.getChannelData(0);
    let sum = 0, peak = 0, finite = true;
    for (const x of data) { sum += x * x; peak = Math.max(peak, Math.abs(x)); if (!Number.isFinite(x)) finite = false; }
    return { rms: Math.sqrt(sum / data.length), peak, finite };
  };
`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const run = (body) => page.evaluate(`(async () => { ${modules} ${body} })()`);
const checks = [];
const check = async (name, body) => {
  const result = await run(body);
  assert.equal(result, true, `${name}: ${JSON.stringify(result)}`);
  checks.push(name);
};

try {
  await page.goto(url);
  await page.waitForSelector(".studio-header");
  // Wait for the saved song to load so it cannot overwrite the demo below.
  await run(
    `while (!useStudio.persist.hasHydrated()) await new Promise((r) => setTimeout(r, 50)); return true;`,
  );
  await run(
    `s.resetDemo(); useStudio.getState().selectTrack(useStudio.getState().project.tracks.find((t) => t.name === "Piano").id); return true;`,
  );
  await page.getByRole("tab", { name: "Instruments" }).click();
  const picker = page.getByRole("region", { name: "Instrument" });
  await picker.waitFor();
  assert.equal(
    await picker.getByRole("radio", { name: /Grand Piano/ }).getAttribute("aria-checked"),
    "true",
  );
  checks.push("keys tracks start on Grand Piano in the Instruments screen");

  await picker.getByRole("radio", { name: /Electric Piano/ }).click();
  await check(
    "choosing an instrument swaps the sound and keeps the notes",
    `const keys = byName("Piano");
     return keys.device.instrument === "electric-piano" && keys.device.cutoff === 7000 &&
       keys.arrangement.length > 0 && keys.arrangement[0].notes.length > 0;`,
  );
  await page.keyboard.down("a");
  await page.waitForTimeout(200);
  await check(
    "playing the keyboard uses the chosen instrument",
    `return [...engine.performer.previews.keys()].some((k) => k.startsWith(byName("Piano").id + ":"));`,
  );
  await page.keyboard.up("a");
  await page.screenshot({ path: resolve("screenshots/instruments.png") });

  for (const id of [
    "grand-piano",
    "electric-piano",
    "organ",
    "strings",
    "warm-pad",
    "pluck",
    "bell",
    "electric-bass",
    "sub-bass",
    "analog",
  ])
    await check(
      `${id} renders audibly in exports`,
      `s.setInstrument(byName("Piano").id, ${JSON.stringify(id)});
       const r = await render("Piano", 5, 6);
       return r.finite && r.rms > 0.005 && r.peak < 1.2 || r;`,
    );
  await check(
    "switching back to Analog Synth restores the original keys voice",
    `const d = byName("Piano").device; return d.waveform === "triangle" && d.cutoff === 2200 && d.decay === 0.5;`,
  );

  await run(`s.selectTrack(byName("War Drums").id); return true;`);
  await picker.getByRole("radio", { name: /808 Kit/ }).click();
  await check(
    "drum tracks offer only drum kits",
    `return document.querySelectorAll('[aria-label="Instrument"] [role=radio]').length === 3 && byName("War Drums").device.instrument === "808-kit";`,
  );
  for (const kit of ["808-kit", "acoustic-kit", "drum-machine"])
    await check(
      `${kit} renders audibly`,
      `s.setInstrument(byName("War Drums").id, ${JSON.stringify(kit)});
       const r = await render("War Drums", 5, 6); return r.finite && r.rms > 0.01 || r;`,
    );

  await run(`s.setInstrument(byName("Low End").id, "electric-bass"); return true;`);
  await run(`useStudio.getState().undo(); return true;`);
  await check(
    "instrument changes are undoable",
    `return useStudio.getState().project.tracks.find((t) => t.name === "Low End").device.instrument === "sub-bass";`,
  );
  await run(`s.setInstrument(byName("Low End").id, "electric-bass"); return true;`);
  await page.reload();
  await page.waitForSelector(".studio-header");
  await run(
    `while (!useStudio.persist.hasHydrated()) await new Promise((r) => setTimeout(r, 50)); return true;`,
  );
  await check(
    "the chosen instrument is saved with the song",
    `return useStudio.getState().project.tracks.find((t) => t.name === "Low End").device.instrument === "electric-bass";`,
  );

  await run(
    `useStudio.getState().selectTrack(useStudio.getState().project.tracks.find((t) => t.name === "Piano").id); return true;`,
  );
  await page.getByRole("button", { name: /Change instrument/ }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("radio", { name: /Grand Piano/ }).click();
  await check(
    "Track sound shows the picker and instrument controls",
    `const text = document.querySelector("[role=dialog]").textContent;
     return text.includes("Grand Piano controls") && text.includes("Tone") && text.includes("Release") && !text.includes("Resonance");`,
  );
  await page.screenshot({ path: resolve("screenshots/instrument-sheet.png") });
  assert.deepEqual(errors, [], "No uncaught page errors");
  console.log(JSON.stringify({ ok: true, checks }, null, 2));
} finally {
  await browser.close();
}
