/* app.js — ViolinAI v15 */


// --- Mic state (window-scoped to avoid module TDZ issues) ---
window.mic = window.mic || {
  stream: null, ctx: null, src: null, analyser: null, buf: null, raf: null,
  freq: 0, clarity: 0, rms: 0,
  latched: false, stableMs: 0, releaseMs: 0,
  lastFrameTs: 0, lastAdvanceAt: 0
};


// --- Music import helpers: MusicXML + MuseScore (.mscz/.mscx) ---
function stepOctAlterToMidi(step, octave, alter){
  const base = {C:0, D:2, E:4, F:5, G:7, A:9, B:11}[step] ?? 0;
  return (octave + 1) * 12 + base + (alter||0);
}

async function unzipFirstMSCXFromMSCZ(arrayBuffer){
  const u8 = new Uint8Array(arrayBuffer);
  const dv = new DataView(arrayBuffer);
  let off = 0;
  const entries = [];
  while (off + 30 < u8.length){
    const sig = dv.getUint32(off, true);
    if (sig !== 0x04034b50) break;
    const method = dv.getUint16(off+8, true);
    const compSize = dv.getUint32(off+18, true);
    const nameLen = dv.getUint16(off+26, true);
    const extraLen = dv.getUint16(off+28, true);
    const name = new TextDecoder().decode(u8.slice(off+30, off+30+nameLen));
    const dataStart = off + 30 + nameLen + extraLen;
    const dataEnd = dataStart + compSize;
    const comp = u8.slice(dataStart, dataEnd);
    entries.push({name, method, comp});
    off = dataEnd;
  }
  const target = entries.find(e => e.name.toLowerCase().endsWith(".mscx")) || entries.find(e => e.name.toLowerCase().endsWith(".xml")) || entries[0];
  if (!target) throw new Error("MSCZ: no files found");

  if (target.method === 0){
    return new TextDecoder().decode(target.comp);
  }
  if (target.method === 8){
    if (typeof DecompressionStream === "undefined"){
      throw new Error("MSCZ: DecompressionStream not supported (Safari iOS often lacks this).");
    }
    const ds = new DecompressionStream("deflate-raw");
    const stream = new Blob([target.comp]).stream().pipeThrough(ds);
    const out = await new Response(stream).arrayBuffer();
    return new TextDecoder().decode(new Uint8Array(out));
  }
  throw new Error("MSCZ: unsupported compression method " + target.method);
}

function parseMSCX(mscxText, melodyOnly=true){
  const dom = new DOMParser().parseFromString(mscxText, "text/xml");
  let bpm = 120;

  // tempo heuristic (MuseScore can store as qn/s)
  const tempoEl = dom.querySelector("Tempo tempo") || dom.querySelector("tempo");
  if (tempoEl){
    const v = parseFloat(tempoEl.textContent||"");
    if (isFinite(v)){
      bpm = (v > 10) ? v : v*60;
    }
  }

  let staffs = [...dom.querySelectorAll("Score > Staff")];
  if (!staffs.length) staffs = [...dom.querySelectorAll("Staff")];
  if (!staffs.length) return { bpm, timeSig:{num:4,den:4}, notes: [] };

  const avgPitch = (st) => {
    const ps = [...st.querySelectorAll("Chord Note > pitch")].map(p=>Number(p.textContent||'')).filter(n=>!Number.isNaN(n));
    if (!ps.length) return -1e9;
    return ps.reduce((a,b)=>a+b,0)/ps.length;
  };
  const staff = staffs.slice().sort((a,b)=>avgPitch(b)-avgPitch(a))[0];

  const divs = 480;
  let tick = 0;
  const notes = [];
  for (const chord of staff.querySelectorAll("Measure Chord")){
    const type = chord.querySelector("durationType")?.textContent || "quarter";
    const dots = parseInt(chord.querySelector("dots")?.textContent||"0",10)||0;
    const durMap = { "64th":divs/16, "32nd":divs/8, "16th":divs/4, "eighth":divs/2, "quarter":divs, "half":divs*2, "whole":divs*4 };
    let dur = durMap[type] || divs;
    if (dots===1) dur *= 1.5;
    if (dots===2) dur *= 1.75;
    const ps = [...chord.querySelectorAll("Note > pitch")].map(p=>parseInt(p.textContent||"0",10)).filter(n=>!Number.isNaN(n));
    if (!ps.length) continue;
    const midi = melodyOnly ? Math.max(...ps) : ps[0];
    notes.push({ midi, startTick: tick, durTick: dur });
    tick += dur;
  }
  return { bpm, timeSig:{num:4,den:4}, notes };
}

