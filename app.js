/* app.js — ViolinAI v15 */

const $ = (id) => document.getElementById(id);

// UI
const openBtn = $("openBtn");
const scoreFile = $("scoreFile");
const headerTitle = $("headerTitle");

const settingsBtn = $("settingsBtn");
const settingsPanel = $("settingsPanel");

const playBtn = $("playBtn");
const pauseBtn = $("pauseBtn");
const stopBtn = $("stopBtn");
const testBtn = $("testBtn");
const micBtn = $("micBtn");

const themeBtn = $("themeBtn");
const designSelect = $("designSelect");

const modePreviewBtn = $("modePreview");
const modeLearnBtn = $("modeLearn");
const showSheet = $("showSheet");
const showFalling = $("showFalling");

const tempoDownBtn = $("tempoDownBtn");
const tempoUpBtn = $("tempoUpBtn");
const tempoVal = $("tempoVal");
const countInEl = $("countIn");
const metroOnEl = $("metroOn");
const loopStartBtn = $("loopStartBtn");
const loopEndBtn = $("loopEndBtn");
const loopClearBtn = $("loopClearBtn");
const loopRead = $("loopRead");

const learnOnlyRow = $("learnOnlyRow");
const tolCentsEl = $("tolCents");
const waitModeEl = $("waitMode");

const targetTxt = $("targetTxt");
const heardTxt = $("heardTxt");
const clarityTxt = $("clarityTxt");
const deltaTxt = $("deltaTxt");
const levelTxt = $("levelTxt");
const micStatusTxt = $("micStatusTxt");

const statusEl = $("status");

const canvas = $("canvas");
const ctx = canvas.getContext("2d");

const sheetCanvas = $("sheetCanvas");
const sctx = sheetCanvas.getContext("2d");

// Register SW
(async () => {
  try{
    if ("serviceWorker" in navigator) {
      await navigator.serviceWorker.register("./sw.js");
    }
  }catch(e){
    console.warn("SW register failed:", e);
  }
})();

// ---------- Settings / Themes ----------
function applyThemeButtonLabel(){
  const isLight = document.documentElement.dataset.theme === "light";
  themeBtn.textContent = isLight ? "☀️ Light" : "🌙 Dark";
}
themeBtn.addEventListener("click", () => {
  const html = document.documentElement;
  html.dataset.theme = (html.dataset.theme === "light") ? "dark" : "light";
  applyThemeButtonLabel();
  persistSettings();
});
designSelect.addEventListener("change", () => {
  document.documentElement.dataset.design = designSelect.value;
  persistSettings();
});
function persistSettings(){
  const html = document.documentElement;
  localStorage.setItem("va_theme", html.dataset.theme);
  localStorage.setItem("va_design", html.dataset.design);
}
(function restoreSettings(){
  const t = localStorage.getItem("va_theme");
  const d = localStorage.getItem("va_design");
  if (t) document.documentElement.dataset.theme = t;
  if (d) document.documentElement.dataset.design = d;
  designSelect.value = document.documentElement.dataset.design || "auto";
  applyThemeButtonLabel();
})();
// --- Melody-only mode (helps with chords / multi-voice scores) ---
let melodyOnly = (localStorage.getItem("va_melodyOnly") || "1") === "1";

// Inject a settings toggle if the HTML doesn't already include it
(function ensureMelodyToggle(){
  try{
    const panel = document.getElementById("settingsPanel");
    if (!panel) return;

    let cb = document.getElementById("melodyOnly");
    if (!cb){
      const row = document.createElement("div");
      row.className = "row";
      row.style.display = "flex";
      row.style.alignItems = "center";
      row.style.justifyContent = "space-between";
      row.style.gap = "10px";

      const label = document.createElement("label");
      label.htmlFor = "melodyOnly";
      label.textContent = "Melody only (ignore chords)";

      cb = document.createElement("input");
      cb.type = "checkbox";
      cb.id = "melodyOnly";
      cb.checked = melodyOnly;

      row.appendChild(label);
      row.appendChild(cb);

      // Place it near the top of settings, after theme/design if possible.
      const firstFieldset = panel.querySelector("fieldset") || panel.firstElementChild;
      if (firstFieldset) firstFieldset.appendChild(row);
      else panel.appendChild(row);
    }
    cb.addEventListener("change", () => {
      melodyOnly = cb.checked;
      localStorage.setItem("va_melodyOnly", melodyOnly ? "1" : "0");
      // If a score is loaded, rebuild events quickly from rawNotes if we have them
      if (score._rawNotes){
        rebuildFromRawNotes();
      }
    });
  }catch(e){
    console.warn("Melody toggle init failed:", e);
  }
})();

// Settings panel toggle
settingsBtn.addEventListener("click", () => {
  const isOpen = !settingsPanel.hasAttribute("hidden");
  if (isOpen) settingsPanel.setAttribute("hidden", "");
  else settingsPanel.removeAttribute("hidden");
  settingsBtn.setAttribute("aria-expanded", String(!isOpen));
});

// Ripple helper
function attachRipple(el){
  el.addEventListener("pointerdown", (e) => {
    const r = el.getBoundingClientRect();
    const ink = document.createElement("span");
    ink.className = "ripple-ink";
    const size = Math.max(r.width, r.height) * 1.4;
    ink.style.width = ink.style.height = `${size}px`;
    ink.style.left = `${e.clientX - r.left - size/2}px`;
    ink.style.top = `${e.clientY - r.top - size/2}px`;
    el.appendChild(ink);
    setTimeout(() => ink.remove(), 650);
  });
}
document.querySelectorAll(".ripple").forEach(attachRipple);

// --- Mic state must be defined before setMode() can call stopMic() ---
var mic = {
  stream: null,
  ctx: null,
  src: null,
  analyser: null,
  buf: null,
  raf: null,

  freq: 0,
  clarity: 0,
  rms: 0,

  latched: false,
  stableMs: 0,
  releaseMs: 0,
  lastFrameTs: 0,
  lastAdvanceAt: 0
};

// ---------- Core state ----------
let mode = "preview"; // preview | learn
let tempoMul = 1.0;
const tempoSteps = [0.25,0.33,0.5,0.67,0.75,1.0,1.25,1.5,2.0];
function setTempoMul(x){
  tempoMul = x;
  tempoVal.textContent = `${tempoMul.toFixed(2)}×`;
  persistLoop();
}
function tempoStep(delta){
  const idx = tempoSteps.reduce((best, v, i) =>
    (Math.abs(v-tempoMul) < Math.abs(tempoSteps[best]-tempoMul)) ? i : best, 0);
  const next = Math.max(0, Math.min(tempoSteps.length-1, idx + delta));
  setTempoMul(tempoSteps[next]);
}
tempoDownBtn.addEventListener("click", () => tempoStep(-1));
tempoUpBtn.addEventListener("click", () => tempoStep(1));
setTempoMul(1.0);

