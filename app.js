const els = {
  startAudioBtn: document.getElementById('startAudioBtn'),
  toggleMicBtn: document.getElementById('toggleMicBtn'),
  clearInputBtn: document.getElementById('clearInputBtn'),
  generateBtn: document.getElementById('generateBtn'),
  genreSelect: document.getElementById('genreSelect'),
  barsSelect: document.getElementById('barsSelect'),
  swingRange: document.getElementById('swingRange'),
  densityRange: document.getElementById('densityRange'),
  bpmInput: document.getElementById('bpmInput'),
  variationRange: document.getElementById('variationRange'),
  tapBtn: document.getElementById('tapBtn'),
  recordKeysBtn: document.getElementById('recordKeysBtn'),
  quantizeBtn: document.getElementById('quantizeBtn'),
  tapTimeline: document.getElementById('tapTimeline'),
  tapCountStatus: document.getElementById('tapCountStatus'),
  captureStatus: document.getElementById('captureStatus'),
  analysisStatus: document.getElementById('analysisStatus'),
  bpmStat: document.getElementById('bpmStat'),
  stabilityStat: document.getElementById('stabilityStat'),
  syncopationStat: document.getElementById('syncopationStat'),
  gridStat: document.getElementById('gridStat'),
  analysisNotes: document.getElementById('analysisNotes'),
  resultsList: document.getElementById('resultsList'),
  arrangementGrid: document.getElementById('arrangementGrid'),
  playbackStatus: document.getElementById('playbackStatus'),
  applyFill1Btn: document.getElementById('applyFill1Btn'),
  applyFill2Btn: document.getElementById('applyFill2Btn'),
  magentaBtn: document.getElementById('magentaBtn'),
  savePresetBtn: document.getElementById('savePresetBtn'),
  loadPresetBtn: document.getElementById('loadPresetBtn'),
  deletePresetBtn: document.getElementById('deletePresetBtn'),
  presetNameInput: document.getElementById('presetNameInput'),
  presetSelect: document.getElementById('presetSelect'),
  presetStatus: document.getElementById('presetStatus'),
  exportMidiBtn: document.getElementById('exportMidiBtn'),
  exportJsonBtn: document.getElementById('exportJsonBtn'),
};

const state = {
  taps: [],
  startedAt: null,
  isKeyCapture: true,
  mic: { active: false, stream: null, ctx: null, analyser: null, data: null, raf: null, lastPeak: 0 },
  selectedTrackIndex: 0,
  generatedTracks: [],
  currentPattern: null,
  magentaModel: null,
  playback: { loop: null, parts: [], step: 0, playing: false },
  presetsKey: 'tap2track-presets-v1',
};

const DRUMS = ['kick', 'snare', 'hat', 'perc'];
const NOTE_MAP = { kick: 'C1', snare: 'D1', hat: 'F#1', perc: 'A#1' };
const DISPLAY_MAP = { kick: 'K', snare: 'S', hat: 'H', perc: 'P' };
const GENRES = {
  'modern-pop': { hatBias: 0.9, kickBias: 0.92, snareBackbeat: 1.0, percBias: 0.4, swing: 0.04 },
  indie: { hatBias: 0.75, kickBias: 0.8, snareBackbeat: 0.95, percBias: 0.28, swing: 0.05 },
  hiphop: { hatBias: 0.85, kickBias: 1.05, snareBackbeat: 1.0, percBias: 0.2, swing: 0.09 },
  house: { hatBias: 1.1, kickBias: 1.0, snareBackbeat: 0.75, percBias: 0.35, swing: 0.02 },
  latin: { hatBias: 0.78, kickBias: 0.7, snareBackbeat: 0.82, percBias: 0.95, swing: 0.06 },
  rock: { hatBias: 0.88, kickBias: 1.0, snareBackbeat: 1.05, percBias: 0.12, swing: 0.03 },
};

