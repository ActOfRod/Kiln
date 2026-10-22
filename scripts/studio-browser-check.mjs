import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const session = `kiln-qa-${process.pid}`;
const url = process.argv[2] ?? "http://127.0.0.1:8080/";
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+\/$/.test(url))
  throw new Error("Use a local development server URL.");
const checks = [];
function browser(...args) {
  return execFileSync(
    "npm",
    [
      "exec",
      "--yes",
      "--package=agent-browser@0.39.1",
      "--",
      "agent-browser",
      "--session",
      session,
      ...args,
    ],
    { encoding: "utf8", timeout: 90000, maxBuffer: 1024 * 1024 },
  );
}
function evaluate(script) {
  const endOfSetup = script.lastIndexOf(";");
  const expression = `(async()=>{${script.slice(0, endOfSetup + 1)} return (${script.slice(endOfSetup + 1)});})()`;
  const result = execFileSync(
    "npm",
    [
      "exec",
      "--yes",
      "--package=agent-browser@0.39.1",
      "--",
      "agent-browser",
      "--session",
      session,
      "eval",
      "--stdin",
    ],
    {
      input: expression,
      encoding: "utf8",
      timeout: 90000,
      maxBuffer: 1024 * 1024,
    },
  );
  return JSON.parse(result);
}
function check(name, script) {
  assert.equal(evaluate(script), true, name);
  checks.push(name);
}
// Resolve the HMR URL so assertions inspect the same store instance as React.
const state =
  'const source=await (await fetch("/src/components/studio/StudioApp.tsx")).text(); const moduleUrl=source.match(/from "([^"]*\\/studio\\/store\\.ts[^"]*)"/)[1]; const {useStudio}=await import(moduleUrl); const s=useStudio.getState();';
const audioEngine =
  'const storeSource=await (await fetch(moduleUrl)).text(); const engineUrl=storeSource.match(/from "([^"]*\\/studio\\/engine\\.ts[^"]*)"/)[1]; const {engine}=await import(engineUrl);';
mkdirSync("screenshots", { recursive: true });

