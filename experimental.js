console.log('TAP Experimental Layer loaded ✓');
(function () {
  const params = new URLSearchParams(window.location.search);
  const experimental = window.tapExperimental = window.tapExperimental || {
    enabled: params.get('exp') === '1',
    mlEnabled: true,
    version: '1.0.0',
  };

  const safe = (fn, fallback) => function (...args) {
    try { return fn.apply(this, args); }
    catch (err) {
      console.error('[TAP Experimental]', err);
      return typeof fallback === 'function' ? fallback.apply(this, args) : fallback;
    }
  };

  const original = {
    AudioEngine: {
      start: AudioEngine.start.bind(AudioEngine),
      hit: AudioEngine.hit.bind(AudioEngine),
      stop: AudioEngine.stop.bind(AudioEngine),
      playPattern: AudioEngine.playPattern.bind(AudioEngine),
    },
    Input: {
      tap: Input.tap.bind(Input),
      toggleMic: Input.toggleMic.bind(Input),
      stopMic: Input.stopMic.bind(Input),
      clear: Input.clear.bind(Input),
    },
    Analyzer: {
      analyze: Analyzer.analyze.bind(Analyzer),
      update: Analyzer.update.bind(Analyzer),
    },
    Groove: {
      buildTracks: Groove.buildTracks.bind(Groove),
      addFill: Groove.addFill.bind(Groove),
      magentaContinue: Groove.magentaContinue.bind(Groove),
      humanize: Groove.humanize.bind(Groove),
    },
    UI: {
      renderTimeline: UI.renderTimeline.bind(UI),
      renderGrid: UI.renderGrid.bind(UI),
      renderResults: UI.renderResults.bind(UI),
      populatePresets: UI.populatePresets.bind(UI),
    },
    Persistence: {
      loadSelectedPreset: Persistence.loadSelectedPreset.bind(Persistence),
      saveCurrentPreset: Persistence.saveCurrentPreset.bind(Persistence),
    },
    Exporter: {
      exportMidi: Exporter.exportMidi.bind(Exporter),
      exportJSON: Exporter.exportJSON.bind(Exporter),
      downloadBlob: Exporter.downloadBlob.bind(Exporter),
    }
  };

  const EXP_KEY = 'tap2track-experimental-enabled';
  experimental.samples = ['kick', 'snare', 'hat', 'perc'];
  experimental.undoLimit = 100;
  experimental.maxTaps = 512;
  experimental.lastGridSignature = '';
  experimental.lastTimelineSignature = '';
  experimental.lastGridPlayhead = -1;
  experimental.pendingGrid = null;
  experimental.pendingTimeline = false;
  experimental.cachedNodes = { rows: {}, timelineBars: [] };
  experimental.shareParam = 'data';
  experimental.genreProfiles = {
    house: { hat: 0.8, sync: 0.18, stability: 0.7, density: 0.65 },
    hiphop: { hat: 0.45, sync: 0.45, stability: 0.45, density: 0.45 },
    latin: { hat: 0.42, sync: 0.55, stability: 0.35, density: 0.52 },
    rock: { hat: 0.5, sync: 0.2, stability: 0.72, density: 0.48 },
    indie: { hat: 0.48, sync: 0.32, stability: 0.55, density: 0.46 },
    'modern-pop': { hat: 0.58, sync: 0.28, stability: 0.62, density: 0.52 },
  };

  experimental.isEnabled = () => experimental.enabled || params.get('exp') === '1' || localStorage.getItem(EXP_KEY) === '1';
  experimental.setEnabled = (value) => {
    experimental.enabled = !!value;
    localStorage.setItem(EXP_KEY, experimental.enabled ? '1' : '0');
    return experimental.enabled;
  };
  if (experimental.enabled) experimental.setEnabled(true);

  Object.defineProperty(window.tapExperimental, 'enabled', {
    get() { return localStorage.getItem(EXP_KEY) === '1' || params.get('exp') === '1'; },
    set(value) {
      localStorage.setItem(EXP_KEY, value ? '1' : '0');
      if (value && state.currentPattern) {
        UI.renderTimeline();
        UI.renderGrid(state.currentPattern, experimental.lastGridPlayhead);
      }
    },
    configurable: true,
  });
  if (params.get('exp') === '1') window.tapExperimental.enabled = true;

  function cloneData(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function pushUndo(label) {
    if (!experimental.isEnabled()) return;
    state.undoStack = state.undoStack || [];
    state.undoStack.push({
      label,
      taps: cloneData(state.taps),
      generatedTracks: cloneData(state.generatedTracks),
      currentPattern: state.currentPattern ? cloneData(state.currentPattern) : null,
      selectedTrackIndex: state.selectedTrackIndex,
      settings: {
        genre: els.genreSelect.value,
        bars: els.barsSelect.value,
        swing: els.swingRange.value,
        density: els.densityRange.value,
        bpm: els.bpmInput.value,
        variation: els.variationRange.value,
      }
    });
    if (state.undoStack.length > experimental.undoLimit) state.undoStack.shift();
  }

  experimental.undo = function () {
    const stack = state.undoStack || [];
    const snap = stack.pop();
    if (!snap) return false;
    state.taps = snap.taps || [];
    state.generatedTracks = snap.generatedTracks || [];
    state.selectedTrackIndex = snap.selectedTrackIndex || 0;
    state.currentPattern = snap.currentPattern || state.generatedTracks[state.selectedTrackIndex] || null;
    els.genreSelect.value = snap.settings.genre;
    els.barsSelect.value = snap.settings.bars;
    els.swingRange.value = snap.settings.swing;
    els.densityRange.value = snap.settings.density;
    els.bpmInput.value = snap.settings.bpm;
    els.variationRange.value = snap.settings.variation;
    Analyzer.update();
    UI.renderTimeline();
    UI.renderResults();
    UI.renderGrid(state.currentPattern);
    return true;
  };

  experimental.capTaps = function () {
    if (!state.taps || state.taps.length <= experimental.maxTaps) return;
    const trimmed = state.taps.slice(-experimental.maxTaps);
    const offset = trimmed[0]?.t || 0;
    state.taps = trimmed.map((tap) => ({ ...tap, t: Math.max(0, tap.t - offset) }));
    state.startedAt = performance.now() - (state.taps[state.taps.length - 1]?.t || 0);
  };

  experimental.getRecentIntervals = function (taps) {
    const intervals = [];
    for (let i = 1; i < taps.length; i += 1) intervals.push(taps[i] - taps[i - 1]);
    return intervals;
  };

  experimental.median = function (values) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };

  experimental.restoreFromShare = function () {
    if (!experimental.isEnabled()) return;
    const data = params.get(experimental.shareParam);
    if (!data) return;
    try {
      const json = decodeURIComponent(escape(atob(data.replace(/-/g, '+').replace(/_/g, '/'))));
      const payload = JSON.parse(json);
      if (payload.settings) {
        els.genreSelect.value = payload.settings.genre || els.genreSelect.value;
        els.barsSelect.value = payload.settings.bars || els.barsSelect.value;
        els.swingRange.value = payload.settings.swing || els.swingRange.value;
        els.densityRange.value = payload.settings.density || els.densityRange.value;
        els.bpmInput.value = payload.settings.bpm || els.bpmInput.value;
        els.variationRange.value = payload.settings.variation || els.variationRange.value;
      }
      state.taps = Array.isArray(payload.taps) ? payload.taps : [];
      state.startedAt = state.taps.length ? performance.now() - state.taps[state.taps.length - 1].t : null;
      Analyzer.update();
      if (payload.generatedTracks) {
        state.generatedTracks = payload.generatedTracks;
        state.selectedTrackIndex = payload.selectedTrackIndex || 0;
        state.currentPattern = state.generatedTracks[state.selectedTrackIndex] || null;
        UI.renderResults();
        UI.renderGrid(state.currentPattern);
      }
      UI.renderTimeline();
      els.presetStatus.textContent = 'Link Restored';
    } catch (err) {
      console.warn('Share restore failed', err);
    }
  };

  experimental.buildShareLink = function () {
    const payload = {
      taps: state.taps,
      generatedTracks: state.generatedTracks,
      selectedTrackIndex: state.selectedTrackIndex,
      settings: {
        genre: els.genreSelect.value,
        bars: els.barsSelect.value,
        swing: els.swingRange.value,
        density: els.densityRange.value,
        bpm: els.bpmInput.value,
        variation: els.variationRange.value,
      }
    };
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(payload)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    const url = new URL(window.location.href);
    url.searchParams.set('exp', '1');
    url.searchParams.set(experimental.shareParam, encoded);
    return url.toString();
  };

  experimental.renderTimelineRAF = function () {
    if (!experimental.isEnabled()) return original.UI.renderTimeline();
    const taps = state.taps || [];
    const sig = taps.map((tap) => `${tap.t.toFixed(1)}:${tap.source}`).join('|');
    if (sig === experimental.lastTimelineSignature) return;
    experimental.lastTimelineSignature = sig;
    if (experimental.pendingTimeline) return;
    experimental.pendingTimeline = true;
    requestAnimationFrame(() => {
      experimental.pendingTimeline = false;
      els.tapTimeline.innerHTML = '';
      if (!taps.length) {
        els.tapTimeline.innerHTML = '<div class="empty-state">No taps captured yet.</div>';
        return;
      }
      const total = Math.max(1, taps[taps.length - 1].t);
      const frag = document.createDocumentFragment();
      taps.forEach((tap, idx) => {
        const bar = document.createElement('div');
        bar.className = 'timeline-bar';
        bar.style.height = `${28 + ((tap.t / total) * 54)}px`;
        bar.title = `${idx + 1}: ${tap.source}`;
        frag.appendChild(bar);
      });
      els.tapTimeline.appendChild(frag);
    });
  };

  experimental.gridSignature = function (pattern) {
    if (!pattern) return 'empty';
    return [pattern.name, pattern.steps, pattern.swing, ...DRUMS.map((voice) => pattern[voice].map((v) => Number(v || 0).toFixed(2)).join(','))].join('|');
  };

  experimental.ensureGridStructure = function (pattern) {
    const sig = experimental.gridSignature(pattern);
    if (sig === experimental.lastGridSignature && experimental.cachedNodes.rows.kick) return;
    experimental.lastGridSignature = sig;
    experimental.cachedNodes.rows = {};
    els.arrangementGrid.innerHTML = '';
    if (!pattern) {
      els.arrangementGrid.innerHTML = '<div class="empty-state">No pattern selected yet.</div>';
      return;
    }
    DRUMS.forEach((voice) => {
      const row = document.createElement('div');
      row.className = 'track-row';
      const label = document.createElement('div');
      label.className = 'track-label';
      label.textContent = voice;
      row.appendChild(label);
      const cells = [];
      pattern[voice].forEach((value, idx) => {
        const cell = document.createElement('div');
        cell.className = `bar-cell ${value > 0 ? 'active' : ''}`.trim();
        cell.textContent = value > 0 ? DISPLAY_MAP[voice] : '·';
        cell.dataset.idx = idx;
        if (value > 0) {
          cell.style.opacity = String(Math.max(0.35, Math.min(1, value)));
          cell.style.transform = idx % 2 ? `translateY(${Math.min(4, pattern.swing * 40).toFixed(1)}px)` : '';
          cell.title = `${voice} step ${idx + 1} · vel ${Math.round(value * 100)}`;
        }
        row.appendChild(cell);
        cells.push(cell);
      });
      experimental.cachedNodes.rows[voice] = cells;
      els.arrangementGrid.appendChild(row);
    });
  };

  experimental.renderGridRAF = function (pattern, playhead = -1) {
    if (!experimental.isEnabled()) return original.UI.renderGrid(pattern, playhead);
    experimental.pendingGrid = { pattern, playhead };
    if (experimental.pendingGridFrame) return;
    experimental.pendingGridFrame = requestAnimationFrame(() => {
      experimental.pendingGridFrame = null;
      const { pattern: p, playhead: h } = experimental.pendingGrid;
      experimental.ensureGridStructure(p);
      if (!p) return;
      DRUMS.forEach((voice) => {
        (experimental.cachedNodes.rows[voice] || []).forEach((cell, idx) => {
          const value = p[voice][idx] || 0;
          const shouldBeActive = value > 0;
          cell.classList.toggle('active', shouldBeActive);
          cell.classList.toggle('playhead', idx === h);
          cell.textContent = shouldBeActive ? DISPLAY_MAP[voice] : '·';
          if (shouldBeActive) {
            cell.style.opacity = String(Math.max(0.35, Math.min(1, value)));
            cell.style.transform = idx % 2 ? `translateY(${Math.min(4, p.swing * 40).toFixed(1)}px)` : '';
            cell.title = `${voice} step ${idx + 1} · vel ${Math.round(value * 100)}`;
          } else {
            cell.style.opacity = '';
            cell.style.transform = '';
            cell.title = `${voice} step ${idx + 1}`;
          }
        });
      });
      experimental.lastGridPlayhead = h;
    });
  };

  experimental.detectGenre = function (analysis, track) {
    if (!experimental.isEnabled()) return els.genreSelect.value;
    const steps = track?.steps || Math.max(16, Number(els.barsSelect.value) * 16);
    const hatDensity = (track?.hat?.filter((v) => v > 0).length || 0) / steps;
    const kickDensity = (track?.kick?.filter((v) => v > 0).length || 0) / steps;
    const density = (hatDensity + kickDensity) / 2;
    const features = {
      hat: hatDensity,
      sync: analysis.syncopation || 0,
      stability: analysis.stability || 0,
      density,
    };
    let best = 'modern-pop';
    let bestScore = Infinity;
    Object.entries(experimental.genreProfiles).forEach(([genre, profile]) => {
      const score = Math.abs(features.hat - profile.hat) + Math.abs(features.sync - profile.sync) + Math.abs(features.stability - profile.stability) + Math.abs(features.density - profile.density);
      if (score < bestScore) {
        bestScore = score;
        best = genre;
      }
    });
    return best;
  };

  experimental.applyDynamicFeel = function (pattern, analysis) {
    if (!experimental.isEnabled()) return pattern;
    const genre = els.genreSelect.value;
    const stability = analysis.stability || 0;
    const humanAmt = Math.max(0.02, (1 - stability) * 0.08 + Number(els.variationRange.value) * 0.05);
    const swingBoost = genre === 'hiphop' ? 0.03 : genre === 'house' ? 0.01 : genre === 'latin' ? 0.04 : 0.02;
    pattern.swing = Math.min(0.24, Math.max(0, pattern.swing + swingBoost * (0.6 + stability * 0.4)));
    DRUMS.forEach((voice) => {
      pattern[voice] = pattern[voice].map((value, idx) => {
        if (value <= 0) return 0;
        const ghost = voice === 'snare' && idx % 4 !== 0 && value < 0.55;
        const variance = (Math.random() - 0.5) * humanAmt;
        const scaled = value + variance - (ghost ? 0.05 : 0);
        return Math.max(0.18, Math.min(1, scaled));
      });
    });
    return pattern;
  };

  experimental.fillLibrary = {
    fill1: [
      { snare: [0, 0.56, 0, 0.7], hat: [0.45, 0.45, 0.55, 0.65], kick: [0, 0, 0, 0.95], perc: [0, 0, 0.3, 0] },
      { snare: [0.44, 0, 0.6, 0.82], hat: [0.5, 0.45, 0.5, 0.6], kick: [0, 0.35, 0, 0.92], perc: [0, 0, 0, 0.36] },
    ],
    fill2: [
      { snare: [0.42, 0.55, 0.64, 0.72, 0.55, 0.62, 0.72, 0.9], hat: [0.44, 0.48, 0.5, 0.55, 0.5, 0.54, 0.58, 0.64], kick: [0, 0, 0.42, 0, 0, 0.5, 0, 0.95], perc: [0.25, 0, 0.28, 0.3, 0.34, 0.38, 0.42, 0.45] },
      { snare: [0, 0.45, 0.5, 0.6, 0.68, 0.72, 0.8, 0.95], hat: [0.48, 0.42, 0.48, 0.52, 0.54, 0.58, 0.6, 0.7], kick: [0.28, 0, 0, 0.42, 0, 0.52, 0, 0.96], perc: [0, 0.24, 0.28, 0, 0.34, 0.36, 0.4, 0.44] },
    ]
  };

  experimental.applySmartFill = function (type) {
    if (!experimental.isEnabled()) return original.Groove.addFill(type);
    const pattern = state.currentPattern;
    if (!pattern) return;
    pushUndo(`fill:${type}`);
    const variants = experimental.fillLibrary[type] || [];
    const variant = variants[Math.floor(Math.random() * variants.length)] || null;
    if (!variant) return original.Groove.addFill(type);
    const span = type === 'fill1' ? 4 : 8;
    const start = pattern.steps - span;
    Object.keys(variant).forEach((voice) => {
      variant[voice].forEach((value, rel) => {
        pattern[voice][start + rel] = Math.max(pattern[voice][start + rel] || 0, value);
      });
    });
    if (experimental.mlEnabled && Math.random() > 0.5) {
      pattern.hat[start] = Math.max(pattern.hat[start], 0.62);
      pattern.perc[pattern.steps - 2] = Math.max(pattern.perc[pattern.steps - 2], 0.48);
    }
    UI.renderResults();
    UI.renderGrid(pattern);
  };

  experimental.loadSampleKit = async function () {
    if (!experimental.isEnabled()) return;
    if (!window.Tone || AudioEngine.__experimentalKitLoaded) return;
    const makePlayer = (voice) => new Tone.Player({ url: `assets/drums/${voice}.wav`, autostart: false }).toDestination();
    const kit = {};
    await Promise.all(experimental.samples.map(async (voice) => {
      try {
        const player = makePlayer(voice);
        await player.load();
        player.volume.value = voice === 'hat' ? -8 : voice === 'snare' ? -5 : voice === 'perc' ? -6 : 0;
        kit[voice] = player;
      } catch (err) {
        console.warn(`Sample fallback for ${voice}`, err);
      }
    }));
    if (Object.keys(kit).length) {
      AudioEngine.kit = { ...(AudioEngine.kit || {}), ...kit };
      AudioEngine.__experimentalKitLoaded = true;
    }
  };

  experimental.ensureMagentaModel = async function () {
    if (!experimental.isEnabled() || !experimental.mlEnabled || !window.mm) return null;
    if (state.magentaModel) return state.magentaModel;
    els.analysisStatus.textContent = 'Loading ML groove model';
    state.magentaModel = new mm.MusicVAE('https://storage.googleapis.com/magentadata/js/checkpoints/music_vae/groovae_2bar_humanize');
    await state.magentaModel.initialize();
    return state.magentaModel;
  };

  experimental.mergePatternVariant = function (base, variant, name) {
    const merged = cloneData(base);
    merged.name = name || `${base.name} · AI`;
    DRUMS.forEach((voice) => {
      merged[voice] = merged[voice].map((value, idx) => Math.max(value || 0, variant[voice]?.[idx] || 0));
    });
    return merged;
  };

  experimental.exportMusicXML = function (pattern) {
    if (!pattern) return;
    const measures = pattern.steps / 16;
    const measureXml = [];
    for (let m = 0; m < measures; m += 1) {
      let notes = '';
      for (let s = 0; s < 16; s += 1) {
        const idx = m * 16 + s;
        const activeVoices = DRUMS.filter((voice) => (pattern[voice][idx] || 0) > 0);
        if (!activeVoices.length) {
          notes += '<note><rest/><duration>1</duration><type>16th</type></note>';
          continue;
        }
        activeVoices.forEach((voice, noteIndex) => {
          notes += `<note>${noteIndex ? '<chord/>' : ''}<unpitched><display-step>${voice === 'kick' ? 'F' : voice === 'snare' ? 'C' : voice === 'hat' ? 'G' : 'A'}</display-step><display-octave>4</display-octave></unpitched><duration>1</duration><instrument id="${voice}"/><voice>1</voice><type>16th</type><stem>up</stem><notehead>${voice === 'hat' ? 'x' : 'normal'}</notehead></note>`;
        });
      }
      measureXml.push(`<measure number="${m + 1}">${m === 0 ? '<attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>percussion</sign><line>2</line></clef></attributes>' : ''}${notes}</measure>`);
    }
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name>Drums</part-name></score-part></part-list><part id="P1">${measureXml.join('')}</part></score-partwise>`;
    original.Exporter.downloadBlob(new Blob([xml], { type: 'application/vnd.recordare.musicxml+xml' }), `${pattern.name.replace(/\s+/g, '-').toLowerCase()}.musicxml`);
  };

  experimental.exportWav = async function (pattern) {
    if (!pattern || !window.Tone) return;
    const renderSeconds = Math.max(2, (60 / pattern.bpm) * (pattern.steps / 4) + 0.5);
    const buffer = await Tone.Offline(async () => {
      try { await experimental.loadSampleKit(); } catch {}
      const players = {};
      experimental.samples.forEach((voice) => {
        players[voice] = new Tone.Player({ url: `assets/drums/${voice}.wav` }).toDestination();
      });
      const stepSeconds = (60 / pattern.bpm) / 4;
      DRUMS.forEach((voice) => {
        pattern[voice].forEach((value, idx) => {
          if (value <= 0) return;
          const when = idx * stepSeconds + (idx % 2 ? pattern.swing * stepSeconds : 0);
          players[voice].volume.value = Tone.gainToDb(Math.max(0.15, Math.min(1, value)));
          players[voice].start(when);
        });
      });
    }, renderSeconds);
    const wav = Tone.Buffer.fromArray(buffer.toArray()).toWav();
    original.Exporter.downloadBlob(new Blob([wav], { type: 'audio/wav' }), `${pattern.name.replace(/\s+/g, '-').toLowerCase()}.wav`);
  };

  experimental.extendExports = function () {
    if (els.exportWavBtn) return;
    const wavBtn = document.createElement('button');
    wavBtn.id = 'exportWavBtn';
    wavBtn.className = 'btn';
    wavBtn.textContent = 'Export WAV';
    wavBtn.style.display = 'none';
    wavBtn.addEventListener('click', () => experimental.exportWav(state.currentPattern));
    els.exportJsonBtn.parentElement?.appendChild(wavBtn);
    els.exportWavBtn = wavBtn;
  };

  experimental.registerPWA = function () {
    if (!experimental.isEnabled()) return;
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('service-worker.js').catch(console.warn);
    if (!document.querySelector('link[rel="manifest"]')) {
      const manifest = document.createElement('link');
      manifest.rel = 'manifest';
      manifest.href = 'manifest.webmanifest';
      document.head.appendChild(manifest);
    }
  };

  AudioEngine.start = safe(async function () {
    const res = await original.AudioEngine.start();
    if (experimental.isEnabled()) {
      experimental.extendExports();
      experimental.registerPWA();
      await experimental.loadSampleKit();
      if (experimental.mlEnabled) experimental.ensureMagentaModel().catch(() => {});
    }
    return res;
  }, original.AudioEngine.start);

  AudioEngine.hit = safe(function (voice, velocity = 0.85, time = Tone.now()) {
    if (!experimental.isEnabled()) return original.AudioEngine.hit(voice, velocity, time);
    const target = AudioEngine.kit && AudioEngine.kit[voice];
    if (target && typeof target.start === 'function') {
      try {
        if (target.state === 'started') target.stop(time);
      } catch {}
      target.volume.value = Tone.gainToDb(Math.max(0.08, Math.min(1, velocity)));
      target.start(time);
      return;
    }
    return original.AudioEngine.hit(voice, velocity, time);
  }, original.AudioEngine.hit);

  AudioEngine.playPattern = safe(function (pattern) {
    if (!experimental.isEnabled()) return original.AudioEngine.playPattern(pattern);
    return original.AudioEngine.playPattern(pattern);
  }, original.AudioEngine.playPattern);

  Input.tap = safe(function (source = 'tap') {
    if (experimental.isEnabled()) pushUndo(`tap:${source}`);
    const result = original.Input.tap(source);
    if (experimental.isEnabled()) experimental.capTaps();
    return result;
  }, original.Input.tap);

  Input.toggleMic = safe(async function () {
    if (!experimental.isEnabled()) return original.Input.toggleMic();
    if (state.mic.active) return original.Input.stopMic();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      const src = ctx.createMediaStreamSource(stream);
      src.connect(analyser);
      state.mic = { ...state.mic, active: true, stream, ctx, analyser, data: new Uint8Array(analyser.fftSize), lastPeak: 0, noiseFloor: 0.004, adaptiveThreshold: 0.015 };
      els.toggleMicBtn.textContent = 'Stop Mic';
      els.captureStatus.textContent = 'Mic Listening';
      const loop = () => {
        if (!state.mic.active) return;
        try {
          analyser.getByteTimeDomainData(state.mic.data);
          let energy = 0;
          for (let i = 0; i < state.mic.data.length; i += 1) {
            const centered = (state.mic.data[i] - 128) / 128;
            energy += centered * centered;
          }
          energy /= state.mic.data.length;
          state.mic.noiseFloor = state.mic.noiseFloor * 0.95 + energy * 0.05;
          state.mic.adaptiveThreshold = Math.max(0.01, state.mic.noiseFloor * 2.4);
          const now = performance.now();
          if (energy > state.mic.adaptiveThreshold && now - state.mic.lastPeak > 110) {
            state.mic.lastPeak = now;
            Input.tap('mic');
          }
        } catch (err) {
          console.warn('Adaptive mic loop recovered', err);
        }
        state.mic.raf = requestAnimationFrame(loop);
      };
      loop();
    } catch (err) {
      els.captureStatus.textContent = 'Mic Denied';
      console.error(err);
    }
  }, original.Input.toggleMic);

  Analyzer.analyze = safe(function () {
    const base = original.Analyzer.analyze();
    if (!experimental.isEnabled()) return base;
    const taps = state.taps.map((x) => x.t);
    if (taps.length < 2) return base;
    const intervals = experimental.getRecentIntervals(taps);
    const recent = intervals.slice(-8);
    const median = experimental.median(recent.length ? recent : intervals) || base.avgInterval || 600;
    const variance = intervals.reduce((acc, v) => acc + (v - median) ** 2, 0) / Math.max(1, intervals.length);
    const stdev = Math.sqrt(variance);
    const bpm = Math.max(50, Math.min(200, Math.round(60000 / median)));
    els.bpmInput.value = bpm;
    els.bpmStat.textContent = bpm;
    const stability = Math.max(0, 1 - stdev / Math.max(1, median));
    const normalized = taps.map((t) => (t / median) % 1);
    const offbeats = normalized.filter((x) => x > 0.18 && x < 0.82).length;
    const syncopation = offbeats / normalized.length;
    const notes = `Pulse suggests ${bpm} BPM from the median of the last ${Math.min(8, intervals.length)} intervals. Stability ${Math.round(stability * 100)}%. Syncopation ${Math.round(syncopation * 100)}%. ${syncopation > 0.45 ? 'Expect busier offbeat material.' : 'Expect stronger downbeats and backbeats.'}`;
    return { ...base, bpm, stability, syncopation, notes, avgInterval: median, normalized };
  }, original.Analyzer.analyze);

  Analyzer.update = safe(function () {
    const res = Analyzer.analyze();
    if (experimental.isEnabled() && res && state.generatedTracks.length) {
      const detected = experimental.detectGenre(res, state.currentPattern || state.generatedTracks[0]);
      if (detected && els.genreSelect.value !== detected) els.genreSelect.value = detected;
    }
    UI.renderAnalysis(res);
  }, original.Analyzer.update);

  Groove.humanize = safe(function (lanes, amount) {
    return original.Groove.humanize(lanes, amount);
  }, original.Groove.humanize);

  Groove.buildTracks = safe(function () {
    const result = original.Groove.buildTracks();
    if (!experimental.isEnabled()) return result;
    const analysis = Analyzer.analyze();
    const detected = experimental.detectGenre(analysis, state.generatedTracks[0]);
    if (detected) els.genreSelect.value = detected;
    state.generatedTracks = state.generatedTracks.map((track) => experimental.applyDynamicFeel(track, analysis));
    state.currentPattern = state.generatedTracks[state.selectedTrackIndex] || state.generatedTracks[0] || null;
    UI.renderResults();
    UI.renderGrid(state.currentPattern);
    return result;
  }, original.Groove.buildTracks);

  Groove.addFill = safe(function (type) {
    return experimental.applySmartFill(type);
  }, original.Groove.addFill);

  Groove.magentaContinue = safe(async function () {
    if (!experimental.isEnabled() || !experimental.mlEnabled) return original.Groove.magentaContinue();
    if (!state.currentPattern) return;
    if (!window.mm) {
      els.analysisNotes.textContent = 'Magenta.js did not load, so the app stayed on local groove generation.';
      return;
    }
    try {
      els.analysisStatus.textContent = 'Loading ML groove model';
      const model = await experimental.ensureMagentaModel();
      const seed = Exporter.patternToNoteSequence(state.currentPattern);
      const result = await model.interpolate([seed, seed], 4);
      if (result && result.length) {
        const aiPattern = Exporter.noteSequenceToPattern(result[result.length - 1], state.currentPattern);
        const merged = experimental.mergePatternVariant(state.currentPattern, aiPattern, `${state.currentPattern.name} · AI Continue`);
        state.generatedTracks = [...state.generatedTracks.slice(0, 3), merged];
        state.selectedTrackIndex = state.generatedTracks.length - 1;
        state.currentPattern = merged;
        UI.renderResults();
        UI.renderGrid(merged);
        els.analysisStatus.textContent = 'ML continuation applied';
      }
    } catch (err) {
      console.error(err);
      els.analysisStatus.textContent = 'ML continuation unavailable';
      els.analysisNotes.textContent = 'The optional Magenta continuation failed, so the local groove engine remains active.';
    }
  }, original.Groove.magentaContinue);

  UI.renderTimeline = safe(function () {
    return experimental.renderTimelineRAF();
  }, original.UI.renderTimeline);

  UI.renderGrid = safe(function (pattern, playhead = -1) {
    return experimental.renderGridRAF(pattern, playhead);
  }, original.UI.renderGrid);

  UI.renderResults = safe(function () {
    const result = original.UI.renderResults();
    if (!experimental.isEnabled()) return result;
    const cards = els.resultsList.querySelectorAll('.clip-card');
    cards.forEach((card, index) => {
      const track = state.generatedTracks[index];
      if (!track) return;
      const meta = card.querySelector('.clip-meta');
      if (meta && track.meta) {
        const aiSuffix = index > 2 ? ' · AI' : '';
        meta.textContent = `${track.meta.genre} · ${track.bpm} BPM · swing ${track.swing.toFixed(2)}${aiSuffix}`;
      }
    });
    return result;
  }, original.UI.renderResults);

  Persistence.saveCurrentPreset = safe(function () {
    if (experimental.isEnabled()) pushUndo('preset-save');
    return original.Persistence.saveCurrentPreset();
  }, original.Persistence.saveCurrentPreset);

  Persistence.loadSelectedPreset = safe(function () {
    const result = original.Persistence.loadSelectedPreset();
    if (experimental.isEnabled()) {
      Analyzer.update();
      UI.renderTimeline();
      UI.renderGrid(state.currentPattern);
    }
    return result;
  }, original.Persistence.loadSelectedPreset);

  Exporter.exportMidi = safe(function (pattern) {
    return original.Exporter.exportMidi(pattern);
  }, original.Exporter.exportMidi);

  Exporter.exportJSON = safe(function (pattern) {
    if (!experimental.isEnabled()) return original.Exporter.exportJSON(pattern);
    const enriched = {
      pattern,
      shareUrl: experimental.buildShareLink(),
      exportedAt: new Date().toISOString(),
      experimental: true,
    };
    return original.Exporter.downloadBlob(new Blob([JSON.stringify(enriched, null, 2)], { type: 'application/json' }), 'tap2track-pattern.json');
  }, original.Exporter.exportJSON);

  document.addEventListener('keydown', async (event) => {
    if (!experimental.isEnabled()) return;
    try {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        experimental.undo();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') {
        event.preventDefault();
        await navigator.clipboard.writeText(experimental.buildShareLink());
        els.presetStatus.textContent = 'Share Link Copied';
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'w') {
        event.preventDefault();
        experimental.exportWav(state.currentPattern);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'x') {
        event.preventDefault();
        experimental.exportMusicXML(state.currentPattern);
      }
    } catch (err) {
      console.warn('Experimental hotkey fallback', err);
    }
  }, true);

  window.addEventListener('load', () => {
    experimental.extendExports();
    experimental.restoreFromShare();
    if (experimental.isEnabled()) {
      experimental.registerPWA();
      if (state.currentPattern) UI.renderGrid(state.currentPattern);
      UI.renderTimeline();
    }
  });
})();