modePreviewBtn.addEventListener("click", () => setMode("preview"));
modeLearnBtn.addEventListener("click", () => setMode("learn"));

function setMode(m){
  mode = m;
  modePreviewBtn.classList.toggle("active", mode==="preview");
  modeLearnBtn.classList.toggle("active", mode==="learn");
  learnOnlyRow.style.display = (mode==="learn") ? "" : "none";
  micBtn.style.display = (mode==="learn") ? "" : "none";
  status(`Mode: ${mode}`);
  if (mode === "preview") stopMic();
}
setMode("preview");

showSheet.addEventListener("change", () => {
  $("sheetPanel").style.display = showSheet.checked ? "" : "none";
});
showFalling.addEventListener("change", () => {
  $("fallingPanel").style.display = showFalling.checked ? "" : "none";
});

// Loop
let loop = { startIdx: null, endIdx: null };
function persistLoop(){
  localStorage.setItem("va_tempoMul", String(tempoMul));
  localStorage.setItem("va_countIn", String(Number(countInEl.value||0)));
  localStorage.setItem("va_tolCents", String(Number(tolCentsEl.value||45)));
  localStorage.setItem("va_waitMode", waitModeEl.checked ? "1":"0");
}
(function restorePractice(){
  const tm = Number(localStorage.getItem("va_tempoMul")||"1");
  if (!Number.isNaN(tm)) setTempoMul(tm);
  const ci = Number(localStorage.getItem("va_countIn")||"0");
  countInEl.value = String(ci);
  const tc = Number(localStorage.getItem("va_tolCents")||"45");
  tolCentsEl.value = String(tc);
  waitModeEl.checked = (localStorage.getItem("va_waitMode")||"1")==="1";
})();
[countInEl, tolCentsEl, waitModeEl].forEach(el => el.addEventListener("change", persistLoop));

function loopText(){
  if (loop.startIdx == null || loop.endIdx == null) return "Loop: off";
  return `Loop: ${loop.startIdx+1} → ${loop.endIdx+1}`;
}
function updateLoopRead(){ loopRead.textContent = loopText(); }
updateLoopRead();

loopStartBtn.addEventListener("click", () => {
  if (!score.events.length) return;
  loop.startIdx = playhead.idx;
  if (loop.endIdx != null && loop.endIdx < loop.startIdx) loop.endIdx = null;
  updateLoopRead();
});
loopEndBtn.addEventListener("click", () => {
  if (!score.events.length) return;
  loop.endIdx = playhead.idx;
  if (loop.startIdx != null && loop.endIdx < loop.startIdx) loop.startIdx = null;
  updateLoopRead();
});
loopClearBtn.addEventListener("click", () => {
  loop.startIdx = loop.endIdx = null;
  updateLoopRead();
});

// ---------- File loading ----------
openBtn.addEventListener("click", () => scoreFile.click());
scoreFile.addEventListener("change", async () => {
  const file = scoreFile.files?.[0];
  if (!file) return;
  await loadFile(file);
});

function setHeaderFilename(name){
  headerTitle.textContent = name ? name : "Load MIDI or MusicXML";
  headerTitle.title = headerTitle.textContent;
}

async function loadFile(file){
  stopAll();
  setHeaderFilename(file.name);
  status(`Loading: ${file.name}`);

  const buf = await file.arrayBuffer();
  const ext = (file.name.split(".").pop()||"").toLowerCase();

  let parsed;
  if (ext === "mscz") {
    parsed = await parseMSCZ(buf);
    score.source = "MSCZ";
  } else if (ext === "xml" || ext === "musicxml") {
    const text = new TextDecoder().decode(buf);
    parsed = parseMusicXML(text);
    score.source = "MusicXML";
  } else {
    parsed = parseMIDI(buf);
    score.source = "MIDI";
  }

  // Apply melody-only filter (highest note at each start time) for all formats if enabled
  parsed.notes = applyMelodyOnlyFilter(parsed.notes);

  score.bpm = parsed.bpm || 120;
  score.timeSig = parsed.timeSig || { num: 4, den: 4 };
  score._rawNotes = parsed.notes;
  score.events = buildScoreEvents(parsed.notes, score.bpm, score.timeSig);
  score.measures = buildMeasures(score.events, score.timeSig);
  score.fileName = file.name;

  playhead.idx = 0;
  playhead.t0 = 0;

  status(`Loaded ${score.events.filter(e=>e.kind==="note").length} notes • ${score.source} • ${score.bpm} bpm`);
  updateTargetReadout();
}

const score = {
  source: "—",
  fileName: "",
  bpm: 120,
  timeSig: { num:4, den:4 },
  events: [],
  measures: []
};

function rebuildFromRawNotes(){
  if (!score._rawNotes) return;
  const notes = applyMelodyOnlyFilter(score._rawNotes);
  score.events = buildScoreEvents(notes, score.bpm, score.timeSig);
  score.measures = buildMeasures(score.events, score.timeSig);
  playhead.idx = 0;
  playhead.t0 = 0;
  updateTargetReadout();
}

// ---------- MIDI parsing ----------
function parseMIDI(arrayBuffer){
  const midi = new Midi(arrayBuffer);
  const tempos = midi.header.tempos || [];
  const bpm = tempos.length ? tempos[0].bpm : 120;

  const ts = midi.header.timeSignatures?.[0];
  const timeSig = ts ? { num: ts.timeSignature[0], den: ts.timeSignature[1] } : { num:4, den:4 };

  const notes = [];
  for (const tr of midi.tracks){
    for (const n of tr.notes){
      notes.push({
        midi: n.midi,
        timeSec: n.time,
        durSec: n.duration
      });
    }
  }
  notes.sort((a,b) => a.timeSec - b.timeSec);
  return { bpm, timeSig, notes };
}