// Deterministic one-second source used for library import and portable backup checks.
const wav = Buffer.alloc(44 + 44100 * 2);
wav.write("RIFF", 0);
wav.writeUInt32LE(wav.length - 8, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(44100, 24);
wav.writeUInt32LE(88200, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(88200, 40);
for (let i = 0; i < 44100; i++)
  wav.writeInt16LE(Math.round(Math.sin((i * Math.PI * 2 * 440) / 44100) * 8000), 44 + i * 2);
const fixture = resolve("screenshots/QA tone.wav");
writeFileSync(fixture, wav);

try {
  browser("open", url);
  evaluate(
    `${state} s.resetDemo(); window.__downloads=[]; const create=URL.createObjectURL.bind(URL); URL.createObjectURL=(b)=>{window.__downloads.push(b);return create(b)}; true`,
  );
  browser("fill", '[aria-label="Search library"]', "bass");
  check("library search", 'document.querySelectorAll(".library-item").length===2');
  browser("fill", '[aria-label="Search library"]', "x");
  browser("press", process.platform === "darwin" ? "Meta+a" : "Control+a");
  browser("press", "Backspace");
  browser("click", '[aria-label="Favorite Soft hats"]');
  browser("find", "role", "button", "click", "--name", "★ Favorites");
  check("favorite collection", 'document.querySelectorAll(".library-item").length===1');
  browser("find", "role", "button", "click", "--name", "All Sounds");
  browser("click", '[aria-label="Region Distant drums"]');
  browser("click", '[aria-label="Duplicate region"]');
  check("region duplicate", `${state} s.project.tracks[0].arrangement.length===7`);
  browser("click", '[aria-label="Undo"]');
  check("undo", `${state} s.project.tracks[0].arrangement.length===6`);
  browser("click", '[aria-label="Redo"]');
  check("redo", `${state} s.project.tracks[0].arrangement.length===7`);
  check(
    "moving a region past the song end grows the song and preserves its length",
    `${state} const t=s.project.tracks[0]; const c=t.arrangement[0]; s.moveArrangeClip(t.id,c.id,999);
    const after=useStudio.getState().project; const moved=after.tracks[0].arrangement[0]; const ok=moved.length===c.length&&moved.start+moved.length===512&&after.bars===128; useStudio.getState().undo(); ok&&useStudio.getState().project.bars===s.project.bars`,
  );
  evaluate(`${state} s.seek(1); true`);
  browser("click", '[aria-label="Split region at playhead"]');
  check(
    "split preserves pattern phase",
    `${state} s.project.tracks[0].arrangement.some(c=>c.start===1&&c.offset===1)`,
  );
  browser("dblclick", '[aria-label="Region Distant drums"]:first-of-type');
  browser("click", ".piano-row:first-child .piano-note:first-child");
  browser("fill", '[aria-label="Note velocity"]', "64");
  check(
    "note editing",
    `${state} s.project.tracks[0].arrangement[0].notes.some(n=>Math.abs(n.velocity-64/127)<0.001)`,
  );
  browser("click", '[aria-label="Close region editor"]');
  browser("click", '[aria-label="Play"]');
  check("live playback starts", `${state} s.playing===true&&s.audioError===null`);
  check(
    "track reordering preserves the live audio graph",
    `${state} ${audioEngine} const id=s.project.tracks[0].id; const graph=engine.performer.graphs.get(id);
    s.reorderTrack(id,1); const ok=engine.performer.graphs.get(id)===graph; useStudio.getState().undo(); ok`,
  );
  browser("click", '[aria-label="Stop"]');
  browser("upload", 'input[type="file"][multiple]', fixture);
  browser("wait", "--text", "QA tone");
  check(
    "concurrent library metadata edits preserve independent fields",
    'const {listSounds,readSound,updateSound}=await import("/src/studio/library.ts"); const id=(await listSounds())[0].id; await Promise.all([updateSound(id,{favorite:true}),updateSound(id,{tags:["qa","tone"]})]); const sound=await readSound(id); sound.favorite&&sound.tags.join(",")==="qa,tone"',
  );
  browser("click", '[aria-label="Preview QA tone"]');
  browser("click", '[aria-label="Add QA tone to song"]');
  check(
    "library sample becomes an independent audio track",
    `${state} s.project.tracks.some(t=>t.kind==="sample"&&t.name==="QA tone"&&t.arrangement.length===1)`,
  );
  browser("click", '[aria-label="Save project"]');
  check(
    "portable project includes audio bytes",
    'const b=window.__downloads.find(b=>b.type==="application/json"); const p=JSON.parse(await b.text()); p.format==="kiln-project"&&Object.keys(p.samples).length===1',
  );
  check(
    "portable project round trip",
    `${state}
    const backup=window.__downloads.find(b=>b.type==="application/json");
    s.newSet(); await useStudio.getState().openProject(new File([backup],"roundtrip.kiln"));
    const p=useStudio.getState().project; p.tracks.length===9&&p.tracks.some(t=>t.name==="QA tone")`,
  );
  browser("open", url);
  check(
    "project survives reload",
    `${state} await useStudio.persist.rehydrate(); useStudio.getState().project.tracks.length===9`,
  );
  browser("find", "role", "button", "click", "--name", "Export");
  evaluate(
    "window.__downloads=[]; const create=URL.createObjectURL.bind(URL); URL.createObjectURL=(b)=>{window.__downloads.push(b);return create(b)}; true",
  );
  browser("fill", '[aria-label="Export end bar"]', "1");
  browser("find", "role", "button", "click", "--name", "Export MP3");
  browser("wait", "--text", "Your audio file has been downloaded.");
  check(
    "MP3 download is decodable non-silent stereo",
    `const b=window.__downloads.at(-1); const bytes=new Uint8Array(await b.arrayBuffer());
    const ctx=new AudioContext({sampleRate:44100}); const a=await ctx.decodeAudioData(await b.arrayBuffer()); await ctx.close();
    b.type==="audio/mpeg"&&bytes[0]===255&&(bytes[1]&254)===250&&a.numberOfChannels===2&&a.duration>3.8&&a.duration<4.2&&a.getChannelData(0).some(v=>Math.abs(v)>0.05)`,
  );
  browser("select", '[aria-label="Export format"]', "wav");
  browser("find", "role", "button", "click", "--name", "Export WAV");
  check(
    "WAV download has PCM RIFF header",
    'const b=window.__downloads.at(-1); const bytes=new Uint8Array(await b.arrayBuffer()); b.type==="audio/wav"&&new TextDecoder().decode(bytes.slice(0,4))==="RIFF"',
  );
  check(
    "128-bar arrangement renders audibly through its final bar",
    `${state} ${audioEngine} const track=s.project.tracks.find(t=>t.kind==="bass");
    const project={...s.project,bars:128,bpm:240,tracks:[{...track,mute:false,solo:false,arrangement:[{...track.arrangement[0],start:0,length:512,offset:0}]}]};
    const blob=await engine.bounce({project,follow:"arrange",launched:{},metronome:false},{format:"wav",source:"arrange",bitrate:192,startBar:1,endBar:128,tail:false});
    const ctx=new AudioContext(); const buffer=await ctx.decodeAudioData(await blob.arrayBuffer()); await ctx.close();
    Math.abs(buffer.duration-128)<0.01&&buffer.getChannelData(0).slice(-44100).some(v=>Math.abs(v)>0.01)`,
  );
  browser("click", '[aria-label="Close"]');
  check(
    "missing sample sources remain blocked with actionable errors on retry",
    `${state} s.addTrack("sample"); const id=useStudio.getState().selectedTrackId; useStudio.getState().ensureClip(id,0,"Missing");
    await useStudio.getState().togglePlay(); const first=useStudio.getState().audioError;
    await useStudio.getState().togglePlay(); const ok=!useStudio.getState().playing&&first.includes("missing")&&useStudio.getState().audioError.includes("Reimport");
    useStudio.getState().undo(); useStudio.getState().undo(); useStudio.setState({audioError:null}); ok`,
  );
  browser("find", "role", "button", "click", "--name", "Data Sources & Lineage");
  check(
    "lineage navigation exposes local storage and export provenance",
    'document.querySelector("[role=dialog]").textContent.includes("IndexedDB")&&document.querySelector("[role=dialog]").textContent.includes("kiln_rooms")&&document.querySelector("iframe[title=\\"Technical lineage inventory\\"]").srcdoc.includes("KILN desktop studio")',
  );
  browser("screenshot", resolve("screenshots/studio-workflows.png"));
  assert.equal(browser("errors").trim(), "", "No uncaught browser errors");
  console.log(JSON.stringify({ ok: true, checks }, null, 2));
} finally {
  browser("close");
}