const AudioEngine = {
  kit: null,
  async start() {
    await Tone.start();
    Tone.Transport.bpm.value = Number(els.bpmInput.value);
    if (!this.kit) {
      this.kit = {
        kick: new Tone.MembraneSynth({ pitchDecay: 0.03, octaves: 4, envelope: { attack: 0.001, decay: 0.4, sustain: 0.01, release: 0.2 } }).toDestination(),
        snare: new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.18, sustain: 0 } }).toDestination(),
        hat: new Tone.MetalSynth({ frequency: 240, envelope: { attack: 0.001, decay: 0.09, release: 0.02 }, harmonicity: 5.1, modulationIndex: 32, resonance: 3000, octaves: 1.5 }).toDestination(),
        perc: new Tone.MembraneSynth({ pitchDecay: 0.01, octaves: 1.5, envelope: { attack: 0.001, decay: 0.18, sustain: 0, release: 0.05 } }).toDestination(),
      };
      this.kit.hat.volume.value = -8;
      this.kit.snare.volume.value = -6;
      this.kit.perc.volume.value = -7;
    }
    els.captureStatus.textContent = 'Audio Ready';
  },
  hit(voice, velocity = 0.85, time = Tone.now()) {
    if (!this.kit) return;
    if (voice === 'kick') this.kit.kick.triggerAttackRelease('C1', '8n', time, velocity);
    if (voice === 'snare') this.kit.snare.triggerAttackRelease('16n', time, velocity);
    if (voice === 'hat') this.kit.hat.triggerAttackRelease('32n', time, velocity * 0.7);
    if (voice === 'perc') this.kit.perc.triggerAttackRelease('G2', '16n', time, velocity * 0.7);
  },
  stop() {
    Tone.Transport.stop();
    Tone.Transport.cancel();
    state.playback.playing = false;
    els.playbackStatus.textContent = 'Stopped';
    UI.renderGrid(state.currentPattern, -1);
  },
  playPattern(pattern) {
    if (!pattern) return;
    this.stop();
    Tone.Transport.bpm.value = pattern.bpm;
    const steps = pattern.steps;
    const stepDur = '16n';
    state.playback.step = 0;
    Tone.Transport.scheduleRepeat((time) => {
      const idx = state.playback.step % steps;
      DRUMS.forEach((voice) => {
        const v = pattern[voice][idx];
        if (v > 0) this.hit(voice, v, time + Groove.getSwingOffset(idx, pattern.swing, Tone.Time(stepDur).toSeconds()));
      });
      UI.renderGrid(pattern, idx);
      state.playback.step += 1;
    }, stepDur);
    Tone.Transport.start();
    state.playback.playing = true;
    els.playbackStatus.textContent = `Playing ${pattern.name}`;
  },
};

const Input = {
  tap(source = 'tap') {
    const now = performance.now();
    if (!state.startedAt) state.startedAt = now;
    state.taps.push({ t: now - state.startedAt, source });
    UI.renderTimeline();
    Analyzer.update();
  },
  async toggleMic() {
    if (state.mic.active) return this.stopMic();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      const src = ctx.createMediaStreamSource(stream);
      src.connect(analyser);
      state.mic = { ...state.mic, active: true, stream, ctx, analyser, data: new Uint8Array(analyser.fftSize), lastPeak: 0 };
      els.toggleMicBtn.textContent = 'Stop Mic';
      els.captureStatus.textContent = 'Mic Listening';
      const loop = () => {
        if (!state.mic.active) return;
        analyser.getByteTimeDomainData(state.mic.data);
        let energy = 0;
        for (let i = 0; i < state.mic.data.length; i += 1) {
          const centered = (state.mic.data[i] - 128) / 128;
          energy += centered * centered;
        }
        energy /= state.mic.data.length;
        const now = performance.now();
        if (energy > 0.015 && now - state.mic.lastPeak > 120) {
          state.mic.lastPeak = now;
          this.tap('mic');
        }
        state.mic.raf = requestAnimationFrame(loop);
      };
      loop();
    } catch (err) {
      els.captureStatus.textContent = 'Mic Denied';
      console.error(err);
    }
  },
  stopMic() {
    if (state.mic.raf) cancelAnimationFrame(state.mic.raf);
    if (state.mic.stream) state.mic.stream.getTracks().forEach((track) => track.stop());
    if (state.mic.ctx) state.mic.ctx.close();
    state.mic = { active: false, stream: null, ctx: null, analyser: null, data: null, raf: null, lastPeak: 0 };
    els.toggleMicBtn.textContent = 'Start Mic';
    els.captureStatus.textContent = 'Mic Off';
  },
  clear() {
    state.taps = [];
    state.startedAt = null;
    state.generatedTracks = [];
    state.currentPattern = null;
    AudioEngine.stop();
    UI.renderTimeline();
    UI.renderResults();
    UI.renderGrid(null);
    Analyzer.reset();
  }
};

