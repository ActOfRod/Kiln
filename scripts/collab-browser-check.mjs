// Two-person live collaboration check against the dev server's local backend
// (BroadcastChannel + localStorage), exercising the same session code as Supabase.
// Usage: node scripts/collab-browser-check.mjs [http://127.0.0.1:8080/]
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const url = process.argv[2] ?? "http://127.0.0.1:8080/";
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+\/$/.test(url))
  throw new Error("Use a local development server URL.");
mkdirSync("screenshots", { recursive: true });

// Resolve the exact HMR module URLs React uses, so we inspect the same store instances.
const modules = `
  const app = await (await fetch("/src/components/studio/StudioApp.tsx")).text();
  const storeUrl = app.match(/from "([^"]*\\/studio\\/store\\.ts[^"]*)"/)[1];
  const sessionUrl = app.match(/from "([^"]*\\/collab\\/session\\.ts[^"]*)"/)[1];
  const { useStudio } = await import(storeUrl);
  const { useCollab } = await import(sessionUrl);
  const storeSource = await (await fetch(storeUrl)).text();
  const { engine } = await import(storeSource.match(/from "([^"]*\\/studio\\/engine\\.ts[^"]*)"/)[1]);
`;
const run = (page, body) => page.evaluate(`(async () => { ${modules} ${body} })()`);
const checks = [];
async function eventually(name, page, predicate, timeout = 8000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await run(page, predicate);
    if (last === true) {
      checks.push(name);
      return;
    }
    await page.waitForTimeout(150);
  }
  assert.fail(`${name} (last value: ${JSON.stringify(last)})`);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const errors = [];
const alice = await context.newPage();
const bob = await context.newPage();
for (const page of [alice, bob]) page.on("pageerror", (error) => errors.push(error.message));