// ---------- MusicXML parsing (best-effort) ----------
function parseMusicXML(xmlText){
  const dom = new DOMParser().parseFromString(xmlText, "text/xml");
  const parserErr = dom.querySelector("parsererror");
  if (parserErr) console.warn("XML parse error:", parserErr.textContent);

  let bpm = 120;
  const soundTempo = dom.querySelector('sound[tempo]');
  if (soundTempo) bpm = Number(soundTempo.getAttribute("tempo")) || bpm;

  let timeSig = { num: 4, den: 4 };
  const ts = dom.querySelector("time");
  if (ts){
    const beats = Number(ts.querySelector("beats")?.textContent || "4");
    const beatType = Number(ts.querySelector("beat-type")?.textContent || "4");
    if (beats && beatType) timeSig = { num: beats, den: beatType };
  }

  const divEl = dom.querySelector("divisions");
  const divisions = Number(divEl?.textContent || "1") || 1;

  const notes = [];
  let cursorDiv = 0;
  const measures = [...dom.querySelectorAll("measure")];
  for (const m of measures){
    cursorDiv = 0;
    const kids = [...m.children];
    for (const el of kids){
      if (el.tagName === "note"){
        const isRest = !!el.querySelector("rest");
        const durDiv = Number(el.querySelector("duration")?.textContent || "0") || 0;
        const voiceTimeDiv = cursorDiv;

        if (!isRest){
          const step = el.querySelector("pitch > step")?.textContent || "C";
          const octave = Number(el.querySelector("pitch > octave")?.textContent || "4");
          const alter = Number(el.querySelector("pitch > alter")?.textContent || "0") || 0;
          const midi = stepOctAlterToMidi(step, octave, alter);
          notes.push({
            midi,
            timeSec: (voiceTimeDiv / divisions) * (60 / bpm),
            durSec: (durDiv / divisions) * (60 / bpm)
          });
        }
        cursorDiv += durDiv;
      }
      if (el.tagName === "backup"){
        const durDiv = Number(el.querySelector("duration")?.textContent || "0") || 0;
        cursorDiv -= durDiv;
      }
      if (el.tagName === "forward"){
        const durDiv = Number(el.querySelector("duration")?.textContent || "0") || 0;
        cursorDiv += durDiv;
      }
    }
  }

  notes.sort((a,b) => a.timeSec - b.timeSec);
  return { bpm, timeSig, notes };
}

function stepOctAlterToMidi(step, oct, alter){
  // step: A-G, oct: integer, alter: -2..2 (semitones)
  const base = {C:0, D:2, E:4, F:5, G:7, A:9, B:11}[String(step||'C').toUpperCase()] ?? 0;
  const o = Number(oct);
  const a = Number(alter)||0;
  // MIDI: C4 = 60. Formula: (oct+1)*12 + base + alter
  return (o + 1) * 12 + base + a;
}
// ---------- MuseScore (.mscz/.mscx) parsing (best-effort) ----------
async function parseMSCZ(arrayBuffer){
  // .mscz is a zip container. We dynamically import JSZip only when needed.
  const mod = await import("https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm");
  const JSZip = mod.default;
  const zip = await JSZip.loadAsync(arrayBuffer);

  // Find the first .mscx file in the zip
  let mscxName = null;
  zip.forEach((path, file) => {
    if (!mscxName && !file.dir && path.toLowerCase().endsWith(".mscx")) mscxName = path;
  });
  if (!mscxName) throw new Error("No .mscx found inside .mscz");

  const xmlText = await zip.file(mscxName).async("string");
  return parseMSCX(xmlText);
}

function parseMSCX(xmlText){
  const dom = new DOMParser().parseFromString(xmlText, "text/xml");
  const parserErr = dom.querySelector("parsererror");
  if (parserErr) console.warn("MSCX parse error:", parserErr.textContent);

  // MuseScore 3 uses <Division> ticks-per-quarter
  const divEl = dom.querySelector("Division");
  const division = Number(divEl?.textContent || "480") || 480;

  // Time signature: <TimeSig><sigN>4</sigN><sigD>4</sigD>
  let timeSig = { num: 4, den: 4 };
  const tsEl = dom.querySelector("TimeSig");
  if (tsEl){
    const n = Number(tsEl.querySelector("sigN")?.textContent || "4");
    const d = Number(tsEl.querySelector("sigD")?.textContent || "4");
    if (n && d) timeSig = { num: n, den: d };
  }

  // Tempo: MuseScore stores tempo in <Tempo><tempo> (quarter-notes per second) or sometimes textual.
  let bpm = 120;
  const tempoEl = dom.querySelector("Tempo tempo, Tempo > tempo");
  if (tempoEl){
    const qps = Number(tempoEl.textContent || "0");
    if (qps > 0) bpm = qps * 60;
  }

  // Choose treble staff only.
  // MuseScore 3+: Score > Staff. MuseScore 1.x: Staff elements with id="1"/"2" at top level.
  let staff = dom.querySelector("Score > Staff") || dom.querySelector("Staff");
  if (!staff || !staff.querySelectorAll("Measure").length){
    // MuseScore 1.x layout: <Staff id="1"> ... <Measure> ...</Staff>
    const staffBlocks = [...dom.querySelectorAll('Staff[id]')];
    if (staffBlocks.length){
      // Prefer the first staff (treble in piano scores) unless user later adds a chooser
      staff = staffBlocks[0];
    }
  }
  if (!staff) return { bpm, timeSig, notes: [] };

  // Helper: durationType -> beats (quarter=1.0)
  const durBeats = (durType) => {
    switch ((durType || "").toLowerCase()){
      case "measure": return timeSig.num * (4 / timeSig.den);
      case "whole": return 4;
      case "half": return 2;
      case "quarter": return 1;
      case "eighth": return 0.5;
      case "16th": return 0.25;
      case "32nd": return 0.125;
      case "64th": return 0.0625;
      default: return 1;
    }
  };

  const ticksPerBeat = division; // quarter note beat
  const beatsToSec = (beats) => beats * (60 / bpm);

  const notes = [];

  // MuseScore stores content under <Measure> with one or more <voice> elements.
  const measures = [...staff.querySelectorAll("Measure")];

  let globalTick = 0;

  for (const meas of measures){
    // If melodyOnly, we prefer voice 1 only (first <voice>). Otherwise merge all voices by a simple sequential pass.
    const voices = [...meas.querySelectorAll(':scope > voice')];
    const useVoices = (melodyOnly && voices.length) ? [voices[0]] : (voices.length ? voices : [meas]);

    // For multi-voice without explicit ticks, we do a simple sequential interpretation per voice and then merge by time.
    // Best-effort: measure-relative cursor for each voice, merged into global.
    const voiceNotes = [];

    for (const v of useVoices){
      let tick = globalTick;

      // direct children can include Chord, Rest, TimeSig, Tempo, etc.
      const items = [...v.children].filter(el => el.tagName !== "Irregular");
      for (const it of items){
        if (it.tagName === "Chord"){
          const durType = it.querySelector("durationType")?.textContent || "quarter";
          const dots = Number(it.querySelector("dots")?.textContent || "0") || 0;
          let beats = durBeats(durType);
          if (dots === 1) beats *= 1.5;
          else if (dots === 2) beats *= 1.75;
          const durTicks = Math.max(1, Math.round(beats * ticksPerBeat));

          // Chord may contain multiple <Note>; melodyOnly: pick highest pitch
          const pitchEls = [...it.querySelectorAll("Note > pitch")];
          if (pitchEls.length){
            const pitches = pitchEls.map(p => Number(p.textContent || "0")).filter(n => !Number.isNaN(n));
            if (pitches.length){
              const pitch = melodyOnly ? Math.max(...pitches) : pitches[0];
              // MuseScore pitch is MIDI note number
              voiceNotes.push({
                midi: pitch,
                timeSec: (tick / ticksPerBeat) * (60 / bpm),
                durSec: beatsToSec(beats)
              });

              if (!melodyOnly){
                // If not melodyOnly, add remaining notes in chord at the same time
                const rest = pitches.filter(p => p !== pitch);
                for (const p of rest){
                  voiceNotes.push({
                    midi: p,
                    timeSec: (tick / ticksPerBeat) * (60 / bpm),
                    durSec: beatsToSec(beats)
                  });
                }
              }
            }
          }

          tick += durTicks;
        } else if (it.tagName === "Rest"){
          const durType = it.querySelector("durationType")?.textContent || "quarter";
          const dots = Number(it.querySelector("dots")?.textContent || "0") || 0;
          let beats = durBeats(durType);
          if (dots === 1) beats *= 1.5;
          else if (dots === 2) beats *= 1.75;
          tick += Math.max(1, Math.round(beats * ticksPerBeat));
        } else if (it.tagName === "TimeSig"){
          // update if a mid-score timesig exists
          const n = Number(it.querySelector("sigN")?.textContent || "0");
          const d = Number(it.querySelector("sigD")?.textContent || "0");
          if (n && d) timeSig = { num: n, den: d };
        } else if (it.tagName === "Tempo"){
          const qps = Number(it.querySelector("tempo")?.textContent || "0");
          if (qps > 0) bpm = qps * 60;
        }
      }
    }

    // Advance globalTick by measure duration inferred from time signature
    globalTick += Math.round((timeSig.num * (4 / timeSig.den)) * ticksPerBeat);

    notes.push(...voiceNotes);
  }

  notes.sort((a,b) => a.timeSec - b.timeSec || a.midi - b.midi);
  return { bpm, timeSig, notes };
}

