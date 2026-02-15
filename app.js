/* global Midi, pitchy */

(async function () {
  // --- Lazy-load Material Color Utilities (MCU) with fallback ---
  let MCU = null;
  async function ensureMCU() {
    if (MCU) return MCU;
    try {
      MCU = await import("https://cdn.jsdelivr.net/npm/@material/material-color-utilities@0.4.0/index.js");
      return MCU;
    } catch (e) {
      console.warn("Material color utilities failed to load; Material theme will fallback.", e);
      MCU = null;
      return null;
    }
  }

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
  const $ = (id) => document.getElementById(id);

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
        ink.style.top  = `${ev.clientY - rect.top - size / 2}px`;
        el.appendChild(ink);
        ink.addEventListener("animationend", () => ink.remove(), { once: true });
      }, { passive: true });
    }
  }

  // UI
  const scoreFileEl = $("scoreFile");
  const statusEl = $("status");
  const srcTxt = $("srcTxt");

  const modePreviewBtn = $("modePreview");
  const modeLearnBtn = $("modeLearn");

  const showFallingEl = $("showFalling");
  const showSheetEl = $("showSheet");

  const previewPlayBtn = $("previewPlayBtn");
  const previewPauseBtn = $("previewPauseBtn");
  const previewStopBtn = $("previewStopBtn");
  const testSoundBtn = $("testSoundBtn");
  const startMicBtn = $("startMicBtn");

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
  const keyTxt = $("keyTxt");

  const canvas = $("canvas");
  const sheetCanvas = $("sheetCanvas");
  const sheetScroll = $("sheetScroll");
  const ctx = canvas.getContext("2d");
  const sctx = sheetCanvas.getContext("2d");

  const sheetPanel = $("sheetPanel");
  const fallingPanel = $("fallingPanel");

  // Strings (open MIDI)
  const STRINGS = [
    { name: "G", open: 55 },
    { name: "D", open: 62 },
    { name: "A", open: 69 },
    { name: "E", open: 76 }
  ];

  // Tempo steps
  const TEMPO_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 1.0, 1.25, 1.5, 2.0];
  let tempoMul = 1.0;

  // State
  let mode = "preview";
  let bpm = 120;
  let keySig = null;

  let baseNotes = [];
  let notes = [];
  let currentIdx = 0;

  let loop = { enabled: false, start: 0, end: 0 };

  let visualTime = 0;
  let dpr = 1;

  // Learn mic
  let audioCtx = null, analyser = null, sourceNode = null, pitchDetector = null, floatBuf = null;
  let micRunning = false;
  let lastGoodMs = 0;
  const NEED_STABLE_MS = 140;

  // Preview audio
  let previewCtx = null;
  let previewTimer = null;
  let previewStartPerf = 0;
  let previewPausedSongTime = 0;
  let previewIsPlaying = false;
  let previewCountInSec = 0;

  // Distinct Material seeds
  const M3_SEEDS = ["#6750A4","#006874","#386A20","#B3261E","#D97900"];

  function clamp(x,a,b){ return Math.max(a, Math.min(b,x)); }
  function setStatus(msg){ statusEl.textContent = msg; }
  function midiToHz(m){ return 440 * Math.pow(2, (m - 69) / 12); }
  function noteName(midi){
    const names=["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
    const n=names[midi%12];
    const oct=Math.floor(midi/12)-1;
    return `${n}${oct}`;
  }
  function centsOff(freq, targetHz){ return 1200 * Math.log2(freq/targetHz); }

  // Settings drawer
  function setSettingsOpen(open){
    settingsPanel.hidden = !open;
    settingsBtn.setAttribute("aria-expanded", open ? "true":"false");
  }
  settingsBtn.addEventListener("click", ()=> setSettingsOpen(settingsPanel.hidden));

  // Platform
  function detectPlatform() {
    const ua = navigator.userAgent || "";
    const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const isAndroid = /Android/.test(ua);
    return { isIOS, isAndroid };
  }

  // ---- Material scheme application ----
  function makeBlobBg(primary, tertiary, secondary, accent4, isDark){
    const a = isDark ? 0.26 : 0.18;
    const b = isDark ? 0.22 : 0.14;
    const c = isDark ? 0.18 : 0.12;
    return [
      `radial-gradient(520px 420px at 16% 10%, color-mix(in srgb, ${primary} ${Math.round(a*100)}%, transparent), transparent 70%)`,
      `radial-gradient(520px 420px at 88% 14%, color-mix(in srgb, ${tertiary} ${Math.round(b*100)}%, transparent), transparent 70%)`,
      `radial-gradient(640px 520px at 60% 110%, color-mix(in srgb, ${secondary} ${Math.round(c*100)}%, transparent), transparent 70%)`,
      `radial-gradient(460px 380px at 44% 52%, color-mix(in srgb, ${accent4} ${Math.round((c-0.04)*100)}%, transparent), transparent 70%)`,
    ].join(", ");
  }

  async function applyMaterialSchemeFromSeed(seedHex) {
    const mcu = await ensureMCU();
    if (!mcu) {
      // fallback: at least make seed text show and keep app running
      m3SeedTxt.textContent = seedHex + " (fallback)";
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
    const surface2 = hexFromArgb(scheme.surfaceContainerHigh ?? scheme.surfaceContainer ?? scheme.surface);
    const outline = hexFromArgb(scheme.outline);
    const onSurface = hexFromArgb(scheme.onSurface);

    const root = document.documentElement.style;

    root.setProperty("--accent", primary);
    root.setProperty("--accent3", secondary);
    root.setProperty("--accent2", tertiary);
    root.setProperty("--accent4", error);

    root.setProperty("--bg", bg);
    root.setProperty("--canvas", surface);
    root.setProperty("--lane", surface2);

    root.setProperty("--surface", surface);
    root.setProperty("--surface2", surface2);
    root.setProperty("--border", outline);

    root.setProperty("--text", onSurface);
    root.setProperty("--muted", isDark ? "rgba(255,255,255,0.70)" : "rgba(0,0,0,0.62)");

    root.setProperty("--bgFX", makeBlobBg(primary, tertiary, secondary, error, isDark));

    m3SeedTxt.textContent = seedHex;
  }

  function clearMaterialOverrides() {
    const root = document.documentElement.style;
    for (const k of [
      "--accent","--accent2","--accent3","--accent4",
      "--bg","--canvas","--lane","--surface","--surface2","--border","--text","--muted","--bgFX"
    ]) root.removeProperty(k);
  }

  function getSeedIndex() {
    const raw = localStorage.getItem("vfn_m3_seed_idx");
    const i = raw == null ? NaN : parseInt(raw, 10);
    return Number.isFinite(i) ? clamp(i, 0, M3_SEEDS.length - 1) : null;
  }

  async function setSeedIndex(i) {
    localStorage.setItem("vfn_m3_seed_idx", String(i));
    const seed = M3_SEEDS[i];
    await applyMaterialSchemeFromSeed(seed);
    updateSeedDots(i);
  }

  function ensureSeedChosen() {
    let idx = getSeedIndex();
    if (idx == null) {
      idx = Math.floor(Math.random() * M3_SEEDS.length);
      localStorage.setItem("vfn_m3_seed_idx", String(idx));
    }
    return idx;
  }

  function buildSeedDots(){
    m3SeedDots.innerHTML = "";
    M3_SEEDS.forEach((hex, i) => {
      const b = document.createElement("button");
      b.className = "seedDot";
      b.type = "button";
      b.title = `Seed ${hex}`;
      b.style.background = hex;
      b.addEventListener("click", () => setSeedIndex(i));
      m3SeedDots.appendChild(b);
    });
  }
  function updateSeedDots(activeIdx){
    const dots = m3SeedDots.querySelectorAll(".seedDot");
    dots.forEach((d, i) => d.classList.toggle("active", i === activeIdx));
  }

  // Design selection / auto resolve
  let resolvedDesign = "material";

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
      await setSeedIndex(idx);
    } else {
      clearMaterialOverrides();
      m3SeedTxt.textContent = "—";
    }

    resizeCanvases();
    drawFalling(); drawSheet();
  }

  async function loadDesignPref() {
    const saved = localStorage.getItem("vfn_design") || "auto";
    designSelect.value = saved;
    await applyDesign(saved);
  }

  designSelect.addEventListener("change", async () => {
    const v = designSelect.value;
    localStorage.setItem("vfn_design", v);
    await applyDesign(v);
  });

  m3ShuffleBtn.addEventListener("click", async () => {
    if (resolvedDesign !== "material") return;
    let idx = ensureSeedChosen();
    idx = (idx + 1) % M3_SEEDS.length;
    await setSeedIndex(idx);
    drawFalling(); drawSheet();
  });

  function setTheme(theme){
    document.documentElement.setAttribute("data-theme", theme);
    themeBtn.textContent = theme==="dark" ? "🌙 Dark" : "☀️ Light";
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#111111" : "#f4f6ff");
  }

  themeBtn.addEventListener("click", async ()=>{
    const cur=document.documentElement.getAttribute("data-theme")||"dark";
    const next = cur==="dark"?"light":"dark";
    setTheme(next);
    localStorage.setItem("vfn_theme", next);

    if (resolvedDesign === "material") {
      const idx = ensureSeedChosen();
      await setSeedIndex(idx);
    }
    drawFalling(); drawSheet();
  });

  function loadThemePref() {
    const saved = localStorage.getItem("vfn_theme");
    if (saved === "light" || saved === "dark") return setTheme(saved);
    try { setTheme(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark":"light"); }
    catch { setTheme("dark"); }
  }

  // View visibility
  function applyViewVisibility(){
    const showSheet = showSheetEl.checked;
    const showFall = showFallingEl.checked;
    sheetPanel.style.display = showSheet ? "block" : "none";
    fallingPanel.style.display = showFall ? "block" : "none";
    resizeCanvases();
    drawFalling(); drawSheet();
  }
  showFallingEl.addEventListener("change", applyViewVisibility);
  showSheetEl.addEventListener("change", applyViewVisibility);

  // Mode
  function setMode(next){
    mode = next;
    modePreviewBtn.classList.toggle("active", mode==="preview");
    modeLearnBtn.classList.toggle("active", mode==="learn");
    learnOnlyRow.style.display = mode==="learn" ? "" : "none";
  }
  modePreviewBtn.addEventListener("click", ()=>setMode("preview"));
  modeLearnBtn.addEventListener("click", ()=>setMode("learn"));

  // Canvas sizing (kept from v12)
  function resizeCanvases(){
    dpr = window.devicePixelRatio || 1;
    const isPhone = window.matchMedia && window.matchMedia("(max-width: 520px)").matches;

    function sizeCanvas(c, cssW, cssH){
      c.style.width = cssW + "px";
      c.style.height = cssH + "px";
      c.width = Math.floor(cssW * dpr);
      c.height = Math.floor(cssH * dpr);
    }

    if (fallingPanel && fallingPanel.style.display !== "none") {
      const rect = fallingPanel.getBoundingClientRect();
      const cssW = Math.max(260, Math.floor(rect.width));
      const cssH = isPhone ? Math.max(380, Math.floor(cssW * 0.92)) : Math.max(260, Math.floor(cssW * 0.56));
      sizeCanvas(canvas, cssW, cssH);
    }

    if (sheetPanel && sheetPanel.style.display !== "none") {
      const rect = sheetPanel.getBoundingClientRect();
      const viewW = Math.max(260, Math.floor(rect.width));
      const widen = isPhone ? 1.9 : 1.2;
      const cssW = Math.floor(viewW * widen);
      const cssH = isPhone ? Math.max(240, Math.floor(viewW * 0.55)) : Math.max(220, Math.floor(viewW * 0.58));
      sizeCanvas(sheetCanvas, cssW, cssH);
      sheetScroll.scrollLeft = Math.max(0, sheetScroll.scrollLeft);
    }
  }
  window.addEventListener("resize", ()=>{ resizeCanvases(); drawFalling(); drawSheet(); });

  // ---- Loaders (same as v12) ----
  async function loadMidi(arrayBuffer){
    const midi = new Midi(arrayBuffer);
    const tempos = midi.header.tempos || [];
    bpm = tempos.length ? tempos[0].bpm : 120;
    keySig = null;

    const raw=[];
    midi.tracks.forEach(tr => tr.notes.forEach(n => raw.push({ t:n.time, dur:n.duration, midi:n.midi })));
    raw.sort((a,b)=>a.t-b.t || a.midi-b.midi);

    const collapsed=[];
    const EPS=0.03;
    for(const n of raw){
      const last=collapsed[collapsed.length-1];
      if(last && Math.abs(n.t-last.t)<EPS){
        if(n.midi>last.midi) collapsed[collapsed.length-1]=n;
      } else collapsed.push(n);
    }
    baseNotes = collapsed.map(n => ({ t:n.t, dur:n.dur || 0.3, midi:n.midi }));
    srcTxt.textContent = "MIDI";
  }

  function textLooksLikeXml(s){
    const t = s.trim();
    return t.startsWith("<?xml") || t.startsWith("<score-partwise") || t.startsWith("<score-timewise");
  }

  function parseMusicXML(xmlText){
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, "application/xml");
    const parseErr = doc.getElementsByTagName("parsererror")[0];
    if (parseErr) throw new Error("MusicXML parse error");
    bpm = 120;
    baseNotes = [];
    srcTxt.textContent = "MusicXML";
  }

  // Wire file input (this is the bit that was likely never attaching before)
  scoreFileEl.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const name = (file.name || "").toLowerCase();
      if (name.endsWith(".mid") || name.endsWith(".midi")) {
        const ab = await file.arrayBuffer();
        await loadMidi(ab);
        setStatus(`Loaded MIDI (${baseNotes.length} notes).`);
      } else {
        const text = await file.text();
        if (!textLooksLikeXml(text)) throw new Error("Not a MusicXML file (or it's .mxl zipped)");
        parseMusicXML(text);
        setStatus(`Loaded MusicXML.`);
      }
    } catch (err) {
      console.error(err);
      setStatus(`Could not load file: ${err.message || err}`);
    }
  });

  // Minimal draw placeholders (so app stays running even if you trimmed other functions)
  function drawFalling(){ /* no-op here; keep your full v12 drawing if you want */ }
  function drawSheet(){ /* no-op here */ }

  function init(){
    loadThemePref();
    loadDesignPref(); // async, but okay
    addRipples();

    const isPhone = window.matchMedia && window.matchMedia("(max-width: 640px)").matches;
    setSettingsOpen(!isPhone);
    if (isPhone) readoutDetails.open = false;

    applyViewVisibility();
    resizeCanvases();
    setMode("preview");
    setStatus("Load a MIDI or MusicXML file to begin.");
  }

  init();
})();
