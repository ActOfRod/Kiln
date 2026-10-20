# KILN desktop feature inventory

Reference: Ableton Live 12's official [concepts](https://www.ableton.com/en/manual/live-concepts/),
[file management and export](https://www.ableton.com/en/manual/managing-files-and-sets/),
[browser](https://www.ableton.com/en/manual/working-with-the-browser/),
[arrangement](https://www.ableton.com/en/manual/arrangement-view/), and
[MIDI editing](https://www.ableton.com/en/manual/editing-midi/) manuals,
reviewed October 19, 2026. The table groups capabilities; it is not an
edition-by-edition entitlement list or a claim of Ableton compatibility.

| Capability in Live                           | KILN desktop implementation                                                                                                                                                       | Remaining scope                                                                                             |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Arrangement and Session views sharing tracks | Desktop timeline and quantized clip / scene launcher, with explicit return to arrangement                                                                                         | Continuous session-performance recording; currently scene capture places the selected scene                 |
| Audio and MIDI tracks                        | Up to 32 audio, drum, bass, keys and lead tracks; shared mixer and device inspector                                                                                               | External MIDI hardware, arbitrary instrument plug-ins                                                       |
| Clip / region editing                        | Move, resize, duplicate, delete and split; preserve pattern phase on split; beat, bar or sixteenth snap; timeline zoom and ruler seeking                                          | Multi-selection, cross-track region moves, comping and take lanes                                           |
| MIDI editor                                  | Piano roll, add / remove notes, pitch, start, duration, velocity, and pattern length; existing session step editor                                                                | MPE, probability, scales, MIDI transforms and generators                                                    |
| Browser / user library                       | IndexedDB sample library, multiple-file import, search by name / tags, editable names / tags, favorites, audition, independent project copies; built-in categorized MIDI patterns | Filesystem folder watching, sound-similarity analysis, downloadable packs, custom instrument preset library |
| Instruments                                  | Procedural drum kit and three configurable synth types; live pads, piano, computer keyboard and quantized recording into session clips                                            | Sampler zones, wavetable / granular instruments, AU / VST hosting                                           |
| Mixer and effects                            | Track volume, stereo pan, mute / solo; filter, resonance, drive, tempo delay and reverb; master level and compressor                                                              | Buses, group tracks, sends / returns, sidechain, EQ / compressor per track                                  |
| Audio recording                              | Browser microphone capture, file import, track-source trim and loop                                                                                                               | Multichannel interfaces, punch recording, take management, low-latency native monitoring                    |
| Tempo / groove                               | 40–240 BPM, swing, metronome, fixed 4/4                                                                                                                                           | Tempo / meter automation, groove pool, Ableton Link, MIDI clock                                             |
| Audio stretching / warping                   | Not implemented; audio plays at its original rate and follows region timing without time stretching                                                                               | Warp markers, transient detection, pitch-preserving stretch                                                 |
| Automation and modulation                    | Manual device controls only                                                                                                                                                       | Editable envelopes, parameter automation recording, modulation routing                                      |
| Export                                       | Real MPEG-1 Layer III MP3 at 128 / 192 / 320 kbps; stereo 16-bit WAV; 44.1 kHz, explicit arrangement / launched-session source, bar range and optional effect tail                | Stems, higher bit depths / sample rates, normalization and seamless loop-tail wrapping                      |
| Project / media management                   | Browser autosave, undo / redo, downloadable versioned `.kiln` projects containing original audio; validated import                                                                | Multiple-project browser, cloud sync, collaboration, `.als` / Logic project import                          |
| Hardware, Max for Live, video, notation      | Not implemented                                                                                                                                                                   | Separate product / native-runtime decisions                                                                 |

## Product boundary

This release retools the **desktop browser / installed PWA workspace**. It does
not create a signed macOS / Windows executable, a native audio driver, or full
Live / Logic parity. Desktop layout and editing take priority; mobile-specific
PWA interaction design is intentionally deferred. Existing PWA infrastructure
and browser-local songs remain compatible.

The track model deliberately combines an Ableton-style shared session and
arrangement engine with a Logic-like horizontal region timeline and inspector.
It does not copy either application's assets, devices, project formats or UI.

The next foundational work should establish per-region audio assets and
automation before adding comping, routing or warping. A native shell alone
would not provide a native low-latency audio engine or plug-in host.