// ---------- Build practice score (quantize + rests + measure structure) ----------
function beatsPerMeasure(ts){
  return ts.num * (4 / ts.den);
}
function quantStepBeats(){ return 0.25; } // 16th note
function secToBeats(sec, bpm){ return sec * (bpm / 60); }


function applyMelodyOnlyFilter(notes){
  if (!melodyOnly) return notes;
  if (!notes || !notes.length) return notes;

  // Group notes that start at the same time (within epsilon) and keep the highest pitch.
  const eps = 1e-4; // 0.1 ms in seconds
  const out = [];
  notes = notes.slice().sort((a,b) => a.timeSec - b.timeSec || a.midi - b.midi);

  let i = 0;
  while (i < notes.length){
    const t0 = notes[i].timeSec;
    let best = notes[i];
    let j = i + 1;
    while (j < notes.length && Math.abs(notes[j].timeSec - t0) <= eps){
      if (notes[j].midi > best.midi) best = notes[j];
      j++;
    }
    out.push(best);
    i = j;
  }
  return out;
}
function buildScoreEvents(notes, bpm, ts){
  const q = quantStepBeats();
  const bpmEff = bpm;

  const qNotes = notes.map(n => {
    const b = secToBeats(n.timeSec, bpmEff);
    const d = Math.max(q, secToBeats(n.durSec, bpmEff));
    const qb = Math.max(0, Math.round(b / q) * q);
    let qd = Math.round(d / q) * q;
    if (qd < q) qd = q;
    return { kind:"note", midi:n.midi, startBeat: qb, durBeat: qd };
  }).sort((a,b)=>a.startBeat-b.startBeat);

  for (let i=0;i<qNotes.length-1;i++){
    const a = qNotes[i];
    const b = qNotes[i+1];
    const endA = a.startBeat + a.durBeat;
    if (endA > b.startBeat){
      a.durBeat = Math.max(q, b.startBeat - a.startBeat);
    }
  }

  const events = [];
  let cursor = 0;
  for (const n of qNotes){
    if (n.startBeat > cursor){
      events.push({ kind:"rest", startBeat: cursor, durBeat: n.startBeat - cursor });
    }
    events.push(n);
    cursor = Math.max(cursor, n.startBeat + n.durBeat);
  }

  const mLen = beatsPerMeasure(ts);
  const endTo = Math.ceil(cursor / mLen) * mLen;
  if (endTo > cursor){
    events.push({ kind:"rest", startBeat: cursor, durBeat: endTo - cursor });
  }

  return events;
}

function buildMeasures(events, ts){
  const mLen = beatsPerMeasure(ts);
  const totalEnd = events.length ? (events[events.length-1].startBeat + events[events.length-1].durBeat) : 0;
  const mCount = Math.max(1, Math.round(totalEnd / mLen));
  const measures = Array.from({length: mCount}, (_,i)=>({
    index:i,
    startBeat: i*mLen,
    endBeat: (i+1)*mLen,
    events:[]
  }));
  for (const ev of events){
    const mid = Math.min(measures.length-1, Math.floor(ev.startBeat / mLen));
    measures[mid].events.push(ev);
  }
  return measures;
}

// ---------- Audio playback (Preview) ----------
let audio = {
  ctx: null,
  master: null,
  isPlaying: false,
  startAt: 0,
  pauseAt: 0,
  schedTimer: null
};

function ensureAudio(){
  if (audio.ctx) return audio.ctx;
  const A = window.AudioContext || window.webkitAudioContext;
  audio.ctx = new A();
  audio.master = audio.ctx.createGain();
  audio.master.gain.value = 0.22;
  audio.master.connect(audio.ctx.destination);
  return audio.ctx;
}

function midiToFreq(m){ return 440 * Math.pow(2, (m-69)/12); }

function playBeep(midi, when, durSec){
  const ctx = ensureAudio();
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(midiToFreq(midi), when);

  const a = 0.006, d = 0.05, s = 0.4, r = 0.06;
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(1.0, when + a);
  g.gain.exponentialRampToValueAtTime(s, when + a + d);
  g.gain.setValueAtTime(s, when + Math.max(a+d, durSec - r));
  g.gain.exponentialRampToValueAtTime(0.0001, when + durSec);

  osc.connect(g);
  g.connect(audio.master);
  osc.start(when);
  osc.stop(when + durSec + 0.02);
}

function scoreBeatToSec(beat){
  const bpmEff = score.bpm * tempoMul;
  return (60 / bpmEff) * beat;
}

