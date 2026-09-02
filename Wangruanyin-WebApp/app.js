// app.js — Wangruanyin web app controller.
// Wires the input pane, controls, annotated output viewer, selection
// translation popup and page read-aloud — all self-contained (no server).
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const inputText = $('inputText');
  const viewer = $('wry-viewer');
  const statusEl = $('status');
  const pinyinToggle = $('togglePinyin');
  const transToggle = $('toggleTranslation');
  const langSelect = $('targetLang');
  const hskLegend = $('hskLegend');
  const ttsToggle = $('ttsToggle');
  const ttsStop = $('ttsStop');
  const ttsRestart = $('ttsRestart');
  const clearBtn = $('clearBtn');

  const STORAGE_KEY = 'wry_webapp_state_v1';

  // --- App state (persisted to localStorage) --------------------------------
  const state = {
    showPinyin: true,
    showTranslation: true,
    targetLang: 'en',
    hskMode: 'off',            // "off" | "hsk2" | "hsk3"
    hskDisabledLevels: []      // HSK levels (1-9) whose colouring is turned off
  };

  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* private mode etc. */ }
  }
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const o = JSON.parse(raw);
      if (typeof o.showPinyin === 'boolean') state.showPinyin = o.showPinyin;
      if (typeof o.showTranslation === 'boolean') state.showTranslation = o.showTranslation;
      if (typeof o.targetLang === 'string' && langSelect.querySelector('option[value="' + o.targetLang + '"]')) {
        state.targetLang = o.targetLang;
      }
      if (['off', 'hsk2', 'hsk3'].indexOf(o.hskMode) !== -1) state.hskMode = o.hskMode;
      if (Array.isArray(o.hskDisabledLevels)) {
        state.hskDisabledLevels = o.hskDisabledLevels.filter((n) => typeof n === 'number' && n >= 1 && n <= 9);
      }
    } catch (e) { /* corrupt storage → keep defaults */ }
  }

  // --- Translation cache -----------------------------------------------------
  // Repeated renders (HSK level toggles, language switch) re-use translations
  // already fetched in this session so Google isn't hammered on every click.
  const transCache = {};
  let transLang = null;

  function getTranslation(sent, lang) {
    const key = lang + '|' + sent;
    if (Object.prototype.hasOwnProperty.call(transCache, key)) {
      return Promise.resolve(transCache[key]);
    }
    return WryTranslator.translate(sent, lang).then((t) => {
      transCache[key] = t;
      return t;
    }).catch(() => '');
  }

  // --- Rendering -------------------------------------------------------------
  let renderGen = 0;

  function render() {
    const gen = ++renderGen;
    stopPageReader(true);
    hideTranslationPopup();
    WryAnnotator.setHskState(state.hskMode, state.hskDisabledLevels);

    const text = inputText.value;
    viewer.innerHTML = '';
    if (!text.trim()) {
      viewer.innerHTML = '<div class="wry-empty">✍️ Paste or type Chinese text in the left pane to see pinyin, translations and HSK colours.</div>';
      return;
    }
    if (!WryAnnotator.CHINESE_RE.test(text)) {
      viewer.innerHTML = '<div class="wry-empty">No Chinese characters (U+4E00–U+9FFF) found in the text on the left.</div>';
      return;
    }

    const sentences = WryAnnotator.splitIntoSentences(text);
    const showPinyin = state.showPinyin;
    const showTrans = state.showTranslation;
    const frag = document.createDocumentFragment();
    const items = []; // { zh, trEl }

    for (const sentence of sentences) {
      const sentenceEl = WryAnnotator.buildSentenceFragment(sentence, '', {
        showPinyin,
        showTranslation: showTrans,
        waitTranslation: showTrans
      });
      items.push({ zh: sentence, trEl: sentenceEl.querySelector('.zh-translation') });
      frag.appendChild(sentenceEl);
    }
    viewer.appendChild(frag);

    // Fetch translations in the background; discard stale results.
    if (showTrans && items.length) {
      if (transLang !== state.targetLang) {
        for (const k in transCache) delete transCache[k];
        transLang = state.targetLang;
      }
      items.forEach((item) => {
        getTranslation(item.zh, state.targetLang).then((t) => {
          if (gen !== renderGen) return;
          if (item.trEl && item.trEl.isConnected) item.trEl.textContent = t || '';
        });
      });
    }

    const charCount = viewer.querySelectorAll('.zh-char').length;
    statusEl.textContent = sentences.length + ' sentence' + (sentences.length === 1 ? '' : 's') +
      ' · ' + charCount + ' Chinese character' + (charCount === 1 ? '' : 's');
    if (state.hskMode !== 'off') updateHskLegend();
    setTtsButtons();
  }

  let debounceTimer = null;
  inputText.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(render, 400);
  });

  // --- Controls ---------------------------------------------------------------
  pinyinToggle.addEventListener('change', () => {
    state.showPinyin = pinyinToggle.checked;
    persist();
    render();
    showStatus(state.showPinyin ? 'Pinyin annotations ON' : 'Pinyin annotations OFF');
  });

  transToggle.addEventListener('change', () => {
    state.showTranslation = transToggle.checked;
    persist();
    render();
    showStatus(state.showTranslation ? 'Sentence translation ON' : 'Sentence translation OFF');
  });

  langSelect.addEventListener('change', () => {
    state.targetLang = langSelect.value || 'en';
    persist();
    render();
  });

  document.querySelectorAll('input[name="hskMode"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      state.hskMode = radio.value;
      updateHskLegend();
      persist();
      render();
      showStatus({ off: 'HSK colouring Off', hsk2: 'HSK 2.0 colours', hsk3: 'HSK 3.0 colours' }[state.hskMode] || state.hskMode);
    });
  });

  clearBtn.addEventListener('click', () => {
    inputText.value = '';
    render();
    inputText.focus();
  });

  // --- HSK legend (per-level colour toggles) ----------------------------------
  function updateHskLegend() {
    const maxLevel = state.hskMode === 'hsk3' ? 9 : (state.hskMode === 'hsk2' ? 6 : 0);
    document.querySelectorAll('#hskLegend .hsk-color').forEach((sw) => {
      const lv = parseInt(sw.getAttribute('data-level'), 10);
      const visible = lv >= 1 && lv <= maxLevel;
      sw.hidden = !visible;
      sw.style.display = visible ? '' : 'none';
      if (visible) {
        sw.textContent = String(lv);
        sw.classList.toggle('off', state.hskDisabledLevels.indexOf(lv) !== -1);
        sw.setAttribute('aria-pressed', state.hskDisabledLevels.indexOf(lv) !== -1 ? 'false' : 'true');
      }
    });
  }

  document.querySelectorAll('#hskLegend .hsk-color').forEach((sw) => {
    sw.addEventListener('click', () => {
      const lv = parseInt(sw.getAttribute('data-level'), 10);
      if (!lv || state.hskMode === 'off') return;
      const idx = state.hskDisabledLevels.indexOf(lv);
      if (idx === -1) { state.hskDisabledLevels.push(lv); } else { state.hskDisabledLevels.splice(idx, 1); }
      state.hskDisabledLevels.sort((a, b) => a - b);
      updateHskLegend();
      persist();
      render();
    });
  });
