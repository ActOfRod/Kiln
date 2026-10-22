// End-to-end live collaboration check against real Supabase, using a production
// build and two isolated browser profiles (no shared storage), driven through the UI.
// Usage: VITE_SUPABASE_URL=... VITE_SUPABASE_PUBLISHABLE_KEY=... npm run build:pages
//        node scripts/collab-cloud-check.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const base = "http://127.0.0.1:8082/Kiln/";
mkdirSync("screenshots", { recursive: true });
const server = spawn("npx", ["vite", "preview", "--config", "vite.pages.config.ts"], {
  stdio: "ignore",
});
await new Promise((done) => setTimeout(done, 4000));

const checks = [];
const errors = [];
async function eventually(name, fn, timeout = 15000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last === true) {
        checks.push(name);
        return;
      }
    } catch (error) {
      last = error.message;
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  assert.fail(`${name} (last: ${JSON.stringify(last)})`);
}
function wav(seconds) {
  const n = Math.round(44100 * seconds);
  const b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(44100, 24);
  b.writeUInt32LE(88200, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 9) * 9000), 44 + i * 2);
  return b;
}

const browser = await chromium.launch();
const aliceContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const bobContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const alice = await aliceContext.newPage();
const bob = await bobContext.newPage();
for (const page of [alice, bob]) page.on("pageerror", (error) => errors.push(error.message));
const tempo = (page) => page.getByLabel("Tempo BPM").inputValue();
const pressed = (page, label) =>
  page.getByLabel(label, { exact: true }).getAttribute("aria-pressed");
let link = "";

try {
  await alice.goto(base);
  await alice.getByRole("button", { name: "Share song" }).click();
  await alice.getByLabel("Your name").fill("Alice");
  await alice.getByRole("button", { name: "Start live session" }).click();
  link = await alice.getByLabel("Share link").inputValue({ timeout: 20000 });
  assert.match(link, /#room=[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/);
  checks.push("room created in Supabase");
  await alice.keyboard.press("Escape");

  await bob.goto(link);
  await bob.getByLabel("Your name").fill("Bob");
  await bob.getByRole("button", { name: "Join session" }).click();
  await bob.getByLabel("Share link").waitFor({ timeout: 20000 });
  await bob.keyboard.press("Escape");
  await eventually(
    "Realtime presence shows both people",
    async () =>
      (await alice.locator('.collab-avatar[title="Bob"]').count()) > 0 &&
      (await bob.locator('.collab-avatar[title="Alice"]').count()) > 0,
  );

  await alice.getByLabel("Tempo BPM").fill("101");
  await eventually("tempo edit syncs live", async () => (await tempo(bob)) === "101");

  await Promise.all([
    alice.getByLabel("Piano mute", { exact: true }).click(),
    bob.getByLabel("Horns solo", { exact: true }).click(),
  ]);
  for (const [name, page] of [
    ["Alice", alice],
    ["Bob", bob],
  ])
    await eventually(
      `simultaneous edits converge for ${name}`,
      async () =>
        (await pressed(page, "Piano mute")) === "true" &&
        (await pressed(page, "Horns solo")) === "true",
    );

  await alice.locator('[aria-label="Region Distant drums"]').first().click();
  await eventually(
    "selection is visible",
    async () => (await bob.locator(".peer-region-tag", { hasText: "Alice" }).count()) > 0,
  );
  const lane = await bob.locator(".arrange-lane").nth(3).boundingBox();
  for (const dx of [200, 260, 320]) {
    await bob.mouse.move(lane.x + dx, lane.y + 30);
    await bob.waitForTimeout(150);
  }
  await eventually(
    "live cursor is visible",
    async () => (await alice.locator(".peer-cursor", { hasText: "Bob" }).count()) > 0,
  );

  const region = alice.locator('[aria-label="Region Ostinato 8ths"]');
  const before = await bob
    .locator('[aria-label="Region Ostinato 8ths"]')
    .evaluate((n) => n.style.left);
  const box = await region.boundingBox();
  await alice.mouse.move(box.x + 40, box.y + 30);
  await alice.mouse.down();
  await alice.mouse.move(box.x + 40 - 96, box.y + 30, { steps: 6 });
  await alice.mouse.up();
  await eventually("dragged region moves for collaborators", async () => {
    const after = await bob
      .locator('[aria-label="Region Ostinato 8ths"]')
      .evaluate((n) => n.style.left);
    return parseFloat(after) === parseFloat(before) - 96;
  });

  await alice.evaluate(
    ({ bytes }) => {
      const data = new DataTransfer();
      data.items.add(new File([new Uint8Array(bytes)], "Cloud tone.wav", { type: "audio/wav" }));
      const target = document.querySelector(".timeline-empty");
      const rect = target.getBoundingClientRect();
      for (const type of ["dragover", "drop"])
        target.dispatchEvent(
          new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            dataTransfer: data,
            clientX: rect.left + 5,
            clientY: rect.top + 10,
          }),
        );
    },
    { bytes: [...wav(1.5)] },
  );
  await eventually(
    "new audio clip appears for collaborators",
    async () => (await bob.locator('[aria-label="Region Cloud tone"]').count()) > 0,
  );
  await bob.locator('[aria-label="Region Cloud tone"]').click();
  await eventually(
    "collaborator downloads the audio from Supabase",
    async () => (await bob.locator(".clip-wave").count()) > 0,
    30000,
  );
  await bob.screenshot({ path: resolve("screenshots/cloud-bob.png") });

  // Bob's only own edit is the solo; Alice's mute and tempo must survive his undo.
  await bob.getByRole("button", { name: "Undo" }).click();
  await eventually("undo only reverts your own edits", async () => {
    const state = await Promise.all([
      pressed(alice, "Horns solo"),
      pressed(alice, "Piano mute"),
      tempo(alice),
      pressed(bob, "Horns solo"),
      pressed(bob, "Piano mute"),
      tempo(bob),
    ]);
    return state.join() === "false,true,101,false,true,101" || state.join();
  });

  await bobContext.setOffline(true);
  await bob.getByLabel("Tempo BPM").fill("103");
  await alice.getByLabel("Drums mute", { exact: true }).click();
  await bob.waitForTimeout(2000);
  await bobContext.setOffline(false);
  for (const [name, page] of [
    ["Alice", alice],
    ["Bob", bob],
  ])
    await eventually(
      `offline edits merge on reconnect for ${name}`,
      async () => (await tempo(page)) === "103" && (await pressed(page, "Drums mute")) === "true",
      60000,
    );

  await alice.waitForTimeout(2500);
  const carol = await (await browser.newContext()).newPage();
  carol.on("pageerror", (error) => errors.push(error.message));
  await carol.goto(link);
  await carol.getByLabel("Your name").fill("Carol");
  await carol.getByRole("button", { name: "Join session" }).click();
  await carol.getByLabel("Share link").waitFor({ timeout: 20000 });
  await carol.keyboard.press("Escape");
  await eventually(
    "a new visitor loads every saved change",
    async () =>
      (await tempo(carol)) === "103" &&
      (await pressed(carol, "Drums mute")) === "true" &&
      (await carol.locator('[aria-label="Region Cloud tone"]').count()) > 0,
    20000,
  );
  await alice.screenshot({ path: resolve("screenshots/cloud-alice.png") });
  assert.deepEqual(errors, [], "No uncaught page errors");
  console.log(JSON.stringify({ ok: true, checks }, null, 2));
} finally {
  writeFileSync("screenshots/cloud-room.txt", link.split("#room=")[1]?.split(".")[0] ?? "");
  await browser.close();
  server.kill();
}