const playhead = {
  idx: 0,
  t0: 0,
  startedAt: 0
};

function resetPlayhead(){
  playhead.idx = 0;
  playhead.t0 = 0;
  playhead.startedAt = 0;
}

function status(t){ statusEl.textContent = t; }

function startPreview(){
  if (!score.events.length){ status("Load a MIDI or MusicXML file first."); return; }
  if (mode !== "preview"){ setMode("preview"); }
  const ctx = ensureAudio();
  ctx.resume?.();

  audio.isPlaying = true;
  const now = ctx.currentTime;

  const countInBeats = (Number(countInEl.value||0) || 0) * (4 / score.timeSig.den);
  const countInSec = scoreBeatToSec(countInBeats);

  if (audio.pauseAt > 0){
    playhead.startedAt = now - audio.pauseAt;
  }else{
    playhead.startedAt = now + countInSec;
  }

  if (audio.schedTimer) clearInterval(audio.schedTimer);
  audio.schedTimer = setInterval(() => schedulerTick(), 25);

  status("Playing (Preview)");
}

function pausePreview(){
  if (!audio.isPlaying) return;
  const ctx = ensureAudio();
  audio.isPlaying = false;
  audio.pauseAt = Math.max(0, ctx.currentTime - playhead.startedAt);
  if (audio.schedTimer) clearInterval(audio.schedTimer);
  audio.schedTimer = null;
  status("Paused");
}

function schedulerTick(){
  if (!audio.isPlaying) return;
  const ctx = ensureAudio();

  const lookahead = 0.12;
  const now = ctx.currentTime;

  const tSec = now - playhead.startedAt;
  const tBeat = secToBeats(Math.max(0, tSec), score.bpm * tempoMul);

  while (playhead.idx < score.events.length){
    const ev = score.events[playhead.idx];
    const evStart = ev.startBeat;
    if (evStart >= tBeat) break;
    playhead.idx++;
  }

  while (playhead.idx < score.events.length){
    const ev = score.events[playhead.idx];
    const evStartSec = playhead.startedAt + scoreBeatToSec(ev.startBeat);
    if (evStartSec > now + lookahead) break;

    if (ev.kind === "note"){
      const durSec = scoreBeatToSec(ev.durBeat);
      playBeep(ev.midi, evStartSec, Math.max(0.06, durSec));
    }
    playhead.idx++;
  }

  if (playhead.idx >= score.events.length){
    setTimeout(() => stopAll(), 250);
  }
}

// Test sound
testBtn.addEventListener("click", async () => {
  const ctx = ensureAudio();
  await ctx.resume?.();
  const now = ctx.currentTime + 0.02;
  playBeep(69, now, 0.18); // A4
  status("Test: A4");
});

// Transport buttons
playBtn.addEventListener("click", startPreview);
pauseBtn.addEventListener("click", pausePreview);
stopBtn.addEventListener("click", () => { stopAll(); stopMic(); });

// ---------- Learn Mode \(Mic pitch detection \+ latch\) ----------

micBtn.addEventListener("click", async () => {
  if (mode !== "learn") setMode("learn");
  await startMic();
});

async function startMic(){
  try{
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    mic.stream = stream;

    const A = window.AudioContext || window.webkitAudioContext;
    mic.ctx = new A();
    await mic.ctx.resume?.();

    mic.src = mic.ctx.createMediaStreamSource(stream);
    mic.analyser = mic.ctx.createAnalyser();
    mic.analyser.fftSize = 2048;

    mic.src.connect(mic.analyser);

    mic.buf = new Float32Array(mic.analyser.fftSize);

    mic.latched = false;
    mic.stableMs = 0;
    mic.releaseMs = 0;
    mic.lastFrameTs = performance.now();
    mic.lastAdvanceAt = 0;

    micStatusTxt.textContent = "Mic running";
    status("Mic started (Learn)");
    updateTargetReadout();

    if (mic.raf) cancelAnimationFrame(mic.raf);
    mic.raf = requestAnimationFrame(micLoop);
  }catch(e){
    console.warn(e);
    micStatusTxt.textContent = "Microphone permission denied or unavailable";
    status("Mic unavailable");
  }
}

function stopMic(){
  // Safe to call during startup before mic has initialized/started
  if (typeof mic === "undefined" || !mic) return;

  if (mic.raf) cancelAnimationFrame(mic.raf);
  mic.raf = null;

  if (mic.stream){
    mic.stream.getTracks().forEach(t => t.stop());
    mic.stream = null;
  }
  if (mic.ctx){
    mic.ctx.close?.();
    mic.ctx = null;
  }

  if (typeof micStatusTxt !== "undefined" && micStatusTxt) micStatusTxt.textContent = "Mic stopped";
}

// Autocorrelation pitch detection
function detectPitchACF(buf, sampleRate){
  let sum = 0;
  for (let i=0;i<buf.length;i++){
    const v = buf[i];
    sum += v*v;
  }
  const rms = Math.sqrt(sum / buf.length);

  if (rms < 0.01) return { freq: 0, clarity: 0, rms };

  let mean = 0;
  for (let i=0;i<buf.length;i++) mean += buf[i];
  mean /= buf.length;
  for (let i=0;i<buf.length;i++) buf[i] -= mean;

  const SIZE = buf.length;
  const MAX_LAG = Math.floor(sampleRate / 50);
  const MIN_LAG = Math.floor(sampleRate / 1200);

  let bestLag = -1;
  let bestCorr = 0;

  for (let lag = MIN_LAG; lag <= MAX_LAG; lag++){
    let corr = 0;
    let norm1 = 0;
    let norm2 = 0;
    for (let i=0; i<SIZE-lag; i++){
      const a = buf[i];
      const b = buf[i+lag];
      corr += a*b;
      norm1 += a*a;
      norm2 += b*b;
    }
    const denom = Math.sqrt(norm1*norm2) || 1;
    const c = corr / denom;
    if (c > bestCorr){
      bestCorr = c;
      bestLag = lag;
    }
  }

  const clarity = Math.max(0, Math.min(1, bestCorr));
  if (bestLag <= 0 || clarity < 0.2) return { freq: 0, clarity, rms };

  const freq = sampleRate / bestLag;
  return { freq, clarity, rms };
}

function freqToMidi(freq){
  return 69 + 12 * Math.log2(freq / 440);
}
function midiToName(m){
  const names = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
  const n = Math.round(m);
  const name = names[(n%12+12)%12];
  const oct = Math.floor(n/12)-1;
  return `${name}${oct}`;
}
function centsOff(midiA, midiB){
  return (midiA - midiB) * 100;
}