const Analyzer = {
  update() {
    const res = this.analyze();
    UI.renderAnalysis(res);
  },
  reset() {
    els.tapCountStatus.textContent = '0 taps';
    els.analysisStatus.textContent = 'Waiting for input';
    els.analysisNotes.textContent = 'Tap a pulse or start the mic to build a groove profile.';
    els.stabilityStat.textContent = '—';
    els.syncopationStat.textContent = '—';
  },
  analyze() {
    const taps = state.taps.map((x) => x.t);
    els.tapCountStatus.textContent = `${taps.length} taps`;
    if (taps.length < 2) {
      return { bpm: Number(els.bpmInput.value), stability: 0, syncopation: 0, grid: 16, notes: 'Need at least two hits to infer pulse.' };
    }
    const intervals = [];
    for (let i = 1; i < taps.length; i += 1) intervals.push(taps[i] - taps[i - 1]);
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance = intervals.reduce((acc, v) => acc + (v - avg) ** 2, 0) / Math.max(1, intervals.length);
    const stdev = Math.sqrt(variance);
    const bpm = Math.max(50, Math.min(200, Math.round(60000 / avg)));
    els.bpmInput.value = bpm;
    els.bpmStat.textContent = bpm;
    const stability = Math.max(0, 1 - stdev / Math.max(1, avg));
    const normalized = taps.map((t) => (t / avg) % 1);
    const offbeats = normalized.filter((x) => x > 0.18 && x < 0.82).length;
    const syncopation = offbeats / normalized.length;
    const notes = `Pulse suggests ${bpm} BPM. Stability ${Math.round(stability * 100)}%. Syncopation ${Math.round(syncopation * 100)}%. ${syncopation > 0.45 ? 'Expect busier offbeat material.' : 'Expect stronger downbeats and backbeats.'}`;
    return { bpm, stability, syncopation, grid: 16, notes, avgInterval: avg, normalized };
  }
};

