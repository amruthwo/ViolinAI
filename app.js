/* global Midi, pitchy */

(function () {
  // SW
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});

  const $ = (id) => document.getElementById(id);

  // UI
  const midiFileEl = $("midiFile");
  const statusEl = $("status");

  const modePreviewBtn = $("modePreview");
  const modeLearnBtn = $("modeLearn");

  const showFallingEl = $("showFalling");
  const showSheetEl = $("showSheet");

  const previewPlayBtn = $("previewPlayBtn");
  const previewPauseBtn = $("previewPauseBtn");
  const previewStopBtn = $("previewStopBtn");
  const testSoundBtn = $("testSoundBtn");
  const startMicBtn = $("startMicBtn");

  const loopStartBtn = $("loopStartBtn");
  const loopEndBtn = $("loopEndBtn");
  const loopClearBtn = $("loopClearBtn");
  const loopRead = $("loopRead");

  const waitModeEl = $("waitMode");
  const tempoMulEl = $("tempoMul");
  const tolCentsEl = $("tolCents");
  const countInEl = $("countIn");
  const metroOnEl = $("metroOn");

  const learnOnlyA = $("learnOnlyA");
  const learnOnlyB = $("learnOnlyB");

  const themeBtn = $("themeBtn");

  const targetTxt = $("targetTxt");
  const heardTxt = $("heardTxt");
  const clarityTxt = $("clarityTxt");
  const deltaTxt = $("deltaTxt");
  const keyTxt = $("keyTxt");

  const canvas = $("canvas");
  const sheetCanvas = $("sheetCanvas");
  const ctx = canvas.getContext("2d");
  const sctx = sheetCanvas.getContext("2d");

  // Violin strings (open MIDI)
  const STRINGS = [
    { name: "G", open: 55 },
    { name: "D", open: 62 },
    { name: "A", open: 69 },
    { name: "E", open: 76 }
  ];

  // ----- State -----
  let notes = []; // [{t,dur,midi,hz,stringIndex,label,fingerText}]
  let currentIdx = 0;

  let mode = "preview"; // preview | learn

  // Key signature from MIDI (if present)
  // store as {sf:int, mi:0|1} where sf=sharps(+)/flats(-), mi=major/minor
  let keySig = null;
  let bpm = 120;

  // Loop (note indices)
  let loop = { enabled: false, start: 0, end: 0 };

  // Visual time
  let visualTime = 0;
  let lastFrameTs = 0;

  // DPR canvas
  let dpr = 1;

  // Learn: mic/pitch
  let audioCtx = null;
  let analyser = null;
  let sourceNode = null;
  let pitchDetector = null;
  let floatBuf = null;
  let micRunning = false;
  let lastGoodMs = 0;
  const NEED_STABLE_MS = 140;

  // Preview audio + timer
  let previewCtx = null;
  let previewTimer = null;
  let previewStartPerf = 0;
  let previewPausedAt = 0;
  let previewIsPlaying = false;

  // ----- Helpers -----
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function setStatus(msg) { statusEl.textContent = msg; }

  function midiToHz(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  function noteName(midi) {
    const names = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
    const n = names[midi % 12];
    const oct = Math.floor(midi / 12) - 1;
    return `${n}${oct}`;
  }

  function centsOff(freq, targetHz) { return 1200 * Math.log2(freq / targetHz); }

  // First-position-ish string choice: allow up to +7 semitones above open
  function chooseStringIndex(midi, prevStringIndex = null) {
    const candidates = [];
    for (let i = 0; i < STRINGS.length; i++) {
      const semi = midi - STRINGS[i].open;
      if (semi >= 0 && semi <= 7) candidates.push({ i, semi });
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => {
      const aStay = prevStringIndex === a.i ? -0.2 : 0;
      const bStay = prevStringIndex === b.i ? -0.2 : 0;
      return (a.semi + aStay) - (b.semi + bStay);
    });
    return candidates[0].i;
  }

  // Finger number heuristic from semitone offset (first-position)
  // 0=open; then approximate “low/high” finger placements
  function fingerTextForSemi(semi) {
    if (semi <= 0) return "0";
    // map semitone to (finger, low/high) in a simple way:
    // 1 => 1L, 2 => 1, 3 => 2L, 4 => 2, 5 => 3, 6 => 4L, 7 => 4
    const map = {
      1: "1L", 2: "1",
      3: "2L", 4: "2",
      5: "3",
      6: "4L", 7: "4"
    };
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

  // ---- Theme ----
  function setTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    themeBtn.textContent = theme === "dark" ? "🌙 Dark" : "☀️ Light";
  }
  themeBtn.addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme") || "dark";
    setTheme(cur === "dark" ? "light" : "dark");
    drawFalling();
    drawSheet();
  });
  try {
    setTheme(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  } catch { setTheme("dark"); }

  // ---- Mode ----
  function setMode(next) {
    mode = next;
    modePreviewBtn.classList.toggle("active", mode === "preview");
    modeLearnBtn.classList.toggle("active", mode === "learn");

    learnOnlyA.style.display = mode === "learn" ? "" : "none";
    learnOnlyB.style.display = mode === "learn" ? "" : "none";

    startMicBtn.style.display = mode === "learn" ? "" : "none";
    previewPlayBtn.style.display = mode === "preview" ? "" : "none";
    previewPauseBtn.style.display = mode === "preview" ? "" : "none";
    previewStopBtn.style.display = mode === "preview" ? "" : "none";
    testSoundBtn.style.display = mode === "preview" ? "" : "none";

    stopPreview();
    stopMic();

    if (notes.length) {
      setStatus(mode === "preview"
        ? "Preview mode: Play to listen. Use Test Sound if iPhone is silent."
        : "Learn mode: Start Mic, then play the target note to advance.");
    }
  }
  modePreviewBtn.addEventListener("click", () => setMode("preview"));
  modeLearnBtn.addEventListener("click", () => setMode("learn"));

  // ---- Views (show/hide both canvases independently) ----
  function applyViewVisibility() {
    canvas.style.display = showFallingEl.checked ? "block" : "none";
    sheetCanvas.style.display = showSheetEl.checked ? "block" : "none";
  }
  showFallingEl.addEventListener("change", () => { applyViewVisibility(); drawFalling(); });
  showSheetEl.addEventListener("change", () => { applyViewVisibility(); drawSheet(); });

  // ---- Canvas sizing ----
  function resizeCanvases() {
    dpr = window.devicePixelRatio || 1;
    const wrap = document.querySelector(".canvasWrap");
    const cssW = Math.min(wrap.clientWidth, 980);

    // Falling aspect
    const cssH = Math.round(cssW * 0.58);
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);

    // Sheet a bit taller
    const sheetCssH = Math.round(cssW * 0.62);
    sheetCanvas.style.width = cssW + "px";
    sheetCanvas.style.height = sheetCssH + "px";
    sheetCanvas.width = Math.floor(cssW * dpr);
    sheetCanvas.height = Math.floor(sheetCssH * dpr);
  }
  window.addEventListener("resize", () => {
    resizeCanvases();
    drawFalling();
    drawSheet();
  });

  // ---- MIDI: key signature helpers ----
  // MIDI meta key signature: sf (sharps/flats), mi (0 major / 1 minor)
  const KEY_NAMES = {
    "0,0":"C major","0,1":"A minor",
    "1,0":"G major","1,1":"E minor",
    "2,0":"D major","2,1":"B minor",
    "3,0":"A major","3,1":"F# minor",
    "4,0":"E major","4,1":"C# minor",
    "5,0":"B major","5,1":"G# minor",
    "6,0":"F# major","6,1":"D# minor",
    "7,0":"C# major","7,1":"A# minor",
    "-1,0":"F major","-1,1":"D minor",
    "-2,0":"Bb major","-2,1":"G minor",
    "-3,0":"Eb major","-3,1":"C minor",
    "-4,0":"Ab major","-4,1":"F minor",
    "-5,0":"Db major","-5,1":"Bb minor",
    "-6,0":"Gb major","-6,1":"Eb minor",
    "-7,0":"Cb major","-7,1":"Ab minor"
  };
  function keyNameFromSig(sig) {
    if (!sig) return "—";
    return KEY_NAMES[`${sig.sf},${sig.mi}`] || `sf=${sig.sf} ${sig.mi ? "minor" : "major"}`;
  }

  // Determine if a pitch class should be sharp/flat in this key signature.
  // We use standard order of sharps/flats.
  const ORDER_SHARPS = ["F","C","G","D","A","E","B"];
  const ORDER_FLATS  = ["B","E","A","D","G","C","F"];
  const PC_TO_LETTER = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
  function keyAccidentalMap(sig) {
    // returns a map letter -> '#' or 'b' implied by key signature
    const m = {};
    if (!sig) return m;
    if (sig.sf > 0) {
      for (let i = 0; i < sig.sf; i++) m[ORDER_SHARPS[i]] = "#";
    } else if (sig.sf < 0) {
      for (let i = 0; i < Math.abs(sig.sf); i++) m[ORDER_FLATS[i]] = "b";
    }
    return m;
  }

  function needsAccidental(sig, midi) {
    // Very simplified: if note name includes #/b but key doesn't imply it, show accidental.
    // Also if natural note but key implies sharp/flat for that letter, show natural.
    const pcName = PC_TO_LETTER[midi % 12]; // e.g., F#
    const letter = pcName[0];               // e.g., F
    const hasSharp = pcName.includes("#");
    const km = keyAccidentalMap(sig);

    if (km[letter] === "#" && !hasSharp) return "♮"; // key expects sharp but note is natural
    if (km[letter] === "b" && !pcName.includes("b")) {
      // our pcName doesn't use flats; approximate: if key has flat on letter, but pitch is natural letter -> natural sign
      // (still helpful even if not perfect)
      return "♮";
    }

    if (hasSharp && km[letter] !== "#") return "#";
    return null;
  }

  // ---- Load MIDI ----
  midiFileEl.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const ab = await file.arrayBuffer();
      const midi = new Midi(ab);

      // tempo
      const tempos = midi.header.tempos || [];
      bpm = tempos.length ? tempos[0].bpm : 120;

      // key signature (ToneJS Midi exposes header.keySignatures sometimes)
      const ks = midi.header.keySignatures || [];
      if (ks.length) {
        // ToneJS uses {ticks, time, key} in some versions; in others it's {ticks,time,scale,tonic}
        // We'll try to read sf/mi if present; otherwise leave null.
        const first = ks[0];
        if (typeof first.sf === "number" && typeof first.mi === "number") {
          keySig = { sf: first.sf, mi: first.mi };
        } else {
          keySig = null;
        }
      } else {
        keySig = null;
      }
      keyTxt.textContent = keyNameFromSig(keySig);

      // collect notes
      const raw = [];
      midi.tracks.forEach(tr => tr.notes.forEach(n => raw.push({ t:n.time, dur:n.duration, midi:n.midi })));
      raw.sort((a,b) => a.t - b.t || a.midi - b.midi);

      // collapse chords to single note (highest pitch) for MVP
      const collapsed = [];
      const EPS = 0.03;
      for (const n of raw) {
        const last = collapsed[collapsed.length - 1];
        if (last && Math.abs(n.t - last.t) < EPS) {
          if (n.midi > last.midi) collapsed[collapsed.length - 1] = n;
        } else collapsed.push(n);
      }

      const tempoMul = clamp(parseFloat(tempoMulEl.value) || 1, 0.25, 2);

      notes = [];
      let prevString = null;
      for (const n of collapsed) {
        const sIdx = chooseStringIndex(n.midi, prevString);
        prevString = sIdx ?? prevString;

        const semi = (sIdx == null) ? null : (n.midi - STRINGS[sIdx].open);
        const fingerText = semi == null ? "?" : fingerTextForSemi(semi);

        notes.push({
          t: n.t / tempoMul,
          dur: (n.dur || 0.3) / tempoMul,
          midi: n.midi,
          hz: midiToHz(n.midi),
          stringIndex: sIdx,
          label: noteName(n.midi),
          fingerText
        });
      }

      currentIdx = 0;
      visualTime = 0;
      previewPausedAt = 0;
      lastGoodMs = 0;

      // default loop off
      loop.enabled = false;
      loop.start = 0;
      loop.end = Math.max(0, notes.length - 1);
      updateLoopReadout();

      // enable buttons
      previewPlayBtn.disabled = false;
      previewPauseBtn.disabled = false;
      previewStopBtn.disabled = false;
      testSoundBtn.disabled = false;
      startMicBtn.disabled = false;

      loopStartBtn.disabled = false;
      loopEndBtn.disabled = false;
      loopClearBtn.disabled = false;

      updateTargetReadout();
      applyViewVisibility();
      drawFalling();
      drawSheet();
      setMode(mode);

      setStatus(`Loaded ${notes.length} notes. BPM≈${Math.round(bpm)}. ${mode === "preview" ? "Preview ready." : "Learn ready."}`);

    } catch (err) {
      console.error(err);
      setStatus("Could not parse MIDI. Try another .mid file.");
    }
  });

  // ---- Loop controls ----
  function updateLoopReadout() {
    if (!loop.enabled) {
      loopRead.textContent = "Loop: off";
    } else {
      loopRead.textContent = `Loop: ${loop.start + 1} → ${loop.end + 1}`;
    }
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

  function maybeLoopAfterAdvance() {
    if (!loop.enabled) return false;
    if (currentIdx > loop.end) {
      currentIdx = loop.start;
      updateTargetReadout();
      return true;
    }
    return false;
  }

  // ---- Learn (mic) ----
  startMicBtn.addEventListener("click", async () => {
    if (!notes.length) return;

    try {
      stopPreview();

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

      micRunning = true;
      visualTime = notes[currentIdx]?.t ?? 0;
      lastFrameTs = 0;

      setStatus("Mic running. Play the target note to advance.");
      requestAnimationFrame(learnLoop);

    } catch (err) {
      console.error(err);
      setStatus("Microphone permission denied or unavailable.");
    }
  });

  function stopMic() {
    micRunning = false;
    if (audioCtx) { try { audioCtx.close(); } catch {} }
    audioCtx = null; analyser = null; sourceNode = null; pitchDetector = null; floatBuf = null;
    heardTxt.textContent = "—"; clarityTxt.textContent = "—"; deltaTxt.textContent = "—";
    lastGoodMs = 0;
  }

  function learnLoop(ts) {
    if (!micRunning || mode !== "learn") return;

    if (!lastFrameTs) lastFrameTs = ts;
    const dt = (ts - lastFrameTs) / 1000;
    lastFrameTs = ts;

    const current = notes[currentIdx];
    if (current) visualTime = current.t;

    let heard = null;
    let clarity = 0;

    analyser.getFloatTimeDomainData(floatBuf);
    const [pitchHz, c] = pitchDetector.findPitch(floatBuf, audioCtx.sampleRate);
    clarity = c;

    if (pitchHz && isFinite(pitchHz)) heard = pitchHz;

    clarityTxt.textContent = clarity ? clarity.toFixed(2) : "—";
    heardTxt.textContent = heard ? `${heard.toFixed(1)} Hz` : "—";

    if (current) {
      const tol = clamp(parseFloat(tolCentsEl.value) || 35, 10, 80);

      if (heard && clarity > 0.86) {
        const delta = centsOff(heard, current.hz);
        deltaTxt.textContent = `${delta.toFixed(1)} cents`;

        const ok = Math.abs(delta) <= tol;

        if (waitModeEl.checked) {
          if (ok) {
            lastGoodMs += dt * 1000;
            if (lastGoodMs >= NEED_STABLE_MS) {
              currentIdx++;
              if (maybeLoopAfterAdvance()) { /* jumped */ }
              updateTargetReadout();
              lastGoodMs = 0;
            }
          } else lastGoodMs = 0;
        } else {
          // follow mode (still learn): allow time drift slightly
          if (ok) {
            lastGoodMs += dt * 1000;
            if (lastGoodMs >= NEED_STABLE_MS) {
              currentIdx++;
              if (maybeLoopAfterAdvance()) {}
              updateTargetReadout();
              lastGoodMs = 0;
            }
          } else lastGoodMs = 0;
        }
      } else {
        deltaTxt.textContent = "—";
        lastGoodMs = 0;
      }

      if (currentIdx >= notes.length) {
        setStatus("Finished! 🎉");
        stopMic();
      }
    }

    drawFalling();
    drawSheet();
    requestAnimationFrame(learnLoop);
  }

  // ---- Preview audio ----
  function ensurePreviewCtx() {
    if (!previewCtx) previewCtx = new (window.AudioContext || window.webkitAudioContext)();
    // iOS sometimes needs resume on user gesture
    previewCtx.resume?.();
  }

  function playClick(atTime) {
    const o = previewCtx.createOscillator();
    const g = previewCtx.createGain();
    o.type = "square";
    o.frequency.value = 1200;
    g.gain.setValueAtTime(0.0001, atTime);
    g.gain.exponentialRampToValueAtTime(0.35, atTime + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, atTime + 0.04);
    o.connect(g); g.connect(previewCtx.destination);
    o.start(atTime); o.stop(atTime + 0.05);
  }

  function playBeep(freq, atTime, dur) {
    const o = previewCtx.createOscillator();
    const g = previewCtx.createGain();
    o.type = "triangle";
    o.frequency.value = freq;

    // louder than previous version
    const peak = 0.45;

    g.gain.setValueAtTime(0.0001, atTime);
    g.gain.exponentialRampToValueAtTime(peak, atTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, atTime + Math.max(0.06, dur * 0.9));

    o.connect(g); g.connect(previewCtx.destination);
    o.start(atTime);
    o.stop(atTime + Math.max(0.08, dur) + 0.05);
  }

  testSoundBtn.addEventListener("click", () => {
    ensurePreviewCtx();
    const t = previewCtx.currentTime + 0.05;
    playBeep(440, t, 0.25);
    playBeep(660, t + 0.30, 0.25);
    setStatus("Test sound played. If you still hear nothing: iPhone silent switch/volume/Bluetooth.");
  });

  function startPreview() {
    if (!notes.length) return;

    stopMic();
    ensurePreviewCtx();

    previewIsPlaying = true;
    previewPlayBtn.disabled = true;

    // time offsets
    const startOffset = previewPausedAt || 0;

    // count-in
    const countInBeats = clamp(parseInt(countInEl.value || "0", 10), 0, 8);
    const spb = 60 / bpm; // seconds per beat
    const countInSec = countInBeats * spb;

    const now = previewCtx.currentTime;
    for (let i = 0; i < countInBeats; i++) {
      playClick(now + i * spb);
    }

    // schedule notes
    for (const n of notes) {
      if (n.t < startOffset) continue;
      const at = now + countInSec + (n.t - startOffset);
      const dur = clamp(n.dur, 0.08, 1.2);
      playBeep(n.hz, at, dur);
    }

    // optional metronome during preview
    if (metroOnEl.checked) {
      const endT = notes[notes.length - 1]?.t ?? 0;
      const totalSec = countInSec + Math.max(0, endT - startOffset) + 2;
      const beats = Math.ceil(totalSec / spb);
      for (let i = 0; i < beats; i++) {
        playClick(now + i * spb);
      }
    }

    // visuals timer uses performance.now
    previewStartPerf = performance.now() - startOffset * 1000 - countInSec * 1000;

    if (previewTimer) clearInterval(previewTimer);
    previewTimer = setInterval(() => {
      const elapsed = (performance.now() - previewStartPerf) / 1000;

      visualTime = Math.max(0, elapsed);
      // advance currentIdx by time
      while (currentIdx < notes.length - 1 && notes[currentIdx + 1].t <= visualTime) {
        currentIdx++;
        // loop in preview by note index
        if (loop.enabled && currentIdx > loop.end) {
          // jump back
          currentIdx = loop.start;
          // adjust visual time to loop start time
          // (simple approach: just snap)
          visualTime = notes[currentIdx].t;
          // also restart preview audio cleanly
          pausePreview(true);
          startPreview();
          return;
        }
        updateTargetReadout();
      }

      drawFalling();
      drawSheet();

      const endTime = (notes[notes.length - 1]?.t ?? 0) + 1.5;
      if (!loop.enabled && visualTime > endTime) stopPreview();

    }, 30);

    setStatus(countInBeats ? `Count-in: ${countInBeats}… then playing.` : "Preview playing…");
  }

  function pausePreview(silent = false) {
    if (!previewIsPlaying && !silent) return;
    previewIsPlaying = false;
    previewPlayBtn.disabled = false;

    if (previewTimer) clearInterval(previewTimer);
    previewTimer = null;

    const elapsed = (performance.now() - previewStartPerf) / 1000;
    previewPausedAt = Math.max(0, elapsed);

    // stop audio immediately by resetting context
    if (previewCtx) { try { previewCtx.close(); } catch {} previewCtx = null; }

    if (!silent) setStatus("Preview paused.");
  }

  function stopPreview() {
    previewIsPlaying = false;
    previewPlayBtn.disabled = false;

    if (previewTimer) clearInterval(previewTimer);
    previewTimer = null;

    previewPausedAt = 0;

    if (previewCtx) { try { previewCtx.close(); } catch {} previewCtx = null; }

    currentIdx = loop.enabled ? loop.start : 0;
    visualTime = notes[currentIdx]?.t ?? 0;

    updateTargetReadout();
    drawFalling();
    drawSheet();

    if (notes.length) setStatus("Preview stopped.");
  }

  previewPlayBtn.addEventListener("click", startPreview);
  previewPauseBtn.addEventListener("click", () => pausePreview(false));
  previewStopBtn.addEventListener("click", stopPreview);

  // ---- Drawing shared style ----
  function cssVars() {
    const s = getComputedStyle(document.documentElement);
    return {
      bg: s.getPropertyValue("--canvas").trim(),
      lane: s.getPropertyValue("--lane").trim(),
      stroke: s.getPropertyValue("--stroke").trim(),
      text: s.getPropertyValue("--text").trim(),
      muted: s.getPropertyValue("--muted").trim(),
      accent: s.getPropertyValue("--accent").trim()
    };
  }

  // ---- Falling notes draw ----
  function drawFalling() {
    if (!showFallingEl.checked) return;

    const { bg, lane: laneBg, stroke, text, muted, accent } = cssVars();

    const w = canvas.width, h = canvas.height;
    ctx.setTransform(dpr,0,0,dpr,0,0);
    const cssW = w / dpr, cssH = h / dpr;

    ctx.clearRect(0,0,cssW,cssH);
    ctx.fillStyle = bg;
    ctx.fillRect(0,0,cssW,cssH);

    const topPad = 18, bottomPad = 26;
    const lanesY0 = topPad, lanesY1 = cssH - bottomPad;

    const laneCount = 4, laneGap = 10;
    const laneW = Math.floor((cssW - laneGap*(laneCount+1)) / laneCount);
    const laneX = (i) => laneGap + i*(laneW + laneGap);

    // lanes + labels
    for (let i=0;i<laneCount;i++){
      ctx.fillStyle = laneBg;
      ctx.fillRect(laneX(i), lanesY0, laneW, lanesY1 - lanesY0);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      ctx.strokeRect(laneX(i), lanesY0, laneW, lanesY1 - lanesY0);

      ctx.fillStyle = text;
      ctx.globalAlpha = 0.85;
      ctx.font = `900 ${Math.max(16, cssW*0.02)}px system-ui`;
      ctx.fillText(STRINGS[i].name, laneX(i) + 10, lanesY0 + 22);
      ctx.globalAlpha = 1;
    }

    // hit line
    const hitY = lanesY1 - 54;
    ctx.strokeStyle = stroke;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, hitY); ctx.lineTo(cssW, hitY); ctx.stroke();
    ctx.globalAlpha = 1;

    const secondsVisible = 5.0;
    const pxPerSec = (lanesY1 - lanesY0) / secondsVisible;

    const baseFont = clamp(cssW*0.030, 16, 28);
    const currentFont = clamp(cssW*0.036, 18, 34);
    const fingerFont = clamp(cssW*0.024, 14, 20);

    for (let i=0;i<notes.length;i++){
      const n = notes[i];
      const dt = n.t - visualTime;
      if (dt < -0.6 || dt > secondsVisible) continue;

      const y = hitY - dt*pxPerSec;
      const height = Math.max(14, n.dur*pxPerSec);

      const laneIdx = n.stringIndex;
      const x = laneIdx == null ? laneX(0) : laneX(laneIdx);
      const laneWidth = laneIdx == null ? (laneW*4 + laneGap*3) : laneW;

      const isCurrent = i === currentIdx;
      const isPast = i < currentIdx;

      ctx.globalAlpha = isPast ? 0.22 : (isCurrent ? 1 : 0.80);

      ctx.fillStyle = isCurrent ? accent : "#8a8a99";
      if (laneIdx == null) ctx.fillStyle = "#cc7a00";

      const pad = 8;
      const rectX = x + pad;
      const rectW = laneWidth - pad*2;
      const rectY = y - height;
      const rectH = height;

      roundRect(ctx, rectX, rectY, rectW, rectH, 12);
      ctx.fill();

      // note label
      ctx.fillStyle = bg;
      ctx.globalAlpha = isPast ? 0.18 : 0.95;
      ctx.font = `900 ${isCurrent ? currentFont : baseFont}px system-ui`;
      ctx.fillText(n.label, rectX + 10, rectY + Math.min((isCurrent ? currentFont : baseFont) + 6, rectH - 6));

      // finger label badge
      ctx.globalAlpha = isPast ? 0.16 : 0.92;
      const badge = n.fingerText || "?";
      const bx = rectX + rectW - 54;
      const by = rectY + 10;
      ctx.fillStyle = "rgba(0,0,0,0.22)";
      roundRect(ctx, bx, by, 44, 26, 10);
      ctx.fill();
      ctx.fillStyle = bg;
      ctx.font = `900 ${fingerFont}px system-ui`;
      ctx.fillText(badge, bx + 12, by + 19);

      ctx.globalAlpha = 1;
    }

    // footer
    ctx.fillStyle = muted;
    ctx.font = `700 ${Math.max(12, cssW*0.016)}px system-ui`;
    ctx.fillText("Finger labels are first-position heuristics (L=low).", 14, cssH - 9);
  }

  function roundRect(c, x, y, w, h, r){
    const rr = Math.min(r, w/2, h/2);
    c.beginPath();
    c.moveTo(x+rr,y);
    c.arcTo(x+w,y,x+w,y+h,rr);
    c.arcTo(x+w,y+h,x,y+h,rr);
    c.arcTo(x,y+h,x,y,rr);
    c.arcTo(x,y,x+w,y,rr);
    c.closePath();
  }

  // ---- Sheet music draw (simplified, now with key sig + accidentals) ----
  function drawSheet() {
    if (!showSheetEl.checked) return;

    const { bg, stroke, text, muted, accent } = cssVars();
    const w = sheetCanvas.width, h = sheetCanvas.height;
    sctx.setTransform(dpr,0,0,dpr,0,0);
    const cssW = w/dpr, cssH = h/dpr;

    sctx.clearRect(0,0,cssW,cssH);
    sctx.fillStyle = bg;
    sctx.fillRect(0,0,cssW,cssH);

    const pad = 18;
    const left = pad, right = cssW - pad;

    const staffGap = clamp(cssH * 0.12, 48, 78);
    const lineGap = clamp(cssH * 0.03, 9, 14);

    const trebleTop = clamp(cssH * 0.18, 42, 80);
    const bassTop = trebleTop + staffGap + 4*lineGap;

    function staffLines(topY) {
      sctx.strokeStyle = stroke;
      sctx.lineWidth = 1;
      for (let i=0;i<5;i++){
        const y = topY + i*lineGap;
        sctx.beginPath(); sctx.moveTo(left,y); sctx.lineTo(right,y); sctx.stroke();
      }
    }

    staffLines(trebleTop);
    staffLines(bassTop);

    // labels
    sctx.fillStyle = muted;
    sctx.font = `800 ${Math.max(12, cssW*0.016)}px system-ui`;
    sctx.fillText("Treble", left, trebleTop - 10);
    sctx.fillText("Bass", left, bassTop - 10);

    // Playhead
    const playheadX = left + (right-left)*0.18;
    sctx.strokeStyle = stroke;
    sctx.lineWidth = 2;
    sctx.globalAlpha = 0.9;
    sctx.beginPath();
    sctx.moveTo(playheadX, trebleTop - 18);
    sctx.lineTo(playheadX, bassTop + 4*lineGap + 18);
    sctx.stroke();
    sctx.globalAlpha = 1;

    // Key signature (simple glyphs)
    function drawKeySig(sig, staffTopY, isTreble) {
      if (!sig || !sig.sf) return;
      const sf = sig.sf;

      // positions (approx y offsets) for sharps/flats on treble/bass
      // (These are common placements; not perfect engraving, but readable.)
      const sharpTreble = [0,3, -1,2,5,1,4];
      const sharpBass   = [2,5, 1,4,7,3,6];
      const flatTreble  = [4,1,5,2,6,3,7];
      const flatBass    = [6,3,7,4,8,5,9];

      const x0 = left + 58;
      const dx = 10;

      sctx.fillStyle = text;
      sctx.font = `900 ${Math.max(14, cssW*0.020)}px system-ui`;

      const arr = sf > 0 ? (isTreble ? sharpTreble : sharpBass) : (isTreble ? flatTreble : flatBass);
      const glyph = sf > 0 ? "#" : "♭";
      const n = Math.abs(sf);

      for (let i=0;i<n;i++){
        const lineIndex = arr[i]; // 0 bottom line, 1 space, etc (rough)
        const y = (staffTopY + 4*lineGap) - (lineIndex * (lineGap/2));
        sctx.fillText(glyph, x0 + i*dx, y);
      }
    }

    drawKeySig(keySig, trebleTop, true);
    drawKeySig(keySig, bassTop, false);

    // Time window
    const secondsVisible = 6.0;
    const t0 = Math.max(0, visualTime - 0.5);
    const t1 = t0 + secondsVisible;

    // diatonic mapping for vertical placement
    function midiToDiatonicStep(m) {
      const pc = m % 12;
      const map = {0:0,1:0,2:1,3:1,4:2,5:3,6:3,7:4,8:4,9:5,10:5,11:6};
      const di = map[pc];
      const oct = Math.floor(m/12) - 1;
      return oct*7 + di;
    }

    const trebleRefMidi = 64; // E4 bottom line
    const bassRefMidi = 43;   // G2-ish
    const trebleRefStep = midiToDiatonicStep(trebleRefMidi);
    const bassRefStep = midiToDiatonicStep(bassRefMidi);

    function stepToY(step, staffTop, refStep) {
      const dy = (refStep - step) * (lineGap/2);
      const bottomLineY = staffTop + 4*lineGap;
      return bottomLineY + dy;
    }

    function staffFor(midi) { return midi >= 60 ? "treble" : "bass"; }

    // Draw notes
    for (let i=0;i<notes.length;i++){
      const n = notes[i];
      if (n.t < t0 || n.t > t1) continue;

      const x = playheadX + ((n.t - visualTime) / secondsVisible) * (right-left) * 0.78;

      const staff = staffFor(n.midi);
      const step = midiToDiatonicStep(n.midi);
      const y = staff === "treble"
        ? stepToY(step, trebleTop, trebleRefStep)
        : stepToY(step, bassTop, bassRefStep);

      const isCurrent = i === currentIdx;
      const isPast = i < currentIdx;

      sctx.globalAlpha = isPast ? 0.25 : (isCurrent ? 1 : 0.82);
      sctx.fillStyle = isCurrent ? accent : text;

      const r = clamp(cssW*0.010, 5, 8);
      sctx.beginPath();
      sctx.ellipse(x, y, r*1.25, r, -0.35, 0, Math.PI*2);
      sctx.fill();

      // stem
      sctx.strokeStyle = sctx.fillStyle;
      sctx.lineWidth = 2;
      sctx.beginPath();
      if (staff === "treble") {
        sctx.moveTo(x + r*1.1, y);
        sctx.lineTo(x + r*1.1, y - lineGap*2.6);
      } else {
        sctx.moveTo(x - r*1.1, y);
        sctx.lineTo(x - r*1.1, y + lineGap*2.6);
      }
      sctx.stroke();

      // accidental (simplified)
      const acc = needsAccidental(keySig, n.midi);
      if (acc) {
        sctx.fillStyle = text;
        sctx.font = `900 ${clamp(cssW*0.022, 14, 18)}px system-ui`;
        sctx.fillText(acc, x - 18, y + 5);
      }

      // label + finger
      sctx.fillStyle = muted;
      sctx.font = `900 ${clamp(cssW*0.020, 12, 16)}px system-ui`;
      sctx.fillText(n.label, x + 10, y + 5);
      sctx.fillText(`(${n.fingerText})`, x + 10, y + 22);

      sctx.globalAlpha = 1;
    }

    // footer
    sctx.fillStyle = muted;
    sctx.font = `700 ${Math.max(12, cssW*0.016)}px system-ui`;
    sctx.fillText("Sheet view is simplified; key sig/accidentals are approximate but useful.", left, cssH - 10);
  }

  // ---- Init ----
  resizeCanvases();
  applyViewVisibility();
  setMode("preview");
  updateTargetReadout();
  drawFalling();
  drawSheet();

})();