function getCurrentTargetNote(){
  let i = playhead.idx;
  while (i < score.events.length && score.events[i].kind !== "note") i++;
  if (i >= score.events.length) return null;
  return { idx: i, ev: score.events[i] };
}

function updateTargetReadout(){
  const t = getCurrentTargetNote();
  if (!t){
    targetTxt.textContent = "—";
    return;
  }
  const name = midiToName(t.ev.midi);
  const finger = violinFingerForMidi(t.ev.midi);
  targetTxt.textContent = `${name} (${finger.string}, ${finger.finger})`;
}

// Simple violin hints (first position-ish)
function violinFingerForMidi(midi){
  const strings = [
    { name:"G", open:55 },
    { name:"D", open:62 },
    { name:"A", open:69 },
    { name:"E", open:76 },
  ];

  let best = strings[0];
  for (const s of strings){
    if (midi >= s.open && midi <= s.open + 7) best = s;
  }
  const semis = Math.max(0, midi - best.open);

  let finger = 0;
  if (semis === 0) finger = 0;
  else if (semis <= 2) finger = 1;
  else if (semis <= 4) finger = 2;
  else if (semis <= 6) finger = 3;
  else finger = 4;

  return { string: best.name, finger };
}

function learnTryAdvance(nowMs){
  const t = getCurrentTargetNote();
  if (!t) return;

  const tol = Number(tolCentsEl.value||45) || 45;
  const requireStable = waitModeEl.checked;

  if (mic.freq <= 0){
    mic.stableMs = 0;
    mic.releaseMs += (nowMs - mic.lastFrameTs);
    return;
  }

  const actualMidi = freqToMidi(mic.freq);
  const delta = centsOff(actualMidi, t.ev.midi);
  const abs = Math.abs(delta);

  heardTxt.textContent = `${midiToName(actualMidi)} (~${Math.round(actualMidi*10)/10})`;
  clarityTxt.textContent = mic.clarity.toFixed(2);
  deltaTxt.textContent = `${(delta>=0?"+":"")}${Math.round(delta)} cents`;
  levelTxt.textContent = mic.rms.toFixed(3);

  const match = (abs <= tol) && (mic.clarity >= 0.55) && (mic.rms >= 0.012);

  const releaseCond = (!match) || (mic.clarity < 0.35) || (mic.rms < 0.009);
  if (releaseCond){
    mic.releaseMs += (nowMs - mic.lastFrameTs);
  } else {
    mic.releaseMs = 0;
  }

  if (mic.latched && mic.releaseMs >= 140){
    mic.latched = false;
    mic.stableMs = 0;
  }

  if (mic.latched) return;

  if (match){
    mic.stableMs += (nowMs - mic.lastFrameTs);
  } else {
    mic.stableMs = 0;
  }

  const minGateMs = Math.max(120, scoreBeatToSec(t.ev.durBeat) * 1000 * 0.35);
  const stableOk = !requireStable || (mic.stableMs >= 120);
  const gateOk = (nowMs - mic.lastAdvanceAt) >= minGateMs;

  if (match && stableOk && gateOk){
    playhead.idx = t.idx + 1;      // advance ONE note only
    mic.latched = true;
    mic.lastAdvanceAt = nowMs;
    mic.stableMs = 0;
    mic.releaseMs = 0;
    updateTargetReadout();
  }
}

function micLoop(ts){
  if (!mic.analyser) return;

  mic.lastFrameTs = ts;

  mic.analyser.getFloatTimeDomainData(mic.buf);
  const det = detectPitchACF(mic.buf, mic.ctx.sampleRate);
  mic.freq = det.freq;
  mic.clarity = det.clarity;
  mic.rms = det.rms;

  if (mode === "learn"){
    micBtn.style.display = "";
    micStatusTxt.textContent = "Mic running";
    learnTryAdvance(ts);
  }

  mic.raf = requestAnimationFrame(micLoop);
}

// ---------- Rendering ----------
function resizeCanvasToDisplaySize(c, minH=260){
  const dpr = window.devicePixelRatio || 1;
  const rect = c.getBoundingClientRect();
  const w = Math.max(320, Math.round(rect.width * dpr));
  const h = Math.max(minH, Math.round(rect.height * dpr));
  if (c.width !== w || c.height !== h){
    c.width = w; c.height = h;
  }
}
function nowPlayBeat(){
  if (!audio.isPlaying) return 0;
  const ctxA = ensureAudio();
  const tSec = Math.max(0, ctxA.currentTime - playhead.startedAt);
  return secToBeats(tSec, score.bpm * tempoMul);
}

// Falling notes lanes
const lanes = [
  { name:"G", open:55 },
  { name:"D", open:62 },
  { name:"A", open:69 },
  { name:"E", open:76 }
];
function laneForMidi(m){
  let best = lanes[0];
  for (const s of lanes){
    if (m >= s.open) best = s;
  }
  return best;
}


