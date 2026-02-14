/* global Midi, pitchy */

(function () {
  // Register service worker (PWA)
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  const $ = (id) => document.getElementById(id);

  const midiFileEl = $("midiFile");
  const startBtn = $("startBtn");
  const statusEl = $("status");

  const waitModeEl = $("waitMode");
  const tempoMulEl = $("tempoMul");
  const tolCentsEl = $("tolCents");

  const targetTxt = $("targetTxt");
  const heardTxt = $("heardTxt");
  const clarityTxt = $("clarityTxt");
  const deltaTxt = $("deltaTxt");

  const canvas = $("canvas");
  const ctx = canvas.getContext("2d");

  // Violin open strings in MIDI notes:
  // G3=55, D4=62, A4=69, E5=76
  const STRINGS = [
    { name: "G", open: 55 },
    { name: "D", open: 62 },
    { name: "A", open: 69 },
    { name: "E", open: 76 }
  ];

  // --- State ---
  let notes = []; // [{t, dur, midi, hz, stringIndex, label}]
  let currentIdx = 0;

  let audioCtx = null;
  let analyser = null;
  let sourceNode = null;

  let pitchDetector = null;
  let floatBuf = null;

  let started = false;
  let lastGoodMs = 0;
  const NEED_STABLE_MS = 140; // must hold near target a moment

  // Visual timing
  let visualTime = 0; // seconds (can freeze in wait mode)
  let lastFrameTs = 0;

  // --- Helpers ---
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

  // Choose a string lane (first-position-ish):
  // allow up to +7 semitones above open string (approx 1st position range)
  function chooseStringIndex(midi, prevStringIndex = null) {
    const candidates = [];
    for (let i = 0; i < STRINGS.length; i++) {
      const semi = midi - STRINGS[i].open;
      if (semi >= 0 && semi <= 7) candidates.push({ i, semi });
    }
    if (candidates.length === 0) return null;

    // Heuristic: prefer open strings, then minimal semitones, then stay on same string
    candidates.sort((a, b) => {
      const aStay = prevStringIndex === a.i ? -0.2 : 0;
      const bStay = prevStringIndex === b.i ? -0.2 : 0;
      return (a.semi + aStay) - (b.semi + bStay);
    });

    return candidates[0].i;
  }

  // --- MIDI loading ---
  midiFileEl.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const ab = await file.arrayBuffer();
      const midi = new Midi(ab);

      // Gather notes from all tracks; keep monophonic by sorting & taking closest start events
      const raw = [];
      midi.tracks.forEach((tr) => {
        tr.notes.forEach((n) => {
          raw.push({
            t: n.time,
            dur: n.duration,
            midi: n.midi
          });
        });
      });

      raw.sort((a, b) => a.t - b.t || a.midi - b.midi);

      // Optional: collapse near-simultaneous notes (chords) by taking the highest clarity target (here: highest pitch)
      const collapsed = [];
      const EPS = 0.03; // seconds
      for (const n of raw) {
        const last = collapsed[collapsed.length - 1];
        if (last && Math.abs(n.t - last.t) < EPS) {
          // pick one note; for now choose higher midi
          if (n.midi > last.midi) collapsed[collapsed.length - 1] = n;
        } else {
          collapsed.push(n);
        }
      }

      // Apply tempo multiplier (visual)
      const tempoMul = clamp(parseFloat(tempoMulEl.value) || 1, 0.25, 2);

      // Build mapped notes
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
      started = false;
      lastGoodMs = 0;

      startBtn.disabled = false;
      setStatus(`Loaded ${notes.length} notes. Tap “Start Mic” to begin.`);
      updateTargetReadout();
      draw();

    } catch (err) {
      console.error(err);
      setStatus("Could not parse MIDI. Try another .mid file.");
      startBtn.disabled = true;
    }
  });

  // --- Mic start ---
  startBtn.addEventListener("click", async () => {
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

      started = true;
      lastFrameTs = 0;
      setStatus("Mic running. Play the target note to advance.");
      requestAnimationFrame(loop);

    } catch (err) {
      console.error(err);
      setStatus("Microphone permission denied or unavailable.");
    }
  });

  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

  function setStatus(msg) {
    statusEl.textContent = msg;
  }

  function updateTargetReadout() {
    const n = notes[currentIdx];
    if (!n) {
      targetTxt.textContent = "Done!";
      return;
    }
    const lane = n.stringIndex == null ? "?" : STRINGS[n.stringIndex].name;
    targetTxt.textContent = `${n.label}  (${lane} string)`;
  }

  // --- Main loop ---
  function loop(ts) {
    if (!started) return;

    if (!lastFrameTs) lastFrameTs = ts;
    const dt = (ts - lastFrameTs) / 1000;
    lastFrameTs = ts;

    // Update pitch
    let heard = null;
    let clarity = 0;

    analyser.getFloatTimeDomainData(floatBuf);
    const [pitchHz, c] = pitchDetector.findPitch(floatBuf, audioCtx.sampleRate);
    clarity = c;

    if (pitchHz && isFinite(pitchHz)) heard = pitchHz;

    // Update UI
    clarityTxt.textContent = clarity ? clarity.toFixed(2) : "—";
    heardTxt.textContent = heard ? `${heard.toFixed(1)} Hz` : "—";

    const current = notes[currentIdx];
    if (current) {
      const tol = clamp(parseFloat(tolCentsEl.value) || 35, 10, 80);

      if (heard && clarity > 0.86) {
        const delta = centsOff(heard, current.hz);
        deltaTxt.textContent = `${delta.toFixed(1)} cents`;
        const ok = Math.abs(delta) <= tol;

        if (waitModeEl.checked) {
          // In wait mode, only advance time when correct; otherwise freeze the "hit line"
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
          // In follow mode, time advances normally and we also auto-advance when correct near hit moment
          visualTime += dt;
          lastGoodMs = ok ? (lastGoodMs + dt * 1000) : 0;
          if (ok && lastGoodMs >= NEED_STABLE_MS) {
            advanceNote();
            lastGoodMs = 0;
          }
        }
      } else {
        deltaTxt.textContent = "—";
        lastGoodMs = 0;
        if (!waitModeEl.checked) visualTime += dt;
      }

      // In wait mode, keep the "hit line" aligned to current note time
      if (waitModeEl.checked) {
        visualTime = current.t;
      }
    } else {
      heardTxt.textContent = heard ? `${heard.toFixed(1)} Hz` : "—";
      deltaTxt.textContent = "—";
    }

    draw();
    requestAnimationFrame(loop);
  }

  function advanceNote() {
    currentIdx++;
    if (currentIdx >= notes.length) {
      setStatus("Finished! 🎉 Load another MIDI to play again.");
      updateTargetReadout();
      return;
    }
    updateTargetReadout();
  }

  // --- Drawing ---
  function draw() {
    const w = canvas.width;
    const h = canvas.height;

    // Background
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#0f0f14";
    ctx.fillRect(0, 0, w, h);

    const topPad = 20;
    const bottomPad = 30;
    const lanesY0 = topPad;
    const lanesY1 = h - bottomPad;

    const laneCount = 4;
    const laneGap = 12;
    const laneW = Math.floor((w - laneGap * (laneCount + 1)) / laneCount);
    const laneX = (i) => laneGap + i * (laneW + laneGap);

    // Draw lanes
    for (let i = 0; i < laneCount; i++) {
      ctx.fillStyle = "#14141c";
      ctx.fillRect(laneX(i), lanesY0, laneW, lanesY1 - lanesY0);

      ctx.strokeStyle = "#2b2b33";
      ctx.lineWidth = 1;
      ctx.strokeRect(laneX(i), lanesY0, laneW, lanesY1 - lanesY0);

      ctx.fillStyle = "#e9e9ee";
      ctx.globalAlpha = 0.85;
      ctx.font = "bold 16px system-ui";
      ctx.fillText(STRINGS[i].name, laneX(i) + 10, lanesY0 + 22);
      ctx.globalAlpha = 1;
    }

    // Hit line
    const hitY = lanesY1 - 60;
    ctx.strokeStyle = "#3a3a44";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, hitY);
    ctx.lineTo(w, hitY);
    ctx.stroke();

    // Notes window
    const secondsVisible = 5.0;
    const pxPerSec = (lanesY1 - lanesY0) / secondsVisible;

    // Draw upcoming notes
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      const dt = n.t - visualTime;

      // only draw a window around current time
      if (dt < -0.6 || dt > secondsVisible) continue;

      // Y position: dt=0 aligns with hit line
      const y = hitY - dt * pxPerSec;
      const height = Math.max(10, n.dur * pxPerSec);

      const lane = n.stringIndex;
      const x = lane == null ? laneX(0) : laneX(lane);
      const laneWidth = lane == null ? (laneW * 4 + laneGap * 3) : laneW;

      // Style by state
      const isCurrent = (i === currentIdx);
      const isPast = (i < currentIdx);

      ctx.globalAlpha = isPast ? 0.25 : (isCurrent ? 1 : 0.75);

      ctx.fillStyle = isCurrent ? "#2a7cff" : "#8a8a99";
      if (lane == null) ctx.fillStyle = "#cc7a00";

      const pad = 8;
      const rectX = x + pad;
      const rectW = laneWidth - pad * 2;
      const rectY = y - height;
      const rectH = height;

      roundRect(ctx, rectX, rectY, rectW, rectH, 10);
      ctx.fill();

      // Label
      ctx.fillStyle = "#0b0b0d";
      ctx.font = "bold 14px system-ui";
      ctx.globalAlpha = isPast ? 0.18 : 0.95;
      ctx.fillText(n.label, rectX + 10, rectY + Math.min(18, rectH - 6));

      ctx.globalAlpha = 1;
    }

    // Footer hint
    ctx.fillStyle = "#e9e9ee";
    ctx.globalAlpha = 0.65;
    ctx.font = "12px system-ui";
    ctx.fillText("Tip: quiet room + steady bowing improves pitch detection.", 16, h - 10);
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

})();