const Groove = {
  getBaseStepDensity() {
    return Number(els.densityRange.value);
  },
  getSwingOffset(stepIndex, swingAmt, stepSeconds) {
    return stepIndex % 2 === 1 ? swingAmt * stepSeconds : 0;
  },
  buildTracks() {
    const analysis = Analyzer.analyze();
    const bars = Number(els.barsSelect.value);
    const steps = 16 * bars;
    const genre = GENRES[els.genreSelect.value];
    const variation = Number(els.variationRange.value);
    const density = this.getBaseStepDensity();
    const tapPattern = this.tapPatternFromInput(analysis, steps);
    const tracks = [
      this.makePattern('Track 1 · Faithful', steps, analysis, genre, density * 0.96, variation * 0.55, tapPattern, 'faithful'),
      this.makePattern('Track 2 · Pocket', steps, analysis, genre, density * 0.88, variation * 0.85, tapPattern, 'pocket'),
      this.makePattern('Track 3 · Energetic', steps, analysis, genre, density * 1.08, variation * 1.1, tapPattern, 'energetic'),
    ];
    state.generatedTracks = tracks;
    state.selectedTrackIndex = 0;
    state.currentPattern = tracks[0];
    UI.renderResults();
    UI.renderGrid(state.currentPattern);
  },
  tapPatternFromInput(analysis, steps) {
    const pattern = new Array(steps).fill(0);
    if (state.taps.length < 2) {
      for (let i = 0; i < steps; i += 4) pattern[i] = 1;
      return pattern;
    }
    const end = state.taps[state.taps.length - 1].t || 1;
    state.taps.forEach((tap) => {
      const idx = Math.min(steps - 1, Math.round((tap.t / end) * (steps - 1)));
      pattern[idx] = 1;
    });
    return pattern;
  },
  makePattern(name, steps, analysis, genre, density, variation, tapPattern, mode) {
    const kick = new Array(steps).fill(0);
    const snare = new Array(steps).fill(0);
    const hat = new Array(steps).fill(0);
    const perc = new Array(steps).fill(0);
    const bpm = analysis.bpm || Number(els.bpmInput.value);
    for (let i = 0; i < steps; i += 1) {
      const beatPos = i % 16;
      const isQuarter = i % 4 === 0;
      const isBackbeat = beatPos === 4 || beatPos === 12;
      const tapWeight = tapPattern[i] ? 1 : 0;
      if (els.genreSelect.value === 'house' && isQuarter) kick[i] = 0.94;
      else if (isQuarter && Math.random() < genre.kickBias * density * 0.8) kick[i] = 0.72 + Math.random() * 0.22;
      if (tapWeight && Math.random() < 0.85) kick[i] = Math.max(kick[i], 0.78);
      if (isBackbeat && Math.random() < genre.snareBackbeat) snare[i] = 0.92;
      if (!isBackbeat && tapWeight && i % 2 === 0 && Math.random() < 0.38 * variation) snare[i] = 0.5;
      if (i % 2 === 0 && Math.random() < genre.hatBias * density * 0.9) hat[i] = 0.45 + Math.random() * 0.2;
      if (mode === 'energetic' && i % 2 === 1 && Math.random() < 0.36 * density) hat[i] = Math.max(hat[i], 0.32);
      if (analysis.syncopation > 0.4 && i % 4 === 2 && Math.random() < 0.45) perc[i] = 0.45;
      if (Math.random() < genre.percBias * 0.18 * variation && i % 4 !== 0) perc[i] = Math.max(perc[i], 0.35 + Math.random() * 0.3);
    }
    this.humanize([kick, snare, hat, perc], variation);
    const pattern = {
      name,
      bpm,
      steps,
      swing: Number(els.swingRange.value) + genre.swing,
      kick,
      snare,
      hat,
      perc,
      meta: {
        stability: analysis.stability,
        syncopation: analysis.syncopation,
        genre: els.genreSelect.value,
      }
    };
    return pattern;
  },
  humanize(lanes, amount) {
    lanes.forEach((lane) => {
      lane.forEach((value, idx) => {
        if (value > 0) lane[idx] = Math.max(0.2, Math.min(1, value + ((Math.random() - 0.5) * 0.15 * amount)));
      });
    });
  },
  addFill(type) {
    const pattern = state.currentPattern;
    if (!pattern) return;
    const span = type === 'fill1' ? 4 : 8;
    const start = pattern.steps - span;
    for (let i = start; i < pattern.steps; i += 1) {
      const rel = i - start;
      pattern.hat[i] = 0.55;
      if (type === 'fill1') {
        if (rel % 2 === 0) pattern.snare[i] = 0.55 + rel * 0.05;
      } else {
        pattern.perc[i] = 0.42 + rel * 0.04;
        if (rel % 2 === 0) pattern.snare[i] = 0.48 + rel * 0.03;
        if (rel === span - 1) pattern.kick[i] = 0.98;
      }
    }
    UI.renderResults();
    UI.renderGrid(pattern);
  },
  async magentaContinue() {
    if (!state.currentPattern) return;
    if (!window.mm) {
      els.analysisNotes.textContent = 'Magenta.js did not load, so the app stayed on local groove generation.';
      return;
    }
    els.analysisStatus.textContent = 'Loading optional ML groove model';
    try {
      if (!state.magentaModel) {
        state.magentaModel = new mm.MusicVAE('https://storage.googleapis.com/magentadata/js/checkpoints/music_vae/groovae_2bar_humanize');
        await state.magentaModel.initialize();
      }
      const seed = Exporter.patternToNoteSequence(state.currentPattern);
      const result = await state.magentaModel.interpolate([seed, seed], 3);
      if (result && result[1]) {
        const merged = Exporter.noteSequenceToPattern(result[1], state.currentPattern);
        state.currentPattern = merged;
        state.generatedTracks[state.selectedTrackIndex] = merged;
        UI.renderResults();
        UI.renderGrid(merged);
        els.analysisStatus.textContent = 'ML continuation applied';
      }
    } catch (err) {
      console.error(err);
      els.analysisStatus.textContent = 'ML continuation unavailable';
      els.analysisNotes.textContent = 'The optional Magenta continuation failed, so the local groove engine remains active.';
    }
  }
};

