/* global Midi, pitchy */

(function () {
  // PWA SW
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  const $ = (id) => document.getElementById(id);

  // Elements
  const midiFileEl = $("midiFile");
  const statusEl = $("status");

  const modePreviewBtn = $("modePreview");
  const modeLearnBtn = $("modeLearn");

  const viewFallingBtn = $("viewFalling");
  const viewSheetBtn = $("viewSheet");

  const previewPlayBtn = $("previewPlayBtn");
  const previewPauseBtn = $("previewPauseBtn");
  const previewStopBtn = $("previewStopBtn");

  const startMicBtn = $("startMicBtn");

  const waitModeEl = $("waitMode");
  const tempoMulEl = $("tempoMul");
  const tolCentsEl = $("tolCents");

  const learnOnlyA = $("learnOnlyA");
  const learnOnlyB = $("learnOnlyB");

  const themeBtn = $("themeBtn");

  const targetTxt = $("targetTxt");
  const heardTxt = $("heardTxt");
  const clarityTxt = $("clarityTxt");
  const deltaTxt = $("deltaTxt");

  const canvas = $("canvas");
  const sheetCanvas = $("sheetCanvas");
  const ctx = canvas.getContext("2d");
  const sctx = sheetCanvas.getContext("2d");

  // Violin open strings in MIDI notes: G3=55, D4=62, A4=69, E5=76
  const STRINGS = [
    { name: "G", open: 55 },
    { name: "D", open: 62 },
    { name: "A", open: 69 },
    { name: "E", open: 76 }
  ];

  // ---------- State ----------
  let notes = []; // [{t, dur, midi, hz, stringIndex, label}]
  let currentIdx = 0;

  let mode = "preview"; // "preview" | "learn"
  let view = "falling"; // "falling" | "sheet"

  // Learning: mic + pitch detection
  let audioCtx = null;
  let analyser = null;
  let sourceNode = null;
  let pitchDetector = null;
  let floatBuf = null;
  let micRunning = false;

  let lastGoodMs = 0;
  const NEED_STABLE_MS = 140;

  // Preview playback (simple synth)
  let previewCtx = null;
  let previewTimer = null;
  let previewStartMs = 0;
  let previewPausedAt = 0;
  let previewIsPlaying = false;

  // Visual timebase
  let visualTime = 0;     // seconds
  let lastFrameTs = 0;

  // HiDPI canvas sizing
  let dpr = 1;
  function resizeCanvases() {
    dpr = window.devicePixelRatio || 1;

    const wrap = document.querySelector(".canvasWrap");
    const cssW = Math.min(wrap.clientWidth, 980);
    const cssH = Math.round(cssW * 0.58); // nice phone-friendly aspect

    // Falling canvas
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);

    // Sheet canvas (taller)
    const sheetCssH = Math.round(cssW * 0.62);
    sheetCanvas.style.width = cssW + "px";
    sheetCanvas.style.height = sheetCssH + "px";
    sheetCanvas.width = Math.floor(cssW * dpr);
    sheetCanvas.height = Math.floor(sheetCssH * dpr);
  }
  window.addEventListener("resize", () => {
    resizeCanvases();
    draw();
    drawSheet();
  });

  // ---------- Helpers ----------
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

  function setStatus(msg) {
    statusEl.textContent = msg;
  }

  function midiToHz(m) {
    return 440 * Math.pow(2, (m - 69) / 12);
  }

  function noteName(midi) {
    const names = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
    const n = names[midi % 12];
    const oct = Math.floor(midi / 12) - 1;
    return `${n}${oct}`;
  }

  function centsOff(freq, targetHz) {
    return 1200 * Math.log2(freq / targetHz);
  }

  // First-position-ish lane choice: allow up to +7 semitones above open
  function chooseStringIndex(midi, prevStringIndex = null) {
    const candidates = [];
    for (let i = 0; i < STRINGS.length; i++) {
      const semi = midi - STRINGS[i].open;
      if (semi >= 0 && semi <= 7) candidates.push({ i, semi });
    }
    if (candidates.length === 0) return null;

    candidates.sort((a, b) => {
      const aStay = prevStringIndex === a.i ? -0.2 : 0;
      const bStay = prevStringIndex === b.i ? -0.2 : 0;
      return (a.semi + aStay) - (b.semi + bStay);
    });

    return candidates[0].i;
  }

  function laneLabel(n) {
    if (!n) return "—";
    const lane = n.stringIndex == null ? "?" : STRINGS[n.stringIndex].name;
    return `${n.label} (${lane} string)`;
  }

  function updateTargetReadout() {
    const n = notes[currentIdx];
    if (!n) {
      targetTxt.textContent = "Done!";
      return;
    }
    targetTxt.textContent = laneLabel(n);
  }

  // Theme toggle
  function setTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    themeBtn.textContent = theme === "dark" ? "🌙 Dark" : "☀️ Light";
  }
  themeBtn.addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme") || "dark";
    setTheme(cur === "dark" ? "light" : "dark");
    draw();
    drawSheet();
  });
  // Start with system preference
  try {
    const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    setTheme(prefersDark ? "dark" : "light");
  } catch {
    setTheme("dark");
  }

  // Mode / view UI
  function setMode(next) {
    mode = next;
    modePreviewBtn.classList.toggle("active", mode === "preview");
    modeLearnBtn.classList.toggle("active", mode === "learn");

    // Show/hide learn-only controls
    learnOnlyA.style.display = mode === "learn" ? "" : "none";
    learnOnlyB.style.display = mode === "learn" ? "" : "none";

    // Buttons
    startMicBtn.style.display = mode === "learn" ? "" : "none";
    previewPlayBtn.style.display = mode === "preview" ? "" : "none";
    previewPauseBtn.style.display = mode === "preview" ? "" : "none";
    previewStopBtn.style.display = mode === "preview" ? "" : "none";

    // Stop anything running when switching
    stopPreview();
    stopMic();

    if (notes.length) {
      if (mode === "preview") {
        setStatus("Preview mode: press Play to listen and watch the notes.");
      } else {
        setStatus("Learn mode: press Start Mic, then play the target note to advance.");
      }
    }
  }
  modePreviewBtn.addEventListener("click", () => setMode("preview"));
  modeLearnBtn.addEventListener("click", () => setMode("learn"));

  function setView(next) {
    view = next;
    viewFallingBtn.classList.toggle("active", view === "falling");
    viewSheetBtn.classList.toggle("active", view === "sheet");

    canvas.classList.toggle("hidden", view !== "falling");
    sheetCanvas.classList.toggle("hidden", view !== "sheet");

    draw();
    drawSheet();
  }
  viewFallingBtn.addEventListener("click", () => setView("falling"));
  viewSheetBtn.addEventListener("click", () => setView("sheet"));

  // ---------- MIDI loading ----------
  midiFileEl.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const ab = await file.arrayBuffer();
      const midi = new Midi(ab);

      const raw = [];
      midi.tracks.forEach((tr) => {
        tr.notes.forEach((n) => raw.push({ t: n.time, dur: n.duration, midi: n.midi }));
      });

      raw.sort((a, b) => a.t - b.t || a.midi - b.midi);

      // Collapse near-simultaneous notes (chords): choose highest pitch
      const collapsed = [];
      const EPS = 0.03;
      for (const n of raw) {
        const last = collapsed[collapsed.length - 1];
        if (last && Math.abs(n.t - last.t) < EPS) {
          if (n.midi > last.midi) collapsed[collapsed.length - 1] = n;
        } else {
          collapsed.push(n);
        }
      }

      const tempoMul = clamp(parseFloat(tempoMulEl.value) || 1, 0.25, 2);

      notes = [];
      let prevString = null;
      for (const n of collapsed) {
        const sIdx = chooseStringIndex(n.midi, prevString);
        prevString = sIdx ?? prevString;
        notes.push({
          t: n.t / tempoMul,
          dur: (n.dur || 0.3) / tempoMul,
          midi: n.midi,
          hz: midiToHz(n.midi),
          stringIndex: sIdx,
          label: `${noteName(n.midi)}`
        });
      }

      currentIdx = 0;
      visualTime = 0;
      lastGoodMs = 0;

      // Enable relevant buttons
      previewPlayBtn.disabled = false;
      previewPauseBtn.disabled = false;
      previewStopBtn.disabled = false;
      startMicBtn.disabled = false;

      updateTargetReadout();
      draw();
      drawSheet();

      setMode(mode); // refresh status based on current mode
      setStatus(`Loaded ${notes.length} notes. (${mode === "preview" ? "Preview ready." : "Learn ready: Start Mic."})`);

    } catch (err) {
      console.error(err);
      setStatus("Could not parse MIDI. Try another .mid file.");
      previewPlayBtn.disabled = true;
      previewPauseBtn.disabled = true;
      previewStopBtn.disabled = true;
      startMicBtn.disabled = true;
    }
  });

  // ---------- Learning (mic) ----------
  startMicBtn.addEventListener("click", async () => {
    if (!notes.length) return;

    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });

      sourceNode = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;

      sourceNode.connect(analyser);

      floatBuf = new Float32Array(analyser.fftSize);
      pitchDetector = pitchy.PitchDetector.forFloat32Array(analyser.fftSize);

      micRunning = true;

      // In learn mode, lock to current note time
      visualTime = notes[currentIdx]?.t ?? 0;
      lastFrameTs = 0;
      setStatus("Mic running. Play the target note to advance.");
      requestAnimationFrame(loop);

    } catch (err) {
      console.error(err);
      setStatus("Microphone permission denied or unavailable.");
    }
  });

  function stopMic() {
    micRunning = false;
    if (audioCtx) {
      try { audioCtx.close(); } catch {}
    }
    audioCtx = null;
    analyser = null;
    sourceNode = null;
    pitchDetector = null;
    floatBuf = null;

    heardTxt.textContent = "—";
    clarityTxt.textContent = "—";
    deltaTxt.textContent = "—";
    lastGoodMs = 0;
  }

  // ---------- Preview playback ----------
  function ensurePreviewCtx() {
    if (!previewCtx) previewCtx = new (window.AudioContext || window.webkitAudioContext)();
  }

  function beepAt(freq, startTime, duration) {
    const o = previewCtx.createOscillator();
    const g = previewCtx.createGain();
    o.type = "sine";
    o.frequency.value = freq;

    // Gentle envelope
    const t0 = startTime;
    const t1 = startTime + Math.max(0.04, duration * 0.9);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.2, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t1);

    o.connect(g);
    g.connect(previewCtx.destination);
    o.start(t0);
    o.stop(t1 + 0.02);
  }

  function playPreview() {
    if (!notes.length) return;
    ensurePreviewCtx();

    // resume if needed (iOS)
    previewCtx.resume?.();

    previewIsPlaying = true;
    previewPlayBtn.disabled = true;

    const startOffset = previewPausedAt || 0;
    previewStartMs = performance.now() - startOffset * 1000;

    // schedule a lightweight tick for visuals
    if (previewTimer) clearInterval(previewTimer);
    previewTimer = setInterval(() => {
      const elapsed = (performance.now() - previewStartMs) / 1000;
      visualTime = elapsed;

      // Move currentIdx to latest note not past too far
      while (currentIdx < notes.length - 1 && notes[currentIdx + 1].t <= visualTime) {
        currentIdx++;
        updateTargetReadout();
      }

      draw();
      if (view === "sheet") drawSheet();

      // stop at end
      if (visualTime > (notes[notes.length - 1].t + 2.0)) {
        stopPreview();
      }
    }, 30);

    // schedule audio for remaining notes
    const now = previewCtx.currentTime;
    for (const n of notes) {
      if (n.t < startOffset) continue;
      const startT = now + (n.t - startOffset);
      const dur = clamp(n.dur, 0.08, 1.2);
      beepAt(n.hz, startT, dur);
    }

    setStatus("Preview playing…");
  }

  function pausePreview() {
    if (!previewIsPlaying) return;
    previewIsPlaying = false;
    previewPlayBtn.disabled = false;

    if (previewTimer) clearInterval(previewTimer);
    previewTimer = null;

    const elapsed = (performance.now() - previewStartMs) / 1000;
    previewPausedAt = elapsed;

    // stop audio immediately by resetting ctx (simple + reliable)
    if (previewCtx) {
      try { previewCtx.close(); } catch {}
      previewCtx = null;
    }

    setStatus("Preview paused.");
  }

  function stopPreview() {
    previewIsPlaying = false;
    previewPlayBtn.disabled = false;

    if (previewTimer) clearInterval(previewTimer);
    previewTimer = null;

    previewPausedAt = 0;

    if (previewCtx) {
      try { previewCtx.close(); } catch {}
      previewCtx = null;
    }

    // reset position (don’t nuke your loaded notes)
    currentIdx = 0;
    visualTime = 0;
    updateTargetReadout();
    draw();
    drawSheet();

    if (notes.length) {
      setStatus("Preview stopped.");
    }
  }

  previewPlayBtn.addEventListener("click", playPreview);
  previewPauseBtn.addEventListener("click", pausePreview);
  previewStopBtn.addEventListener("click", stopPreview);

  // ---------- Main loop (learn mode) ----------
  function loop(ts) {
    if (!micRunning || mode !== "learn") return;

    if (!lastFrameTs) lastFrameTs = ts;
    const dt = (ts - lastFrameTs) / 1000;
    lastFrameTs = ts;

    const current = notes[currentIdx];

    // lock visual time to current target note in learn mode
    if (current) visualTime = current.t;

    // pitch detect
    let heard = null;
    let clarity = 0;

    analyser.getFloatTimeDomainData(floatBuf);
    const [pitchHz, c] = pitchDetector.findPitch(floatBuf, audioCtx.sampleRate);
    clarity = c;

    if (pitchHz && isFinite(pitchHz)) heard = pitchHz;

    // Update readout
    clarityTxt.textContent = clarity ? clarity.toFixed(2) : "—";
    heardTxt.textContent = heard ? `${heard.toFixed(1)} Hz` : "—";

    if (current) {
      const tol = clamp(parseFloat(tolCentsEl.value) || 35, 10, 80);

      if (heard && clarity > 0.86) {
        const delta = centsOff(heard, current.hz);
        deltaTxt.textContent = `${delta.toFixed(1)} cents`;

        const ok = Math.abs(delta) <= tol;

        // Wait mode: only advance when correct
        if (waitModeEl.checked) {
          if (ok) {
            lastGoodMs += dt * 1000;
            if (lastGoodMs >= NEED_STABLE_MS) {
              advanceNote();
              lastGoodMs = 0;
            }
          } else {
            lastGoodMs = 0;
          }
        } else {
          // (Optional) follow mode while still in learn: keep visual time moving
          visualTime += dt;
          if (ok) {
            lastGoodMs += dt * 1000;
            if (lastGoodMs >= NEED_STABLE_MS) {
              advanceNote();
              lastGoodMs = 0;
            }
          } else {
            lastGoodMs = 0;
          }
        }
      } else {
        deltaTxt.textContent = "—";
        lastGoodMs = 0;
      }
    } else {
      deltaTxt.textContent = "—";
    }

    draw();
    if (view === "sheet") drawSheet();

    requestAnimationFrame(loop);
  }

  function advanceNote() {
    currentIdx++;
    if (currentIdx >= notes.length) {
      setStatus("Finished! 🎉 Load another MIDI to play again.");
      updateTargetReadout();
      stopMic(); // stop mic at end (optional, but nice)
      return;
    }
    updateTargetReadout();
  }

  // ---------- Drawing: Falling notes ----------
  function draw() {
    if (view !== "falling") return;

    const w = canvas.width;
    const h = canvas.height;

    // scale drawing to DPR
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cssW = w / dpr;
    const cssH = h / dpr;

    ctx.clearRect(0, 0, cssW, cssH);

    // Colors from CSS variables
    const styles = getComputedStyle(document.documentElement);
    const bg = styles.getPropertyValue("--canvas").trim();
    const laneBg = styles.getPropertyValue("--lane").trim();
    const stroke = styles.getPropertyValue("--stroke").trim();
    const text = styles.getPropertyValue("--text").trim();
    const muted = styles.getPropertyValue("--muted").trim();
    const accent = styles.getPropertyValue("--accent").trim();

    // Background
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, cssW, cssH);

    const topPad = 18;
    const bottomPad = 26;
    const lanesY0 = topPad;
    const lanesY1 = cssH - bottomPad;

    const laneCount = 4;
    const laneGap = 10;
    const laneW = Math.floor((cssW - laneGap * (laneCount + 1)) / laneCount);
    const laneX = (i) => laneGap + i * (laneW + laneGap);

    // Draw lanes + labels
    for (let i = 0; i < laneCount; i++) {
      ctx.fillStyle = laneBg;
      ctx.fillRect(laneX(i), lanesY0, laneW, lanesY1 - lanesY0);

      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      ctx.strokeRect(laneX(i), lanesY0, laneW, lanesY1 - lanesY0);

      ctx.fillStyle = text;
      ctx.globalAlpha = 0.85;
      ctx.font = `800 ${Math.max(16, cssW * 0.02)}px system-ui`;
      ctx.fillText(STRINGS[i].name, laneX(i) + 10, lanesY0 + 22);
      ctx.globalAlpha = 1;
    }

    // Hit line
    const hitY = lanesY1 - 54;
    ctx.strokeStyle = stroke;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, hitY);
    ctx.lineTo(cssW, hitY);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Visibility window
    const secondsVisible = 5.0;
    const pxPerSec = (lanesY1 - lanesY0) / secondsVisible;

    // Bigger labels on small screens
    const baseFont = clamp(cssW * 0.028, 16, 26);      // label size
    const currentFont = clamp(cssW * 0.034, 18, 32);   // current note label

    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      const dt = n.t - visualTime;

      if (dt < -0.6 || dt > secondsVisible) continue;

      const y = hitY - dt * pxPerSec;
      const height = Math.max(12, n.dur * pxPerSec);

      const lane = n.stringIndex;
      const x = lane == null ? laneX(0) : laneX(lane);
      const laneWidth = lane == null ? (laneW * 4 + laneGap * 3) : laneW;

      const isCurrent = (i === currentIdx);
      const isPast = (i < currentIdx);

      ctx.globalAlpha = isPast ? 0.22 : (isCurrent ? 1 : 0.78);

      ctx.fillStyle = isCurrent ? accent : "#8a8a99";
      if (lane == null) ctx.fillStyle = "#cc7a00";

      const pad = 8;
      const rectX = x + pad;
      const rectW = laneWidth - pad * 2;
      const rectY = y - height;
      const rectH = height;

      roundRect(ctx, rectX, rectY, rectW, rectH, 12);
      ctx.fill();

      // Label
      ctx.fillStyle = bg;
      ctx.font = `900 ${isCurrent ? currentFont : baseFont}px system-ui`;
      ctx.globalAlpha = isPast ? 0.18 : 0.95;
      const labelY = rectY + Math.min(isCurrent ? currentFont + 6 : baseFont + 6, rectH - 6);
      ctx.fillText(n.label, rectX + 10, labelY);

      ctx.globalAlpha = 1;
    }

    // Footer hint
    ctx.fillStyle = muted;
    ctx.globalAlpha = 0.95;
    ctx.font = `600 ${Math.max(12, cssW * 0.016)}px system-ui`;
    ctx.fillText(
      "Tip: quiet room + steady bowing improves pitch detection.",
      14,
      cssH - 9
    );
    ctx.globalAlpha = 1;
  }

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  // ---------- Drawing: Sheet music (simple grand staff) ----------
  function drawSheet() {
    if (view !== "sheet") return;

    const w = sheetCanvas.width;
    const h = sheetCanvas.height;

    sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cssW = w / dpr;
    const cssH = h / dpr;

    sctx.clearRect(0, 0, cssW, cssH);

    const styles = getComputedStyle(document.documentElement);
    const bg = styles.getPropertyValue("--canvas").trim();
    const stroke = styles.getPropertyValue("--stroke").trim();
    const text = styles.getPropertyValue("--text").trim();
    const muted = styles.getPropertyValue("--muted").trim();
    const accent = styles.getPropertyValue("--accent").trim();

    sctx.fillStyle = bg;
    sctx.fillRect(0, 0, cssW, cssH);

    // Layout
    const pad = 18;
    const left = pad;
    const right = cssW - pad;

    // Two staves
    const staffGap = clamp(cssH * 0.12, 48, 78);
    const lineGap = clamp(cssH * 0.03, 9, 14);

    const trebleTop = clamp(cssH * 0.18, 42, 80);
    const bassTop = trebleTop + staffGap + 4 * lineGap;

    function drawStaff(topY, label) {
      sctx.strokeStyle = stroke;
      sctx.lineWidth = 1;
      for (let i = 0; i < 5; i++) {
        const y = topY + i * lineGap;
        sctx.beginPath();
        sctx.moveTo(left, y);
        sctx.lineTo(right, y);
        sctx.stroke();
      }
      sctx.fillStyle = muted;
      sctx.font = `700 ${Math.max(12, cssW * 0.016)}px system-ui`;
      sctx.fillText(label, left, topY - 10);
    }

    drawStaff(trebleTop, "Treble");
    drawStaff(bassTop, "Bass");

    // Time window around current visualTime
    const secondsVisible = 6.0;
    const t0 = Math.max(0, visualTime - 0.5);
    const t1 = t0 + secondsVisible;

    // Convert MIDI to staff Y using a simple diatonic step mapping around reference pitches.
    // Treble reference: E4 is bottom line, F4 space, etc. (approx)
    // Bass reference: G2 bottom line-ish (approx)
    function midiToDiatonicStep(m) {
      // map chromatic to diatonic index using letter names, ignoring accidentals for vertical placement
      const pitchClass = m % 12;
      const map = {0:0, 1:0, 2:1, 3:1, 4:2, 5:3, 6:3, 7:4, 8:4, 9:5, 10:5, 11:6}; // C,C#,D,D#,E,F,F#,G,G#,A,A#,B
      const diat = map[pitchClass];
      const oct = Math.floor(m / 12) - 1;
      return oct * 7 + diat;
    }

    const trebleRefMidi = 64; // E4
    const bassRefMidi = 43;   // G2
    const trebleRefStep = midiToDiatonicStep(trebleRefMidi);
    const bassRefStep = midiToDiatonicStep(bassRefMidi);

    function stepToY(step, topY, refStep) {
      // each diatonic step is half a lineGap (line/space)
      const dy = (refStep - step) * (lineGap / 2);
      // ref pitch sits on bottom line (line index 4)
      const bottomLineY = topY + 4 * lineGap;
      return bottomLineY + dy;
    }

    function noteToStaff(midi) {
      // choose treble for C4 and above (60+), bass otherwise
      if (midi >= 60) return "treble";
      return "bass";
    }

    // Draw a playhead
    const playheadX = left + (right - left) * 0.18;
    sctx.strokeStyle = stroke;
    sctx.lineWidth = 2;
    sctx.globalAlpha = 0.9;
    sctx.beginPath();
    sctx.moveTo(playheadX, trebleTop - 18);
    sctx.lineTo(playheadX, bassTop + 4 * lineGap + 18);
    sctx.stroke();
    sctx.globalAlpha = 1;

    // Draw notes in window
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      if (n.t < t0 || n.t > t1) continue;

      const x = playheadX + ((n.t - visualTime) / secondsVisible) * (right - left) * 0.78;

      const staff = noteToStaff(n.midi);
      const step = midiToDiatonicStep(n.midi);

      const y = staff === "treble"
        ? stepToY(step, trebleTop, trebleRefStep)
        : stepToY(step, bassTop, bassRefStep);

      const isCurrent = i === currentIdx;
      const isPast = i < currentIdx;

      sctx.globalAlpha = isPast ? 0.25 : (isCurrent ? 1 : 0.8);
      sctx.fillStyle = isCurrent ? accent : text;

      const r = clamp(cssW * 0.010, 5, 8);
      sctx.beginPath();
      sctx.ellipse(x, y, r * 1.25, r, -0.35, 0, Math.PI * 2);
      sctx.fill();

      // stem (optional)
      sctx.strokeStyle = sctx.fillStyle;
      sctx.lineWidth = 2;
      sctx.beginPath();
      if (staff === "treble") {
        sctx.moveTo(x + r * 1.1, y);
        sctx.lineTo(x + r * 1.1, y - lineGap * 2.6);
      } else {
        sctx.moveTo(x - r * 1.1, y);
        sctx.lineTo(x - r * 1.1, y + lineGap * 2.6);
      }
      sctx.stroke();

      // label bigger (phone-friendly)
      sctx.fillStyle = muted;
      sctx.font = `800 ${clamp(cssW * 0.020, 12, 16)}px system-ui`;
      sctx.fillText(n.label, x + 10, y + 5);

      sctx.globalAlpha = 1;
    }

    // Footer
    sctx.fillStyle = muted;
    sctx.font = `700 ${Math.max(12, cssW * 0.016)}px system-ui`;
    sctx.fillText(
      "Sheet view is simplified (no key signature/accidentals yet).",
      left,
      cssH - 10
    );
  }

  // ---------- Init ----------
  resizeCanvases();
  setMode("preview");
  setView("falling");
  updateTargetReadout();
  draw();
  drawSheet();

})();
