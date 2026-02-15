/* global Midi, pitchy */

(function () {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
  const $ = (id) => document.getElementById(id);

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

  const settingsBtn = $("settingsBtn");
  const settingsPanel = $("settingsPanel");

  const targetTxt = $("targetTxt");
  const heardTxt = $("heardTxt");
  const clarityTxt = $("clarityTxt");
  const deltaTxt = $("deltaTxt");
  const keyTxt = $("keyTxt");

  const canvas = $("canvas");
  const sheetCanvas = $("sheetCanvas");
  const ctx = canvas.getContext("2d");
  const sctx = sheetCanvas.getContext("2d");

  const sheetPanel = $("sheetPanel");
  const fallingPanel = $("fallingPanel");

  // Violin strings (open MIDI)
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

  let baseNotes = []; // [{t, dur, midi}]
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

  // ---- helpers ----
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

  function chooseStringIndex(midi, prevStringIndex=null){
    const candidates=[];
    for(let i=0;i<STRINGS.length;i++){
      const semi=midi-STRINGS[i].open;
      if(semi>=0 && semi<=7) candidates.push({i,semi});
    }
    if(!candidates.length) return null;
    candidates.sort((a,b)=>{
      const aStay = prevStringIndex===a.i ? -0.2 : 0;
      const bStay = prevStringIndex===b.i ? -0.2 : 0;
      return (a.semi+aStay)-(b.semi+bStay);
    });
    return candidates[0].i;
  }
  function fingerTextForSemi(semi){
    if(semi<=0) return "0";
    const map={1:"1L",2:"1",3:"2L",4:"2",5:"3",6:"4L",7:"4"};
    return map[semi] || "";
  }
  function laneLabel(n){
    if(!n) return "—";
    const lane = n.stringIndex==null ? "?" : STRINGS[n.stringIndex].name;
    return `${n.label} (${lane} string, ${n.fingerText})`;
  }
  function updateTargetReadout(){
    const n=notes[currentIdx];
    targetTxt.textContent = n ? laneLabel(n) : "Done!";
  }

  // ---- Settings drawer toggle ----
  function setSettingsOpen(open){
    settingsPanel.hidden = !open;
    settingsBtn.setAttribute("aria-expanded", open ? "true":"false");
  }
  settingsBtn.addEventListener("click", ()=>{
    setSettingsOpen(settingsPanel.hidden);
  });

  // ---- Platform + theming ----
  function detectPlatform() {
    const ua = navigator.userAgent || "";
    const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const isAndroid = /Android/.test(ua);
    return { isIOS, isAndroid };
  }

  function applyDesign(design) {
    const plat = detectPlatform();
    let resolved = design;
    if (design === "auto") resolved = plat.isIOS ? "liquid" : "material";
    document.documentElement.setAttribute("data-design", resolved);
  }

  function loadDesignPref() {
    const saved = localStorage.getItem("vfn_design") || "auto";
    designSelect.value = saved;
    applyDesign(saved);
  }

  designSelect.addEventListener("change", () => {
    const v = designSelect.value;
    localStorage.setItem("vfn_design", v);
    applyDesign(v);
  });

  function setTheme(theme){
    document.documentElement.setAttribute("data-theme", theme);
    themeBtn.textContent = theme==="dark" ? "🌙 Dark" : "☀️ Light";
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#111111" : "#f4f6ff");
    drawFalling(); drawSheet();
  }

  themeBtn.addEventListener("click", ()=>{
    const cur=document.documentElement.getAttribute("data-theme")||"dark";
    setTheme(cur==="dark"?"light":"dark");
    localStorage.setItem("vfn_theme", document.documentElement.getAttribute("data-theme"));
  });

  function loadThemePref() {
    const saved = localStorage.getItem("vfn_theme");
    if (saved === "light" || saved === "dark") return setTheme(saved);
    try { setTheme(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark":"light"); }
    catch { setTheme("dark"); }
  }

  // ---- View visibility ----
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

    startMicBtn.style.display = mode==="learn" ? "" : "none";
    previewPlayBtn.style.display = mode==="preview" ? "" : "none";
    previewPauseBtn.style.display = mode==="preview" ? "" : "none";
    previewStopBtn.style.display = mode==="preview" ? "" : "none";
    testSoundBtn.style.display = mode==="preview" ? "" : "none";

    stopPreview(true);
    stopMic();

    if(notes.length){
      setStatus(mode==="preview"
        ? "Preview: Play to listen. If silent, Test Sound + check iPhone silent switch/volume/Bluetooth."
        : "Learn: Start Mic, then play the target note to advance.");
    }
  }
  modePreviewBtn.addEventListener("click", ()=>setMode("preview"));
  modeLearnBtn.addEventListener("click", ()=>setMode("learn"));

  // Canvas sizing
  function resizeCanvases(){
    dpr = window.devicePixelRatio || 1;

    function sizeCanvasToPanel(c, panel, aspect){
      if (!panel || panel.style.display === "none") return;
      const rect = panel.getBoundingClientRect();
      const cssW = Math.max(260, Math.floor(rect.width));
      const cssH = Math.max(220, Math.floor(cssW * aspect));
      c.style.width = cssW + "px";
      c.style.height = cssH + "px";
      c.width = Math.floor(cssW * dpr);
      c.height = Math.floor(cssH * dpr);
    }

    sizeCanvasToPanel(sheetCanvas, sheetPanel, 0.58);
    sizeCanvasToPanel(canvas, fallingPanel, 0.56);
  }
  window.addEventListener("resize", ()=>{ resizeCanvases(); drawFalling(); drawSheet(); });

  function cssVars(){
    const s=getComputedStyle(document.documentElement);
    return {
      bg:s.getPropertyValue("--canvas").trim(),
      lane:s.getPropertyValue("--lane").trim(),
      stroke:s.getPropertyValue("--border").trim() || "rgba(255,255,255,0.2)",
      text:s.getPropertyValue("--text").trim(),
      muted:s.getPropertyValue("--muted").trim(),
      accent:s.getPropertyValue("--accent").trim()
    };
  }

  // Key sig display
  const KEY_NAMES = {
    "0,0":"C major","0,1":"A minor",
    "1,0":"G major","1,1":"E minor",
    "2,0":"D major","2,1":"B minor",
    "3,0":"A major","3,1":"F# minor",
    "4,0":"E major","4,1":"C# minor",
    "-1,0":"F major","-1,1":"D minor",
    "-2,0":"Bb major","-2,1":"G minor",
    "-3,0":"Eb major","-3,1":"C minor"
  };
  function keyNameFromSig(sig){
    if(!sig) return "—";
    return KEY_NAMES[`${sig.sf},${sig.mi}`] || `sf=${sig.sf} ${sig.mi ? "minor":"major"}`;
  }

  // Tempo stepper
  function closestTempoIndex(x){
    let best=0, bestd=Infinity;
    for(let i=0;i<TEMPO_STEPS.length;i++){
      const d=Math.abs(TEMPO_STEPS[i]-x);
      if(d<bestd){ bestd=d; best=i; }
    }
    return best;
  }
  function setTempoMul(next){
    tempoMul = next;
    tempoVal.textContent = `${tempoMul.toFixed(2)}×`;
    if(baseNotes.length) rebuildNotesFromBase();
  }
  tempoDownBtn.addEventListener("click", ()=>{
    const i=closestTempoIndex(tempoMul);
    setTempoMul(TEMPO_STEPS[Math.max(0, i-1)]);
  });
  tempoUpBtn.addEventListener("click", ()=>{
    const i=closestTempoIndex(tempoMul);
    setTempoMul(TEMPO_STEPS[Math.min(TEMPO_STEPS.length-1, i+1)]);
  });

  // Build notes from base times using current tempoMul
  function rebuildNotesFromBase(){
    stopPreview(true);
    stopMic();

    notes=[];
    let prevString=null;
    for(const n of baseNotes){
      const t = n.t / tempoMul;
      const dur = (n.dur || 0.3) / tempoMul;

      const sIdx=chooseStringIndex(n.midi, prevString);
      prevString=sIdx ?? prevString;

      const semi=(sIdx==null)?null:(n.midi-STRINGS[sIdx].open);
      const fingerText = semi==null ? "?" : fingerTextForSemi(semi);

      notes.push({
        t, dur,
        midi:n.midi,
        hz:midiToHz(n.midi),
        stringIndex:sIdx,
        label:noteName(n.midi),
        fingerText
      });
    }

    currentIdx = clamp(currentIdx, 0, Math.max(0, notes.length-1));
    visualTime = notes[currentIdx]?.t ?? 0;
    updateTargetReadout();
    updateLoopReadout();
    drawFalling(); drawSheet();
    enableControls(true);
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

  // ---- Loaders ----
  async function loadMidi(arrayBuffer){
    const midi = new Midi(arrayBuffer);
    const tempos = midi.header.tempos || [];
    bpm = tempos.length ? tempos[0].bpm : 120;

    keySig = null;
    const ks = midi.header.keySignatures || [];
    if (ks.length) {
      const first = ks[0];
      if (typeof first.sf === "number" && typeof first.mi === "number") keySig = { sf:first.sf, mi:first.mi };
    }

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

  function pitchToMidi(step, alter, octave) {
    const base = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 }[step];
    if (base == null || !isFinite(octave)) return null;
    return (octave + 1) * 12 + base + (alter || 0);
  }

  function parseMusicXML(xmlText){
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, "application/xml");
    const parseErr = doc.getElementsByTagName("parsererror")[0];
    if (parseErr) throw new Error("MusicXML parse error");

    bpm = 120;
    const sound = doc.querySelector("sound[tempo]");
    if (sound) {
      const v = parseFloat(sound.getAttribute("tempo"));
      if (isFinite(v) && v > 10 && v < 400) bpm = v;
    } else {
      const pm = doc.querySelector("per-minute");
      if (pm) {
        const v = parseFloat(pm.textContent);
        if (isFinite(v) && v > 10 && v < 400) bpm = v;
      }
    }

    keySig = null;
    const fifths = doc.querySelector("key > fifths");
    if (fifths) {
      const sf = parseInt(fifths.textContent, 10);
      const modeEl = doc.querySelector("key > mode");
      const modeTxt = modeEl ? (modeEl.textContent || "").toLowerCase() : "major";
      const mi = modeTxt.includes("minor") ? 1 : 0;
      if (isFinite(sf)) keySig = { sf, mi };
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
        if (isFinite(v) && v > 0) divisions = v;
      }

      const notesEl = Array.from(meas.getElementsByTagName("note"));
      for (const n of notesEl) {
        const isRest = !!n.querySelector("rest");
        const chord = !!n.querySelector("chord");

        const durEl = n.querySelector("duration");
        const durDiv = durEl ? parseInt(durEl.textContent, 10) : 0;
        const quarterLen = divisions > 0 ? (durDiv / divisions) : 0;
        const durSec = Math.max(0.04, quarterLen * spq);

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

        if (!chord) {
          lastStartSec = startSec;
          curSec += durSec;
        } else {
          lastStartSec = startSec;
        }
      }
    }

    out.sort((a,b)=>a.t-b.t || a.midi-b.midi);
    const collapsed = [];
    const EPS = 0.02;
    for (const n of out) {
      const last = collapsed[collapsed.length - 1];
      if (last && Math.abs(n.t - last.t) < EPS) {
        if (n.midi > last.midi) collapsed[collapsed.length - 1] = n;
      } else collapsed.push(n);
    }

    baseNotes = collapsed.map(n => ({ t:n.t, dur:n.dur || 0.3, midi:n.midi }));
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
        if (!textLooksLikeXml(text)) throw new Error("Not a MusicXML file (or it's .mxl zipped)");
        parseMusicXML(text);
      }

      keyTxt.textContent = keyNameFromSig(keySig);

      currentIdx = 0;
      visualTime = 0;

      loop.enabled = false;
      loop.start = 0;
      loop.end = Math.max(0, baseNotes.length - 1);
      updateLoopReadout();

      rebuildNotesFromBase();
      applyViewVisibility();
      setMode(mode);
      resizeCanvases();

      setStatus(`Loaded ${notes.length} notes from ${srcTxt.textContent}. BPM≈${Math.round(bpm)}.`);

      if (window.matchMedia && window.matchMedia("(max-width: 640px)").matches) {
        setSettingsOpen(false);
      }

    } catch (err) {
      console.error(err);
      setStatus(`Could not load file: ${err.message || err}`);
      srcTxt.textContent = "—";
      keyTxt.textContent = "—";
      baseNotes = [];
      notes = [];
      enableControls(false);
      drawFalling();
      drawSheet();
    }
  });

  // ---- Loop controls ----
  function updateLoopReadout(){
    if(!loop.enabled) loopRead.textContent="Loop: off";
    else loopRead.textContent=`Loop: ${loop.start+1} → ${loop.end+1}`;
  }
  loopStartBtn.addEventListener("click", ()=>{
    loop.start=currentIdx;
    loop.end=Math.max(loop.end, loop.start);
    loop.enabled=true;
    updateLoopReadout();
  });
  loopEndBtn.addEventListener("click", ()=>{
    loop.end=currentIdx;
    loop.start=Math.min(loop.start, loop.end);
    loop.enabled=true;
    updateLoopReadout();
  });
  loopClearBtn.addEventListener("click", ()=>{
    loop.enabled=false;
    updateLoopReadout();
  });

  function loopTimes(){
    if(!loop.enabled || !notes.length) return null;
    const tStart = notes[loop.start]?.t ?? 0;
    const endNote = notes[loop.end];
    const tEnd = (endNote?.t ?? 0) + (endNote?.dur ?? 0.2);
    return { tStart, tEnd };
  }

  // ---- Learn (mic) ----
  startMicBtn.addEventListener("click", async ()=>{
    if(!notes.length) return;
    stopPreview(true);

    try{
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation:false, noiseSuppression:false, autoGainControl:false }
      });

      sourceNode = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      sourceNode.connect(analyser);

      floatBuf = new Float32Array(analyser.fftSize);
      pitchDetector = pitchy.PitchDetector.forFloat32Array(analyser.fftSize);

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
    if(audioCtx){ try{audioCtx.close();}catch{} }
    audioCtx=null; analyser=null; sourceNode=null; pitchDetector=null; floatBuf=null;
    heardTxt.textContent="—"; clarityTxt.textContent="—"; deltaTxt.textContent="—";
    lastGoodMs=0;
  }

  function learnLoop(){
    if(!micRunning || mode!=="learn") return;

    const current=notes[currentIdx];
    if(current) visualTime=current.t;

    analyser.getFloatTimeDomainData(floatBuf);
    const [pitchHz, clarity] = pitchDetector.findPitch(floatBuf, audioCtx.sampleRate);

    clarityTxt.textContent = clarity ? clarity.toFixed(2) : "—";
    heardTxt.textContent = (pitchHz && isFinite(pitchHz)) ? `${pitchHz.toFixed(1)} Hz` : "—";

    if(current && pitchHz && isFinite(pitchHz) && clarity > 0.86){
      const delta = centsOff(pitchHz, current.hz);
      deltaTxt.textContent = `${delta.toFixed(1)} cents`;

      const tol = clamp(parseFloat(tolCentsEl.value)||35, 10, 80);
      const ok = Math.abs(delta) <= tol;

      if(ok){
        lastGoodMs += 16;
        if(lastGoodMs >= NEED_STABLE_MS){
          currentIdx++;
          lastGoodMs = 0;
        }
      } else {
        lastGoodMs = 0;
      }

      if(loop.enabled && currentIdx > loop.end) currentIdx = loop.start;
      updateTargetReadout();

      if(currentIdx >= notes.length){
        setStatus("Finished! 🎉");
        stopMic();
      }
    } else {
      deltaTxt.textContent="—";
      lastGoodMs=0;
    }

    drawFalling(); drawSheet();
    requestAnimationFrame(learnLoop);
  }

  // ---- Preview audio: more violin-like synth ----
  function ensurePreviewCtx(){
    if(!previewCtx) previewCtx = new (window.AudioContext || window.webkitAudioContext)();
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

  // Bowed-ish synth: two detuned saws + filter + envelope + vibrato
  function playViolinSynth(freq, atTime, dur){
    const t0 = atTime;
    const t1 = atTime + Math.max(0.08, dur);

    const g = previewCtx.createGain();
    const f = previewCtx.createBiquadFilter();
    const comp = previewCtx.createDynamicsCompressor();

    // filter
    f.type = "lowpass";
    f.frequency.setValueAtTime(Math.min(9000, Math.max(1200, freq*6)), t0);
    f.Q.setValueAtTime(0.8, t0);

    // envelope (bow: slower attack than pluck)
    const attack = 0.045;
    const release = 0.09;
    const sustain = 0.22;

    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(sustain, t0 + attack);
    g.gain.setValueAtTime(sustain, Math.max(t0 + attack, t1 - release));
    g.gain.exponentialRampToValueAtTime(0.0001, t1);

    // oscillators
    const o1 = previewCtx.createOscillator();
    const o2 = previewCtx.createOscillator();
    o1.type = "sawtooth";
    o2.type = "sawtooth";
    o1.frequency.setValueAtTime(freq, t0);
    o2.frequency.setValueAtTime(freq, t0);
    o1.detune.setValueAtTime(-7, t0);
    o2.detune.setValueAtTime(+7, t0);

    // subtle vibrato LFO
    const lfo = previewCtx.createOscillator();
    const lfoGain = previewCtx.createGain();
    lfo.type = "sine";
    lfo.frequency.setValueAtTime(5.5, t0);
    lfoGain.gain.setValueAtTime(12, t0); // cents-ish detune depth
    lfo.connect(lfoGain);
    lfoGain.connect(o1.detune);
    lfoGain.connect(o2.detune);

    // chain
    o1.connect(f);
    o2.connect(f);
    f.connect(comp);
    comp.connect(g);
    g.connect(previewCtx.destination);

    // start/stop
    lfo.start(t0);
    o1.start(t0);
    o2.start(t0);

    const stopTime = t1 + 0.02;
    o1.stop(stopTime);
    o2.stop(stopTime);
    lfo.stop(stopTime);
  }

  testSoundBtn.addEventListener("click", ()=>{
    ensurePreviewCtx();
    const t=previewCtx.currentTime+0.06;
    // little violin-ish arpeggio
    playViolinSynth(440, t, 0.28);
    playViolinSynth(659.25, t+0.32, 0.28);
    playViolinSynth(880, t+0.64, 0.28);
    setStatus("Test sound played. If silent: iPhone silent switch/volume/Bluetooth.");
  });

  function startPreview(){
    if(!notes.length) return;

    stopMic();
    ensurePreviewCtx();

    previewIsPlaying=true;
    previewPlayBtn.disabled=true;

    const spb=60/bpm;
    const countInBeats=clamp(parseInt(countInEl.value||"0",10),0,8);
    previewCountInSec=countInBeats*spb;

    const now=previewCtx.currentTime;
    for(let i=0;i<countInBeats;i++) playClick(now+i*spb);

    const startSongTime=previewPausedSongTime||0;
    for(const n of notes){
      if(n.t<startSongTime) continue;
      const at=now+previewCountInSec+(n.t-startSongTime);
      playViolinSynth(n.hz, at, clamp(n.dur,0.10,1.4));
    }

    if(metroOnEl.checked){
      const endSong=(notes[notes.length-1]?.t ?? 0)+1.0;
      const total=previewCountInSec+Math.max(0,endSong-startSongTime)+1.0;
      const beats=Math.ceil(total/spb);
      for(let i=0;i<beats;i++) playClick(now+i*spb);
    }

    previewStartPerf=performance.now();

    if(previewTimer) clearInterval(previewTimer);
    previewTimer=setInterval(()=>{
      const elapsed=(performance.now()-previewStartPerf)/1000;
      const songTime=(elapsed-previewCountInSec)+(previewPausedSongTime||0);
      visualTime=Math.max(0,songTime);

      if(songTime<0){ drawFalling(); drawSheet(); return; }

      while(currentIdx<notes.length-1 && notes[currentIdx+1].t<=visualTime) currentIdx++;
      updateTargetReadout();

      const lt=loopTimes();
      if(lt && visualTime>=lt.tEnd){
        previewPausedSongTime=lt.tStart;
        currentIdx=loop.start;
        stopPreview(true);
        startPreview();
        return;
      }

      drawFalling(); drawSheet();

      const endTime=(notes[notes.length-1]?.t ?? 0)+1.5;
      if(!lt && visualTime>endTime) stopPreview(false);
    }, 30);

    setStatus(countInBeats ? `Count-in: ${countInBeats}… then playing.` : "Preview playing…");
  }

  function pausePreview(){
    if(!previewIsPlaying) return;
    previewIsPlaying=false;
    previewPlayBtn.disabled=false;

    if(previewTimer) clearInterval(previewTimer);
    previewTimer=null;

    const elapsed=(performance.now()-previewStartPerf)/1000;
    const songTime=(elapsed-previewCountInSec)+(previewPausedSongTime||0);
    previewPausedSongTime=Math.max(0,songTime);

    if(previewCtx){ try{previewCtx.close();}catch{} previewCtx=null; }
    setStatus("Preview paused.");
  }

  function stopPreview(silent){
    previewIsPlaying=false;
    previewPlayBtn.disabled=false;

    if(previewTimer) clearInterval(previewTimer);
    previewTimer=null;

    previewPausedSongTime=0;
    if(previewCtx){ try{previewCtx.close();}catch{} previewCtx=null; }

    currentIdx=loop.enabled?loop.start:0;
    visualTime=notes[currentIdx]?.t ?? 0;
    updateTargetReadout();
    drawFalling(); drawSheet();

    if(!silent && notes.length) setStatus("Preview stopped.");
  }

  previewPlayBtn.addEventListener("click", startPreview);
  previewPauseBtn.addEventListener("click", pausePreview);
  previewStopBtn.addEventListener("click", ()=>stopPreview(false));

  // ---- Drawing (unchanged from your current) ----
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

  function drawFalling(){
    if(!showFallingEl.checked || fallingPanel.style.display==="none") return;

    const {bg,lane:laneBg,stroke,text,muted,accent}=cssVars();
    const w=canvas.width, h=canvas.height;

    ctx.setTransform(dpr,0,0,dpr,0,0);
    const cssW=w/dpr, cssH=h/dpr;

    ctx.clearRect(0,0,cssW,cssH);
    ctx.fillStyle=bg; ctx.fillRect(0,0,cssW,cssH);

    const topPad=18, bottomPad=26;
    const lanesY0=topPad, lanesY1=cssH-bottomPad;

    const laneCount=4, laneGap=12;
    const laneW=Math.floor((cssW-laneGap*(laneCount+1))/laneCount);
    const laneX=(i)=>laneGap+i*(laneW+laneGap);

    for(let i=0;i<laneCount;i++){
      ctx.fillStyle=laneBg;
      ctx.fillRect(laneX(i), lanesY0, laneW, lanesY1-lanesY0);
      ctx.strokeStyle=stroke; ctx.lineWidth=1;
      ctx.strokeRect(laneX(i), lanesY0, laneW, lanesY1-lanesY0);

      ctx.fillStyle=text; ctx.globalAlpha=0.85;
      ctx.font=`900 ${Math.max(16, cssW*0.02)}px system-ui`;
      ctx.fillText(STRINGS[i].name, laneX(i)+10, lanesY0+22);
      ctx.globalAlpha=1;
    }

    const hitY=lanesY1-62;
    ctx.strokeStyle=stroke; ctx.lineWidth=2; ctx.globalAlpha=0.9;
    ctx.beginPath(); ctx.moveTo(0,hitY); ctx.lineTo(cssW,hitY); ctx.stroke();
    ctx.globalAlpha=1;

    const secondsVisible=6.2;
    const pxPerSec=(lanesY1-lanesY0)/secondsVisible;

    const baseFont=clamp(cssW*0.030,16,28);
    const currentFont=clamp(cssW*0.036,18,34);
    const fingerFont=clamp(cssW*0.024,14,20);

    for(let i=0;i<notes.length;i++){
      const n=notes[i];
      const dt=n.t-visualTime;
      if(dt<-0.8 || dt>secondsVisible) continue;

      const y=hitY-dt*pxPerSec;
      const height=Math.max(18, n.dur*pxPerSec);

      const laneIdx=n.stringIndex;
      const x=laneIdx==null?laneX(0):laneX(laneIdx);
      const laneWidth=laneIdx==null?(laneW*4+laneGap*3):laneW;

      const isCurrent=i===currentIdx;
      const isPast=i<currentIdx;

      ctx.globalAlpha=isPast?0.20:(isCurrent?1:0.78);
      ctx.fillStyle=isCurrent?accent:"#8a8a99";
      if(laneIdx==null) ctx.fillStyle="#cc7a00";

      const pad=10;
      const rectX=x+pad, rectW=laneWidth-pad*2;
      const rectY=y-height, rectH=height;

      roundRect(ctx, rectX, rectY, rectW, rectH, 14);
      ctx.fill();

      ctx.fillStyle=bg;
      ctx.globalAlpha=isPast?0.15:0.96;
      ctx.font=`900 ${isCurrent?currentFont:baseFont}px system-ui`;
      ctx.fillText(n.label, rectX+12, rectY+Math.min((isCurrent?currentFont:baseFont)+8, rectH-6));

      const badge=n.fingerText||"?";
      const bx=rectX+rectW-56, by=rectY+10;
      ctx.globalAlpha=isPast?0.14:0.92;
      ctx.fillStyle="rgba(0,0,0,0.22)";
      roundRect(ctx, bx, by, 46, 28, 11);
      ctx.fill();
      ctx.fillStyle=bg;
      ctx.font=`900 ${fingerFont}px system-ui`;
      ctx.fillText(badge, bx+14, by+20);

      ctx.globalAlpha=1;
    }

    ctx.fillStyle=muted;
    ctx.font=`700 ${Math.max(12, cssW*0.016)}px system-ui`;
    ctx.fillText("Finger labels are first-position heuristics (L=low).", 14, cssH-10);
  }

  function drawSheet(){
    if(!showSheetEl.checked || sheetPanel.style.display==="none") return;

    const {bg,stroke,text,muted,accent}=cssVars();
    const w=sheetCanvas.width, h=sheetCanvas.height;

    sctx.setTransform(dpr,0,0,dpr,0,0);
    const cssW=w/dpr, cssH=h/dpr;

    sctx.clearRect(0,0,cssW,cssH);
    sctx.fillStyle=bg; sctx.fillRect(0,0,cssW,cssH);

    const pad=18;
    const left=pad, right=cssW-pad;

    const staffGap=clamp(cssH*0.14,56,88);
    const lineGap=clamp(cssH*0.030,9,14);

    const trebleTop=clamp(cssH*0.20,48,90);
    const bassTop=trebleTop+staffGap+4*lineGap;

    function staffLines(topY){
      sctx.strokeStyle=stroke; sctx.lineWidth=1;
      for(let i=0;i<5;i++){
        const y=topY+i*lineGap;
        sctx.beginPath(); sctx.moveTo(left,y); sctx.lineTo(right,y); sctx.stroke();
      }
    }
    staffLines(trebleTop);
    staffLines(bassTop);

    sctx.fillStyle=muted;
    sctx.font=`800 ${Math.max(12, cssW*0.016)}px system-ui`;
    sctx.fillText("Treble", left, trebleTop-12);
    sctx.fillText("Bass", left, bassTop-12);

    const playheadX=left+(right-left)*0.18;
    sctx.strokeStyle=stroke; sctx.lineWidth=2; sctx.globalAlpha=0.9;
    sctx.beginPath();
    sctx.moveTo(playheadX, trebleTop-20);
    sctx.lineTo(playheadX, bassTop+4*lineGap+20);
    sctx.stroke();
    sctx.globalAlpha=1;

    const secondsVisible=7.2;
    const t0=Math.max(0, visualTime-0.6);
    const t1=t0+secondsVisible;

    function midiToDiatonicStep(m){
      const pc=m%12;
      const map={0:0,1:0,2:1,3:1,4:2,5:3,6:3,7:4,8:4,9:5,10:5,11:6};
      const di=map[pc];
      const oct=Math.floor(m/12)-1;
      return oct*7+di;
    }
    const trebleRefMidi=64;
    const bassRefMidi=43;
    const trebleRefStep=midiToDiatonicStep(trebleRefMidi);
    const bassRefStep=midiToDiatonicStep(bassRefMidi);

    function stepToY(step, staffTop, refStep){
      const dy=(refStep-step)*(lineGap/2);
      const bottom=staffTop+4*lineGap;
      return bottom+dy;
    }
    function staffFor(m){ return m>=60 ? "treble":"bass"; }

    for(let i=0;i<notes.length;i++){
      const n=notes[i];
      if(n.t<t0 || n.t>t1) continue;

      const x=playheadX+((n.t-visualTime)/secondsVisible)*(right-left)*0.78;

      const staff=staffFor(n.midi);
      const step=midiToDiatonicStep(n.midi);
      const y = staff==="treble"
        ? stepToY(step, trebleTop, trebleRefStep)
        : stepToY(step, bassTop, bassRefStep);

      const isCurrent=i===currentIdx;
      const isPast=i<currentIdx;

      sctx.globalAlpha=isPast?0.24:(isCurrent?1:0.84);
      sctx.fillStyle=isCurrent?accent:text;

      const r=clamp(cssW*0.010,5,8);
      sctx.beginPath();
      sctx.ellipse(x,y,r*1.25,r,-0.35,0,Math.PI*2);
      sctx.fill();

      sctx.strokeStyle=sctx.fillStyle;
      sctx.lineWidth=2;
      sctx.beginPath();
      if(staff==="treble"){
        sctx.moveTo(x+r*1.1,y);
        sctx.lineTo(x+r*1.1,y-lineGap*2.8);
      }else{
        sctx.moveTo(x-r*1.1,y);
        sctx.lineTo(x-r*1.1,y+lineGap*2.8);
      }
      sctx.stroke();

      sctx.fillStyle=muted;
      sctx.font=`900 ${clamp(cssW*0.020,12,16)}px system-ui`;
      sctx.fillText(n.label, x+10, y+5);
      sctx.fillText(`(${n.fingerText})`, x+10, y+22);

      sctx.globalAlpha=1;
    }

    sctx.fillStyle=muted;
    sctx.font=`700 ${Math.max(12, cssW*0.016)}px system-ui`;
    sctx.fillText("Sheet view is simplified (spacing-first).", left, cssH-10);
  }

  // ---- Init ----
  function disableAll(){
    enableControls(false);
    tempoDownBtn.disabled=true;
    tempoUpBtn.disabled=true;
  }

  function init(){
    loadThemePref();
    loadDesignPref();

    const isPhone = window.matchMedia && window.matchMedia("(max-width: 640px)").matches;
    setSettingsOpen(!isPhone);

    applyViewVisibility();
    resizeCanvases();

    setMode("preview");
    setTempoMul(1.0);
    disableAll();

    updateTargetReadout();
    drawFalling();
    drawSheet();

    keyTxt.textContent="—";
    srcTxt.textContent="—";
  }

  init();
})();