function parseMusicXML(xmlText, melodyOnly=true){
  const dom = new DOMParser().parseFromString(xmlText, "text/xml");
  let bpm = 120;
  const tempoAttr = dom.querySelector("sound[tempo]")?.getAttribute("tempo");
  if (tempoAttr){
    const t = parseFloat(tempoAttr);
    if (isFinite(t)) bpm = t;
  }

  let divisions = parseInt(dom.querySelector("divisions")?.textContent || "480", 10);
  if (!isFinite(divisions) || divisions<=0) divisions = 480;

  const beats = parseInt(dom.querySelector("time > beats")?.textContent || "4", 10) || 4;
  const beatType = parseInt(dom.querySelector("time > beat-type")?.textContent || "4", 10) || 4;
  const timeSig = {num: beats, den: beatType};

  let tick = 0;
  const notes = [];
  // For melodyOnly: ignore chord continuation notes (<chord/> marker)
  for (const meas of dom.querySelectorAll("part > measure")){
    for (const n of meas.querySelectorAll(":scope > note")){
      const isRest = !!n.querySelector("rest");
      const isChord = !!n.querySelector("chord");
      const dur = parseInt(n.querySelector("duration")?.textContent || "0", 10) || 0;

      if (melodyOnly && isChord){
        // Don't add, don't advance time
        continue;
      }

      if (!isRest){
        const step = n.querySelector("pitch > step")?.textContent;
        const oct = parseInt(n.querySelector("pitch > octave")?.textContent || "0", 10);
        const alter = parseInt(n.querySelector("pitch > alter")?.textContent || "0", 10) || 0;
        if (step && isFinite(oct)){
          const midi = stepOctAlterToMidi(step, oct, alter);
          notes.push({ midi, startTick: tick, durTick: dur || divisions });
        }
      }

      // Advance time only on non-chord notes
      tick += (dur || divisions);
    }
  }
  return { bpm, timeSig, notes };
}

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
  if (ext === "xml" || ext === "musicxml") {
    const text = new TextDecoder().decode(buf);
    parsed = parseMusicXML(text);
    score.source = "MusicXML";
  } else {
    parsed = parseMIDI(buf);
    score.source = "MIDI";
  }

  score.bpm = parsed.bpm || 120;
  score.timeSig = parsed.timeSig || { num: 4, den: 4 };
  score.events = buildScoreEvents(parsed.notes, score.bpm, score.timeSig);
  score.measures = buildMeasures(score.events, score.timeSig);
  score.fileName = file.name;

  playhead.idx = 0;
  playhead.t0 = 0;
  sheetRowStartMeasure = 0;

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

  // IMPORTANT:
  // MusicXML durations are in "divisions". We must accumulate time across measures.
  // Also, measures may contain multiple voices using <backup>/<forward>. We keep a single cursor and
  // track the maximum cursor reached in each measure to advance global time correctly.
  let globalDiv = 0;

  const measures = [...dom.querySelectorAll("measure")];
  for (const m of measures){
    let cursorDiv = 0;
    let maxCursorDiv = 0;

    const kids = [...m.children];
    for (const el of kids){
      if (el.tagName === "note"){
        const isRest = !!el.querySelector("rest");
        const isChord = !!el.querySelector("chord"); // chord notes share the same start time
        const durDiv = Number(el.querySelector("duration")?.textContent || "0") || 0;

        // If <chord/> exists, do not advance cursorDiv before placing this note.
        const noteStartDiv = globalDiv + cursorDiv;

        if (!isRest){
          const step = el.querySelector("pitch > step")?.textContent || "C";
          const octave = Number(el.querySelector("pitch > octave")?.textContent || "4");
          const alter = Number(el.querySelector("pitch > alter")?.textContent || "0") || 0;
          const midi = stepOctAlterToMidi(step, octave, alter);

          notes.push({
            midi,
            timeSec: (noteStartDiv / divisions) * (60 / bpm),
            durSec: (durDiv / divisions) * (60 / bpm)
          });
        }

        // Advance cursor unless this is a chord continuation
        if (!isChord) cursorDiv += durDiv;
        maxCursorDiv = Math.max(maxCursorDiv, cursorDiv);
      }

      if (el.tagName === "backup"){
        const durDiv = Number(el.querySelector("duration")?.textContent || "0") || 0;
        cursorDiv -= durDiv;
        if (cursorDiv < 0) cursorDiv = 0;
      }

      if (el.tagName === "forward"){
        const durDiv = Number(el.querySelector("duration")?.textContent || "0") || 0;
        cursorDiv += durDiv;
        maxCursorDiv = Math.max(maxCursorDiv, cursorDiv);
      }
    }

    // Move global time forward by the furthest any voice reached in this measure.
    globalDiv += maxCursorDiv;
  }

  notes.sort((a,b) => a.timeSec - b.timeSec);
  return { bpm, timeSig, notes };
}