const UI = {
  renderTimeline() {
    const taps = state.taps;
    els.tapTimeline.innerHTML = '';
    if (!taps.length) {
      els.tapTimeline.innerHTML = '<div class="empty-state">No taps captured yet.</div>';
      return;
    }
    const total = Math.max(1, taps[taps.length - 1].t);
    taps.forEach((tap, idx) => {
      const bar = document.createElement('div');
      bar.className = 'timeline-bar';
      bar.style.height = `${28 + ((tap.t / total) * 54)}px`;
      bar.title = `${idx + 1}: ${tap.source}`;
      els.tapTimeline.appendChild(bar);
    });
  },
  renderAnalysis(res) {
    els.analysisStatus.textContent = res.notes.includes('Need') ? 'Need more taps' : 'Pattern analyzed';
    els.bpmStat.textContent = res.bpm;
    els.stabilityStat.textContent = `${Math.round(res.stability * 100)}%`;
    els.syncopationStat.textContent = `${Math.round(res.syncopation * 100)}%`;
    els.gridStat.textContent = `${res.grid}-step`;
    els.analysisNotes.textContent = res.notes;
  },
  renderResults() {
    els.resultsList.innerHTML = '';
    if (!state.generatedTracks.length) {
      els.resultsList.innerHTML = '<div class="empty-state">Generate tracks to see three groove choices.</div>';
      return;
    }
    state.generatedTracks.forEach((track, index) => {
      const card = document.createElement('article');
      card.className = 'clip-card';
      const activity = track.kick.map((_, i) => track.kick[i] + track.snare[i] + track.hat[i] + track.perc[i]);
      card.innerHTML = `
        <div class="clip-top">
          <div>
            <div class="clip-name">${track.name}</div>
            <div class="clip-meta">${track.meta.genre} · ${track.bpm} BPM · swing ${track.swing.toFixed(2)}</div>
          </div>
          <span class="status">${index === state.selectedTrackIndex ? 'Selected' : 'Ready'}</span>
        </div>
        <div class="clip-preview">${activity.map(v => `<div class="clip-bar" style="height:${10 + (v * 18)}px"></div>`).join('')}</div>
        <div class="clip-strip">
          <span>Stability ${Math.round(track.meta.stability * 100)}%</span>
          <span>Syncopation ${Math.round(track.meta.syncopation * 100)}%</span>
          <span>${track.steps / 16} bar</span>
        </div>
        <div class="clip-actions">
          <button class="btn" data-action="select" data-index="${index}">Select</button>
          <button class="btn" data-action="play" data-index="${index}">Play</button>
        </div>
      `;
      els.resultsList.appendChild(card);
    });
  },
  renderGrid(pattern, playhead = -1) {
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
      pattern[voice].forEach((value, idx) => {
        const cell = document.createElement('div');
        cell.className = `bar-cell ${value > 0 ? 'active' : ''} ${idx === playhead ? 'playhead' : ''}`.trim();
        cell.textContent = value > 0 ? DISPLAY_MAP[voice] : '·';
        row.appendChild(cell);
      });
      els.arrangementGrid.appendChild(row);
    });
  },
  populatePresets() {
    const presets = Persistence.loadPresets();
    els.presetSelect.innerHTML = presets.length
      ? presets.map((p, i) => `<option value="${i}">${p.name}</option>`).join('')
      : '<option value="">No presets saved</option>';
  }
};

