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

// ---------- Core state ----------
let mode = "preview"; // preview | learn
let tempoMul = 1.0;
const tempoSteps = [0.25,0.33,0.5,0.67,0.75,1.0,1.25,1.5,2.0];
function setTempoMul(x){
  tempoMul = x;
  tempoVal.textContent = `${tempoMul.toFixed(2)}×`;
  persistLoop(); // not required, but consistent
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
  score.events = buildScoreEvents(parsed.notes, score.bpm, score.timeSig); // quantized + rests
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

// ---------- MIDI parsing ----------
function parseMIDI(arrayBuffer){
  const midi = new Midi(arrayBuffer);
  const tempos = midi.header.tempos || [];
  const bpm = tempos.length ? tempos[0].bpm : 120;

  const ts = midi.header.timeSignatures?.[0];
  const timeSig = ts ? { num: ts.timeSignature[0], den: ts.timeSignature[1] } : { num:4, den:4 };

  // Collect notes from all tracks
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
  if (parserErr) {
    console.warn("XML parse error:", parserErr.textContent);
  }

  // Tempo: best-effort
  let bpm = 120;
  const soundTempo = dom.querySelector('sound[tempo]');
  if (soundTempo) bpm = Number(soundTempo.getAttribute("tempo")) || bpm;

  // Time signature: best-effort
  let timeSig = { num: 4, den: 4 };
  const ts = dom.querySelector("time");
  if (ts){
    const beats = Number(ts.querySelector("beats")?.textContent || "4");
    const beatType = Number(ts.querySelector("beat-type")?.textContent || "4");
    if (beats && beatType) timeSig = { num: beats, den: beatType };
  }

  // Divisions
  const divEl = dom.querySelector("divisions");
  const divisions = Number(divEl?.textContent || "1") || 1;

  // Extract notes measure-order
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
            timeSec: (voiceTimeDiv / divisions) * (60 / bpm), // using 1 quarter-note == divisions
            durSec: (durDiv / divisions) * (60 / bpm)
          });
        }
        cursorDiv += durDiv;
      }
      // ignore backup/forward for now (simple parts)
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

function stepOctAlterToMidi(step, octave, alter){
  const base = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 }[step.toUpperCase()] ?? 0;
  return (octave + 1) * 12 + base + alter;
}

// ---------- Build practice score (quantize + rests + measure structure) ----------
function beatsPerMeasure(ts){
  return ts.num * (4 / ts.den);
}
function quantStepBeats(){ return 0.25; } // 16th note in beats
function secToBeats(sec, bpm){ return sec * (bpm / 60); }

function buildScoreEvents(notes, bpm, ts){
  const q = quantStepBeats();
  const bpmEff = bpm;

  // Quantize notes to 16th grid
  const qNotes = notes.map(n => {
    const b = secToBeats(n.timeSec, bpmEff);
    const d = Math.max(q, secToBeats(n.durSec, bpmEff));
    const qb = Math.max(0, Math.round(b / q) * q);
    let qd = Math.round(d / q) * q;
    if (qd < q) qd = q;
    return { kind:"note", midi:n.midi, startBeat: qb, durBeat: qd };
  }).sort((a,b)=>a.startBeat-b.startBeat);

  // Remove overlaps: ensure non-decreasing start times; clamp durations if needed
  for (let i=0;i<qNotes.length-1;i++){
    const a = qNotes[i];
    const b = qNotes[i+1];
    const endA = a.startBeat + a.durBeat;
    if (endA > b.startBeat){
      a.durBeat = Math.max(q, b.startBeat - a.startBeat);
    }
  }

  // Build with rests
  const events = [];
  let cursor = 0;
  for (const n of qNotes){
    if (n.startBeat > cursor){
      events.push({ kind:"rest", startBeat: cursor, durBeat: n.startBeat - cursor });
    }
    events.push(n);
    cursor = Math.max(cursor, n.startBeat + n.durBeat);
  }

  // Snap total length to end-of-measure
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
  // tempoMul slows down/speeds up playback: effective bpm = score.bpm * tempoMul
  const bpmEff = score.bpm * tempoMul;
  return (60 / bpmEff) * beat;
}