function stepOctAlterToMidi(step, octave, alter){
  const base = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 }[step.toUpperCase()] ?? 0;
  return (octave + 1) * 12 + base + alter;
}

// ---------- Build practice score (quantize + rests + measure structure) ----------
function beatsPerMeasure(ts){
  return ts.num * (4 / ts.den);
}
function quantStepBeats(){ return 0.25; } // 16th note
function secToBeats(sec, bpm){ return sec * (bpm / 60); }

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


async function loadFromGenericNotes(rawNotes, bpm, sourceLabel){
  // rawNotes: [{midi,startTick,durTick}] ticks are in "divisions" space; we'll normalize to beats later.
  // Map to internal events format used by the app: {midi, t, dur}
  const divs = 480;
  const events = rawNotes
    .filter(n => n && Number.isFinite(n.midi))
    .map(n => ({
      midi: n.midi,
      t: (n.startTick || 0) / divs,     // quarter-note beats
      dur: Math.max(0.05, (n.durTick || divs) / divs)
    }))
    .sort((a,b)=>a.t-b.t);

  // Try to set whichever global the app uses for song state.
  if (typeof score !== "undefined"){
    score.events = events;
    score.bpm = bpm || score.bpm || 120;
    score.source = sourceLabel || "Imported";
    if (typeof buildMeasures === "function") score.measures = buildMeasures(score.events);
    window.score = score;
  }else{
    // fallback window.score object
    window.score = window.score || {};
    window.score.events = events;
    window.score.bpm = bpm || 120;
    window.score.source = sourceLabel || "Imported";
    if (typeof buildMeasures === "function") window.score.measures = buildMeasures(events);
  }

  if (typeof setPlayheadToStart === "function") setPlayheadToStart();
  if (typeof status === "function") status(`Loaded ${events.length} notes • ${sourceLabel} • ${Math.round(bpm||120)} bpm`);
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

// Sheet paging: start measure index for the top row (advances in 2-measure rows)
let sheetRowStartMeasure = 0;

function resetPlayhead(){
  playhead.idx = 0;
  playhead.t0 = 0;
  sheetRowStartMeasure = 0;
  playhead.startedAt = 0;
}

function status(t){ statusEl.textContent = t; }

// --- Theme-aware drawing colors (so notes are readable in light theme) ---
function isLightTheme(){
  return (document.documentElement.dataset.theme || "").toLowerCase() === "light";
}
function staffInk(){
  // Prefer CSS variables if present, else fall back.
  const cs = getComputedStyle(document.documentElement);
  const v = cs.getPropertyValue("--staffInk").trim();
  if (v) return v;
  return isLightTheme() ? "rgba(16,18,28,.82)" : "rgba(255,255,255,.20)";
}
function noteInk(){
  const cs = getComputedStyle(document.documentElement);
  const v = cs.getPropertyValue("--noteInk").trim();
  if (v) return v;
  return isLightTheme() ? "rgba(16,18,28,.92)" : "rgba(255,255,255,.92)";
}
function noteFillInk(){
  const cs = getComputedStyle(document.documentElement);
  const v = cs.getPropertyValue("--noteFill").trim();
  if (v) return v;
  return isLightTheme() ? "rgba(16,18,28,.92)" : "rgba(255,255,255,.92)";
}
function noteHollowFill(){
  return isLightTheme() ? "rgba(16,18,28,.06)" : "rgba(255,255,255,.06)";
}

function startPreview(){
  if (!score.events.length){ status("Load a MIDI or MusicXML file first."); return; }
  if (mode !== "preview"){ setMode("preview"); }

  const ctx = ensureAudio();
  ctx.resume?.();

  // Reset playhead/scheduler pointer
  if (audio.pauseAt <= 0) {
    playhead.idx = 0;
  } else {
    // seek to beat at pause
    const beatAtPause = secToBeats(Math.max(0, audio.pauseAt), score.bpm * tempoMul);
    playhead.idx = seekIdxByBeat(beatAtPause);
  }

  audio.isPlaying = true;

  const now = ctx.currentTime;
  const countInBeats = (Number(countInEl.value||0) || 0) * (4 / score.timeSig.den);
  const countInSec = scoreBeatToSec(countInBeats);

  // Small scheduling lead helps iOS and prevents "first note missed".
  const lead = 0.06;

  if (audio.pauseAt > 0){
    playhead.startedAt = (now + lead) - audio.pauseAt;
  }else{
    playhead.startedAt = now + lead + countInSec;
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

let metroState = { lastScheduledBeat: null };

function playClick(when, strong=false){
  const ctx = ensureAudio();
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = "square";
  osc.frequency.setValueAtTime(strong ? 1200 : 900, when);
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(strong ? 0.6 : 0.35, when + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.03);
  osc.connect(g);
  g.connect(audio.master);
  osc.start(when);
  osc.stop(when + 0.04);
}

function seekIdxByBeat(beat){
  // Find first event whose startBeat >= beat, but don't skip events at 0 due to tiny time drift.
  for (let i=0;i<score.events.length;i++){
    if (score.events[i].startBeat >= (beat - 0.02)) return i;
  }
  return score.events.length;
}

function schedulerTick(){
  if (!audio.isPlaying) return;
  const ctx = ensureAudio();

  const lookahead = 0.16;
  const now = ctx.currentTime;

  const tSec = now - playhead.startedAt;
  const tBeat = secToBeats(Math.max(0, tSec), score.bpm * tempoMul);

  // Metronome (preview mode only)
  if (metroOnEl?.checked){
    const beatsPerBar = score.timeSig.num;
    const beatNow = tBeat;
    const startBeat = Math.floor(beatNow);
    const endBeat = Math.floor(beatNow + secToBeats(lookahead, score.bpm * tempoMul)) + 1;

    if (metroState.lastScheduledBeat == null) metroState.lastScheduledBeat = startBeat - 1;

    for (let b = metroState.lastScheduledBeat + 1; b <= endBeat; b++){
      const when = playhead.startedAt + scoreBeatToSec(b);
      if (when >= now - 0.01 && when <= now + lookahead + 0.02){
        const isStrong = (b % beatsPerBar) === 0;
        playClick(when, isStrong);
        metroState.lastScheduledBeat = b;
      }
    }
  } else {
    metroState.lastScheduledBeat = null;
  }

  // Schedule notes
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

// ---------- Learn Mode (Mic pitch detection + latch) ----------

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

    window.mic.stream = stream;

    const A = window.AudioContext || window.webkitAudioContext;
    window.mic.ctx = new A();
    await window.mic.ctx.resume?.();

    window.mic.src = window.mic.ctx.createMediaStreamSource(stream);
    window.mic.analyser = window.mic.ctx.createAnalyser();
    window.mic.analyser.fftSize = 2048;

    window.mic.src.connect(window.mic.analyser);

    window.mic.buf = new Float32Array(window.mic.analyser.fftSize);

    window.mic.latched = false;
    window.mic.stableMs = 0;
    window.mic.releaseMs = 0;
    window.mic.lastFrameTs = performance.now();
    window.mic.lastAdvanceAt = 0;

    micStatusTxt.textContent = "Mic running";
    status("Mic started (Learn)");
    updateTargetReadout();

    if (window.mic.raf) cancelAnimationFrame(window.mic.raf);
    window.mic.raf = requestAnimationFrame(micLoop);
  }catch(e){
    console.warn(e);
    micStatusTxt.textContent = "Microphone permission denied or unavailable";
    status("Mic unavailable");
  }
}

function stopMic(){
  const mic = window.mic;
  if (!mic) return;

  if (window.mic.raf) cancelAnimationFrame(window.mic.raf);
  window.mic.raf = null;

  if (window.mic.stream){
    window.mic.stream.getTracks().forEach(t => t.stop());
    window.mic.stream = null;
  }
  if (window.mic.ctx){
    window.mic.ctx.close?.();
    window.mic.ctx = null;
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

  if (window.mic.freq <= 0){
    window.mic.stableMs = 0;
    window.mic.releaseMs += (nowMs - window.mic.lastFrameTs);
    return;
  }

  const actualMidi = freqToMidi(window.mic.freq);
  const delta = centsOff(actualMidi, t.ev.midi);
  const abs = Math.abs(delta);

  heardTxt.textContent = `${midiToName(actualMidi)} (~${Math.round(actualMidi*10)/10})`;
  clarityTxt.textContent = window.mic.clarity.toFixed(2);
  deltaTxt.textContent = `${(delta>=0?"+":"")}${Math.round(delta)} cents`;
  levelTxt.textContent = window.mic.rms.toFixed(3);

  const match = (abs <= tol) && (window.mic.clarity >= 0.55) && (window.mic.rms >= 0.012);

  const releaseCond = (!match) || (window.mic.clarity < 0.35) || (window.mic.rms < 0.009);
  if (releaseCond){
    window.mic.releaseMs += (nowMs - window.mic.lastFrameTs);
  } else {
    window.mic.releaseMs = 0;
  }

  if (window.mic.latched && window.mic.releaseMs >= 140){
    window.mic.latched = false;
    window.mic.stableMs = 0;
  }

  if (window.mic.latched) return;

  if (match){
    window.mic.stableMs += (nowMs - window.mic.lastFrameTs);
  } else {
    window.mic.stableMs = 0;
  }

  const minGateMs = Math.max(120, scoreBeatToSec(t.ev.durBeat) * 1000 * 0.35);
  const stableOk = !requireStable || (window.mic.stableMs >= 120);
  const gateOk = (nowMs - window.mic.lastAdvanceAt) >= minGateMs;

  if (match && stableOk && gateOk){
    playhead.idx = t.idx + 1;      // advance ONE note only
    window.mic.latched = true;
    window.mic.lastAdvanceAt = nowMs;
    window.mic.stableMs = 0;
    window.mic.releaseMs = 0;
    updateTargetReadout();
  }
}

function micLoop(ts){
  if (!window.mic.analyser) return;

  window.mic.lastFrameTs = ts;

  window.mic.analyser.getFloatTimeDomainData(window.mic.buf);
  const det = detectPitchACF(window.mic.buf, window.mic.ctx.sampleRate);
  window.mic.freq = det.freq;
  window.mic.clarity = det.clarity;
  window.mic.rms = det.rms;

  if (mode === "learn"){
    micBtn.style.display = "";
    micStatusTxt.textContent = "Mic running";
    learnTryAdvance(ts);
  }

  window.mic.raf = requestAnimationFrame(micLoop);
}

// ---------- Rendering ----------
// Theme-aware ink colors for canvas drawing
function themeIsLight(){
  return (document.documentElement.dataset.theme || "").toLowerCase() === "light";
}
function ink(){
  // Prefer CSS variable if present
  const v = getComputedStyle(document.documentElement).getPropertyValue("--ink").trim();
  if (v) return v;
  return themeIsLight() ? "rgba(10,16,28,.92)" : "rgba(255,255,255,.92)";
}
function inkSubtle(alphaDark=0.22, alphaLight=0.18){
  const base = themeIsLight() ? `rgba(10,16,28,${alphaLight})` : `rgba(255,255,255,${alphaDark})`;
  return base;
}
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
  resizeCanvasToDisplaySize(canvas, 360);
  const W = canvas.width, H = canvas.height;

  ctx.clearRect(0,0,W,H);

  const pad = 18 * (window.devicePixelRatio||1);
  const laneW = (W - pad*2) / 4;

  for (let i=0;i<4;i++){
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--lane").trim() || "#121843";
    ctx.fillRect(pad + i*laneW, 0, laneW-2, H);
  }

  // Lane labels (string names)
  ctx.fillStyle = "rgba(255,255,255,.75)";
  ctx.font = `${Math.round(16*(window.devicePixelRatio||1))}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
  ctx.textBaseline = "top";
  for (let i=0;i<4;i++){
    const x = pad + i*laneW + 10;
    ctx.fillText(lanes[i].name, x, 10*(window.devicePixelRatio||1));
  }

  const hitY = H * 0.78;
  ctx.strokeStyle = "rgba(255,255,255,.22)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(pad, hitY);
  ctx.lineTo(W-pad, hitY);
  ctx.stroke();

  const bNow = (mode === "preview" && audio.isPlaying) ? nowPlayBeat() : 0;

  const noteEvents = score.events.filter(e => e.kind==="note");

  let idx0 = 0;
  while (idx0 < noteEvents.length && noteEvents[idx0].startBeat < bNow) idx0++;
  const showCount = 3;
  const windowNotes = noteEvents.slice(Math.max(0, idx0-1), Math.max(0, idx0-1) + showCount + 1);

  for (const ev of windowNotes){
    const lane = laneForMidi(ev.midi);
    const laneIdx = lanes.findIndex(x=>x.name===lane.name);
    const x = pad + laneIdx*laneW + 8;
    const w = laneW - 16;

    const dyBeats = ev.startBeat - bNow;

// Falling time scale: pixels-per-beat. This controls both fall speed and sustain height,
// so longer notes literally appear "longer" relative to the play-now bar.
const pxPerBeat = (H * 0.22);

// Where the note *ends* (i.e., its "start moment") hits the play line.
const yBottom = hitY - dyBeats * pxPerBeat;

// Sustain height is proportional to duration in beats (with a minimum so 1/16 isn't tiny on phones).
const minH = 56; // baseline readable size for a 1/16 note
const maxH = H * 0.55; // avoid absurdly tall whole notes on small screens
let rectH = ev.durBeat * pxPerBeat;
rectH = Math.max(minH, Math.min(maxH, rectH));

// Draw as a sustain bar that ends at yBottom.
const yTop = yBottom - rectH;
const yMid = (yTop + yBottom) / 2;

    let fill = "rgba(200,200,200,.28)";
    if (Math.abs(dyBeats) < 0.12) fill = "rgba(91,140,255,.80)";
    if (dyBeats < -0.25) fill = "rgba(255,176,32,.55)";

    ctx.fillStyle = fill;
    roundRect(ctx, x, yTop, w, rectH, 14);
    ctx.fill();

    ctx.fillStyle = isLightTheme() ? "rgba(16,18,28,.92)" : "rgba(255,255,255,.95)";
    ctx.font = `${Math.round(14*(window.devicePixelRatio||1))}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
    const name = midiToName(ev.midi);
    const fing = violinFingerForMidi(ev.midi);

    const ty = Math.min(yBottom - 8, yTop + 18);
    // Note name left, finger hint right for readability on phones
    ctx.textAlign = "left";
    ctx.fillText(name, x + 12, ty);
    ctx.globalAlpha = 0.92;
    ctx.textAlign = "right";
    ctx.fillText(`${fing.string} ${fing.finger}`, x + w - 12, ty);
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";
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
  // y should be around the middle staff line for best alignment.
  const dpr = (window.devicePixelRatio||1);
  sctx.save();
  sctx.fillStyle = ink();
  sctx.font = `${Math.round(44*dpr)}px serif`;
  sctx.textBaseline = "middle";
  sctx.fillText("𝄞", x, y);
  sctx.restore();
}


function drawSheet(){
  resizeCanvasToDisplaySize(sheetCanvas, 320);
  const W = sheetCanvas.width, H = sheetCanvas.height;
  sctx.clearRect(0,0,W,H);

  const show = showSheet.checked;
  if (!show){
    sctx.fillStyle = "rgba(255,255,255,.6)";
    sctx.fillText("Sheet hidden", 20, 30);
    return;
  }

  const dpr = (window.devicePixelRatio||1);
  const padX = 18 * dpr;
  const padY = 16 * dpr;

  // Staff sizing (fill vertical space better; 3 systems)
  const systems = 3;
  const systemGap = 22 * dpr;
  const staffLineGap = 12.5 * dpr;      // distance between staff lines
  const staffHeight = 4 * staffLineGap; // 5 lines -> 4 gaps
  const systemHeight = staffHeight + 30 * dpr; // include some headroom for stems/ledger/labels

  const totalH = systems*systemHeight + (systems-1)*systemGap;
  const top = padY + Math.max(0, (H - totalH) * 0.10); // small centering bias
  const clefW = 52 * dpr;

  // Beats/measure window: 3 rows, 2 measures each (total 6 measures)
  if (!score.measures.length){
    const staffTopY = top + 18*dpr;
    const staffBottomY = staffTopY + staffHeight;
    sctx.strokeStyle = inkSubtle(0.20, 0.20);
    sctx.lineWidth = 2;
    for (let si=0; si<systems; si++){
      const y0 = staffTopY + si*(systemHeight+systemGap);
      for (let i=0;i<5;i++){
        const y = y0 + i*staffLineGap;
        sctx.beginPath();
        sctx.moveTo(padX, y);
        sctx.lineTo(W-padX, y);
        sctx.stroke();
      }
      drawTrebleClef(padX + 2, y0 + staffHeight/2);
    }
    sctx.fillStyle = themeIsLight() ? "rgba(10,16,28,.72)" : "rgba(255,255,255,.72)";
    sctx.font = `${Math.round(14*dpr)}px system-ui`;
    sctx.fillText("Load a MIDI or MusicXML file to see notes.", padX + clefW, staffTopY + 2*staffLineGap);
    return;
  }

  const bNow = (mode==="preview" && audio.isPlaying) ? nowPlayBeat() : 0;
  const mLen = beatsPerMeasure(score.timeSig);
  const curMeasureIdx = Math.max(0, Math.min(score.measures.length-1, Math.floor(bNow / mLen)));

  // Row-based paging: 2 measures per row. Only advance the window when the *row* completes.
  // When not playing, snap the window to the row containing the current measure.
  if (!(mode==="preview" && audio.isPlaying)) {
    sheetRowStartMeasure = Math.floor(curMeasureIdx / 2) * 2;
  } else {
    // If we've moved beyond the current row, advance in 2-measure steps.
    const rowEnd = sheetRowStartMeasure + 2;
    if (curMeasureIdx >= rowEnd) {
      const deltaRows = Math.floor((curMeasureIdx - sheetRowStartMeasure) / 2);
      sheetRowStartMeasure = sheetRowStartMeasure + deltaRows * 2;
    }
    // If we jumped backwards (seek/stop-start), clamp back.
    if (curMeasureIdx < sheetRowStartMeasure) {
      sheetRowStartMeasure = Math.floor(curMeasureIdx / 2) * 2;
    }
  }
  sheetRowStartMeasure = Math.max(0, Math.min(score.measures.length-1, sheetRowStartMeasure));

  // Build 6-measure window starting at the row boundary (3 systems × 2 measures)
  const windowMeasures = [];
  for (let k=0;k<6;k++){
    windowMeasures.push(score.measures[Math.min(score.measures.length-1, sheetRowStartMeasure + k)]);
  }

  // Geometry per system
  const usableW = (W - padX*2 - clefW);
  const measureW = usableW / 2;
  const x0 = padX + clefW;

  // Draw each system
  for (let sys=0; sys<systems; sys++){
    const rowMeasures = windowMeasures.slice(sys*2, sys*2+2);

    const staffTopY = top + 18*dpr + sys*(systemHeight + systemGap);
    const staffBottomY = staffTopY + staffHeight;

    // staff lines
    sctx.strokeStyle = inkSubtle(0.20, 0.20);
    sctx.lineWidth = 2;
    for (let i=0;i<5;i++){
      const y = staffTopY + i*staffLineGap;
      sctx.beginPath();
      sctx.moveTo(padX, y);
      sctx.lineTo(W-padX, y);
      sctx.stroke();
    }

    // treble clef (aligned to middle of staff)
    drawTrebleClef(padX + 2, staffTopY + staffHeight/2);

    // barlines (2 measures per system)
    sctx.strokeStyle = inkSubtle(0.25, 0.22);
    sctx.lineWidth = 2;
    for (let i=0;i<3;i++){
      const x = x0 + i*measureW;
      sctx.beginPath();
      sctx.moveTo(x, staffTopY);
      sctx.lineTo(x, staffBottomY);
      sctx.stroke();
    }

    // Draw notes/rests in the two measures
    for (let mi=0; mi<2; mi++){
      const m = rowMeasures[mi];
      const baseX = x0 + mi*measureW;
      const beatSpan = mLen;

      const xForBeat = (beat) => baseX + ((beat - m.startBeat) / beatSpan) * (measureW - 14*dpr) + 8*dpr;
      const evs = (m.events||[]).slice().sort((a,b)=>a.startBeat-b.startBeat);

      for (const ev of evs){
        const x = xForBeat(ev.startBeat);

        if (ev.kind === "rest"){
          sctx.fillStyle = themeIsLight() ? "rgba(10,16,28,.75)" : "rgba(255,255,255,.75)";
          sctx.font = `${Math.round(18*dpr)}px serif`;
          const k = durKind(ev.durBeat);
          const glyph = (k==="whole")?"𝄻":(k==="half")?"𝄼":(k==="quarter")?"𝄽":(k==="eighth")?"𝄾":"𝄿";
          sctx.textBaseline = "middle";
          sctx.fillText(glyph, x, staffTopY + staffHeight*0.55);
          continue;
        }

        const y = staffYForMidi(ev.midi, staffBottomY, staffLineGap);

        const kind = durKind(ev.durBeat);
        const filled = !(kind==="whole" || kind==="half");
        const headW = 14*dpr;
        const headH = 10*dpr;

        // notehead
        sctx.save();
        sctx.translate(x, y);
        sctx.rotate(-0.35);
        sctx.strokeStyle = ink();
        sctx.lineWidth = 2;
        sctx.fillStyle = filled ? ink() : (themeIsLight() ? "rgba(10,16,28,.08)" : "rgba(255,255,255,.06)");
        sctx.beginPath();
        sctx.ellipse(0, 0, headW/2, headH/2, 0, 0, Math.PI*2);
        sctx.fill();
        sctx.stroke();
        sctx.restore();

        // accidental
        const st = midiToStepOct(ev.midi);
        if (st.accidental){
          sctx.fillStyle = themeIsLight() ? "rgba(10,16,28,.86)" : "rgba(255,255,255,.86)";
          sctx.font = `${Math.round(16*dpr)}px system-ui`;
          sctx.textBaseline = "alphabetic";
          sctx.fillText(st.accidental, x - 18*dpr, y + 6*dpr);
        }

        // stem + flags
        if (kind !== "whole"){
          const stemUp = (y > staffTopY + 2*staffLineGap);
          sctx.strokeStyle = ink();
          sctx.lineWidth = 2;

          const stemX = x + (stemUp ? (headW/2) : -(headW/2));
          const stemLen = 38*dpr;
          const y1 = y;
          const y2 = stemUp ? (y - stemLen) : (y + stemLen);

          sctx.beginPath();
          sctx.moveTo(stemX, y1);
          sctx.lineTo(stemX, y2);
          sctx.stroke();

          if (kind === "eighth" || kind === "sixteenth"){
            const dir = stemUp ? -1 : 1;
            const fx = stemX;
            const fy = y2;

            sctx.beginPath();
            sctx.moveTo(fx, fy);
            sctx.quadraticCurveTo(fx + 10*dpr, fy + 6*dir, fx + 6*dpr, fy + 14*dir);
            sctx.stroke();

            if (kind === "sixteenth"){
              const fy2 = fy + 10*dir;
              sctx.beginPath();
              sctx.moveTo(fx, fy2);
              sctx.quadraticCurveTo(fx + 10*dpr, fy2 + 6*dir, fx + 6*dpr, fy2 + 14*dir);
              sctx.stroke();
            }
          }
        }

        // ledger lines (keep)
        const yMin = staffTopY;
        const yMax = staffBottomY;
        sctx.strokeStyle = inkSubtle(0.20, 0.20);
        sctx.lineWidth = 2;
        if (y < yMin){
          for (let ly = yMin - staffLineGap; ly >= y; ly -= staffLineGap){
            sctx.beginPath();
            sctx.moveTo(x - 10*dpr, ly);
            sctx.lineTo(x + 10*dpr, ly);
            sctx.stroke();
          }
        } else if (y > yMax){
          for (let ly = yMax + staffLineGap; ly <= y; ly += staffLineGap){
            sctx.beginPath();
            sctx.moveTo(x - 10*dpr, ly);
            sctx.lineTo(x + 10*dpr, ly);
            sctx.stroke();
          }
        }
      }
    }

    // Caret only on first system, moving across the full row (2 measures)
    if (sys === 0 && mode==="preview" && audio.isPlaying){
      const rowStartBeat = sheetRowStartMeasure * mLen;
      const rowBeats = 2 * mLen;
      const t = Math.max(0, Math.min(1, (bNow - rowStartBeat) / rowBeats));
      const caretX = x0 + t * (2 * measureW);
      sctx.strokeStyle = "rgba(91,140,255,.9)";
      sctx.lineWidth = 3;
      sctx.beginPath();
      sctx.moveTo(caretX, staffTopY - 10*dpr);
      sctx.lineTo(caretX, staffBottomY + 10*dpr);
      sctx.stroke();
    }
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
  sheetRowStartMeasure = 0;
  status("Stopped");
  updateTargetAtStop();
}

// ---------- Init ----------
setHeaderFilename(""); // shows helper text
status("Ready. Tap the folder to load a file.");
updateTargetReadout();