function drawFalling(){
  // Falling view with sustain-length rectangles (duration-true) and clearer labels.
  resizeCanvasToDisplaySize(fallingCanvas, 360);
  const W = fallingCanvas.width, H = fallingCanvas.height;
  ctx.clearRect(0,0,W,H);

  if (!showFalling.checked){
    ctx.fillStyle = isLightTheme?.() ? "rgba(16,18,28,.7)" : "rgba(255,255,255,.65)";
    ctx.font = `${Math.round(14*(window.devicePixelRatio||1))}px system-ui, sans-serif`;
    ctx.fillText("Falling hidden", 20*(window.devicePixelRatio||1), 30*(window.devicePixelRatio||1));
    return;
  }

  const dpr = (window.devicePixelRatio||1);
  const pad = 14*dpr;
  const hitY = H - 70*dpr;
  const laneW = (W - pad*2) / 4;

  // lanes background
  ctx.fillStyle = isLightTheme?.() ? "rgba(0,0,0,.03)" : "rgba(255,255,255,.03)";
  for (let i=0;i<4;i++){
    const x = pad + i*laneW;
    ctx.fillRect(x, pad, laneW-2*dpr, H-pad*2);
  }

  // lane labels
  ctx.fillStyle = isLightTheme?.() ? "rgba(16,18,28,.70)" : "rgba(255,255,255,.70)";
  ctx.font = `700 ${Math.round(16*dpr)}px system-ui, sans-serif`;
  ctx.textAlign = "left";
  const names = ["G","D","A","E"];
  for (let i=0;i<4;i++){
    ctx.fillText(names[i], pad + i*laneW + 10*dpr, pad + 24*dpr);
  }

  // hit line
  ctx.strokeStyle = isLightTheme?.() ? "rgba(16,18,28,.18)" : "rgba(255,255,255,.20)";
  ctx.lineWidth = 2*dpr;
  ctx.beginPath();
  ctx.moveTo(pad, hitY);
  ctx.lineTo(W-pad, hitY);
  ctx.stroke();

  if (!score.events || !score.events.length) return;

  const bNow = nowPlayBeat?.() ?? 0;

  // pixels per beat controls scroll speed; choose based on height for phone readability
  const visibleBeats = 6.0; // how far ahead shown
  const pxPerBeat = (hitY - (pad + 40*dpr)) / visibleBeats;

  // choose events in window
  const windowStart = bNow - 1.5; 
  const windowEnd = bNow + visibleBeats;
  const evs = score.events.filter(ev => ev.type==="note" && ev.endBeat >= windowStart && ev.startBeat <= windowEnd);

  // draw notes (fainter for future)
  for (const ev of evs){
    const fing = guessStringAndFinger(ev.midi);
    const lane = ({G:0,D:1,A:2,E:3})[fing.string] ?? 0;
    const x = pad + lane*laneW + 8*dpr;
    const w = laneW - 16*dpr;

    // sustain-true rect: bottom hits play line at startBeat
    const yBottom = hitY - (ev.startBeat - bNow)*pxPerBeat;
    const rectH = Math.max(44*dpr, ev.durBeat * pxPerBeat); // minimum for legibility
    const yTop = yBottom - rectH;

    if (yBottom < pad || yTop > H-pad) continue;

    const isNow = Math.abs(ev.startBeat - bNow) < 0.08;
    const alpha = isNow ? 1.0 : (ev.startBeat >= bNow ? 0.70 : 0.28);

    // rect
    ctx.globalAlpha = alpha;
    ctx.fillStyle = isNow ? "rgba(91,140,255,.95)" : "rgba(160,170,190,.45)";
    ctx.strokeStyle = isLightTheme?.() ? "rgba(16,18,28,.10)" : "rgba(255,255,255,.10)";
    const r = 12*dpr;
    roundRect(ctx, x, yTop, w, rectH, r, true, true);

    // labels (note left, finger right)
    const name = midiToName(ev.midi);
    ctx.globalAlpha = Math.min(1, alpha + 0.22);
    ctx.fillStyle = isLightTheme?.() ? "rgba(16,18,28,.92)" : "rgba(255,255,255,.95)";
    ctx.font = `800 ${Math.round(16*dpr)}px system-ui, sans-serif`;
    ctx.textAlign = "left";
    ctx.fillText(name, x + 12*dpr, yTop + 24*dpr);

    ctx.font = `700 ${Math.round(14*dpr)}px system-ui, sans-serif`;
    ctx.textAlign = "right";
    ctx.fillText(`${fing.string} ${fing.finger}`, x + w - 12*dpr, yTop + 24*dpr);

    ctx.textAlign = "left";
    ctx.globalAlpha = 1.0;
  }
}


function roundRect(c,x,y,w,h,r){
  c.beginPath();
  c.moveTo(x+r, y);
  c.arcTo(x+w, y, x+w, y+h, r);
  c.arcTo(x+w, y+h, x, y+h, r);
  c.arcTo(x, y+h, x, y, r);
  c.arcTo(x, y, x+w, y, r);
  c.closePath();
}

function midiToStepOct(midi){
  const n = Math.round(midi);
  const names = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
  const name = names[(n%12+12)%12];
  const step = name[0];
  const accidental = name.length>1 ? name[1] : "";
  const oct = Math.floor(n/12)-1;
  return { step, accidental, oct };
}
function diatonicNumber(step, oct){
  const map = { C:0, D:1, E:2, F:3, G:4, A:5, B:6 };
  return (oct * 7) + (map[step] ?? 0);
}
const E4_DIAT = diatonicNumber("E",4);

function staffYForMidi(midi, staffBottomY, lineGap){
  const { step, oct } = midiToStepOct(midi);
  const dn = diatonicNumber(step, oct);
  const pos = dn - E4_DIAT;
  return staffBottomY - pos * (lineGap/2);
}

function durKind(beats){
  const b = beats;
  if (Math.abs(b - 4) < 0.001) return "whole";
  if (Math.abs(b - 2) < 0.001) return "half";
  if (Math.abs(b - 1) < 0.001) return "quarter";
  if (Math.abs(b - 0.5) < 0.001) return "eighth";
  if (Math.abs(b - 0.25) < 0.001) return "sixteenth";
  if (b >= 3) return "whole";
  if (b >= 1.5) return "half";
  if (b >= 0.75) return "quarter";
  if (b >= 0.375) return "eighth";
  return "sixteenth";
}

function drawTrebleClef(x, y){
  sctx.save();
  sctx.fillStyle = "rgba(255,255,255,.92)";
  sctx.font = `${Math.round(38*(window.devicePixelRatio||1))}px serif`;
  sctx.fillText("𝄞", x, y);
  sctx.restore();
}


