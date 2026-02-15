/* global Midi, pitchy */

(() => {
  const $ = (id) => document.getElementById(id);
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const isFiniteNumber = (x) => Number.isFinite(x) && !Number.isNaN(x);

  // SW
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});

  // UI
  const scoreFileEl = $("scoreFile");
  const statusEl = $("status");
  const srcTxt = $("srcTxt");
  const keyTxt = $("keyTxt");

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

  const canvas = $("canvas");
  const sheetCanvas = $("sheetCanvas");
  const sheetScroll = $("sheetScroll");
  const ctx = canvas.getContext("2d");
  const sctx = sheetCanvas.getContext("2d");

  const sheetPanel = $("sheetPanel");
  const fallingPanel = $("fallingPanel");

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
        ink.addEventListener("animationend", () => ink.remove(), { once:true });
      }, { passive:true });
    }
  }

  // Platform
  function detectPlatform() {
    const ua = navigator.userAgent || "";
    const isIOS =
      /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const isAndroid = /Android/.test(ua);
    return { isIOS, isAndroid };
  }

  // ---------------------------
  // Themes / Design (Material via dynamic import)
  // ---------------------------
  let resolvedDesign = "auto";
  const M3_SEEDS = ["#6750A4", "#006874", "#386A20", "#B3261E", "#D97900"];

  let MCU = null;
  async function ensureMCU() {
    if (MCU) return MCU;
    try {
      MCU = await import("https://cdn.jsdelivr.net/npm/@material/material-color-utilities@0.4.0/index.js");
      return MCU;
    } catch (e) {
      console.warn("Material color utilities failed to load; Material scheme will fallback.", e);
      MCU = null;
      return null;
    }
  }

  function setTheme(theme){
    document.documentElement.setAttribute("data-theme", theme);
    themeBtn.textContent = theme === "dark" ? "🌙 Dark" : "☀️ Light";
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#111111" : "#f7f8ff");
  }

  function loadThemePref(){
    const saved = localStorage.getItem("vfn_theme");
    if (saved === "dark" || saved === "light") setTheme(saved);
    else {
      try { setTheme(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark":"light"); }
      catch { setTheme("dark"); }
    }
  }

  function makeBlobBg(primary, tertiary, secondary, accent4, isDark){
    const a = isDark ? 0.22 : 0.16; // medium color (Option B)
    const b = isDark ? 0.18 : 0.12;
    const c = isDark ? 0.14 : 0.10;
    return [
      `radial-gradient(520px 420px at 16% 10%, color-mix(in srgb, ${primary} ${Math.round(a*100)}%, transparent), transparent 70%)`,
      `radial-gradient(520px 420px at 88% 14%, color-mix(in srgb, ${tertiary} ${Math.round(b*100)}%, transparent), transparent 70%)`,
      `radial-gradient(640px 520px at 60% 110%, color-mix(in srgb, ${secondary} ${Math.round(c*100)}%, transparent), transparent 70%)`,
      `radial-gradient(460px 380px at 44% 52%, color-mix(in srgb, ${accent4} ${Math.round((c-0.03)*100)}%, transparent), transparent 70%)`,
    ].join(", ");
  }

  async function applyMaterialSchemeFromSeed(seedHex){
    // IMPORTANT: these vars drive the whole UI (buttons & notes).
    const mcu = await ensureMCU();
    const root = document.documentElement.style;

    if (!mcu){
      // fallback: still set accent to seed so it visibly changes
      root.setProperty("--accent", seedHex);
      m3SeedTxt.textContent = `${seedHex} (fallback)`;
      return;
    }

    const { argbFromHex, hexFromArgb, themeFromSourceColor } = mcu;
    const theme = themeFromSourceColor(argbFromHex(seedHex));
    const isDark = (document.documentElement.getAttribute("data-theme") || "dark") === "dark";
    const scheme = isDark ? theme.schemes.dark : theme.schemes.light;

    const primary   = hexFromArgb(scheme.primary);
    const secondary = hexFromArgb(scheme.secondary);
    const tertiary  = hexFromArgb(scheme.tertiary);
    const error     = hexFromArgb(scheme.error);

    // Medium-tint surfaces (Material-y but not neon)
    const bg       = hexFromArgb(scheme.background);
    const surface  = hexFromArgb(scheme.surface);
    const lane     = hexFromArgb(scheme.surfaceContainerHigh ?? scheme.surfaceContainer ?? scheme.surface);
    const outline  = hexFromArgb(scheme.outline);
    const onSurface= hexFromArgb(scheme.onSurface);

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

  function getSeedIndex(){
    const raw = localStorage.getItem("vfn_m3_seed_idx");
    const i = raw == null ? NaN : parseInt(raw, 10);
    return Number.isFinite(i) ? clamp(i, 0, M3_SEEDS.length - 1) : null;
  }

  function ensureSeedChosen(){
    let idx = getSeedIndex();
    if (idx == null){
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
      b.addEventListener("click", async () => {
        await setSeedIndex(i);
        drawAll(true);
      });
      m3SeedDots.appendChild(b);
    });
  }

  function updateSeedDots(activeIdx){
    const dots = m3SeedDots.querySelectorAll(".seedDot");
    dots.forEach((d, i) => d.classList.toggle("active", i === activeIdx));
  }

  async function setSeedIndex(i){
    localStorage.setItem("vfn_m3_seed_idx", String(i));
    await applyMaterialSchemeFromSeed(M3_SEEDS[i]);
    updateSeedDots(i);

    // force paint: sometimes Safari needs a tick after CSS var changes
    document.body.offsetHeight; // reflow nudge
  }

  async function applyDesign(design){
    const plat = detectPlatform();
    resolvedDesign = design;
    if (design === "auto") resolvedDesign = plat.isIOS ? "liquid" : "material";
    document.documentElement.setAttribute("data-design", resolvedDesign);

    const showM3 = resolvedDesign === "material";
    m3SeedControls.hidden = !showM3;
    m3SeedLine.style.display = showM3 ? "" : "none";

    if (showM3){
      buildSeedDots();
      const idx = ensureSeedChosen();
      await setSeedIndex(idx);
    } else {
      m3SeedTxt.textContent = "—";
    }

    resizeCanvases();
    drawAll(true);
  }

  async function loadDesignPref(){
    const saved = localStorage.getItem("vfn_design") || "auto";
    designSelect.value = saved;
    await applyDesign(saved);
  }

  themeBtn.addEventListener("click", async () => {
    const cur = document.documentElement.getAttribute("data-theme") || "dark";
    const next = cur === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("vfn_theme", next);

    if (resolvedDesign === "material"){
      const idx = ensureSeedChosen();
      await setSeedIndex(idx);
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

  // Settings drawer
  function setSettingsOpen(open){
    settingsPanel.hidden = !open;
    settingsBtn.setAttribute("aria-expanded", open ? "true" : "false");
  }
  settingsBtn.addEventListener("click", () => setSettingsOpen(settingsPanel.hidden));

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
  let visualTime = 0;

  let loop = { enabled:false, start:0, end:0 };

  let dpr = 1;

  function setStatus(msg){ statusEl.textContent = msg; }
  function midiToHz(m){ return 440 * Math.pow(2, (m - 69) / 12); }
  function noteName(midi){
    const names=["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
    const n=names[midi%12];
    const oct=Math.floor(midi/12)-1;
    return `${n}${oct}`;
  }
  function centsOff(freq, targetHz){ return 1200 * Math.log2(freq/targetHz); }

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
  function keyNameFromSig(sig){
    if (!sig) return "—";
    return KEY_NAMES[`${sig.sf},${sig.mi}`] || `sf=${sig.sf} ${sig.mi ? "minor":"major"}`;
  }

  function chooseStringIndex(midi, prevStringIndex=null){
    const cand=[];
    for (let i=0;i<STRINGS.length;i++){
      const semi=midi-STRINGS[i].open;
      if (semi>=0 && semi<=7) cand.push({i,semi});
    }
    if (!cand.length) return null;
    cand.sort((a,b)=>{
      const aStay = prevStringIndex===a.i ? -0.2 : 0;
      const bStay = prevStringIndex===b.i ? -0.2 : 0;
      return (a.semi+aStay)-(b.semi+bStay);
    });
    return cand[0].i;
  }
  function fingerTextForSemi(semi){
    if (semi<=0) return "0";
    const map={1:"1L",2:"1",3:"2L",4:"2",5:"3",6:"4L",7:"4"};
    return map[semi] || "";
  }

  function laneLabel(n){
    if (!n) return "—";
    const lane = n.stringIndex==null ? "?" : STRINGS[n.stringIndex].name;
    return `${n.label} (${lane} string, ${n.fingerText})`;
  }
  function updateTargetReadout(){
    const n=notes[currentIdx];
    targetTxt.textContent = n ? laneLabel(n) : "Done!";
  }
  function updateLoopReadout(){
    if (!loop.enabled) loopRead.textContent = "Loop: off";
    else loopRead.textContent = `Loop: ${loop.start+1} → ${loop.end+1}`;
  }

  function enableControls(on){
    previewPlayBtn.disabled = !on;
    previewPauseBtn.disabled = !on;
    previewStopBtn.disabled = !on;
    testSoundBtn.disabled = !on;
    startMicBtn.disabled = !on;

    tempoDownBtn.disabled = !on;
    tempoUpBtn.disabled = !on;

    loopStartBtn.disabled = !on;
    loopEndBtn.disabled = !on;
    loopClearBtn.disabled = !on;
  }

  function closestTempoIndex(x){
    let best=0, bestd=Infinity;
    for (let i=0;i<TEMPO_STEPS.length;i++){
      const d=Math.abs(TEMPO_STEPS[i]-x);
      if (d<bestd){ bestd=d; best=i; }
    }
    return best;
  }
  function setTempoMul(next){
    tempoMul = next;
    tempoVal.textContent = `${tempoMul.toFixed(2)}×`;
    if (baseNotes.length) rebuildNotesFromBase();
  }
  tempoDownBtn.addEventListener("click", ()=>{
    const i=closestTempoIndex(tempoMul);
    setTempoMul(TEMPO_STEPS[Math.max(0,i-1)]);
  });
  tempoUpBtn.addEventListener("click", ()=>{
    const i=closestTempoIndex(tempoMul);
    setTempoMul(TEMPO_STEPS[Math.min(TEMPO_STEPS.length-1,i+1)]);
  });

  // Views
  function applyViewVisibility(){
    const showSheet = showSheetEl.checked;
    const showFall = showFallingEl.checked;
    sheetPanel.style.display = showSheet ? "block":"none";
    fallingPanel.style.display = showFall ? "block":"none";
    resizeCanvases();
    drawAll(true);
  }
  showFallingEl.addEventListener("change", applyViewVisibility);
  showSheetEl.addEventListener("change", applyViewVisibility);

  // Mode
  function setMode(next){
    mode = next;
    modePreviewBtn.classList.toggle("active", mode==="preview");
    modeLearnBtn.classList.toggle("active", mode==="learn");
    learnOnlyRow.style.display = mode==="learn" ? "" : "none";

    startMicBtn.style.display = mode==="learn" ? "" : "none";
    previewPlayBtn.style.display = mode==="preview" ? "" : "none";
    previewPauseBtn.style.display = mode==="preview" ? "" : "none";
    previewStopBtn.style.display = mode==="preview" ? "" : "none";
    testSoundBtn.style.display = mode==="preview" ? "" : "none";

    stopPreview(true);
    stopMic();

    if (notes.length){
      setStatus(mode==="preview"
        ? "Preview: Play to listen. If silent: Test + iPhone silent switch/volume/Bluetooth."
        : "Learn: Start Mic, then play the target note to advance.");
    }
  }
  modePreviewBtn.addEventListener("click", ()=>setMode("preview"));
  modeLearnBtn.addEventListener("click", ()=>setMode("learn"));

  // Canvas sizing
  function resizeCanvases(){
    dpr = window.devicePixelRatio || 1;
    const isPhone = window.matchMedia && window.matchMedia("(max-width: 520px)").matches;

    const sizeCanvas=(c, cssW, cssH)=>{
      c.style.width = cssW + "px";
      c.style.height = cssH + "px";
      c.width = Math.floor(cssW * dpr);
      c.height = Math.floor(cssH * dpr);
    };

    if (fallingPanel && fallingPanel.style.display !== "none"){
      const rect = fallingPanel.getBoundingClientRect();
      const cssW = Math.max(260, Math.floor(rect.width));
      const cssH = isPhone ? Math.max(520, Math.floor(cssW * 1.08)) : Math.max(340, Math.floor(cssW * 0.62));
      sizeCanvas(canvas, cssW, cssH);
    }

    if (sheetPanel && sheetPanel.style.display !== "none"){
      const rect = sheetPanel.getBoundingClientRect();
      const cssW = Math.max(260, Math.floor(rect.width));
      const cssH = isPhone ? Math.max(520, Math.floor(cssW * 1.05)) : Math.max(420, Math.floor(cssW * 0.72));
      sizeCanvas(sheetCanvas, cssW, cssH);
    }
  }
  window.addEventListener("resize", ()=>{ resizeCanvases(); drawAll(true); });

  function cssVar(name, fallback){
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }
  function cssVars(){
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

  // Notes rebuild
  function rebuildNotesFromBase(){
    stopPreview(true);
    stopMic();

    notes = [];
    let prevString=null;

    for (const n of baseNotes){
      const t = n.t / tempoMul;
      const dur = (n.dur || 0.3) / tempoMul;

      const sIdx = chooseStringIndex(n.midi, prevString);
      prevString = sIdx ?? prevString;

      const semi = sIdx==null ? null : n.midi - STRINGS[sIdx].open;
      const fingerText = semi==null ? "?" : fingerTextForSemi(semi);

      notes.push({
        t, dur,
        midi:n.midi,
        hz:midiToHz(n.midi),
        stringIndex:sIdx,
        label:noteName(n.midi),
        fingerText,
      });
    }

    currentIdx = clamp(currentIdx, 0, Math.max(0, notes.length-1));
    visualTime = notes[currentIdx]?.t ?? 0;

    updateTargetReadout();
    updateLoopReadout();

    drawAll(true);
    enableControls(true);
  }

  function loopTimes(){
    if (!loop.enabled || !notes.length) return null;
    const tStart = notes[loop.start]?.t ?? 0;
    const endNote = notes[loop.end];
    const tEnd = (endNote?.t ?? 0) + (endNote?.dur ?? 0.2);
    return { tStart, tEnd };
  }

  loopStartBtn.addEventListener("click", ()=>{
    loop.start = currentIdx;
    loop.end = Math.max(loop.end, loop.start);
    loop.enabled = true;
    updateLoopReadout();
  });
  loopEndBtn.addEventListener("click", ()=>{
    loop.end = currentIdx;
    loop.start = Math.min(loop.start, loop.end);
    loop.enabled = true;
    updateLoopReadout();
  });
  loopClearBtn.addEventListener("click", ()=>{
    loop.enabled = false;
    updateLoopReadout();
  });

  // ---------------------------
  // MIDI + MusicXML
  // ---------------------------
  async function loadMidi(arrayBuffer){
    const midi = new Midi(arrayBuffer);
    const tempos = midi.header.tempos || [];
    bpm = tempos.length ? tempos[0].bpm : 120;

    keySig = null;
    const ks = midi.header.keySignatures || [];
    if (ks.length){
      const first = ks[0];
      if (typeof first.sf==="number" && typeof first.mi==="number") keySig={sf:first.sf, mi:first.mi};
    }

    const raw=[];
    midi.tracks.forEach(tr => tr.notes.forEach(n => raw.push({t:n.time, dur:n.duration, midi:n.midi})));
    raw.sort((a,b)=>a.t-b.t || a.midi-b.midi);

    // collapse chords to highest pitch (for piano MIDI)
    const collapsed=[];
    const EPS=0.03;
    for (const n of raw){
      const last=collapsed[collapsed.length-1];
      if (last && Math.abs(n.t-last.t)<EPS){
        if (n.midi>last.midi) collapsed[collapsed.length-1]=n;
      } else collapsed.push(n);
    }

    baseNotes = collapsed.map(n => ({t:n.t, dur:n.dur||0.3, midi:n.midi}));
    srcTxt.textContent = "MIDI";
  }

  function textLooksLikeXml(s){
    const t=s.trim();
    return t.startsWith("<?xml") || t.startsWith("<score-partwise") || t.startsWith("<score-timewise");
  }

  function pitchToMidi(step, alter, octave){
    const base={C:0,D:2,E:4,F:5,G:7,A:9,B:11}[step];
    if (base==null || !isFiniteNumber(octave)) return null;
    return (octave+1)*12 + base + (alter||0);
  }

  function parseMusicXML(xmlText){
    const parser=new DOMParser();
    const doc=parser.parseFromString(xmlText,"application/xml");
    const parseErr = doc.getElementsByTagName("parsererror")[0];
    if (parseErr) throw new Error("MusicXML parse error");

    bpm=120;
    const sound=doc.querySelector("sound[tempo]");
    if (sound){
      const v=parseFloat(sound.getAttribute("tempo"));
      if (isFiniteNumber(v)&&v>10&&v<400) bpm=v;
    } else {
      const pm=doc.querySelector("per-minute");
      if (pm){
        const v=parseFloat(pm.textContent);
        if (isFiniteNumber(v)&&v>10&&v<400) bpm=v;
      }
    }

    keySig=null;
    const fifths=doc.querySelector("key > fifths");
    if (fifths){
      const sf=parseInt(fifths.textContent,10);
      const modeEl=doc.querySelector("key > mode");
      const modeTxt=modeEl?(modeEl.textContent||"").toLowerCase():"major";
      const mi=modeTxt.includes("minor")?1:0;
      if (isFiniteNumber(sf)) keySig={sf,mi};
    }

    const parts=Array.from(doc.getElementsByTagName("part"));
    if (!parts.length) throw new Error("No <part> found");

    // prefer violin part if present
    let chosen=parts[0];
    const partList=Array.from(doc.querySelectorAll("part-list score-part"));
    const idToName=new Map();
    for (const sp of partList){
      const id=sp.getAttribute("id")||"";
      const nm=(sp.querySelector("part-name")?.textContent||"").toLowerCase();
      idToName.set(id,nm);
    }
    for (const p of parts){
      const id=p.getAttribute("id")||"";
      const nm=idToName.get(id)||"";
      if (nm.includes("violin")){ chosen=p; break; }
    }

    let divisions=1;
    let curSec=0;
    let lastStartSec=0;
    const spq=60/bpm;
    const out=[];

    const measures=Array.from(chosen.getElementsByTagName("measure"));
    for (const meas of measures){
      const divEl=meas.querySelector("attributes > divisions");
      if (divEl){
        const v=parseInt(divEl.textContent,10);
        if (isFiniteNumber(v)&&v>0) divisions=v;
      }

      const noteEls=Array.from(meas.getElementsByTagName("note"));
      for (const n of noteEls){
        const isRest=!!n.querySelector("rest");
        const chord=!!n.querySelector("chord");

        const durEl=n.querySelector("duration");
        const durDiv=durEl?parseInt(durEl.textContent,10):0;
        const quarterLen=divisions>0?durDiv/divisions:0;
        const durSec=Math.max(0.04, quarterLen*spq);

        const startSec=chord?lastStartSec:curSec;

        if (!isRest){
          const step=n.querySelector("pitch > step")?.textContent;
          const octave=n.querySelector("pitch > octave")?.textContent;
          if (step && octave){
            const alter=parseInt(n.querySelector("pitch > alter")?.textContent||"0",10)||0;
            const midi=pitchToMidi(step.trim(), alter, parseInt(octave,10));
            if (midi!=null) out.push({t:startSec, dur:durSec, midi});
          }
        }

        if (!chord){
          lastStartSec=startSec;
          curSec += durSec;
        } else {
          lastStartSec=startSec;
        }
      }
    }

    out.sort((a,b)=>a.t-b.t || a.midi-b.midi);

    const collapsed=[];
    const EPS=0.02;
    for (const n of out){
      const last=collapsed[collapsed.length-1];
      if (last && Math.abs(n.t-last.t)<EPS){
        if (n.midi>last.midi) collapsed[collapsed.length-1]=n;
      } else collapsed.push(n);
    }

    baseNotes = collapsed.map(n=>({t:n.t, dur:n.dur||0.3, midi:n.midi}));
    srcTxt.textContent="MusicXML";
  }

  scoreFileEl.addEventListener("change", async (e)=>{
    const file=e.target.files?.[0];
    if (!file) return;
    try{
      enableControls(false);
      stopPreview(true);
      stopMic();

      const name=(file.name||"").toLowerCase();
      if (name.endsWith(".mid")||name.endsWith(".midi")){
        const ab=await file.arrayBuffer();
        await loadMidi(ab);
      } else {
        const text=await file.text();
        if (!textLooksLikeXml(text)) throw new Error("Not MusicXML (.mxl zipped not supported yet)");
        parseMusicXML(text);
      }

      keyTxt.textContent = keyNameFromSig(keySig);

      currentIdx=0;
      visualTime=0;
      loop.enabled=false;
      loop.start=0;
      loop.end=Math.max(0, baseNotes.length-1);
      updateLoopReadout();

      rebuildNotesFromBase();
      applyViewVisibility();
      setMode(mode);
      resizeCanvases();

      setStatus(`Loaded ${notes.length} notes from ${srcTxt.textContent}. BPM≈${Math.round(bpm)}.`);
    } catch(err){
      console.error(err);
      setStatus(`Could not load file: ${err.message||err}`);
      srcTxt.textContent="—";
      keyTxt.textContent="—";
      baseNotes=[]; notes=[];
      enableControls(false);
      drawAll(true);
    }
  });

  // ---------------------------
  // Preview audio (violin-ish synth)
  // ---------------------------
  let previewCtx=null, previewTimer=null, previewStartPerf=0, previewPausedSongTime=0, previewIsPlaying=false, previewCountInSec=0;

  function ensurePreviewCtx(){
    if (!previewCtx) previewCtx = new (window.AudioContext || window.webkitAudioContext)();
    previewCtx.resume?.();
  }

  function playClick(atTime){
    const o=previewCtx.createOscillator();
    const g=previewCtx.createGain();
    const f=previewCtx.createBiquadFilter();
    o.type="square";
    o.frequency.value=1600;
    f.type="highpass";
    f.frequency.setValueAtTime(800, atTime);

    g.gain.setValueAtTime(0.0001, atTime);
    g.gain.exponentialRampToValueAtTime(0.25, atTime+0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, atTime+0.05);

    o.connect(f); f.connect(g); g.connect(previewCtx.destination);
    o.start(atTime); o.stop(atTime+0.06);
  }

  function playViolinSynth(freq, atTime, dur){
    const t0=atTime;
    const t1=atTime + Math.max(0.10, dur);

    const g=previewCtx.createGain();
    const f=previewCtx.createBiquadFilter();
    const comp=previewCtx.createDynamicsCompressor();

    f.type="lowpass";
    f.frequency.setValueAtTime(Math.min(9000, Math.max(1400, freq*6)), t0);
    f.Q.setValueAtTime(0.85, t0);

    const attack=0.05, release=0.10, sustain=0.22;

    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(sustain, t0+attack);
    g.gain.setValueAtTime(sustain, Math.max(t0+attack, t1-release));
    g.gain.exponentialRampToValueAtTime(0.0001, t1);

    const o1=previewCtx.createOscillator();
    const o2=previewCtx.createOscillator();
    o1.type="sawtooth"; o2.type="sawtooth";
    o1.frequency.setValueAtTime(freq, t0);
    o2.frequency.setValueAtTime(freq, t0);
    o1.detune.setValueAtTime(-7, t0);
    o2.detune.setValueAtTime(+7, t0);

    const lfo=previewCtx.createOscillator();
    const lfoGain=previewCtx.createGain();
    lfo.type="sine";
    lfo.frequency.setValueAtTime(5.5, t0);
    lfoGain.gain.setValueAtTime(12, t0);
    lfo.connect(lfoGain);
    lfoGain.connect(o1.detune);
    lfoGain.connect(o2.detune);

    o1.connect(f); o2.connect(f);
    f.connect(comp); comp.connect(g); g.connect(previewCtx.destination);

    lfo.start(t0); o1.start(t0); o2.start(t0);

    const stopTime=t1+0.02;
    o1.stop(stopTime); o2.stop(stopTime); lfo.stop(stopTime);
  }

  testSoundBtn.addEventListener("click", ()=>{
    ensurePreviewCtx();
    const t=previewCtx.currentTime+0.06;
    playViolinSynth(440,t,0.28);
    playViolinSynth(659.25,t+0.32,0.28);
    playViolinSynth(880,t+0.64,0.28);
    setStatus("Test sound played. If silent: iPhone silent switch/volume/Bluetooth.");
  });

  function startPreview(){
    if (!notes.length) return;
    stopMic();
    ensurePreviewCtx();

    previewIsPlaying=true;
    previewPlayBtn.disabled=true;

    const spb=60/bpm;
    const countInBeats=clamp(parseInt(countInEl.value||"0",10),0,8);
    previewCountInSec=countInBeats*spb;

    const now=previewCtx.currentTime;

    for (let i=0;i<countInBeats;i++) playClick(now + i*spb);

    const startSongTime=previewPausedSongTime||0;

    for (const n of notes){
      if (n.t < startSongTime) continue;
      const at = now + previewCountInSec + (n.t - startSongTime);
      playViolinSynth(n.hz, at, clamp(n.dur, 0.10, 1.4));
    }

    if (metroOnEl.checked){
      const endSong=(notes[notes.length-1]?.t??0)+1.0;
      const total=previewCountInSec+Math.max(0,endSong-startSongTime)+1.0;
      const beats=Math.ceil(total/spb);
      for (let i=0;i<beats;i++) playClick(now+i*spb);
    }

    previewStartPerf=performance.now();

    if (previewTimer) clearInterval(previewTimer);
    previewTimer=setInterval(()=>{
      const elapsed=(performance.now()-previewStartPerf)/1000;
      const songTime=elapsed - previewCountInSec + (previewPausedSongTime||0);
      visualTime=Math.max(0, songTime);

      if (songTime < 0){ drawAll(false); return; }

      while (currentIdx < notes.length-1 && notes[currentIdx+1].t <= visualTime) currentIdx++;
      updateTargetReadout();

      const lt=loopTimes();
      if (lt && visualTime >= lt.tEnd){
        previewPausedSongTime=lt.tStart;
        currentIdx=loop.start;
        stopPreview(true);
        startPreview();
        return;
      }

      drawAll(false);

      const endTime=(notes[notes.length-1]?.t??0)+1.5;
      if (!lt && visualTime > endTime) stopPreview(false);
    }, 30);

    setStatus(countInBeats ? `Count-in: ${countInBeats}… then playing.` : "Preview playing…");
  }

  function pausePreview(){
    if (!previewIsPlaying) return;
    previewIsPlaying=false;
    previewPlayBtn.disabled=false;

    if (previewTimer) clearInterval(previewTimer);
    previewTimer=null;

    const elapsed=(performance.now()-previewStartPerf)/1000;
    const songTime=elapsed - previewCountInSec + (previewPausedSongTime||0);
    previewPausedSongTime=Math.max(0, songTime);

    if (previewCtx){
      try{ previewCtx.close(); } catch{}
      previewCtx=null;
    }
    setStatus("Preview paused.");
  }

  function stopPreview(silent){
    previewIsPlaying=false;
    previewPlayBtn.disabled=false;

    if (previewTimer) clearInterval(previewTimer);
    previewTimer=null;

    previewPausedSongTime=0;
    if (previewCtx){
      try{ previewCtx.close(); } catch{}
      previewCtx=null;
    }

    currentIdx = loop.enabled ? loop.start : 0;
    visualTime = notes[currentIdx]?.t ?? 0;
    updateTargetReadout();
    drawAll(true);

    if (!silent && notes.length) setStatus("Preview stopped.");
  }

  previewPlayBtn.addEventListener("click", startPreview);
  previewPauseBtn.addEventListener("click", pausePreview);
  previewStopBtn.addEventListener("click", ()=>stopPreview(false));

  // ---------------------------
  // Learn (mic)
  // ---------------------------
  let audioCtx=null, analyser=null, sourceNode=null, pitchDetector=null, floatBuf=null;
  let micRunning=false;
  let lastGoodMs=0;
  const NEED_STABLE_MS=140;

  startMicBtn.addEventListener("click", async ()=>{
    if (!notes.length) return;
    stopPreview(true);

    try{
      audioCtx=new (window.AudioContext||window.webkitAudioContext)();
      const stream=await navigator.mediaDevices.getUserMedia({
        audio:{ echoCancellation:false, noiseSuppression:false, autoGainControl:false }
      });

      sourceNode=audioCtx.createMediaStreamSource(stream);
      analyser=audioCtx.createAnalyser();
      analyser.fftSize=2048;
      sourceNode.connect(analyser);

      floatBuf=new Float32Array(analyser.fftSize);
      pitchDetector=pitchy.PitchDetector.forFloat32Array(analyser.fftSize);

      micRunning=true;
      lastGoodMs=0;
      setStatus("Mic running. Play the target note to advance.");
      requestAnimationFrame(learnLoop);
    } catch(err){
      console.error(err);
      setStatus("Microphone permission denied or unavailable.");
    }
  });

  function stopMic(){
    micRunning=false;
    if (audioCtx){
      try{ audioCtx.close(); } catch{}
    }
    audioCtx=null; analyser=null; sourceNode=null; pitchDetector=null; floatBuf=null;

    heardTxt.textContent="—";
    clarityTxt.textContent="—";
    deltaTxt.textContent="—";
    lastGoodMs=0;
  }

  function learnLoop(){
    if (!micRunning || mode!=="learn") return;

    const current=notes[currentIdx];
    if (current) visualTime=current.t;

    analyser.getFloatTimeDomainData(floatBuf);
    const [pitchHz, clarity] = pitchDetector.findPitch(floatBuf, audioCtx.sampleRate);

    clarityTxt.textContent = clarity ? clarity.toFixed(2) : "—";
    heardTxt.textContent = pitchHz && isFiniteNumber(pitchHz) ? `${pitchHz.toFixed(1)} Hz` : "—";

    if (current && pitchHz && isFiniteNumber(pitchHz) && clarity > 0.86){
      const delta=centsOff(pitchHz, current.hz);
      deltaTxt.textContent=`${delta.toFixed(1)} cents`;

      const tol=clamp(parseFloat(tolCentsEl.value)||35,10,80);
      const ok=Math.abs(delta)<=tol;
      const waitMode=!!waitModeEl.checked;

      if (ok){
        lastGoodMs += 16;
        if (lastGoodMs >= NEED_STABLE_MS){
          if (waitMode) currentIdx++;
          else currentIdx = Math.min(currentIdx+1, notes.length-1);
          lastGoodMs=0;
        }
      } else lastGoodMs=0;

      if (loop.enabled && currentIdx > loop.end) currentIdx = loop.start;
      updateTargetReadout();

      if (currentIdx >= notes.length){
        setStatus("Finished! 🎉");
        stopMic();
      }
    } else {
      deltaTxt.textContent="—";
      lastGoodMs=0;
    }

    drawAll(false);
    requestAnimationFrame(learnLoop);
  }

  // ---------------------------
  // Drawing
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

  // Falling: low density on phone (target + next 2–3 max)
  function fallingWindowCount(){
    const isPhone = window.matchMedia && window.matchMedia("(max-width: 520px)").matches;
    if (isPhone) return 3;         // next 3
    if (window.innerWidth >= 1100) return 7;
    return 5;
  }

  function drawFalling(){
    if (!showFallingEl.checked || fallingPanel.style.display==="none") return;

    const { bg, lane, stroke, text, muted, accent, accent4 } = cssVars();

    ctx.setTransform(dpr,0,0,dpr,0,0);
    const cssW=canvas.width/dpr, cssH=canvas.height/dpr;

    ctx.clearRect(0,0,cssW,cssH);
    ctx.fillStyle=bg; ctx.fillRect(0,0,cssW,cssH);

    const topPad=18, bottomPad=28;
    const lanesY0=topPad, lanesY1=cssH-bottomPad;

    const laneCount=4, laneGap=12;
    const laneW=Math.floor((cssW - laneGap*(laneCount+1))/laneCount);
    const laneX=(i)=>laneGap + i*(laneW+laneGap);

    // lanes
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

    // hit line
    const hitY = lanesY1 - 86;
    ctx.strokeStyle=stroke; ctx.lineWidth=2;
    ctx.globalAlpha=0.9;
    ctx.beginPath(); ctx.moveTo(0, hitY); ctx.lineTo(cssW, hitY); ctx.stroke();
    ctx.globalAlpha=1;

    // Window: current + next N only (reduces overlap massively)
    const ahead = fallingWindowCount();
    const start = Math.max(0, currentIdx - 1);
    const end = Math.min(notes.length - 1, currentIdx + ahead);

    // We place notes by index with minimum vertical separation, not just time
    const minGap = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--fallingMinGap")) || 64;
    const pxPerStep = minGap;

    const baseFont = clamp(cssW * 0.040, 20, 34);
    const fingerFont = clamp(cssW * 0.030, 16, 24);

    for (let i=start;i<=end;i++){
      const n=notes[i];
      const step = i - currentIdx; // 0 = target
      const y = hitY - step * pxPerStep;

      const laneIdx=n.stringIndex;
      const x = laneIdx==null ? laneX(0) : laneX(laneIdx);
      const laneWidth = laneIdx==null ? laneW*4 + laneGap*3 : laneW;

      const isCurrent = i===currentIdx;
      const isPast = i<currentIdx;

      const height = Math.max(44, pxPerStep * 0.62);
      const pad=10;
      const rectX = x + pad;
      const rectW = laneWidth - pad*2;
      const rectY = y - height;
      const rectH = height;

      ctx.globalAlpha = isPast ? 0.18 : isCurrent ? 1 : 0.88;
      ctx.fillStyle = isCurrent ? accent : "#8a8a99";
      if (laneIdx==null) ctx.fillStyle = accent4;

      roundRect(ctx, rectX, rectY, rectW, rectH, 16);
      ctx.fill();

      // text
      ctx.fillStyle = bg;
      ctx.globalAlpha = isPast ? 0.12 : 0.96;
      ctx.font = `900 ${baseFont}px system-ui`;
      ctx.fillText(n.label, rectX + 14, rectY + baseFont + 6);

      // finger badge
      const badge = n.fingerText || "?";
      const bx = rectX + rectW - 66;
      const by = rectY + 10;

      ctx.globalAlpha = isPast ? 0.12 : 0.92;
      ctx.fillStyle = "rgba(0,0,0,0.22)";
      roundRect(ctx, bx, by, 56, 32, 14);
      ctx.fill();

      ctx.fillStyle = bg;
      ctx.font = `900 ${fingerFont}px system-ui`;
      ctx.fillText(badge, bx + 16, by + 23);

      ctx.globalAlpha = 1;
    }

    ctx.fillStyle=muted;
    ctx.font=`700 ${Math.max(12, cssW*0.016)}px system-ui`;
    ctx.fillText("Low-density view on phones: target + a few upcoming notes.", 14, cssH-10);
  }

  // Sheet: page-like layout (no horizontal scroll). We lay notes left→right with minimum spacing.
  function drawSheet(){
    if (!showSheetEl.checked || sheetPanel.style.display==="none") return;

    const { bg, stroke, text, muted, accent } = cssVars();

    sctx.setTransform(dpr,0,0,dpr,0,0);
    const cssW=sheetCanvas.width/dpr, cssH=sheetCanvas.height/dpr;

    sctx.clearRect(0,0,cssW,cssH);
    sctx.fillStyle=bg; sctx.fillRect(0,0,cssW,cssH);

    const pad = 18;
    const left = pad, right = cssW - pad;
    const usableW = right - left;

    const lineGap = clamp(cssH * 0.028, 10, 14);
    const staffGap = clamp(cssH * 0.14, 60, 96);

    // multiple systems vertically
    const systemHeight = staffGap + 10 * lineGap; // treble + bass + spacing
    const systemsThatFit = Math.max(1, Math.floor((cssH - 2*pad) / systemHeight));

    // spacing settings
    const minSpacing = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sheetMinSpacing")) || 58;
    const xPerNote = minSpacing; // fixed spacing per note for readability
    const notesPerSystem = Math.max(4, Math.floor(usableW / xPerNote));

    // total systems needed
    const totalSystems = notes.length ? Math.ceil(notes.length / notesPerSystem) : 1;

    // If we need more vertical space, expand canvas height (so scroll becomes useful)
    // (But only when sheet is visible; avoid infinite growth)
    const desiredH = Math.max(cssH, pad*2 + totalSystems * systemHeight);
    if (Math.abs(desiredH - cssH) > 2){
      // resize canvas once; subsequent draw will use correct cssH
      const newCssH = Math.min(desiredH, 2400); // sanity cap
      sheetCanvas.style.height = newCssH + "px";
      sheetCanvas.height = Math.floor(newCssH * dpr);
      return; // redraw on next tick
    }

    // staff helpers
    function staffLines(topY){
      sctx.strokeStyle = stroke;
      sctx.lineWidth = 1;
      for (let i=0;i<5;i++){
        const y = topY + i*lineGap;
        sctx.beginPath();
        sctx.moveTo(left, y);
        sctx.lineTo(right, y);
        sctx.stroke();
      }
    }

    // midi placement (diatonic)
    function midiToDiatonicStep(m){
      const pc=m%12;
      const map={0:0,1:0,2:1,3:1,4:2,5:3,6:3,7:4,8:4,9:5,10:5,11:6};
      const di=map[pc];
      const oct=Math.floor(m/12)-1;
      return oct*7+di;
    }
    const trebleRefMidi=64; // E4
    const bassRefMidi=43;   // G2
    const trebleRefStep=midiToDiatonicStep(trebleRefMidi);
    const bassRefStep=midiToDiatonicStep(bassRefMidi);

    function stepToY(step, staffTop, refStep){
      const dy=(refStep-step)*(lineGap/2);
      const bottom=staffTop + 4*lineGap;
      return bottom + dy;
    }
    function staffFor(m){ return m>=60 ? "treble":"bass"; }

    // draw each system
    sctx.font = `800 ${Math.max(12, cssW*0.016)}px system-ui`;
    sctx.fillStyle = muted;

    for (let sys=0; sys<totalSystems; sys++){
      const y0 = pad + sys*systemHeight;

      const trebleTop = y0 + 18;
      const bassTop = trebleTop + staffGap;

      staffLines(trebleTop);
      staffLines(bassTop);

      sctx.fillText(`System ${sys+1}`, left, y0 + 10);

      // notes for this system
      const i0 = sys * notesPerSystem;
      const i1 = Math.min(notes.length, i0 + notesPerSystem);

      for (let i=i0;i<i1;i++){
        const n=notes[i];
        const col = i - i0;
        const x = left + col * xPerNote + 24;

        const st = staffFor(n.midi);
        const step = midiToDiatonicStep(n.midi);
        const y = (st==="treble")
          ? stepToY(step, trebleTop, trebleRefStep)
          : stepToY(step, bassTop, bassRefStep);

        const isCurrent = i===currentIdx;
        const isPast = i<currentIdx;

        sctx.globalAlpha = isPast ? 0.24 : isCurrent ? 1 : 0.90;
        sctx.fillStyle = isCurrent ? accent : text;

        // note head
        const r = clamp(cssW*0.010, 6, 9);
        sctx.beginPath();
        sctx.ellipse(x, y, r*1.3, r, -0.35, 0, Math.PI*2);
        sctx.fill();

        // stem
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

        // labels (stacked, spaced)
        sctx.globalAlpha = isPast ? 0.22 : 0.82;
        sctx.fillStyle = muted;
        sctx.font = `900 ${clamp(cssW*0.016, 12, 14)}px system-ui`;
        sctx.fillText(n.label, x - 18, y + 24);
        sctx.fillText(n.fingerText ? `(${n.fingerText})` : "", x - 18, y + 40);

        sctx.globalAlpha = 1;
      }
    }

    // hint
    sctx.fillStyle = muted;
    sctx.font = `700 ${Math.max(12, cssW*0.016)}px system-ui`;
    sctx.fillText("Page layout: fixed spacing per note for readability (no horizontal scroll).", left, (pad + totalSystems*systemHeight) - 12);
  }

  function drawAll(forceLayout){
    if (forceLayout){
      // ensure sizing feels correct after theme/layout changes
      resizeCanvases();
    }
    drawFalling();
    drawSheet();
  }

  // ---------------------------
  // Mode init + controls
  // ---------------------------
  function setDefaultUI(){
    const isPhone = window.matchMedia && window.matchMedia("(max-width: 640px)").matches;
    setSettingsOpen(!isPhone);
    if (isPhone) readoutDetails.open = false;
    enableControls(false);

    srcTxt.textContent="—";
    keyTxt.textContent="—";
    updateLoopReadout();
    updateTargetReadout();
  }

  // ---------------------------
  // Start-up
  // ---------------------------
  function init(){
    addRipples();
    loadThemePref();
    loadDesignPref(); // async

    setMode("preview");
    setTempoMul(1.0);

    setDefaultUI();
    resizeCanvases();
    applyViewVisibility();
    setStatus("Load a MIDI or MusicXML file to begin.");
  }

  init();
})();
