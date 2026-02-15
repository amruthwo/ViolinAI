/* v14: audio-master clock + rolling scheduler + smooth animation + fixed pitchy import */

import { PitchDetector } from "https://esm.sh/pitchy@4.1.0";

(() => {
  const $ = (id) => document.getElementById(id);
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const isFiniteNumber = (x) => Number.isFinite(x) && !Number.isNaN(x);

  // UI
  const scoreFileEl = $("scoreFile");
  const statusEl = $("status");
  const srcTxt = $("srcTxt");
  const keyTxt = $("keyTxt");

  const modePreviewBtn = $("modePreview");
  const modeLearnBtn = $("modeLearn");

  const showFallingEl = $("showFalling");
  const showSheetEl = $("showSheet");

  const playBtn = $("playBtn");
  const pauseBtn = $("pauseBtn");
  const stopBtn = $("stopBtn");
  const testBtn = $("testBtn");
  const micBtn = $("micBtn");

  const tempoDownBtn = $("tempoDownBtn");
  const tempoUpBtn = $("tempoUpBtn");
  const tempoVal = $("tempoVal");

  const countInEl = $("countIn");
  const metroOnEl = $("metroOn");

  const loopStartBtn = $("loopStartBtn");
  const loopEndBtn = $("loopEndBtn");
  const loopClearBtn = $("loopClearBtn");
  const loopRead = $("loopRead");

  const tolCentsEl = $("tolCents");
  const waitModeEl = $("waitMode");
  const learnOnlyRow = $("learnOnlyRow");

  const themeBtn = $("themeBtn");
  const designSelect = $("designSelect");

  const m3SeedControls = $("m3SeedControls");
  const m3ShuffleBtn = $("m3ShuffleBtn");
  const m3SeedDots = $("m3SeedDots");
  const m3SeedTxt = $("m3SeedTxt");
  const m3SeedLine = $("m3SeedLine");

  const settingsBtn = $("settingsBtn");
  const settingsPanel = $("settingsPanel");
  const readoutDetails = $("readoutDetails");

  const targetTxt = $("targetTxt");
  const heardTxt = $("heardTxt");
  const clarityTxt = $("clarityTxt");
  const deltaTxt = $("deltaTxt");
  const levelTxt = $("levelTxt");
  const micStatusTxt = $("micStatusTxt");

  const canvas = $("canvas");
  const sheetCanvas = $("sheetCanvas");
  const ctx = canvas.getContext("2d");
  const sctx = sheetCanvas.getContext("2d");

  const sheetPanel = $("sheetPanel");
  const fallingPanel = $("fallingPanel");

  // SW
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});

  // Ripple
  function addRipples() {
    const els = document.querySelectorAll(".ripple");
    for (const el of els) {
      el.addEventListener("pointerdown", (ev) => {
        if (el.disabled) return;
        const rect = el.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height) * 2.1;
        const ink = document.createElement("span");
        ink.className = "ripple-ink";
        ink.style.width = ink.style.height = `${size}px`;
        ink.style.left = `${ev.clientX - rect.left - size / 2}px`;
        ink.style.top = `${ev.clientY - rect.top - size / 2}px`;
        el.appendChild(ink);
        ink.addEventListener("animationend", () => ink.remove(), { once: true });
      }, { passive: true });
    }
  }

  // Settings drawer
  function setSettingsOpen(open) {
    settingsPanel.hidden = !open;
    settingsBtn.setAttribute("aria-expanded", open ? "true" : "false");
  }
  settingsBtn.addEventListener("click", () => setSettingsOpen(settingsPanel.hidden));

  // Platform
  function detectPlatform() {
    const ua = navigator.userAgent || "";
    const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const isAndroid = /Android/.test(ua);
    return { isIOS, isAndroid };
  }

  // ---------------------------
  // Theme / Design
  // ---------------------------
  let resolvedDesign = "auto";
  const M3_SEEDS = ["#6750A4", "#006874", "#386A20", "#B3261E", "#D97900"];

  const MATERIAL_VARS = [
    "--accent","--accent2","--accent3","--accent4",
    "--bg","--surface","--surface2","--canvas","--lane",
    "--border","--text","--muted","--bgFX"
  ];
  function clearMaterialOverrides() {
    const root = document.documentElement.style;
    MATERIAL_VARS.forEach((k) => root.removeProperty(k));
  }

  let MCU = null;
  async function ensureMCU() {
    if (MCU) return MCU;
    try {
      MCU = await import("https://cdn.jsdelivr.net/npm/@material/material-color-utilities@0.4.0/index.js");
      return MCU;
    } catch {
      MCU = null;
      return null;
    }
  }

  function setTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    themeBtn.textContent = theme === "dark" ? "🌙 Dark" : "☀️ Light";
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#111111" : "#f7f8ff");
  }

  function loadThemePref() {
    const saved = localStorage.getItem("vfn_theme");
    if (saved === "dark" || saved === "light") setTheme(saved);
    else {
      try { setTheme(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"); }
      catch { setTheme("dark"); }
    }
  }

  function makeBlobBg(primary, tertiary, secondary, accent4, isDark) {
    const a = isDark ? 0.22 : 0.16;
    const b = isDark ? 0.18 : 0.12;
    const c = isDark ? 0.14 : 0.10;
    return [
      `radial-gradient(520px 420px at 16% 10%, color-mix(in srgb, ${primary} ${Math.round(a*100)}%, transparent), transparent 70%)`,
      `radial-gradient(520px 420px at 88% 14%, color-mix(in srgb, ${tertiary} ${Math.round(b*100)}%, transparent), transparent 70%)`,
      `radial-gradient(640px 520px at 60% 110%, color-mix(in srgb, ${secondary} ${Math.round(c*100)}%, transparent), transparent 70%)`,
      `radial-gradient(460px 380px at 44% 52%, color-mix(in srgb, ${accent4} ${Math.round((c-0.03)*100)}%, transparent), transparent 70%)`,
    ].join(", ");
  }

  async function applyMaterialSchemeFromSeed(seedHex) {
    const root = document.documentElement.style;
    const mcu = await ensureMCU();

    if (!mcu) {
      root.setProperty("--accent", seedHex);
      m3SeedTxt.textContent = `${seedHex} (fallback)`;
      return;
    }

    const { argbFromHex, hexFromArgb, themeFromSourceColor } = mcu;
    const theme = themeFromSourceColor(argbFromHex(seedHex));
    const isDark = (document.documentElement.getAttribute("data-theme") || "dark") === "dark";
    const scheme = isDark ? theme.schemes.dark : theme.schemes.light;

    const primary = hexFromArgb(scheme.primary);
    const secondary = hexFromArgb(scheme.secondary);
    const tertiary = hexFromArgb(scheme.tertiary);
    const error = hexFromArgb(scheme.error);

    const bg = hexFromArgb(scheme.background);
    const surface = hexFromArgb(scheme.surface);
    const lane = hexFromArgb(scheme.surfaceContainerHigh ?? scheme.surfaceContainer ?? scheme.surface);
    const outline = hexFromArgb(scheme.outline);
    const onSurface = hexFromArgb(scheme.onSurface);

    root.setProperty("--accent", primary);
    root.setProperty("--accent2", tertiary);
    root.setProperty("--accent3", secondary);
    root.setProperty("--accent4", error);

    root.setProperty("--bg", bg);
    root.setProperty("--surface", surface);
    root.setProperty("--surface2", lane);
    root.setProperty("--canvas", surface);
    root.setProperty("--lane", lane);
    root.setProperty("--border", outline);

    root.setProperty("--text", onSurface);
    root.setProperty("--muted", isDark ? "rgba(255,255,255,0.70)" : "rgba(0,0,0,0.62)");
    root.setProperty("--bgFX", makeBlobBg(primary, tertiary, secondary, error, isDark));

    m3SeedTxt.textContent = seedHex;
  }

  function getSeedIndex() {
    const raw = localStorage.getItem("vfn_m3_seed_idx");
    const i = raw == null ? NaN : parseInt(raw, 10);
    return Number.isFinite(i) ? clamp(i, 0, M3_SEEDS.length - 1) : null;
  }

  function ensureSeedChosen() {
    let idx = getSeedIndex();
    if (idx == null) {
      idx = Math.floor(Math.random() * M3_SEEDS.length);
      localStorage.setItem("vfn_m3_seed_idx", String(idx));
    }
    return idx;
  }

  function buildSeedDots() {
    m3SeedDots.innerHTML = "";
    M3_SEEDS.forEach((hex, i) => {
      const b = document.createElement("button");
      b.className = "seedDot";
      b.type = "button";
      b.title = `Seed ${hex}`;
      b.style.background = hex;
      b.addEventListener("click", async () => {
        await setSeedIndex(i);
        drawAll(true);
      });
      m3SeedDots.appendChild(b);
    });
  }

  function updateSeedDots(activeIdx) {
    const dots = m3SeedDots.querySelectorAll(".seedDot");
    dots.forEach((d, i) => d.classList.toggle("active", i === activeIdx));
  }

  async function setSeedIndex(i) {
    localStorage.setItem("vfn_m3_seed_idx", String(i));
    updateSeedDots(i);
    if (resolvedDesign === "material") {
      await applyMaterialSchemeFromSeed(M3_SEEDS[i]);
      document.body.offsetHeight; // Safari repaint nudge
    } else {
      m3SeedTxt.textContent = "—";
    }
  }

  async function applyDesign(design) {
    const plat = detectPlatform();
    resolvedDesign = design;
    if (design === "auto") resolvedDesign = plat.isIOS ? "liquid" : "material";
    document.documentElement.setAttribute("data-design", resolvedDesign);

    const showM3 = resolvedDesign === "material";
    m3SeedControls.hidden = !showM3;
    m3SeedLine.style.display = showM3 ? "" : "none";

    if (showM3) {
      buildSeedDots();
      const idx = ensureSeedChosen();
      await applyMaterialSchemeFromSeed(M3_SEEDS[idx]);
      updateSeedDots(idx);
      m3SeedTxt.textContent = M3_SEEDS[idx];
    } else {
      clearMaterialOverrides();
      m3SeedTxt.textContent = "—";
    }

    resizeCanvases();
    drawAll(true);
  }

  async function loadDesignPref() {
    const saved = localStorage.getItem("vfn_design") || "auto";
    designSelect.value = saved;
    await applyDesign(saved);
  }

  themeBtn.addEventListener("click", async () => {
    const cur = document.documentElement.getAttribute("data-theme") || "dark";
    const next = cur === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("vfn_theme", next);

    if (resolvedDesign === "material") {
      const idx = ensureSeedChosen();
      await applyMaterialSchemeFromSeed(M3_SEEDS[idx]);
    } else {
      clearMaterialOverrides();
    }
    drawAll(true);
  });

  designSelect.addEventListener("change", async () => {
    localStorage.setItem("vfn_design", designSelect.value);
    await applyDesign(designSelect.value);
  });

  m3ShuffleBtn.addEventListener("click", async () => {
    if (resolvedDesign !== "material") return;
    let idx = ensureSeedChosen();
    idx = (idx + 1) % M3_SEEDS.length;
    await setSeedIndex(idx);
    drawAll(true);
  });

  // ---------------------------
  // App core
  // ---------------------------
  const STRINGS = [
    { name: "G", open: 55 },
    { name: "D", open: 62 },
    { name: "A", open: 69 },
    { name: "E", open: 76 },
  ];

  const TEMPO_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 1.0, 1.25, 1.5, 2.0];
  let tempoMul = 1.0;

  let mode = "preview";
  let bpm = 120;
  let keySig = null;

  let baseNotes = [];
  let notes = [];
  let currentIdx = 0;

  let loop = { enabled: false, start: 0, end: 0 };

  let dpr = 1;

  function setStatus(msg) { statusEl.textContent = msg; }

  function midiToHz(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function noteName(midi) {
    const names = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
    const n = names[midi % 12];
    const oct = Math.floor(midi / 12) - 1;
    return `${n}${oct}`;
  }
  function centsOff(freq, targetHz) { return 1200 * Math.log2(freq / targetHz); }

  const KEY_NAMES = {
    "0,0":"C major","0,1":"A minor",
    "1,0":"G major","1,1":"E minor",
    "2,0":"D major","2,1":"B minor",
    "3,0":"A major","3,1":"F# minor",
    "4,0":"E major","4,1":"C# minor",
    "-1,0":"F major","-1,1":"D minor",
    "-2,0":"Bb major","-2,1":"G minor",
    "-3,0":"Eb major","-3,1":"C minor",
  };
  function keyNameFromSig(sig) {
    if (!sig) return "—";
    return KEY_NAMES[`${sig.sf},${sig.mi}`] || `sf=${sig.sf} ${sig.mi ? "minor":"major"}`;
  }

  function chooseStringIndex(midi, prevStringIndex = null) {
    const candidates = [];
    for (let i = 0; i < STRINGS.length; i++) {
      const semi = midi - STRINGS[i].open;
      if (semi >= 0 && semi <= 7) candidates.push({ i, semi });
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => {
      const aStay = prevStringIndex === a.i ? -0.25 : 0;
      const bStay = prevStringIndex === b.i ? -0.25 : 0;
      return (a.semi + aStay) - (b.semi + bStay);
    });
    return candidates[0].i;
  }

  function fingerTextForSemi(semi) {
    if (semi <= 0) return "0";
    const map = { 1:"1L", 2:"1", 3:"2L", 4:"2", 5:"3", 6:"4L", 7:"4" };
    return map[semi] || "";
  }

  function laneLabel(n) {
    if (!n) return "—";
    const lane = n.stringIndex == null ? "?" : STRINGS[n.stringIndex].name;
    return `${n.label} (${lane} string, ${n.fingerText})`;
  }

  function updateTargetReadout() {
    const n = notes[currentIdx];
    targetTxt.textContent = n ? laneLabel(n) : "Done!";
  }

  function updateLoopReadout() {
    if (!loop.enabled) loopRead.textContent = "Loop: off";
    else loopRead.textContent = `Loop: ${loop.start + 1} → ${loop.end + 1}`;
  }

  function enableControls(on) {
    playBtn.disabled = !on;
    pauseBtn.disabled = !on;
    stopBtn.disabled = !on;
    testBtn.disabled = !on;
    micBtn.disabled = !on;
    tempoDownBtn.disabled = !on;
    tempoUpBtn.disabled = !on;
    loopStartBtn.disabled = !on;
    loopEndBtn.disabled = !on;
    loopClearBtn.disabled = !on;
  }

  function closestTempoIndex(x) {
    let best = 0, bestd = Infinity;
    for (let i = 0; i < TEMPO_STEPS.length; i++) {
      const d = Math.abs(TEMPO_STEPS[i] - x);
      if (d < bestd) { bestd = d; best = i; }
    }
    return best;
  }

  function setTempoMul(next) {
    tempoMul = next;
    tempoVal.textContent = `${tempoMul.toFixed(2)}×`;
    if (baseNotes.length) rebuildNotesFromBase();
  }

  tempoDownBtn.addEventListener("click", () => {
    const i = closestTempoIndex(tempoMul);
    setTempoMul(TEMPO_STEPS[Math.max(0, i - 1)]);
  });
  tempoUpBtn.addEventListener("click", () => {
    const i = closestTempoIndex(tempoMul);
    setTempoMul(TEMPO_STEPS[Math.min(TEMPO_STEPS.length - 1, i + 1)]);
  });

  function applyViewVisibility() {
    const showSheet = showSheetEl.checked;
    const showFall = showFallingEl.checked;
    sheetPanel.style.display = showSheet ? "block" : "none";
    fallingPanel.style.display = showFall ? "block" : "none";
    resizeCanvases();
    drawAll(true);
  }
  showFallingEl.addEventListener("change", applyViewVisibility);
  showSheetEl.addEventListener("change", applyViewVisibility);

  function setMode(next) {
    mode = next;
    modePreviewBtn.classList.toggle("active", mode === "preview");
    modeLearnBtn.classList.toggle("active", mode === "learn");
    learnOnlyRow.style.display = mode === "learn" ? "" : "none";

    micBtn.style.display = mode === "learn" ? "" : "none";

    stopPreview(true);
    stopMic();

    if (notes.length) {
      setStatus(mode === "preview"
        ? "Preview: Play to listen. iPhone: silent switch/volume/Bluetooth."
        : "Learn: Tap Mic, then play/whistle the target note to advance.");
    }
  }
  modePreviewBtn.addEventListener("click", () => setMode("preview"));
  modeLearnBtn.addEventListener("click", () => setMode("learn"));

  // ---------------------------
  // Layout / canvases
  // ---------------------------
  function resizeCanvases() {
    dpr = window.devicePixelRatio || 1;
    const isPhone = window.matchMedia && window.matchMedia("(max-width: 520px)").matches;

    const sizeCanvas = (c, cssW, cssH) => {
      c.style.width = cssW + "px";
      c.style.height = cssH + "px";
      c.width = Math.floor(cssW * dpr);
      c.height = Math.floor(cssH * dpr);
    };

    if (fallingPanel && fallingPanel.style.display !== "none") {
      const rect = fallingPanel.getBoundingClientRect();
      const cssW = Math.max(260, Math.floor(rect.width));
      const cssH = isPhone ? Math.max(660, Math.floor(cssW * 1.30)) : Math.max(380, Math.floor(cssW * 0.70));
      sizeCanvas(canvas, cssW, cssH);
    }

    if (sheetPanel && sheetPanel.style.display !== "none") {
      const rect = sheetPanel.getBoundingClientRect();
      const cssW = Math.max(260, Math.floor(rect.width));
      const cssH = isPhone ? Math.max(440, Math.floor(cssW * 0.86)) : Math.max(420, Math.floor(cssW * 0.72));
      sizeCanvas(sheetCanvas, cssW, cssH);
    }
  }
  window.addEventListener("resize", () => { resizeCanvases(); drawAll(true); });

  function cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }
  function cssVars() {
    return {
      bg: cssVar("--canvas","#0b0c18"),
      lane: cssVar("--lane","#101331"),
      stroke: cssVar("--border","rgba(255,255,255,0.2)"),
      text: cssVar("--text","#f2f4ff"),
      muted: cssVar("--muted","rgba(242,244,255,0.72)"),
      accent: cssVar("--accent","#5b8cff"),
      accent4: cssVar("--accent4","#ffb020"),
    };
  }

  function rebuildNotesFromBase() {
    stopPreview(true);
    stopMic();

    notes = [];
    let prevString = null;

    for (const n of baseNotes) {
      const t = n.t / tempoMul;
      const dur = (n.dur || 0.3) / tempoMul;

      const sIdx = chooseStringIndex(n.midi, prevString);
      prevString = sIdx ?? prevString;

      const semi = sIdx == null ? null : n.midi - STRINGS[sIdx].open;
      const fingerText = semi == null ? "?" : fingerTextForSemi(semi);

      notes.push({
        t, dur,
        midi: n.midi,
        hz: midiToHz(n.midi),
        stringIndex: sIdx,
        label: noteName(n.midi),
        fingerText,
      });
    }

    currentIdx = 0;
    updateTargetReadout();
    updateLoopReadout();

    drawAll(true);
    enableControls(true);
  }

  function loopTimes() {
    if (!loop.enabled || !notes.length) return null;
    const tStart = notes[loop.start]?.t ?? 0;
    const endNote = notes[loop.end];
    const tEnd = (endNote?.t ?? 0) + (endNote?.dur ?? 0.2);
    return { tStart, tEnd };
  }

  loopStartBtn.addEventListener("click", () => {
    loop.start = currentIdx;
    loop.end = Math.max(loop.end, loop.start);
    loop.enabled = true;
    updateLoopReadout();
  });
  loopEndBtn.addEventListener("click", () => {
    loop.end = currentIdx;
    loop.start = Math.min(loop.start, loop.end);
    loop.enabled = true;
    updateLoopReadout();
  });
  loopClearBtn.addEventListener("click", () => {
    loop.enabled = false;
    updateLoopReadout();
  });

  // ---------------------------
  // MIDI + MusicXML (same as v13.1-ish)
  // ---------------------------
  async function loadMidi(arrayBuffer) {
    // Midi is global from ToneJS Midi script
    const midi = new Midi(arrayBuffer);
    const tempos = midi.header.tempos || [];
    bpm = tempos.length ? tempos[0].bpm : 120;

    keySig = null;
    const ks = midi.header.keySignatures || [];
    if (ks.length) {
      const first = ks[0];
      if (typeof first.sf === "number" && typeof first.mi === "number") keySig = { sf: first.sf, mi: first.mi };
    }

    const raw = [];
    midi.tracks.forEach((tr) => tr.notes.forEach((n) => raw.push({ t: n.time, dur: n.duration, midi: n.midi })));
    raw.sort((a, b) => a.t - b.t || a.midi - b.midi);

    const collapsed = [];
    const EPS = 0.03;
    for (const n of raw) {
      const last = collapsed[collapsed.length - 1];
      if (last && Math.abs(n.t - last.t) < EPS) {
        if (n.midi > last.midi) collapsed[collapsed.length - 1] = n;
      } else collapsed.push(n);
    }

    baseNotes = collapsed.map((n) => ({ t: n.t, dur: n.dur || 0.3, midi: n.midi }));
    srcTxt.textContent = "MIDI";
  }

  function textLooksLikeXml(s) {
    const t = s.trim();
    return t.startsWith("<?xml") || t.startsWith("<score-partwise") || t.startsWith("<score-timewise");
  }

  function pitchToMidi(step, alter, octave) {
    const base = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 }[step];
    if (base == null || !isFiniteNumber(octave)) return null;
    return (octave + 1) * 12 + base + (alter || 0);
  }

  function parseMusicXML(xmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, "application/xml");
    const parseErr = doc.getElementsByTagName("parsererror")[0];
    if (parseErr) throw new Error("MusicXML parse error");

    bpm = 120;
    const sound = doc.querySelector("sound[tempo]");
    if (sound) {
      const v = parseFloat(sound.getAttribute("tempo"));
      if (isFiniteNumber(v) && v > 10 && v < 400) bpm = v;
    } else {
      const pm = doc.querySelector("per-minute");
      if (pm) {
        const v = parseFloat(pm.textContent);
        if (isFiniteNumber(v) && v > 10 && v < 400) bpm = v;
      }
    }

    keySig = null;
    const fifths = doc.querySelector("key > fifths");
    if (fifths) {
      const sf = parseInt(fifths.textContent, 10);
      const modeEl = doc.querySelector("key > mode");
      const modeTxt = modeEl ? (modeEl.textContent || "").toLowerCase() : "major";
      const mi = modeTxt.includes("minor") ? 1 : 0;
      if (isFiniteNumber(sf)) keySig = { sf, mi };
    }

    const parts = Array.from(doc.getElementsByTagName("part"));
    if (!parts.length) throw new Error("No <part> found");

    let chosen = parts[0];
    const partList = Array.from(doc.querySelectorAll("part-list score-part"));
    const idToName = new Map();
    for (const sp of partList) {
      const id = sp.getAttribute("id") || "";
      const nm = (sp.querySelector("part-name")?.textContent || "").toLowerCase();
      idToName.set(id, nm);
    }
    for (const p of parts) {
      const id = p.getAttribute("id") || "";
      const nm = idToName.get(id) || "";
      if (nm.includes("violin")) { chosen = p; break; }
    }

    let divisions = 1;
    let curSec = 0;
    let lastStartSec = 0;
    const spq = 60 / bpm;
    const out = [];

    const measures = Array.from(chosen.getElementsByTagName("measure"));
    for (const meas of measures) {
      const divEl = meas.querySelector("attributes > divisions");
      if (divEl) {
        const v = parseInt(divEl.textContent, 10);
        if (isFiniteNumber(v) && v > 0) divisions = v;
      }

      const notesEl = Array.from(meas.getElementsByTagName("note"));
      for (const n of notesEl) {
        const isRest = !!n.querySelector("rest");
        const chord = !!n.querySelector("chord");

        const durEl = n.querySelector("duration");
        const durDiv = durEl ? parseInt(durEl.textContent, 10) : 0;
        const quarterLen = divisions > 0 ? durDiv / divisions : 0;
        const durSec = Math.max(0.05, quarterLen * spq);

        const startSec = chord ? lastStartSec : curSec;

        if (!isRest) {
          const step = n.querySelector("pitch > step")?.textContent;
          const octave = n.querySelector("pitch > octave")?.textContent;
          if (step && octave) {
            const alter = parseInt(n.querySelector("pitch > alter")?.textContent || "0", 10) || 0;
            const midi = pitchToMidi(step.trim(), alter, parseInt(octave, 10));
            if (midi != null) out.push({ t: startSec, dur: durSec, midi });
          }
        }

        if (!chord) { lastStartSec = startSec; curSec += durSec; }
        else { lastStartSec = startSec; }
      }
    }

    out.sort((a, b) => a.t - b.t || a.midi - b.midi);

    const collapsed = [];
    const EPS = 0.02;
    for (const n of out) {
      const last = collapsed[collapsed.length - 1];
      if (last && Math.abs(n.t - last.t) < EPS) {
        if (n.midi > last.midi) collapsed[collapsed.length - 1] = n;
      } else collapsed.push(n);
    }

    baseNotes = collapsed.map((n) => ({ t: n.t, dur: n.dur || 0.3, midi: n.midi }));
    srcTxt.textContent = "MusicXML";
  }

  scoreFileEl.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      enableControls(false);
      stopPreview(true);
      stopMic();

      const name = (file.name || "").toLowerCase();
      if (name.endsWith(".mid") || name.endsWith(".midi")) {
        const ab = await file.arrayBuffer();
        await loadMidi(ab);
      } else {
        const text = await file.text();
        if (!textLooksLikeXml(text)) throw new Error("Not MusicXML (.mxl zipped not supported yet)");
        parseMusicXML(text);
      }

      keyTxt.textContent = keyNameFromSig(keySig);

      currentIdx = 0;

      loop.enabled = false;
      loop.start = 0;
      loop.end = Math.max(0, baseNotes.length - 1);
      updateLoopReadout();

      rebuildNotesFromBase();
      applyViewVisibility();
      setMode(mode);
      resizeCanvases();

      setStatus(`Loaded ${notes.length} notes from ${srcTxt.textContent}. BPM≈${Math.round(bpm)}.`);
    } catch (err) {
      console.error(err);
      setStatus(`Could not load file: ${err.message || err}`);
      srcTxt.textContent = "—";
      keyTxt.textContent = "—";
      baseNotes = [];
      notes = [];
      enableControls(false);
      drawAll(true);
    }
  });

  // ---------------------------
  // Preview audio (v14): AudioContext master clock + rolling scheduler
  // ---------------------------
  let audioCtx = null;

  // playback state
  let isPlaying = false;
  let isPaused = false;
  let rafId = null;

  // master clock mapping:
  // songTime (sec) = audioCtx.currentTime - t0 + pausedSongTime
  let t0 = 0;
  let pausedSongTime = 0;

  // scheduler
  let schedTimer = null;
  const LOOKAHEAD_MS = 25;
  const SCHEDULE_AHEAD_SEC = 0.35;
  let nextSchedIdx = 0;

  // count-in bookkeeping
  let countInSec = 0;

  function ensureAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    audioCtx.resume?.();
  }

  function playClick(atTime) {
    if (!audioCtx) return;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = "square";
    o.frequency.setValueAtTime(1600, atTime);
    g.gain.setValueAtTime(0.0001, atTime);
    g.gain.exponentialRampToValueAtTime(0.20, atTime + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, atTime + 0.05);
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start(atTime);
    o.stop(atTime + 0.06);
  }

  // Simplified synth: sine + gentle envelope (iOS-friendly)
  function playSine(freq, atTime, durSec) {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();

    o.type = "sine";
    o.frequency.setValueAtTime(freq, atTime);

    const t0 = atTime;
    const t1 = atTime + Math.max(0.10, durSec);
    const a = 0.012;
    const r = 0.060;

    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.15, t0 + a);
    g.gain.setValueAtTime(0.15, Math.max(t0 + a, t1 - r));
    g.gain.exponentialRampToValueAtTime(0.0001, t1);

    o.connect(g);
    g.connect(audioCtx.destination);

    o.start(t0);
    o.stop(t1 + 0.02);
  }

  function getSongTimeNow() {
    if (!audioCtx) return pausedSongTime;
    const now = audioCtx.currentTime;
    const raw = (now - t0) + pausedSongTime;
    return raw; // includes negative during count-in (handled separately)
  }

  function songTimeToAudioTime(songTime) {
    // audio time corresponding to a given songTime (sec) from start (excluding count-in)
    return t0 + (songTime - pausedSongTime);
  }

  function findStartIndexForSongTime(songTime) {
    // find first note with t >= songTime (linear OK for now)
    for (let i = 0; i < notes.length; i++) {
      if (notes[i].t >= songTime - 0.001) return i;
    }
    return notes.length;
  }

  function scheduleNotesWindow() {
    if (!isPlaying || !audioCtx || !notes.length) return;

    const nowAudio = audioCtx.currentTime;
    const nowSong = (nowAudio - t0) + pausedSongTime;

    // during count-in, nowSong is negative; we still want to schedule notes after count-in
    const songWindowStart = Math.max(0, nowSong);
    const songWindowEnd = songWindowStart + SCHEDULE_AHEAD_SEC;

    const lt = loopTimes();
    let loopStartT = 0;
    let loopEndT = Infinity;
    if (lt) { loopStartT = lt.tStart; loopEndT = lt.tEnd; }

    while (nextSchedIdx < notes.length) {
      const n = notes[nextSchedIdx];
      let nt = n.t;

      // loop handling: if looping, we only schedule within the loop window
      if (lt) {
        if (nt < loopStartT) { nextSchedIdx++; continue; }
        if (nt >= loopEndT) break;
      }

      if (nt > songWindowEnd) break;
      if (nt >= songWindowStart - 0.002) {
        const at = songTimeToAudioTime(nt) + countInSec; // count-in shifts audio forward
        const dur = clamp(n.dur, 0.10, 1.2);
        if (at >= nowAudio - 0.02) playSine(n.hz, at, dur);
      }
      nextSchedIdx++;
    }

    // if loop enabled and we've scheduled to the end of loop, wrap by resetting index
    if (lt && nextSchedIdx < notes.length) {
      const n = notes[nextSchedIdx];
      if (n && n.t >= loopEndT - 0.001) {
        // reset to loop start if we're close to reaching the end in real time
        if (songWindowStart >= loopEndT - 0.02) {
          pausedSongTime = loopStartT;
          t0 = audioCtx.currentTime + 0.06; // reset master start to avoid drift
          nextSchedIdx = findStartIndexForSongTime(loopStartT);
        }
      }
    }
  }

  function startScheduler() {
    stopScheduler();
    schedTimer = setInterval(scheduleNotesWindow, LOOKAHEAD_MS);
  }
  function stopScheduler() {
    if (schedTimer) clearInterval(schedTimer);
    schedTimer = null;
  }

  function startPreview() {
    if (!notes.length) return;
    if (mode !== "preview") { setMode("preview"); }

    stopMic();
    ensureAudioCtx();

    // soft warm-up (helps iOS)
    const warmAt = audioCtx.currentTime + 0.03;
    playSine(440, warmAt, 0.08);

    const spb = 60 / bpm;
    const countInBeats = clamp(parseInt(countInEl.value || "0", 10), 0, 8);
    countInSec = countInBeats * spb;

    // establish master time
    t0 = audioCtx.currentTime + 0.10; // small lead for scheduler stability
    isPlaying = true;
    isPaused = false;

    // schedule count-in clicks + optional metronome clicks
    if (countInBeats > 0) {
      for (let i = 0; i < countInBeats; i++) playClick(t0 + i * spb);
    }
    if (metroOnEl.checked) {
      // schedule metronome only a little ahead in the scheduler tick to keep it light
      // (we'll do a simple continuous click stream during playback loop below)
    }

    // scheduler prep
    const songStart = pausedSongTime || 0;
    nextSchedIdx = findStartIndexForSongTime(songStart);

    updateTargetReadout();
    setStatus(countInBeats ? `Count-in: ${countInBeats}… then playing.` : "Preview playing…");

    startScheduler();
    startRAF();
  }

  function pausePreview() {
    if (!isPlaying || !audioCtx) return;
    isPlaying = false;
    isPaused = true;

    // capture current song time (excluding count-in)
    const nowAudio = audioCtx.currentTime;
    const rawSong = (nowAudio - t0) + pausedSongTime;
    pausedSongTime = Math.max(0, rawSong);

    stopScheduler();
    stopRAF();

    audioCtx.suspend?.();
    setStatus("Paused.");
  }

  function stopPreview(silent) {
    isPlaying = false;
    isPaused = false;

    stopScheduler();
    stopRAF();

    if (audioCtx) {
      audioCtx.suspend?.();
      // keep context alive for iOS; don't close
    }

    pausedSongTime = 0;
    countInSec = 0;

    currentIdx = loop.enabled ? loop.start : 0;
    updateTargetReadout();
    drawAll(true);

    if (!silent && notes.length) setStatus("Stopped.");
  }

  function stopRAF() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  function startRAF() {
    stopRAF();
    const tick = () => {
      rafId = requestAnimationFrame(tick);

      // compute song time driven by audio clock
      let songT = pausedSongTime;
      if (audioCtx && isPlaying) {
        const nowAudio = audioCtx.currentTime;
        const raw = (nowAudio - t0) + pausedSongTime;
        songT = raw;
      }

      // during count-in, raw can be negative. treat visuals as "about to start"
      const visSong = Math.max(0, songT);
      // update currentIdx based on visSong, respecting loop
      if (notes.length) {
        const lt = loopTimes();
        let startI = 0;
        let endI = notes.length - 1;
        if (lt) { startI = loop.start; endI = loop.end; }

        // advance index
        while (currentIdx < endI && notes[currentIdx + 1].t <= visSong + 1e-4) currentIdx++;
        if (lt && visSong >= (notes[endI].t + notes[endI].dur)) {
          // visually wrap
          currentIdx = startI;
          pausedSongTime = lt.tStart;
          if (audioCtx && isPlaying) {
            t0 = audioCtx.currentTime + 0.06;
            nextSchedIdx = findStartIndexForSongTime(lt.tStart);
          }
        }
      }

      updateTargetReadout();
      drawAll(false, visSong);
    };
    tick();
  }

  playBtn.addEventListener("click", startPreview);
  pauseBtn.addEventListener("click", pausePreview);
  stopBtn.addEventListener("click", () => stopPreview(false));

  testBtn.addEventListener("click", () => {
    ensureAudioCtx();
    const t = audioCtx.currentTime + 0.06;
    playSine(440, t, 0.22);
    playSine(659.25, t + 0.26, 0.22);
    playSine(880, t + 0.52, 0.22);
    setStatus("Test sound played.");
  });

  // ---------------------------
  // Learn (mic): fixed pitchy import + better diagnostics
  // ---------------------------
  let micCtx = null, analyser = null, sourceNode = null, pitchDetector = null, floatBuf = null;
  let micRunning = false;
  let lastGoodMs = 0;
  const NEED_STABLE_MS = 180;

  function rms(buf) {
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    return Math.sqrt(s / buf.length);
  }

  micBtn.addEventListener("click", async () => {
    if (!notes.length) return;
    if (mode !== "learn") setMode("learn");

    stopPreview(true);
    stopMic();

    try {
      micStatusTxt.textContent = "Requesting mic…";
      micCtx = new (window.AudioContext || window.webkitAudioContext)();

      // minimal constraints first (most compatible)
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      sourceNode = micCtx.createMediaStreamSource(stream);
      analyser = micCtx.createAnalyser();
      analyser.fftSize = 2048;
      sourceNode.connect(analyser);

      floatBuf = new Float32Array(analyser.fftSize);
      pitchDetector = PitchDetector.forFloat32Array(analyser.fftSize);

      micRunning = true;
      lastGoodMs = 0;

      micStatusTxt.textContent = "Mic running";
      setStatus("Mic running. Play/whistle the target note to advance.");

      requestAnimationFrame(learnLoop);
    } catch (err) {
      console.error(err);
      micStatusTxt.textContent = `${err?.name || "Error"}: ${err?.message || err}`;
      setStatus("Mic failed. Open Settings → Site permissions and allow microphone.");
      stopMic();
    }
  });

  function stopMic() {
    micRunning = false;

    if (micCtx) {
      try { micCtx.close(); } catch {}
    }
    micCtx = null; analyser = null; sourceNode = null; pitchDetector = null; floatBuf = null;

    heardTxt.textContent = "—";
    clarityTxt.textContent = "—";
    deltaTxt.textContent = "—";
    levelTxt.textContent = "—";
    micStatusTxt.textContent = "—";
    lastGoodMs = 0;
  }

  function learnLoop() {
    if (!micRunning || mode !== "learn" || !micCtx || !analyser || !pitchDetector) return;

    const current = notes[currentIdx];
    analyser.getFloatTimeDomainData(floatBuf);

    const level = rms(floatBuf);
    levelTxt.textContent = level.toFixed(4);

    const [pitchHz, clarity] = pitchDetector.findPitch(floatBuf, micCtx.sampleRate);

    // show zeros instead of "—" so we know it's updating
    clarityTxt.textContent = isFiniteNumber(clarity) ? clarity.toFixed(2) : "0.00";
    heardTxt.textContent = (pitchHz && isFiniteNumber(pitchHz)) ? `${pitchHz.toFixed(1)} Hz` : "—";

    if (current && pitchHz && isFiniteNumber(pitchHz) && clarity >= 0.65 && level >= 0.004) {
      const delta = centsOff(pitchHz, current.hz);
      deltaTxt.textContent = `${delta.toFixed(1)} cents`;

      const tol = clamp(parseFloat(tolCentsEl.value) || 45, 10, 120);
      const ok = Math.abs(delta) <= tol;
      const waitMode = !!waitModeEl.checked;

      if (ok) {
        lastGoodMs += 16;
        if (!waitMode || lastGoodMs >= NEED_STABLE_MS) {
          currentIdx++;
          lastGoodMs = 0;
        }
      } else {
        lastGoodMs = 0;
      }

      if (loop.enabled && currentIdx > loop.end) currentIdx = loop.start;

      if (currentIdx >= notes.length) {
        setStatus("Finished! 🎉");
        stopMic();
      }
      updateTargetReadout();
      drawAll(false, notes[Math.min(currentIdx, notes.length - 1)]?.t ?? 0);
    } else {
      deltaTxt.textContent = "—";
      lastGoodMs = 0;
    }

    requestAnimationFrame(learnLoop);
  }

  // ---------------------------
  // Drawing helpers
  // ---------------------------
  function roundRect(c,x,y,w,h,r){
    const rr=Math.min(r,w/2,h/2);
    c.beginPath();
    c.moveTo(x+rr,y);
    c.arcTo(x+w,y,x+w,y+h,rr);
    c.arcTo(x+w,y+h,x,y+h,rr);
    c.arcTo(x,y+h,x,y,rr);
    c.arcTo(x,y,x+w,y,rr);
    c.closePath();
  }

  function fallingWindowCount(){
    const isPhone = window.matchMedia && window.matchMedia("(max-width: 520px)").matches;
    if (isPhone) return 3;
    if (window.innerWidth >= 1100) return 7;
    return 5;
  }

  function drawFalling(songTimeSec){
    if (!showFallingEl.checked || fallingPanel.style.display==="none") return;

    const { bg, lane, stroke, text, muted, accent, accent4 } = cssVars();

    ctx.setTransform(dpr,0,0,dpr,0,0);
    const cssW=canvas.width/dpr, cssH=canvas.height/dpr;

    ctx.clearRect(0,0,cssW,cssH);
    ctx.fillStyle=bg; ctx.fillRect(0,0,cssW,cssH);

    const topPad=14, bottomPad=26;
    const lanesY0=topPad, lanesY1=cssH-bottomPad;

    const laneCount=4, laneGap=12;
    const laneW=Math.floor((cssW - laneGap*(laneCount+1))/laneCount);
    const laneX=(i)=>laneGap + i*(laneW+laneGap);

    for (let i=0;i<laneCount;i++){
      ctx.fillStyle=lane;
      ctx.fillRect(laneX(i), lanesY0, laneW, lanesY1-lanesY0);
      ctx.strokeStyle=stroke; ctx.lineWidth=1;
      ctx.strokeRect(laneX(i), lanesY0, laneW, lanesY1-lanesY0);

      ctx.fillStyle=text; ctx.globalAlpha=0.9;
      ctx.font=`900 ${Math.max(16, cssW*0.022)}px system-ui`;
      ctx.fillText(STRINGS[i].name, laneX(i)+10, lanesY0+24);
      ctx.globalAlpha=1;
    }

    // hit line lower to use upper space
    const hitY = lanesY1 - 104;
    ctx.strokeStyle=stroke; ctx.lineWidth=2;
    ctx.globalAlpha=0.9;
    ctx.beginPath(); ctx.moveTo(0, hitY); ctx.lineTo(cssW, hitY); ctx.stroke();
    ctx.globalAlpha=1;

    const ahead = fallingWindowCount();

    // Smooth “guitar hero” style: position is based on time to each note
    const minGap = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--fallingMinGap")) || 74;
    const usableAbove = Math.max(140, hitY - (lanesY0 + 56));
    const autoGap = usableAbove / (ahead + 0.6);
    const stepGap = Math.max(minGap, autoGap);
    const rectH = Math.max(62, stepGap * 0.80);

    const noteFont = clamp(cssW * 0.045, 22, 36);
    const fingerFont = clamp(cssW * 0.034, 18, 26);

    // convert time delta to pixels:
    // Use average spacing based on local note spacing; keep simple and stable:
    const baseSpeed = stepGap / 0.55; // px per second (tuned for readability)
    const speed = baseSpeed * tempoMul;

    // draw a small set around the currentIdx, but positioned by time (smooth)
    const start = Math.max(0, currentIdx - 1);
    const end = Math.min(notes.length - 1, currentIdx + ahead + 2);

    for (let i=start;i<=end;i++){
      const n=notes[i];
      const dt = n.t - songTimeSec; // seconds until note
      const y = hitY - dt * speed;

      // skip far offscreen
      if (y < lanesY0 - 140 || y > lanesY1 + 120) continue;

      const laneIdx=n.stringIndex;
      const x = laneIdx==null ? laneX(0) : laneX(laneIdx);
      const laneWidth = laneIdx==null ? laneW*4 + laneGap*3 : laneW;

      const isCurrent = i===currentIdx || (dt <= 0.02 && dt >= -0.18);
      const isPast = dt < -0.20;

      const pad=10;
      const rectX = x + pad;
      const rectW = laneWidth - pad*2;
      const rectY = y - rectH;

      ctx.globalAlpha = isPast ? 0.16 : isCurrent ? 1 : 0.90;
      ctx.fillStyle = isCurrent ? accent : "#8a8a99";
      if (laneIdx==null) ctx.fillStyle = accent4;

      roundRect(ctx, rectX, rectY, rectW, rectH, 16);
      ctx.fill();

      // NOTE label: top-left
      ctx.fillStyle = bg;
      ctx.globalAlpha = isPast ? 0.12 : 0.96;
      ctx.font = `900 ${noteFont}px system-ui`;
      ctx.fillText(n.label, rectX + 14, rectY + noteFont + 8);

      // Finger badge: bottom-right auto-fit
      const badge = n.fingerText || "?";
      ctx.font = `900 ${fingerFont}px system-ui`;
      const textW = ctx.measureText(badge).width;
      const bh = 34;
      const maxBw = Math.max(40, rectW - 24);
      const bw = clamp(textW + 26, 44, maxBw);

      const bx = rectX + rectW - (bw + 12);
      const by = rectY + rectH - (bh + 12);

      ctx.globalAlpha = isPast ? 0.12 : 0.92;
      ctx.fillStyle = "rgba(0,0,0,0.22)";
      roundRect(ctx, bx, by, bw, bh, 14);
      ctx.fill();

      ctx.fillStyle = bg;
      ctx.font = `900 ${fingerFont}px system-ui`;
      ctx.fillText(badge, bx + 13, by + 24);

      ctx.globalAlpha = 1;
    }

    ctx.fillStyle=muted;
    ctx.font=`700 ${Math.max(12, cssW*0.016)}px system-ui`;
    ctx.fillText("Smooth scrolling is driven by the audio clock (iOS-friendly).", 14, cssH-10);
  }

  // Forward-looking sheet window (current + upcoming systems only)
  function drawSheet(){
    if (!showSheetEl.checked || sheetPanel.style.display==="none") return;

    const { bg, stroke, text, muted, accent } = cssVars();

    sctx.setTransform(dpr,0,0,dpr,0,0);
    const cssW=sheetCanvas.width/dpr, cssH=sheetCanvas.height/dpr;

    sctx.clearRect(0,0,cssW,cssH);
    sctx.fillStyle=bg; sctx.fillRect(0,0,cssW,cssH);

    const pad=18;
    const left=pad, right=cssW-pad;
    const usableW = right-left;

    const lineGap = clamp(cssH * 0.028, 10, 14);
    const staffGap = clamp(cssH * 0.14, 60, 96);

    const systemH = (staffGap + 10*lineGap);
    const systemsFit = Math.max(1, Math.floor((cssH - pad*2) / systemH));

    const minSpacing = clamp(usableW * 0.08, 44, 72);
    const notesPerSystem = Math.max(4, Math.floor(usableW / minSpacing));

    function staffLines(topY){
      sctx.strokeStyle=stroke;
      sctx.lineWidth=1;
      for (let i=0;i<5;i++){
        const y=topY + i*lineGap;
        sctx.beginPath();
        sctx.moveTo(left,y);
        sctx.lineTo(right,y);
        sctx.stroke();
      }
    }

    function midiToDiatonicStep(m){
      const pc=m%12;
      const map={0:0,1:0,2:1,3:1,4:2,5:3,6:3,7:4,8:4,9:5,10:5,11:6};
      const di=map[pc];
      const oct=Math.floor(m/12)-1;
      return oct*7+di;
    }
    const trebleRefStep=midiToDiatonicStep(64); // E4
    const bassRefStep=midiToDiatonicStep(43);   // G2
    function stepToY(step, staffTop, refStep){
      const dy=(refStep-step)*(lineGap/2);
      const bottom=staffTop + 4*lineGap;
      return bottom + dy;
    }
    function staffFor(m){ return m>=60 ? "treble":"bass"; }

    const sysIndex = notes.length ? Math.floor(currentIdx / notesPerSystem) : 0;
    const totalSystems = Math.max(1, Math.ceil(notes.length / notesPerSystem));
    const firstSys = clamp(sysIndex, 0, Math.max(0, totalSystems - systemsFit));
    const lastSys  = clamp(firstSys + systemsFit - 1, 0, totalSystems - 1);

    for (let sys=firstSys; sys<=lastSys; sys++){
      const yBase = pad + (sys-firstSys)*systemH;

      const trebleTop = yBase + 26;
      const bassTop = trebleTop + staffGap;

      staffLines(trebleTop);
      staffLines(bassTop);

      sctx.fillStyle=muted;
      sctx.font=`800 ${Math.max(12, cssW*0.016)}px system-ui`;
      sctx.fillText("Treble", left, trebleTop - 10);
      sctx.fillText("Bass", left, bassTop - 10);

      const i0 = sys * notesPerSystem;
      const i1 = Math.min(notes.length, i0 + notesPerSystem);

      for (let i=i0;i<i1;i++){
        const n=notes[i];
        const col=i - i0;
        const x=left + col*minSpacing + 26;

        const st=staffFor(n.midi);
        const step=midiToDiatonicStep(n.midi);
        const y=(st==="treble") ? stepToY(step, trebleTop, trebleRefStep) : stepToY(step, bassTop, bassRefStep);

        const isCurrent = i===currentIdx;
        const isPast = i<currentIdx;

        // Keep only last 1 past note faint; skip older
        if (isPast && i < currentIdx - 1) continue;

        sctx.globalAlpha = isPast ? 0.10 : isCurrent ? 1 : 0.90;
        sctx.fillStyle = isCurrent ? accent : text;

        const r = clamp(cssW*0.010, 6, 9);
        sctx.beginPath();
        sctx.ellipse(x, y, r*1.3, r, -0.35, 0, Math.PI*2);
        sctx.fill();

        sctx.strokeStyle = sctx.fillStyle;
        sctx.lineWidth = 2;
        sctx.beginPath();
        if (st==="treble"){
          sctx.moveTo(x + r*1.1, y);
          sctx.lineTo(x + r*1.1, y - lineGap*2.8);
        } else {
          sctx.moveTo(x - r*1.1, y);
          sctx.lineTo(x - r*1.1, y + lineGap*2.8);
        }
        sctx.stroke();

        sctx.globalAlpha = isPast ? 0.14 : 0.78;
        sctx.fillStyle = muted;
        sctx.font = `900 ${clamp(cssW*0.015, 11, 13)}px system-ui`;
        sctx.fillText(n.label, x - 18, y + 26);
        if (n.fingerText) sctx.fillText(`(${n.fingerText})`, x - 18, y + 42);

        sctx.globalAlpha = 1;
      }
    }

    sctx.fillStyle=muted;
    sctx.font=`700 ${Math.max(12, cssW*0.016)}px system-ui`;
    sctx.fillText("Forward view: current + upcoming only.", left, cssH-10);
  }

  function drawAll(forceLayout, songTimeSec = 0){
    if (forceLayout) resizeCanvases();
    drawFalling(songTimeSec);
    drawSheet();
  }

  // ---------------------------
  // Init
  // ---------------------------
  function init(){
    addRipples();

    loadThemePref();
    loadDesignPref(); // async

    const isPhone = window.matchMedia && window.matchMedia("(max-width: 640px)").matches;
    setSettingsOpen(!isPhone);
    if (isPhone) readoutDetails.open = false;

    setMode("preview");
    setTempoMul(1.0);

    srcTxt.textContent="—";
    keyTxt.textContent="—";

    updateLoopReadout();
    updateTargetReadout();

    enableControls(false);
    resizeCanvases();
    applyViewVisibility();

    setStatus("Load a MIDI or MusicXML file to begin.");
  }

  init();
})();