function drawSheet(){
  // 3 systems (rows), 2 measures per row. Caret moves across full top row; paging happens per row.
  resizeCanvasToDisplaySize(sheetCanvas, 340);
  const W = sheetCanvas.width, H = sheetCanvas.height;
  sctx.clearRect(0,0,W,H);

  if (!showSheet.checked){
    sctx.fillStyle = noteInk?.() || "rgba(255,255,255,.6)";
    sctx.font = `${Math.round(14*(window.devicePixelRatio||1))}px system-ui, sans-serif`;
    sctx.fillText("Sheet hidden", 20*(window.devicePixelRatio||1), 30*(window.devicePixelRatio||1));
    return;
  }

  const dpr = (window.devicePixelRatio||1);
  const padX = 18*dpr, padY = 16*dpr;
  const lineGap = 14*dpr;
  const staffH = 4*lineGap;
  const systemGap = (staffH + 42*dpr);

  const measures = score.measures || [];
  if (!measures.length){
    sctx.fillStyle = noteInk?.() || "rgba(255,255,255,.7)";
    sctx.font = `${Math.round(14*dpr)}px system-ui, sans-serif`;
    sctx.fillText("Load MIDI / MusicXML / MSCZ to see notation.", padX, padY+20*dpr);
    return;
  }

  const measuresPerRow = 2;
  const rows = 3;
  const rowW = Math.max(1, W - padX*2);
  const measureW = rowW / measuresPerRow;

  // Determine current measure index from preview playback position
  const bNow = nowPlayBeat?.() ?? 0;
  let curIdx = 0;
  for (let i=0;i<measures.length;i++){
    const m = measures[i];
    const start = m.startBeat, end = m.endBeat;
    if (bNow >= start && bNow < end){ curIdx = i; break; }
    if (bNow >= end) curIdx = i;
  }
  const rowStartIdx = Math.floor(curIdx / measuresPerRow) * measuresPerRow;

  // staff line style
  sctx.lineWidth = 1*dpr;
  sctx.strokeStyle = staffInk?.() || (isLightTheme?.() ? "rgba(16,18,28,.25)" : "rgba(255,255,255,.20)");

  // draw each system
  for (let r=0;r<rows;r++){
    const sysTopY = padY + r*systemGap;
    const staffTopY = sysTopY + 28*dpr;
    const staffBottomY = staffTopY + staffH;

    // staff lines
    for (let k=0;k<5;k++){
      const y = staffTopY + k*lineGap;
      sctx.beginPath();
      sctx.moveTo(padX, y);
      sctx.lineTo(W-padX, y);
      sctx.stroke();
    }

    // treble clef on each system
    if (typeof drawTrebleClef === "function"){
      drawTrebleClef(padX + 10*dpr, staffTopY + 2*lineGap);
    } else {
      sctx.save();
      sctx.fillStyle = noteInk?.() || "rgba(255,255,255,.9)";
      sctx.font = `${Math.round(38*dpr)}px serif`;
      sctx.textBaseline = "middle";
      sctx.fillText("𝄞", padX + 8*dpr, staffTopY + 2*lineGap);
      sctx.restore();
    }

    // measures to render in this row
    const baseIdx = rowStartIdx + r*measuresPerRow;
    for (let mi=0; mi<measuresPerRow; mi++){
      const idx = baseIdx + mi;
      if (idx >= measures.length) continue;
      const m = measures[idx];
      const x0 = padX + mi*measureW;

      // bar line at measure start (except first)
      if (mi>0){
        sctx.beginPath();
        sctx.moveTo(x0, staffTopY);
        sctx.lineTo(x0, staffBottomY);
        sctx.stroke();
      }

      // Render events in this measure
      const evs = m.events || [];
      for (const ev of evs){
        if (ev.type !== "note") continue;

        const t = (ev.startBeat - m.startBeat) / (m.endBeat - m.startBeat);
        const x = x0 + Math.max(0, Math.min(0.999, t)) * measureW + 26*dpr;

        // map midi to staff position (very simplified)
        const midi = ev.midi;
        const semisFromE4 = midi - 64; // E4 is bottom line in treble-ish mapping
        const y = staffBottomY - semisFromE4 * (lineGap/2);

        // notehead + stem (reuse existing drawing style)
        const filled = (ev.durBeat ?? 1) <= 1.0;
        const rx = 7*dpr, ry = 5*dpr;

        sctx.save();
        sctx.strokeStyle = noteInk?.() || "rgba(255,255,255,.92)";
        sctx.fillStyle = filled ? (noteFillInk?.() || sctx.strokeStyle) : (noteHollowFill?.() || "rgba(255,255,255,.06)");
        sctx.lineWidth = 1.6*dpr;

        sctx.beginPath();
        sctx.ellipse(x, y, rx, ry, -0.35, 0, Math.PI*2);
        sctx.fill();
        sctx.stroke();

        // stem
        sctx.beginPath();
        sctx.moveTo(x + rx, y);
        sctx.lineTo(x + rx, y - 30*dpr);
        sctx.stroke();

        // simple flag for 1/8 and shorter
        if ((ev.durBeat ?? 1) <= 0.5){
          sctx.beginPath();
          sctx.moveTo(x + rx, y - 30*dpr);
          sctx.quadraticCurveTo(x + rx + 10*dpr, y - 22*dpr, x + rx, y - 14*dpr);
          sctx.stroke();
        }
        if ((ev.durBeat ?? 1) <= 0.25){
          sctx.beginPath();
          sctx.moveTo(x + rx, y - 22*dpr);
          sctx.quadraticCurveTo(x + rx + 10*dpr, y - 14*dpr, x + rx, y - 6*dpr);
          sctx.stroke();
        }

        // ledger lines
        const yMin = staffTopY, yMax = staffBottomY;
        if (y < yMin){
          for (let ly = yMin - lineGap; ly >= y; ly -= lineGap){
            sctx.beginPath();
            sctx.moveTo(x - 10*dpr, ly);
            sctx.lineTo(x + 10*dpr, ly);
            sctx.stroke();
          }
        } else if (y > yMax){
          for (let ly = yMax + lineGap; ly <= y; ly += lineGap){
            sctx.beginPath();
            sctx.moveTo(x - 10*dpr, ly);
            sctx.lineTo(x + 10*dpr, ly);
            sctx.stroke();
          }
        }

        sctx.restore();
      }
    }
  }

  // Caret across the entire TOP row width (two measures)
  if (mode==="preview" && audio.isPlaying){
    const topStartIdx = rowStartIdx;
    const mA = measures[topStartIdx];
    const mB = measures[topStartIdx+1] || mA;
    const rowStartBeat = mA.startBeat;
    const rowEndBeat = mB.endBeat;
    const rowLen = Math.max(1e-6, rowEndBeat - rowStartBeat);
    const tRow = Math.max(0, Math.min(1, (bNow - rowStartBeat) / rowLen));
    const xCaret = padX + tRow * rowW;

    const staffTopY = padY + 28*dpr;
    const staffBottomY = staffTopY + staffH;

    sctx.strokeStyle = "rgba(91,140,255,.9)";
    sctx.lineWidth = 3*dpr;
    sctx.beginPath();
    sctx.moveTo(xCaret, staffTopY - 10*dpr);
    sctx.lineTo(xCaret, staffBottomY + 10*dpr);
    sctx.stroke();
  }
}


// ---------- Animation loop ----------
function renderLoop(){
  drawSheet();
  if (showFalling.checked) drawFalling();
  if (score.events.length) updateTargetReadout();
  requestAnimationFrame(renderLoop);
}
requestAnimationFrame(renderLoop);

// ---------- Misc ----------
function updateTargetAtStop(){
  heardTxt.textContent = "—";
  clarityTxt.textContent = "—";
  deltaTxt.textContent = "—";
  levelTxt.textContent = "—";
  updateTargetReadout();
}

// ✅ Single stopAll() exists (no duplicates)
function stopAll(){
  audio.isPlaying = false;
  audio.pauseAt = 0;
  if (audio.schedTimer) clearInterval(audio.schedTimer);
  audio.schedTimer = null;
  resetPlayhead();
  status("Stopped");
  updateTargetAtStop();
}

// ---------- Init ----------
setHeaderFilename("");
// allow .mscz in file picker
try{ if (scoreFile && scoreFile.accept && !scoreFile.accept.includes('.mscz')) scoreFile.accept += ',.mscz'; }catch(e){}
 // shows helper text
status("Ready. Tap the folder to load a file.");
updateTargetReadout();