const Persistence = {
  loadPresets() {
    try {
      return JSON.parse(localStorage.getItem(state.presetsKey) || '[]');
    } catch {
      return [];
    }
  },
  savePresets(list) {
    localStorage.setItem(state.presetsKey, JSON.stringify(list));
    UI.populatePresets();
  },
  saveCurrentPreset() {
    const name = els.presetNameInput.value.trim() || `Preset ${new Date().toLocaleString()}`;
    const list = this.loadPresets();
    list.unshift({
      name,
      createdAt: new Date().toISOString(),
      taps: state.taps,
      settings: {
        genre: els.genreSelect.value,
        bars: els.barsSelect.value,
        swing: els.swingRange.value,
        density: els.densityRange.value,
        bpm: els.bpmInput.value,
        variation: els.variationRange.value,
      },
      generatedTracks: state.generatedTracks,
      selectedTrackIndex: state.selectedTrackIndex,
    });
    this.savePresets(list.slice(0, 20));
    els.presetStatus.textContent = 'Preset Saved';
  },
  loadSelectedPreset() {
    const list = this.loadPresets();
    const preset = list[Number(els.presetSelect.value)];
    if (!preset) return;
    state.taps = preset.taps || [];
    state.startedAt = state.taps.length ? performance.now() - state.taps[state.taps.length - 1].t : null;
    els.genreSelect.value = preset.settings.genre;
    els.barsSelect.value = preset.settings.bars;
    els.swingRange.value = preset.settings.swing;
    els.densityRange.value = preset.settings.density;
    els.bpmInput.value = preset.settings.bpm;
    els.variationRange.value = preset.settings.variation;
    state.generatedTracks = preset.generatedTracks || [];
    state.selectedTrackIndex = preset.selectedTrackIndex || 0;
    state.currentPattern = state.generatedTracks[state.selectedTrackIndex] || null;
    UI.renderTimeline();
    Analyzer.update();
    UI.renderResults();
    UI.renderGrid(state.currentPattern);
    els.presetStatus.textContent = 'Preset Loaded';
  },
  deleteSelectedPreset() {
    const list = this.loadPresets();
    const idx = Number(els.presetSelect.value);
    if (Number.isNaN(idx)) return;
    list.splice(idx, 1);
    this.savePresets(list);
    els.presetStatus.textContent = 'Preset Deleted';
  }
};

const Exporter = {
  exportMidi(pattern) {
    if (!pattern || !window.Midi) return;
    const midi = new Midi();
    midi.header.setTempo(pattern.bpm);
    DRUMS.forEach((voice) => {
      const track = midi.addTrack();
      track.channel = 9;
      track.name = voice;
      pattern[voice].forEach((value, idx) => {
        if (value <= 0) return;
        track.addNote({
          midi: Tone.Frequency(NOTE_MAP[voice]).toMidi(),
          time: idx * 0.25,
          duration: 0.12,
          velocity: Math.max(0.2, Math.min(1, value)),
        });
      });
    });
    const bytes = midi.toArray();
    this.downloadBlob(new Blob([bytes], { type: 'audio/midi' }), `${pattern.name.replace(/\s+/g, '-').toLowerCase()}.mid`);
  },
  exportJSON(pattern) {
    if (!pattern) return;
    this.downloadBlob(new Blob([JSON.stringify(pattern, null, 2)], { type: 'application/json' }), 'tap2track-pattern.json');
  },
  downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  },
  patternToNoteSequence(pattern) {
    const notes = [];
    DRUMS.forEach((voice) => {
      pattern[voice].forEach((value, idx) => {
        if (value > 0) {
          notes.push({
            pitch: Tone.Frequency(NOTE_MAP[voice]).toMidi(),
            quantizedStartStep: idx,
            quantizedEndStep: idx + 1,
            isDrum: true,
            velocity: Math.round(value * 127),
          });
        }
      });
    });
    return {
      notes,
      quantizationInfo: { stepsPerQuarter: 4 },
      tempos: [{ time: 0, qpm: pattern.bpm }],
      totalQuantizedSteps: pattern.steps,
    };
  },
  noteSequenceToPattern(sequence, fallback) {
    const steps = fallback.steps;
    const base = {
      ...fallback,
      kick: new Array(steps).fill(0),
      snare: new Array(steps).fill(0),
      hat: new Array(steps).fill(0),
      perc: new Array(steps).fill(0),
      name: `${fallback.name} · ML`,
    };
    (sequence.notes || []).forEach((note) => {
      const idx = Math.min(steps - 1, note.quantizedStartStep || 0);
      const velocity = (note.velocity || 80) / 127;
      if (note.pitch <= 37) base.kick[idx] = Math.max(base.kick[idx], velocity);
      else if (note.pitch <= 40) base.snare[idx] = Math.max(base.snare[idx], velocity);
      else if (note.pitch <= 46) base.hat[idx] = Math.max(base.hat[idx], velocity);
      else base.perc[idx] = Math.max(base.perc[idx], velocity);
    });
    return base;
  }
};