try {
  await alice.goto(url);
  await alice.waitForSelector(".studio-header");
  await run(alice, `useStudio.getState().resetDemo(); return true;`);
  await alice.getByRole("button", { name: "Share song" }).click();
  await alice.getByLabel("Your name").fill("Alice");
  await alice.getByRole("button", { name: "Start live session" }).click();
  const link = await alice.getByLabel("Share link").inputValue({ timeout: 10000 });
  assert.match(link, /#room=[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/);
  checks.push("share link created");
  await alice.keyboard.press("Escape");

  await bob.goto(url);
  await bob.waitForSelector(".studio-header");
  await run(bob, `useStudio.getState().renameProject("Bob's own song"); return true;`);
  await bob.goto(link);
  await bob.getByLabel("Your name").fill("Bob");
  await bob.getByRole("button", { name: "Join session" }).click();
  await bob.getByLabel("Share link").waitFor({ timeout: 10000 });
  await bob.keyboard.press("Escape");
  await eventually(
    "joiner opens the shared song",
    bob,
    `return useStudio.getState().project.name === "Ember Queen";`,
  );
  await eventually(
    "both people see each other",
    alice,
    `return useCollab.getState().peers.some((p) => p.name === "Bob");`,
  );

  await run(
    alice,
    `const s = useStudio.getState(); const t = s.project.tracks[1]; s.moveArrangeClip(t.id, t.arrangement[0].id, 0); return true;`,
  );
  await eventually(
    "region moves sync live",
    bob,
    `return useStudio.getState().project.tracks[1].arrangement.some((r) => r.start === 0);`,
  );

  await Promise.all([
    run(alice, `useStudio.getState().setBpm(97); return true;`),
    run(bob, `const s = useStudio.getState(); s.toggleMute(s.project.tracks[2].id); return true;`),
  ]);
  for (const [name, page] of [
    ["Alice", alice],
    ["Bob", bob],
  ])
    await eventually(
      `concurrent edits converge for ${name}`,
      page,
      `const p = useStudio.getState().project; return p.bpm === 97 && p.tracks[2].mute === true;`,
    );

  await alice.locator('[aria-label="Region Distant drums"]').first().click();
  await eventually(
    "selection is visible to collaborators",
    bob,
    `return [...document.querySelectorAll(".peer-region-tag")].some((n) => n.textContent.includes("Alice"));`,
  );
  const lane = bob.locator(".arrange-lane").nth(3);
  const box = await lane.boundingBox();
  await bob.mouse.move(box.x + 200, box.y + 30);
  await bob.mouse.move(box.x + 240, box.y + 40);
  await eventually(
    "live cursor is visible to collaborators",
    alice,
    `return [...document.querySelectorAll(".peer-cursor")].some((n) => n.textContent.includes("Bob"));`,
  );
  await alice.screenshot({ path: resolve("screenshots/collab-alice.png") });

  await run(
    bob,
    `const s = useStudio.getState(); s.renameTrack(s.project.tracks[0].id, "Bob drums"); return true;`,
  );
  await run(
    alice,
    `const s = useStudio.getState(); s.renameTrack(s.project.tracks[3].id, "Alice lead"); return true;`,
  );
  await eventually(
    "remote edits arrive before undo",
    bob,
    `return useStudio.getState().project.tracks[3].name === "Alice lead";`,
  );
  await run(bob, `useStudio.getState().undo(); return true;`);
  await eventually(
    "undo reverts only your own change",
    alice,
    `const t = useStudio.getState().project.tracks; return t[0].name === "War Drums" && t[3].name === "Alice lead";`,
  );

  // Alice adds audio; it is uploaded, and Bob downloads it after his local copy is removed.
  const asset = await run(
    alice,
    `const n = 22050; const b = new ArrayBuffer(44 + n * 2); const v = new DataView(b);
     const w = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
     w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true);
     v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 44100, true); v.setUint32(28, 88200, true);
     v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * 2, true);
     for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.round(Math.sin(i / 10) * 9000), true);
     const placed = await useStudio.getState().placeAudio(null, b, "Shared tone", 0);
     return useStudio.getState().project.tracks.find((t) => t.id === placed.trackId).arrangement[0].assetId;`,
  );
  await eventually(
    "audio is uploaded to the room",
    alice,
    `const room = JSON.parse(localStorage.getItem("kiln-local-room:" + useCollab.getState().room.id));
     return !!room.assets[${JSON.stringify(asset)}]?.every(Boolean);`,
  );
  await run(
    bob,
    `await new Promise((resolve, reject) => { const r = indexedDB.open("kiln-samples", 1);
       r.onsuccess = () => { const tx = r.result.transaction("buffers", "readwrite");
         tx.objectStore("buffers").delete(${JSON.stringify(asset)}); tx.oncomplete = () => { r.result.close(); resolve(); }; tx.onerror = reject; }; r.onerror = reject; });
     return true;`,
  );
  await run(alice, `useStudio.getState().setSwing(0.2); return true;`);
  await eventually(
    "collaborator downloads shared audio",
    bob,
    `return engine.hasAsset(${JSON.stringify(asset)}) && engine.duration(${JSON.stringify(asset)}) > 0.4;`,
    12000,
  );

  await eventually("changes are saved to the room", alice, `return !useCollab.getState().dirty;`);
  await bob.getByRole("button", { name: "Live session" }).click();
  await bob.getByRole("button", { name: "Leave and return to my song" }).click();
  await eventually(
    "leaving restores your own song",
    bob,
    `return useStudio.getState().project.name === "Bob's own song" && !useCollab.getState().room;`,
  );
  await eventually(
    "others see you leave",
    alice,
    `return !useCollab.getState().peers.some((p) => p.name === "Bob");`,
  );

  await bob.goto(link);
  await bob.getByRole("button", { name: "Join session" }).click();
  await eventually(
    "rejoining loads every saved change",
    bob,
    `const p = useStudio.getState().project;
     return p.bpm === 97 && p.swing === 0.2 && p.tracks.some((t) => t.name === "Alice lead") && p.tracks.some((t) => t.arrangement.some((r) => r.name === "Shared tone"));`,
  );
  await bob.screenshot({ path: resolve("screenshots/collab-bob.png") });
  assert.deepEqual(errors, [], "No uncaught page errors");
  console.log(JSON.stringify({ ok: true, checks }, null, 2));
} finally {
  await browser.close();
}