// --- Selection translation popup --------------------------------------------
  document.addEventListener('mouseup', (e) => {
    if (e.target.closest && e.target.closest('#wry-translation-popup')) return;
    window.setTimeout(() => {
      const sel = window.getSelection();
      const selectedText = sel ? sel.toString().trim() : '';
      if (!selectedText || !WryAnnotator.CHINESE_RE.test(selectedText)) return;

      let position = { x: e.clientX, y: e.clientY + 12 };
      if (sel && sel.rangeCount > 0) {
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        if (rect.width > 0 || rect.height > 0) {
          position = { x: rect.left + rect.width / 2, y: rect.bottom + 12 };
        }
      }
      showTranslationPopup(selectedText, position);
    }, 60);
  });

  let ttsSpeaking = false;

  function showTranslationPopup(text, position) {
    hideTranslationPopup();
    if (!WryAnnotator.CHINESE_RE.test(text)) return;

    const pinyinLine = WryAnnotator.buildPinyinLine(text);
    const speakText = WryAnnotator.chineseOnly(text);

    const popup = document.createElement('div');
    popup.id = 'wry-translation-popup';
    popup.innerHTML =
      '<div class="wry-header">' +
      '<button type="button" class="wry-tts" title="Pronounce the Chinese text (browser TTS)">🔊 Read aloud</button>' +
      '<button type="button" class="wry-close" title="Close">&times;</button>' +
      '</div>' +
      '<div class="wry-label">Chinese</div>' +
      '<div class="wry-chinese"></div>' +
      '<div class="wry-label">Pinyin</div>' +
      '<div class="wry-pinyin"></div>' +
      '<div class="wry-label">Translation</div>' +
      '<div class="wry-translation"></div>';

    popup.querySelector('.wry-chinese').innerHTML = WryAnnotator.buildChineseHtml(text);
    popup.querySelector('.wry-pinyin').innerHTML = pinyinLine;
    popup.querySelector('.wry-translation').textContent = '';

    // Read aloud: browser speech synthesis (Chinese voice when available).
    const ttsBtn = popup.querySelector('.wry-tts');
    ttsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (ttsSpeaking) {
        stopTtsForPopup();
        ttsBtn.textContent = '🔊 Read aloud';
        ttsBtn.classList.remove('wry-tts-playing');
        return;
      }
      ttsBtn.textContent = '⏹ Stop';
      ttsBtn.classList.add('wry-tts-playing');
      pronounceText(speakText).then(() => {
        ttsBtn.textContent = '🔊 Read aloud';
        ttsBtn.classList.remove('wry-tts-playing');
      });
    });

    document.body.appendChild(popup);

    const rect = popup.getBoundingClientRect();
    let left = Math.max(8, position.x - rect.width / 2);
    let top = position.y;
    if (left + rect.width > window.innerWidth - 8) left = window.innerWidth - rect.width - 8;
    if (top + rect.height > window.innerHeight - 8) top = Math.max(8, position.y - rect.height - 24);
    popup.style.left = left + 'px';
    popup.style.top = top + 'px';

    popup.querySelector('.wry-close').addEventListener('click', hideTranslationPopup);
    window.setTimeout(() => {
      document.addEventListener('click', (ev) => {
        if (!document.getElementById('wry-translation-popup')) return;
        if (!ev.target.closest('#wry-translation-popup')) hideTranslationPopup();
      }, { once: true });
    }, 0);
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') hideTranslationPopup();
    }, { once: true });

    getTranslation(text, state.targetLang).then((t) => {
      const live = document.getElementById('wry-translation-popup');
      if (live) {
        const el = live.querySelector('.wry-translation');
        if (el) el.textContent = t || '';
      }
    });
  }

  function hideTranslationPopup() {
    stopTtsForPopup();
    const existing = document.getElementById('wry-translation-popup');
    if (existing) existing.remove();
  }

  function showStatus(message) {
    statusEl.textContent = message;
    window.setTimeout(() => {
      if (statusEl.textContent === message) statusEl.textContent = '';
    }, 4000);
  }

  // --- Text-to-speech ----------------------------------------------------------
  // Uses the browser's Web Speech API with a Chinese (zh-CN) voice when a
  // compatible voice is available. Requires no external server.
  function speakZh(text, onBoundary, onEnd) {
    try {
      if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
        if (onEnd) onEnd(false);
        return null;
      }
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'zh-CN';
      u.rate = 0.9;
      try {
        const voices = window.speechSynthesis.getVoices();
        const zhVoice = voices.find((v) => /^zh([-_]|$)/i.test(v.lang || ''));
        if (zhVoice) u.voice = zhVoice;
      } catch (e2) { /* some platforms lack getVoices() */ }
      if (onBoundary) u.onboundary = onBoundary;
      if (onEnd) { u.onend = () => onEnd(true); u.onerror = () => onEnd(false); }
      window.speechSynthesis.speak(u);
      return u;
    } catch (e) {
      if (onEnd) onEnd(false);
      return null;
    }
  }

  function stopTtsForPopup() {
    ttsSpeaking = false;
    try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) {}
  }

  function pronounceText(text) {
    return new Promise((resolve) => {
      stopTtsForPopup();
      ttsSpeaking = true;
      const u = speakZh(text, null, (ok) => {
        ttsSpeaking = false;
        resolve(!!ok);
      });
      if (!u) { ttsSpeaking = false; resolve(false); }
    });
  }

  // --- Page read-aloud (reads every annotated sentence in order) --------------
  const pageTts = {
    active: false,
    paused: false,
    gen: 0,
    items: [],   // [{ wrapper, blocks, zh }]
    index: 0,
    timer: null,
    boundarySeen: false,
    startTime: 0
  };

  function collectSentences() {
    pageTts.items = [];
    viewer.querySelectorAll('.zh-sentence').forEach((wrapper) => {
      const blocks = Array.prototype.slice.call(wrapper.querySelectorAll('.zh-char-block'));
      if (!blocks.length) return;
      const zh = WryAnnotator.chineseOnly(blocks.map((b) => {
        const c = b.querySelector('.zh-char');
        return c ? c.textContent : '';
      }).join(''));
      if (zh) pageTts.items.push({ wrapper, blocks, zh });
    });
  }

  function clearHighlight(blocks) {
    blocks.forEach((b) => b.classList.remove('wry-tts-active'));
  }
  function highlightIdx(blocks, idx) {
    blocks.forEach((b, i) => b.classList.toggle('wry-tts-active', i === idx));
  }

  function setTtsButtons() {
    if (!ttsToggle) return;
    const playing = pageTts.active && !pageTts.paused;
    const paused = pageTts.active && pageTts.paused;
    ttsToggle.disabled = false;
    ttsStop.disabled = !pageTts.active;
    ttsRestart.disabled = !pageTts.active;
    ttsToggle.textContent = playing ? '⏸ Pause' : (paused ? '▶ Resume' : '▶ Play');
  }

  function stopPageReader(keepItems) {
    pageTts.active = false;
    pageTts.paused = false;
    pageTts.gen++;
    if (pageTts.timer) { clearInterval(pageTts.timer); pageTts.timer = null; }
    try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) {}
    document.querySelectorAll('.zh-char-block.wry-tts-active').forEach((b) => b.classList.remove('wry-tts-active'));
    if (!keepItems) pageTts.items = [];
    if (ttsToggle) setTtsButtons();
  }

  function readSentence(index) {
    if (!pageTts.active) return;
    if (index >= pageTts.items.length) {
      stopPageReader(true);
      statusEl.textContent = 'Reading finished.';
      return;
    }
    pageTts.index = index;
    if (pageTts.timer) { clearInterval(pageTts.timer); pageTts.timer = null; }
    const item = pageTts.items[index];
    clearHighlight(item.blocks);
    const gen = ++pageTts.gen;
    pageTts.boundarySeen = false;
    pageTts.startTime = Date.now();
    highlightIdx(item.blocks, 0);

    speakZh(item.zh,
      (e) => {
        if (pageTts.gen !== gen || !pageTts.active || pageTts.paused) return;
        pageTts.boundarySeen = true;
        const hanzi = (item.zh.substring(0, e.charIndex || 0).match(/[\u4e00-\u9fff]/g) || []).length;
        highlightIdx(item.blocks, Math.min(item.blocks.length - 1, hanzi));
      },
      () => {
        if (pageTts.gen !== gen || !pageTts.active) return;
        readSentence(index + 1);
      }
    );

    // Coarse fallback while the TTS engine doesn't fire boundary events.
    const estimatedMs = Math.max(1200, item.zh.length * 260);
    pageTts.timer = setInterval(() => {
      if (pageTts.gen !== gen || !pageTts.active || pageTts.paused) return;
      if (pageTts.boundarySeen || !window.speechSynthesis || !window.speechSynthesis.speaking) return;
      const progress = Math.min(1, (Date.now() - pageTts.startTime) / estimatedMs);
      highlightIdx(item.blocks, Math.min(item.blocks.length - 1, Math.floor(progress * item.blocks.length)));
    }, 200);
  }

  function startPageReader(fromIndex) {
    stopPageReader(true);
    collectSentences();
    if (!pageTts.items.length) {
      statusEl.textContent = 'No Chinese sentences to read — paste some text first.';
      return false;
    }
    pageTts.active = true;
    pageTts.paused = false;
    readSentence(fromIndex || 0);
    statusEl.textContent = 'Reading page aloud…';
    return true;
  }
  function pausePageReader() {
    if (!pageTts.active || pageTts.paused) return;
    pageTts.paused = true;
    try { if (window.speechSynthesis) window.speechSynthesis.pause(); } catch (e) {}
    setTtsButtons();
  }
  function resumePageReader() {
    if (!pageTts.active || !pageTts.paused) return;
    pageTts.paused = false;
    try { if (window.speechSynthesis) window.speechSynthesis.resume(); } catch (e) {}
    setTtsButtons();
  }
  function restartPageReader() {
    stopPageReader(true);
    startPageReader(0);
  }

  ttsToggle.addEventListener('click', () => {
    if (pageTts.active && !pageTts.paused) pausePageReader();
    else if (pageTts.active && pageTts.paused) resumePageReader();
    else startPageReader(0);
  });
  ttsStop.addEventListener('click', () => stopPageReader(false));
  ttsRestart.addEventListener('click', () => restartPageReader());

  // --- Initialisation ---------------------------------------------------------
  load();
  pinyinToggle.checked = state.showPinyin;
  transToggle.checked = state.showTranslation;
  langSelect.value = state.targetLang;
  const modeRadio = document.querySelector('input[name="hskMode"][value="' + state.hskMode + '"]');
  if (modeRadio) modeRadio.checked = true;
  updateHskLegend();
  setTtsButtons();
  render();
})();