function bindEvents() {
  els.startAudioBtn.addEventListener('click', () => AudioEngine.start());
  els.tapBtn.addEventListener('click', () => Input.tap('button'));
  els.recordKeysBtn.addEventListener('click', () => {
    state.isKeyCapture = !state.isKeyCapture;
    els.recordKeysBtn.textContent = state.isKeyCapture ? 'Keyboard Capture On' : 'Keyboard Capture Off';
  });
  els.toggleMicBtn.addEventListener('click', () => Input.toggleMic());
  els.clearInputBtn.addEventListener('click', () => Input.clear());
  els.quantizeBtn.addEventListener('click', () => Analyzer.update());
  els.generateBtn.addEventListener('click', async () => {
    await AudioEngine.start();
    Groove.buildTracks();
  });
  els.applyFill1Btn.addEventListener('click', () => Groove.addFill('fill1'));
  els.applyFill2Btn.addEventListener('click', () => Groove.addFill('fill2'));
  els.magentaBtn.addEventListener('click', () => Groove.magentaContinue());
  els.exportMidiBtn.addEventListener('click', () => Exporter.exportMidi(state.currentPattern));
  els.exportJsonBtn.addEventListener('click', () => Exporter.exportJSON(state.currentPattern));
  els.savePresetBtn.addEventListener('click', () => Persistence.saveCurrentPreset());
  els.loadPresetBtn.addEventListener('click', () => Persistence.loadSelectedPreset());
  els.deletePresetBtn.addEventListener('click', () => Persistence.deleteSelectedPreset());
  els.resultsList.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const index = Number(button.dataset.index);
    if (button.dataset.action === 'select') {
      state.selectedTrackIndex = index;
      state.currentPattern = state.generatedTracks[index];
      UI.renderResults();
      UI.renderGrid(state.currentPattern);
    }
    if (button.dataset.action === 'play') {
      state.selectedTrackIndex = index;
      state.currentPattern = state.generatedTracks[index];
      UI.renderResults();
      AudioEngine.playPattern(state.currentPattern);
    }
  });
  els.bpmInput.addEventListener('change', () => {
    els.bpmStat.textContent = els.bpmInput.value;
    if (state.currentPattern) state.currentPattern.bpm = Number(els.bpmInput.value);
    Tone.Transport.bpm.value = Number(els.bpmInput.value);
  });
  document.addEventListener('keydown', async (event) => {
    if (event.repeat) return;
    if (event.code === 'Space') {
      event.preventDefault();
      await AudioEngine.start();
      if (state.playback.playing) AudioEngine.stop();
      else AudioEngine.playPattern(state.currentPattern);
    }
    if (event.key.toLowerCase() === 't') Input.tap('keyboard');
    if (event.key.toLowerCase() === 'f') Groove.addFill('fill1');
    if (event.key.toLowerCase() === 'g') Groove.addFill('fill2');
    if (event.key.toLowerCase() === 'm') Input.toggleMic();
    if (['1','2','3'].includes(event.key)) {
      const idx = Number(event.key) - 1;
      if (state.generatedTracks[idx]) {
        state.selectedTrackIndex = idx;
        state.currentPattern = state.generatedTracks[idx];
        UI.renderResults();
        UI.renderGrid(state.currentPattern);
      }
    }
    if (state.isKeyCapture && ['Enter', 'Shift', 'Backspace', 'Alt', 'Meta', 'Control'].includes(event.key) === false && !event.ctrlKey && !event.metaKey) {
      Input.tap('key');
    }
  });
}

function init() {
  UI.renderTimeline();
  UI.renderResults();
  UI.renderGrid(null);
  UI.populatePresets();
  Analyzer.reset();
  bindEvents();
}

init();