const playhead = {
  idx: 0,      // index into score.events (notes+rests)
  t0: 0,       // beat position at play start
  startedAt: 0 // audioCtx time at play start
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

  // Count-in: delay playback start, but keep visuals aligned
  const countInBeats = (Number(countInEl.value||0) || 0) * (4 / score.timeSig.den);
  const countInSec = scoreBeatToSec(countInBeats);

  // If resuming, adjust startedAt
  if (audio.pauseAt > 0){
    playhead.startedAt = now - audio.pauseAt;
  }else{
    playhead.startedAt = now + countInSec;
  }

  // Start scheduling
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

function stopAll(){
  audio.isPlaying = false;
  audio.pauseAt = 0;
  if (audio.schedTimer) clearInterval(audio.schedTimer);
  audio.schedTimer = null;
  resetPlayhead();
  status("Stopped");
}

function schedulerTick(){
  if (!audio.isPlaying) return;
  const ctx = ensureAudio();

  const lookahead = 0.12; // seconds
  const now = ctx.currentTime;

  // current play position in beats, based on audio clock
  const tSec = now - playhead.startedAt;
  const tBeat = secToBeats(Math.max(0, tSec), score.bpm * tempoMul);

  // Advance idx based on beats
  while (playhead.idx < score.events.length){
    const ev = score.events[playhead.idx];
    const evStart = ev.startBeat;
    if (evStart >= tBeat) break;
    // if we've passed this event, advance idx
    playhead.idx++;
  }

  // Schedule notes in window
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

  // End-of-song
  if (playhead.idx >= score.events.length){
    // allow tail
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
let mic = {
  stream: null,
  ctx: null,
  src: null,
  analyser: null,
  buf: null,
  raf: null,

  // detection
  freq: 0,
  clarity: 0,
  rms: 0,

  // latch behavior
  latched: false,
  stableMs: 0,
  releaseMs: 0,
  lastFrameTs: 0,
  lastAdvanceAt: 0
};

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
  micStatusTxt.textContent = "Mic stopped";
}

// Autocorrelation pitch detection (simple + robust enough for violin/whistle)
function detectPitchACF(buf, sampleRate){
  // Compute RMS
  let sum = 0;
  for (let i=0;i<buf.length;i++){
    const v = buf[i];
    sum += v*v;
  }
  const rms = Math.sqrt(sum / buf.length);

  // If too quiet, bail
  if (rms < 0.01) return { freq: 0, clarity: 0, rms };

  // Remove DC
  let mean = 0;
  for (let i=0;i<buf.length;i++) mean += buf[i];
  mean /= buf.length;
  for (let i=0;i<buf.length;i++) buf[i] -= mean;

  const SIZE = buf.length;
  const MAX_LAG = Math.floor(sampleRate / 50);   // ~50 Hz
  const MIN_LAG = Math.floor(sampleRate / 1200); // ~1200 Hz

  let bestLag = -1;
  let bestCorr = 0;

  // normalized autocorrelation
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

  // clarity heuristic
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
  // midiA actual, midiB target
  return (midiA - midiB) * 100;
}

function getCurrentTargetNote(){
  // Find next NOTE event at/after playhead.idx in learn mode
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

// Simple violin string/finger hint for first position
function violinFingerForMidi(midi){
  // Strings: G3=55, D4=62, A4=69, E5=76
  const strings = [
    { name:"G", open:55 },
    { name:"D", open:62 },
    { name:"A", open:69 },
    { name:"E", open:76 },
  ];

  // pick highest string that can play note within ~7 semitones (1st position)
  let best = strings[0];
  for (const s of strings){
    if (midi >= s.open && midi <= s.open + 7) best = s;
  }
  const semis = Math.max(0, midi - best.open);
  // crude mapping:
  // 0 open, 1 low1, 2 1, 3 low2, 4 2, 5 low3, 6 3, 7 4
  // We'll just show 0-4 with approximate:
  let finger = 0;
  if (semis === 0) finger = 0;
  else if (semis <= 2) finger = 1;
  else if (semis <= 4) finger = 2;
  else if (semis <= 6) finger = 3;
  else finger = 4;

  return { string: best.name, finger };
}

// Learn-mode advance with latch (fixes A4 A4 A4 fast-forward)
function learnTryAdvance(nowMs){
  const t = getCurrentTargetNote();
  if (!t) return;

  const tol = Number(tolCentsEl.value||45) || 45;
  const requireStable = waitModeEl.checked;

  // Conditions for "match"
  if (mic.freq <= 0){
    mic.stableMs = 0;
    mic.releaseMs += (nowMs - mic.lastFrameTs);
    return;
  }

  const actualMidi = freqToMidi(mic.freq);
  const delta = centsOff(actualMidi, t.ev.midi);
  const abs = Math.abs(delta);

  // UI readout
  heardTxt.textContent = `${midiToName(actualMidi)} (~${Math.round(actualMidi*10)/10})`;
  clarityTxt.textContent = mic.clarity.toFixed(2);
  deltaTxt.textContent = `${(delta>=0?"+":"")}${Math.round(delta)} cents`;
  levelTxt.textContent = mic.rms.toFixed(3);

  const match = (abs <= tol) && (mic.clarity >= 0.55) && (mic.rms >= 0.012);

  // Release logic
  const releaseCond = (!match) || (mic.clarity < 0.35) || (mic.rms < 0.009);
  if (releaseCond){
    mic.releaseMs += (nowMs - mic.lastFrameTs);
  } else {
    mic.releaseMs = 0;
  }

  // unlatch if release sustained
  if (mic.latched && mic.releaseMs >= 140){
    mic.latched = false;
    mic.stableMs = 0;
  }

  if (mic.latched) return;

  // stable logic (optional)
  if (match){
    mic.stableMs += (nowMs - mic.lastFrameTs);
  } else {
    mic.stableMs = 0;
  }

  // time gate based on duration (A+C behavior)
  const minGateMs = Math.max(120, scoreBeatToSec(t.ev.durBeat) * 1000 * 0.35);

  const stableOk = !requireStable || (mic.stableMs >= 120);
  const gateOk = (nowMs - mic.lastAdvanceAt) >= minGateMs;

  if (match && stableOk && gateOk){
    // Advance exactly ONE note (even if same pitch repeats)
    playhead.idx = t.idx + 1;
    mic.latched = true;
    mic.lastAdvanceAt = nowMs;
    mic.stableMs = 0;
    mic.releaseMs = 0;
    updateTargetReadout();
  }
}

function micLoop(ts){
  if (!mic.analyser) return;

  const dt = ts - mic.lastFrameTs;
  mic.lastFrameTs = ts;

  mic.analyser.getFloatTimeDomainData(mic.buf);
  const det = detectPitchACF(mic.buf, mic.ctx.sampleRate);
  mic.freq = det.freq;
  mic.clarity = det.clarity;
  mic.rms = det.rms;

  if (mode === "learn"){
    micBtn.style.display = ""; // visible
    micStatusTxt.textContent = "Mic running";
    learnTryAdvance(ts);
  }

  mic.raf = requestAnimationFrame(micLoop);
}

// ---------- Rendering (Falling + Sheet) ----------
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

// Falling notes display settings
const lanes = [
  { name:"G", open:55 },
  { name:"D", open:62 },
  { name:"A", open:69 },
  { name:"E", open:76 }
];
function laneForMidi(m){
  // choose lane with open <= m (prefer highest string)
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

  // lanes
  const pad = 18 * (window.devicePixelRatio||1);
  const laneW = (W - pad*2) / 4;

  // background lanes
  ctx.globalAlpha = 1;
  for (let i=0;i<4;i++){
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--lane").trim() || "#121843";
    ctx.fillRect(pad + i*laneW, 0, laneW-2, H);
  }

  // hit line
  const hitY = H * 0.72;
  ctx.strokeStyle = "rgba(255,255,255,.22)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(pad, hitY);
  ctx.lineTo(W-pad, hitY);
  ctx.stroke();

  // Determine beat window
  const bNow = (mode === "preview" && audio.isPlaying) ? nowPlayBeat() : 0;
  const secondsPerBeat = 60 / (score.bpm * tempoMul);
  const beatsAhead = (H / (Number(getComputedStyle(document.documentElement).getPropertyValue("--fallingMinGap").replace("px","")) || 84)) * 0.9;

  // Show only next few notes for low density
  const noteEvents = score.events.filter(e => e.kind==="note");

  // compute current note index for visualization: find first note whose startBeat >= bNow
  let idx0 = 0;
  while (idx0 < noteEvents.length && noteEvents[idx0].startBeat < bNow) idx0++;
  const showCount = 3; // low density
  const windowNotes = noteEvents.slice(Math.max(0, idx0-1), Math.max(0, idx0-1) + showCount + 1);

  for (const ev of windowNotes){
    const lane = laneForMidi(ev.midi);
    const laneIdx = lanes.findIndex(x=>x.name===lane.name);
    const x = pad + laneIdx*laneW + 8;
    const w = laneW - 16;

    const dyBeats = ev.startBeat - bNow;
    const y = hitY - dyBeats * (H * 0.22); // scale (guitar-hero-ish)
    const rectH = Math.max(44, Math.min(72, ev.durBeat * 60)); // bigger rectangles

    // color based on state
    let fill = "rgba(200,200,200,.28)";
    if (Math.abs(dyBeats) < 0.12) fill = "rgba(91,140,255,.80)";
    if (dyBeats < -0.25) fill = "rgba(255,176,32,.55)";

    ctx.fillStyle = fill;
    roundRect(ctx, x, y - rectH/2, w, rectH, 14);
    ctx.fill();

    // labels (note + finger)
    ctx.fillStyle = "rgba(255,255,255,.95)";
    ctx.font = `${Math.round(14*(window.devicePixelRatio||1))}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
    const name = midiToName(ev.midi);
    const fing = violinFingerForMidi(ev.midi);

    // two-line label with spacing
    const ty = y - 4;
    ctx.fillText(name, x + 12, ty);
    ctx.globalAlpha = 0.92;
    ctx.fillText(`${fing.string} ${fing.finger}`, x + 12, ty + 18);
    ctx.globalAlpha = 1;
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

// ---- Sheet music (Treble only, current + next measure) ----
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
const E4_DIAT = diatonicNumber("E",4); // bottom line treble staff

function staffYForMidi(midi, staffBottomY, lineGap){
  const { step, oct } = midiToStepOct(midi);
  const dn = diatonicNumber(step, oct);
  const pos = dn - E4_DIAT; // each +1 is line/space step
  return staffBottomY - pos * (lineGap/2);
}

function durKind(beats){
  // quant grid is 16th (0.25)
  const b = beats;
  // prefer common values
  if (Math.abs(b - 4) < 0.001) return "whole";
  if (Math.abs(b - 2) < 0.001) return "half";
  if (Math.abs(b - 1) < 0.001) return "quarter";
  if (Math.abs(b - 0.5) < 0.001) return "eighth";
  if (Math.abs(b - 0.25) < 0.001) return "sixteenth";
  // fallback: map ranges
  if (b >= 3) return "whole";
  if (b >= 1.5) return "half";
  if (b >= 0.75) return "quarter";
  if (b >= 0.375) return "eighth";
  return "sixteenth";
}

function drawTrebleClef(x, y){
  // Best-effort: use unicode if available
  sctx.save();
  sctx.fillStyle = "rgba(255,255,255,.92)";
  sctx.font = `${Math.round(38*(window.devicePixelRatio||1))}px serif`;
  sctx.fillText("𝄞", x, y);
  sctx.restore();
}

function drawSheet(){
  resizeCanvasToDisplaySize(sheetCanvas, 260);
  const W = sheetCanvas.width, H = sheetCanvas.height;
  sctx.clearRect(0,0,W,H);

  const show = showSheet.checked;
  if (!show){
    sctx.fillStyle = "rgba(255,255,255,.6)";
    sctx.fillText("Sheet hidden", 20, 30);
    return;
  }

  // staff layout
  const padX = 18 * (window.devicePixelRatio||1);
  const padY = 18 * (window.devicePixelRatio||1);
  const lineGap = 14 * (window.devicePixelRatio||1); // between staff lines
  const staffTopY = padY + 18*(window.devicePixelRatio||1);
  const staffBottomY = staffTopY + 4*lineGap;

  // draw staff lines
  sctx.strokeStyle = "rgba(255,255,255,.20)";
  sctx.lineWidth = 2;
  for (let i=0;i<5;i++){
    const y = staffTopY + i*lineGap;
    sctx.beginPath();
    sctx.moveTo(padX, y);
    sctx.lineTo(W-padX, y);
    sctx.stroke();
  }

  // clef
  drawTrebleClef(padX + 2, staffBottomY + lineGap*0.25);

  if (!score.measures.length){
    sctx.fillStyle = "rgba(255,255,255,.7)";
    sctx.font = `${Math.round(14*(window.devicePixelRatio||1))}px system-ui`;
    sctx.fillText("Load a MIDI or MusicXML file to see notes.", padX + 52*(window.devicePixelRatio||1), staffTopY + 2*lineGap);
    return;
  }

  // current beat for window
  const bNow = (mode==="preview" && audio.isPlaying) ? nowPlayBeat() : 0;
  const mLen = beatsPerMeasure(score.timeSig);
  const curMeasureIdx = Math.max(0, Math.min(score.measures.length-1, Math.floor(bNow / mLen)));
  const m0 = score.measures[curMeasureIdx];
  const m1 = score.measures[Math.min(score.measures.length-1, curMeasureIdx+1)];

  // measure window: current + next (2 measures)
  const windowMeasures = [m0, m1];

  // geometry
  const clefW = 52*(window.devicePixelRatio||1);
  const usableW = (W - padX*2 - clefW);
  const measureW = usableW / 2;
  const x0 = padX + clefW;

  // draw barlines and measure labels
  sctx.strokeStyle = "rgba(255,255,255,.25)";
  sctx.lineWidth = 2;
  for (let i=0;i<3;i++){
    const x = x0 + i*measureW;
    sctx.beginPath();
    sctx.moveTo(x, staffTopY);
    sctx.lineTo(x, staffBottomY);
    sctx.stroke();
  }

  // draw events
  for (let mi=0; mi<2; mi++){
    const m = windowMeasures[mi];
    const baseX = x0 + mi*measureW;
    const beatSpan = mLen;

    // group notes for beaming: consecutive eighth/sixteenth without rests
    const evs = (m.events||[]).slice().sort((a,b)=>a.startBeat-b.startBeat);

    // helper to x position
    const xForBeat = (beat) => baseX + ( (beat - m.startBeat) / beatSpan ) * (measureW - 14*(window.devicePixelRatio||1)) + 8*(window.devicePixelRatio||1);

    // draw each event
    for (const ev of evs){
      const x = xForBeat(ev.startBeat);

      if (ev.kind === "rest"){
        // simple rest rendering using text fallback
        sctx.fillStyle = "rgba(255,255,255,.75)";
        sctx.font = `${Math.round(18*(window.devicePixelRatio||1))}px serif`;
        const k = durKind(ev.durBeat);
        const glyph = (k==="whole")?"𝄻":(k==="half")?"𝄼":(k==="quarter")?"𝄽":(k==="eighth")?"𝄾":"𝄿";
        // If glyph missing, draw a small zigzag-ish mark
        if (glyph === "𝄻" || glyph === "𝄼" || glyph === "𝄽" || glyph === "𝄾" || glyph === "𝄿"){
          sctx.fillText(glyph, x, staffTopY + 3.1*lineGap);
        } else {
          sctx.fillRect(x, staffTopY + 2*lineGap, 10, 4);
        }
        continue;
      }

      const y = staffYForMidi(ev.midi, staffBottomY, lineGap);

      // notehead
      const kind = durKind(ev.durBeat);
      const filled = !(kind==="whole" || kind==="half");
      const headW = 14*(window.devicePixelRatio||1);
      const headH = 10*(window.devicePixelRatio||1);

      sctx.save();
      sctx.translate(x, y);
      sctx.rotate(-0.35);
      sctx.strokeStyle = "rgba(255,255,255,.92)";
      sctx.lineWidth = 2;
      sctx.fillStyle = filled ? "rgba(255,255,255,.92)" : "rgba(255,255,255,.06)";
      sctx.beginPath();
      sctx.ellipse(0, 0, headW/2, headH/2, 0, 0, Math.PI*2);
      sctx.fill();
      sctx.stroke();
      sctx.restore();

      // accidental (simple #)
      const st = midiToStepOct(ev.midi);
      if (st.accidental){
        sctx.fillStyle = "rgba(255,255,255,.86)";
        sctx.font = `${Math.round(16*(window.devicePixelRatio||1))}px system-ui`;
        sctx.fillText(st.accidental, x - 18*(window.devicePixelRatio||1), y + 6*(window.devicePixelRatio||1));
      }

      // stem + flags
      if (kind !== "whole"){
        const stemUp = (y > staffTopY + 2*lineGap); // below middle -> up
        sctx.strokeStyle = "rgba(255,255,255,.92)";
        sctx.lineWidth = 2;

        const stemX = x + (stemUp ? (headW/2) : -(headW/2));
        const stemLen = 38*(window.devicePixelRatio||1);
        const y1 = y;
        const y2 = stemUp ? (y - stemLen) : (y + stemLen);

        sctx.beginPath();
        sctx.moveTo(stemX, y1);
        sctx.lineTo(stemX, y2);
        sctx.stroke();

        // flags for eighth/sixteenth (beams are best-effort in v15; flags always present)
        if (kind === "eighth" || kind === "sixteenth"){
          const dir = stemUp ? -1 : 1;
          const fx = stemX;
          const fy = y2;
          sctx.strokeStyle = "rgba(255,255,255,.92)";
          sctx.lineWidth = 2;

          // 1st flag
          sctx.beginPath();
          sctx.moveTo(fx, fy);
          sctx.quadraticCurveTo(fx + 10*(window.devicePixelRatio||1), fy + 6*dir, fx + 6*(window.devicePixelRatio||1), fy + 14*dir);
          sctx.stroke();

          if (kind === "sixteenth"){
            const fy2 = fy + 10*dir;
            sctx.beginPath();
            sctx.moveTo(fx, fy2);
            sctx.quadraticCurveTo(fx + 10*(window.devicePixelRatio||1), fy2 + 6*dir, fx + 6*(window.devicePixelRatio||1), fy2 + 14*dir);
            sctx.stroke();
          }
        }
      }

      // ledger lines (simple)
      const yMin = staffTopY;
      const yMax = staffBottomY;
      sctx.strokeStyle = "rgba(255,255,255,.20)";
      sctx.lineWidth = 2;
      if (y < yMin){
        for (let ly = yMin - lineGap; ly >= y; ly -= lineGap){
          sctx.beginPath();
          sctx.moveTo(x - 10*(window.devicePixelRatio||1), ly);
          sctx.lineTo(x + 10*(window.devicePixelRatio||1), ly);
          sctx.stroke();
        }
      } else if (y > yMax){
        for (let ly = yMax + lineGap; ly <= y; ly += lineGap){
          sctx.beginPath();
          sctx.moveTo(x - 10*(window.devicePixelRatio||1), ly);
          sctx.lineTo(x + 10*(window.devicePixelRatio||1), ly);
          sctx.stroke();
        }
      }
    }
  }

  // highlight play position (simple caret)
  if (mode==="preview" && audio.isPlaying){
    const xCaret = x0 + ( (bNow - m0.startBeat) / mLen ) * measureW;
    sctx.strokeStyle = "rgba(91,140,255,.9)";
    sctx.lineWidth = 3;
    sctx.beginPath();
    sctx.moveTo(xCaret, staffTopY - 10*(window.devicePixelRatio||1));
    sctx.lineTo(xCaret, staffBottomY + 10*(window.devicePixelRatio||1));
    sctx.stroke();
  }
}

// ---------- Animation loop ----------
function renderLoop(){
  drawSheet();
  if (showFalling.checked) drawFalling();

  // update target readout in preview for convenience
  if (score.events.length){
    updateTargetReadout();
  }

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
function stopAllAndReset(){
  stopAll();
  updateTargetAtStop();
}

function stopAllWrapper(){
  stopAllAndReset();
  stopMic();
}

function stopAllHard(){
  stopAllWrapper();
}

function stopAllPublic(){ stopAllHard(); }

// keep stopAll exposed to above callbacks
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
setHeaderFilename(""); // shows helper text
status("Ready. Tap the folder to load a file.");
updateTargetReadout();
