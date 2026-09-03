// page-runner.js
// Wangruanyin website viewer — runs INSIDE a fetched website after the hosting
// app's engine bootstrap loads the engine scripts into the sandboxed iframe.
// Mirrors the extension's content.js: pinyin annotations, sentence
// translation, HSK colour coding, selection popup and read-aloud, all
// operated from a small floating panel injected into the page.
(() => {
  'use strict';
  if (window.__WRY_PAGE_RUNNER__) return;
  window.__WRY_PAGE_RUNNER__ = true;

  const CHINESE_RE = (window.WryAnnotator && window.WryAnnotator.CHINESE_RE) || /[\u4e00-\u9fff]/;
  const A = window.WryAnnotator;

  const LANGS = [
    ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'],
    ['it', 'Italian'], ['pt', 'Portuguese'], ['ru', 'Russian'], ['ja', 'Japanese'],
    ['ko', 'Korean'], ['nl', 'Dutch'], ['pl', 'Polish'], ['tr', 'Turkish']
  ];

  // --- state (mirrors content.js) ---
  let settings = {
    pinyin: true, translation: true, selection: false,
    lang: 'en', hsk: 'off', disabled: [], hskHighlight: false
  };
  let isEnabled = true;          // pinyin annotations master
  let isPageProcessed = false;
  let selectionEnabled = false;
  let targetLang = 'en';
  let hskMode = 'off';
  let hskDisabledLevels = [];
  let hskHighlight = false;      // standalone HSK highlight (no translation)
  let processing = false;

  // Per-site persistence — like the extension's chrome.storage: toggles changed
  // in the floating panel are remembered for that website in the site's own
  // localStorage and re-applied the next time 王软音 is applied on that site.
  let defaultSettings = null;
  const SITE_KEY_PREFIX = 'wry_site_settings_';

  function siteKey() {
    const host = (location.hostname || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const safe = (host || 'local').slice(0, 60);
    let h = 0;
    for (let i = 0; i < safe.length; i++) h = ((h << 5) - h + safe.charCodeAt(i)) | 0;
    return SITE_KEY_PREFIX + (h >>> 0);
  }

  function loadSavedSettings() {
    try {
      const raw = window.localStorage.getItem(siteKey());
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (o && typeof o === 'object') return o;
    } catch (e) { /* storage blocked / corrupt */ }
    return null;
  }

  function saveSettings() {
    try {
      window.localStorage.setItem(siteKey(), JSON.stringify({
        pinyin: isEnabled,
        translation: settings.translation !== false,
        selection: selectionEnabled,
        lang: targetLang,
        hsk: hskMode,
        disabled: hskDisabledLevels.slice(),
        hskHighlight: hskHighlight
      }));
    } catch (e) { /* storage blocked on this site */ }
  }

  const transCache = {};
  let transLang = null;

  function setHskState() {
    if (A && A.setHskState) A.setHskState(hskMode, hskDisabledLevels);
  }

  // --- translation ----------------------------------------------------------
  function getTranslation(text) {
    const key = targetLang + '|' + text;
    if (Object.prototype.hasOwnProperty.call(transCache, key)) return Promise.resolve(transCache[key]);
    return WryTranslator.translate(text, targetLang).then((t) => {
      transCache[key] = t;
      return t;
    }).catch(() => '');
  }

  // --- text walking & page annotation ----------------------------------------
  function walkTextNodes(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) {
      if (CHINESE_RE.test(node.nodeValue)) nodes.push(node);
    }
    return nodes;
  }

  async function processPage() {
    if (!isEnabled || processing) return;
    processing = true;
    try {
      if (document.querySelector('.wry-hsk-span')) removeStandaloneHsk();
      const nodes = walkTextNodes(document.body);
      for (const node of nodes) {
        const parent = node.parentNode;
        if (!parent || !parent.contains(node)) continue;
        const original = node.nodeValue;
        if (!original || !original.trim()) continue;
        const sentences = A.splitIntoSentences(original);
        const outer = document.createDocumentFragment();
        for (const sentence of sentences) {
          let translation = '';
          try { translation = await getTranslation(sentence); } catch (e) {}
          if (!parent.contains(node)) break;
          const frag = A.buildSentenceFragment(sentence, translation, {
            showPinyin: true,
            showTranslation: settings.translation
          });
          outer.appendChild(frag);
        }
        if (parent.contains(node)) parent.replaceChild(outer, node);
      }
      isPageProcessed = true;
      setStatus('王软音 applied to this page.');
    } catch (e) {
      console.error('Wangruanyin page error:', e);
    } finally {
      processing = false;
    }
  }

  function removeAnnotations() {
    stopPageReader(false);
    document.querySelectorAll('.zh-sentence').forEach((el) => {
      const parent = el.parentNode;
      if (!parent) return;
      const chars = [];
      el.querySelectorAll('.zh-char').forEach((c) => chars.push(c.textContent));
      parent.insertBefore(document.createTextNode(chars.join('')), el);
      parent.removeChild(el);
    });
    document.body.normalize();
    isPageProcessed = false;
  }

  // Re-annotate after a language / translation / HSK change (mirrors the popup
  // behaviour: drop the annotations and rebuild with the new options).
  function rebuildAnnotation() {
    if (isPageProcessed) removeAnnotations();
    if (isEnabled) processPage();
  }

  // --- standalone HSK highlight (colours every character, no translation) ----
  function applyStandaloneHsk() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const el = node.parentElement;
        if (el && el.closest && el.closest('.zh-sentence, .wry-hsk-span')) {
          return NodeFilter.FILTER_REJECT;
        }
        return CHINESE_RE.test(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) nodes.push(node);

    for (const n of nodes) {
      const parent = n.parentNode;
      if (!parent || !parent.contains(n)) continue;
      const fragment = document.createDocumentFragment();
      for (const ch of n.nodeValue) {
        if (CHINESE_RE.test(ch)) {
          const hsk = A.getHskLevel(ch);
          const span = document.createElement('span');
          span.className = 'wry-hsk-span' + (hsk > 0 ? ' hsk-lv' + hsk : '');
          if (hsk > 0) span.title = 'HSK ' + hsk;
          span.textContent = ch;
          fragment.appendChild(span);
        } else {
          fragment.appendChild(document.createTextNode(ch));
        }
      }
      if (parent.contains(n)) parent.replaceChild(fragment, n);
    }
  }
// --- selection translation popup -------------------------------------------
  function onSelectionMouseUp(e) {
    if (!selectionEnabled) return;
    if (e.target && e.target.closest && e.target.closest('#wry-translation-popup')) return;
    window.setTimeout(() => {
      const selection = window.getSelection();
      const selectedText = selection ? selection.toString().trim() : '';
      if (!selectedText || !CHINESE_RE.test(selectedText)) return;

      let position = { x: e.clientX, y: e.clientY + 12 };
      if (selection && selection.rangeCount > 0) {
        const rect = selection.getRangeAt(0).getBoundingClientRect();
        if (rect.width > 0 || rect.height > 0) {
          position = { x: rect.left + rect.width / 2, y: rect.bottom + 12 };
        }
      }
      showTranslationPopup(selectedText, position);
    }, 50);
  }

  let selChangeTimer = null;
  function maybeShowSelectionPopup() {
    if (selChangeTimer) clearTimeout(selChangeTimer);
    selChangeTimer = window.setTimeout(() => {
      const selection = window.getSelection();
      const text = selection ? selection.toString().trim() : '';
      if (!selectionEnabled) return;
      if (!text || !CHINESE_RE.test(text)) { hideTranslationPopup(); return; }
      let position = { x: (window.innerWidth || 300) / 2, y: (window.innerHeight || 300) / 2 };
      if (selection && selection.rangeCount > 0) {
        const rect = selection.getRangeAt(0).getBoundingClientRect();
        if (rect.width > 0 || rect.height > 0) {
          position = { x: rect.left + rect.width / 2, y: rect.bottom + 12 };
        }
      }
      showTranslationPopup(text, position);
    }, 280);
  }

  // Touch support: on Android / iOS a long-press fires 'selectionchange'
  // (not mouseup), so we listen for it to open the translation popup there.
  function onSelectionChange() {
    if (!selectionEnabled) return;
    maybeShowSelectionPopup();
  }

  function showTranslationPopup(text, position) {
    hideTranslationPopup();
    if (!CHINESE_RE.test(text)) return;

    const pinyinLine = A.buildPinyinLine(text);
    const speakText = A.chineseOnly(text);

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

    popup.querySelector('.wry-chinese').innerHTML = A.buildChineseHtml(text);
    popup.querySelector('.wry-pinyin').innerHTML = pinyinLine;
    popup.querySelector('.wry-translation').textContent = '';

    const ttsBtn = popup.querySelector('.wry-tts');
    ttsBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (ttsSpeaking) {
        stopTtsForPopup();
        ttsBtn.textContent = '🔊 Read aloud';
        ttsBtn.classList.remove('wry-tts-playing');
        return;
      }
      ttsBtn.textContent = '⏹ Stop';
      ttsBtn.classList.add('wry-tts-playing');
      speakZhText(speakText).then((ok) => {
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

    getTranslation(text).then((t) => {
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

  // --- read-aloud (browser Web Speech API, Chinese voice) ---------------------
  let ttsSpeaking = false;
  let currentUtterance = null;

  function stopTtsForPopup() {
    ttsSpeaking = false;
    if (currentUtterance) { currentUtterance = null; }
    try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) {}
  }

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
      } catch (e2) {}
      if (onBoundary) u.onboundary = onBoundary;
      if (onEnd) { u.onend = () => onEnd(true); u.onerror = () => onEnd(false); }
      window.speechSynthesis.speak(u);
      return u;
    } catch (e) {
      if (onEnd) onEnd(false);
      return null;
    }
  }

  function speakZhText(text) {
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

  function removeStandaloneHsk() {
    document.querySelectorAll('.wry-hsk-span').forEach((span) => {
      const parent = span.parentNode;
      if (!parent) return;
      parent.insertBefore(document.createTextNode(span.textContent), span);
      parent.removeChild(span);
    });
    document.body.normalize();
  }

  // --- whole-page read-aloud (reads every annotated sentence) ----------------
  const pageTts = {
    active: false, paused: false, gen: 0, items: [], index: 0,
    timer: null, boundarySeen: false, startTime: 0
  };

  function collectPageSentences() {
    pageTts.items = [];
    document.querySelectorAll('.zh-sentence').forEach((wrapper) => {
      const blocks = Array.prototype.slice.call(wrapper.querySelectorAll('.zh-char-block'));
      if (!blocks.length) return;
      const zh = A.chineseOnly(blocks.map((b) => {
        const c = b.querySelector('.zh-char');
        return c ? c.textContent : '';
      }).join(''));
      if (zh) pageTts.items.push({ blocks, zh });
    });
  }

  function highlightIdx(blocks, idx) {
    blocks.forEach((b, i) => b.classList.toggle('wry-tts-active', i === idx));
  }
  function clearHighlight(blocks) {
    blocks.forEach((b) => b.classList.remove('wry-tts-active'));
  }

  function stopPageReader(keepItems) {
    pageTts.active = false;
    pageTts.paused = false;
    pageTts.gen++;
    if (pageTts.timer) { clearInterval(pageTts.timer); pageTts.timer = null; }
    try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) {}
    document.querySelectorAll('.zh-char-block.wry-tts-active').forEach((b) => b.classList.remove('wry-tts-active'));
    if (!keepItems) pageTts.items = [];
    syncTtsButtons();
  }

  function readPageSentence(index) {
    if (!pageTts.active) return;
    if (index >= pageTts.items.length) {
      stopPageReader(true);
      setStatus('Reading finished.');
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
        readPageSentence(index + 1);
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

  function startPageReader() {
    stopPageReader(true);
    collectPageSentences();
    if (!pageTts.items.length) {
      setStatus('No annotated sentences to read.');
      return;
    }
    pageTts.active = true;
    pageTts.paused = false;
    readPageSentence(0);
    setStatus('Reading page aloud…');
  }

  function togglePageReader() {
    if (pageTts.active && !pageTts.paused) {
      pageTts.paused = true;
      try { window.speechSynthesis && window.speechSynthesis.pause(); } catch (e) {}
    } else if (pageTts.active && pageTts.paused) {
      pageTts.paused = false;
      try { window.speechSynthesis && window.speechSynthesis.resume(); } catch (e) {}
    } else {
      startPageReader();
    }
    syncTtsButtons();
  }

  function syncTtsButtons() {
    if (!panel) return;
    const play = panel.querySelector('#wrypgPlay');
    const stop = panel.querySelector('#wrypgStop');
    if (!play) return;
    const playing = pageTts.active && !pageTts.paused;
    play.textContent = playing ? '⏸' : '▶';
    play.title = playing ? 'Pause' : 'Play';
    stop.disabled = !pageTts.active;
    play.classList.toggle('playing', playing);
  }

  // --- floating panel ---------------------------------------------------------
  let panel = null;
  // When the hosting app drives everything through its own header toggles
  // (settings.panel === false), the floating panel is not injected into the
  // fetched page — the page is still auto-annotated, just without the popup.
  let panelSuppressed = false;

  function setStatus(msg) {
    if (!panel) return;
    const s = panel.querySelector('.wry-panel-status');
    if (s) s.textContent = msg;
    if (msg) window.setTimeout(() => { if (s && s.textContent === msg) s.textContent = ''; }, 5000);
  }

  function buildPanel() {
    if (panel) return panel;
    const langs = LANGS.map(([v, label]) => '<option value="' + v + '">' + label + '</option>').join('');
    const legend = Array.from({ length: 9 }, (_, i) => {
      const lv = i + 1;
      return '<button type="button" class="hsk-color hsk-lv' + lv + '" data-level="' + lv + '" title="HSK ' + lv + ' — click to toggle">' + lv + '</button>';
    }).join('');

    panel = document.createElement('div');
    panel.id = 'wry-page-panel';
    panel.innerHTML =
      '<div class="wry-panel-head">' +
        '<span class="wry-panel-title">王软音 · Wangruanyin</span>' +
        '<span class="wry-panel-head-btns">' +
          '<button type="button" id="wrypgReset" class="wry-panel-btn" title="Forget this website&#39;s saved toggles and use the bookmark defaults">Reset</button>' +
          '<button type="button" class="wry-panel-close" title="Close and restore the page">&times;</button>' +
        '</span>' +
      '</div>' +
      '<label class="wry-panel-row"><span>Pinyin annotations</span><span class="wry-switch"><input type="checkbox" id="wrypgPinyin"><span class="wry-slider"></span></span></label>' +
      '<label class="wry-panel-row"><span>Sentence translation</span><span class="wry-switch"><input type="checkbox" id="wrypgTrans"><span class="wry-slider"></span></span></label>' +
      '<label class="wry-panel-row"><span>Translate selection</span><span class="wry-switch"><input type="checkbox" id="wrypgSel"><span class="wry-slider"></span></span></label>' +
      '<div class="wry-panel-row"><span>Language</span><select id="wrypgLang">' + langs + '</select></div>' +
      '<div class="wry-panel-row"><span>HSK version</span><span class="wry-panel-hsk" id="wrypgHskWrap">' +
        '<label><input type="radio" name="wrypgHsk" value="off"><span>Off</span></label>' +
        '<label><input type="radio" name="wrypgHsk" value="hsk2"><span>2.0</span></label>' +
        '<label><input type="radio" name="wrypgHsk" value="hsk3"><span>3.0</span></label>' +
      '</span></div>' +
      '<div class="wry-panel-legend" id="wrypgLegend">' + legend + '</div>' +
      '<div class="wry-panel-row"><span>Read page aloud</span><span class="wry-panel-tts">' +
        '<button type="button" id="wrypgPlay" class="wry-panel-btn">▶</button>' +
        '<button type="button" id="wrypgStop" class="wry-panel-btn" disabled>⏹</button>' +
      '</span></div>' +
      '<div class="wry-panel-status"></div>';

    (document.body || document.documentElement).appendChild(panel);
    return panel;
  }

  function byId(id) { return panel ? panel.querySelector('#' + id) : null; }

  function updateLegend() {
    if (!panel) return;
    const maxLevel = hskMode === 'hsk3' ? 9 : (hskMode === 'hsk2' ? 6 : 0);
    panel.querySelectorAll('#wrypgLegend .hsk-color').forEach((sw) => {
      const lv = parseInt(sw.getAttribute('data-level'), 10);
      const visible = lv >= 1 && lv <= maxLevel;
      sw.hidden = !visible;
      sw.style.display = visible ? '' : 'none';
      if (visible) sw.classList.toggle('off', hskDisabledLevels.indexOf(lv) !== -1);
    });
  }

  function syncPanel() {
    const pPin = byId('wrypgPinyin');
    const pTrans = byId('wrypgTrans');
    const pSel = byId('wrypgSel');
    const pLang = byId('wrypgLang');
    if (pPin) pPin.checked = isEnabled;
    if (pTrans) pTrans.checked = settings.translation !== false;
    if (pSel) pSel.checked = selectionEnabled;
    if (pLang) pLang.value = targetLang;
    const wrap = panel && panel.querySelector('#wrypgHskWrap');
    if (wrap) {
      wrap.querySelectorAll('input').forEach((r) => { r.checked = (r.value === hskMode); });
    }
    updateLegend();
    syncTtsButtons();
  }
// --- panel wiring ------------------------------------------------------------
  function wirePanel() {
    if (panel && panel.__wryWired) return;
    if (panel) panel.__wryWired = true;
    const pPin = byId('wrypgPinyin');
    const pTrans = byId('wrypgTrans');
    const pSel = byId('wrypgSel');
    const pLang = byId('wrypgLang');

    pPin.addEventListener('change', () => {
      isEnabled = pPin.checked;
      settings.pinyin = isEnabled;
      if (!isEnabled) { removeAnnotations(); setStatus('Pinyin annotations off.'); }
      else { processPage(); }
      saveSettings();
    });

    pTrans.addEventListener('change', () => {
      settings.translation = pTrans.checked;
      rebuildAnnotation();
      saveSettings();
    });

    pSel.addEventListener('change', () => {
      selectionEnabled = pSel.checked;
      settings.selection = selectionEnabled;
      if (selectionEnabled) {
        document.addEventListener('mouseup', onSelectionMouseUp);
        document.addEventListener('selectionchange', onSelectionChange);
        setStatus('Translate selection — select Chinese text on the page.');
      } else {
        document.removeEventListener('mouseup', onSelectionMouseUp);
        document.removeEventListener('selectionchange', onSelectionChange);
        hideTranslationPopup();
      }
      saveSettings();
    });

    pLang.addEventListener('change', () => {
      targetLang = pLang.value || 'en';
      settings.lang = targetLang;
      transLang = null;
      for (const k in transCache) delete transCache[k];
      rebuildAnnotation();
      saveSettings();
    });

    panel.querySelectorAll('#wrypgHskWrap input').forEach((r) => {
      r.addEventListener('change', () => {
        if (!r.checked) return;
        hskMode = r.value;
        settings.hsk = hskMode;
        setHskState();
        updateLegend();
        rebuildAnnotation();
        if (hskHighlight) { removeStandaloneHsk(); applyStandaloneHsk(); }
        setStatus({ off: 'HSK colouring Off', hsk2: 'HSK 2.0 colours', hsk3: 'HSK 3.0 colours' }[hskMode] || hskMode);
        saveSettings();
      });
    });

    panel.querySelectorAll('#wrypgLegend .hsk-color').forEach((sw) => {
      sw.addEventListener('click', () => {
        const lv = parseInt(sw.getAttribute('data-level'), 10);
        if (!lv || hskMode === 'off') return;
        const idx = hskDisabledLevels.indexOf(lv);
        if (idx === -1) hskDisabledLevels.push(lv); else hskDisabledLevels.splice(idx, 1);
        hskDisabledLevels.sort((a, b) => a - b);
        settings.disabled = hskDisabledLevels.slice();
        setHskState();
        updateLegend();
        rebuildAnnotation();
        if (hskHighlight) { removeStandaloneHsk(); applyStandaloneHsk(); }
        saveSettings();
      });
    });

    byId('wrypgPlay').addEventListener('click', togglePageReader);
    byId('wrypgStop').addEventListener('click', () => stopPageReader(false));

    // Reset: forget this site's saved toggles and re-apply the bookmark defaults.
    const resetBtn = byId('wrypgReset');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        try { window.localStorage.removeItem(siteKey()); } catch (e) {}
        applySettings(defaultSettings || settings);
        syncPanel();
        rebuildAnnotation();
        if (hskHighlight && hskMode !== 'off') { removeStandaloneHsk(); applyStandaloneHsk(); }
        setStatus('Reset to the bookmark defaults.');
      });
    }

    panel.querySelector('.wry-panel-close').addEventListener('click', cleanup);
  }

  // --- init / cleanup / public API ---------------------------------------------
  function applySettings(s) {
    if (!s) s = {};
    settings = Object.assign(settings, s);
    isEnabled = settings.pinyin !== false;
    selectionEnabled = settings.selection === true;
    targetLang = settings.lang || 'en';
    hskMode = ['off', 'hsk2', 'hsk3'].indexOf(settings.hsk) !== -1 ? settings.hsk : 'off';
    hskDisabledLevels = Array.isArray(settings.disabled)
      ? settings.disabled.filter((n) => typeof n === 'number' && n >= 1 && n <= 9)
      : [];
    hskHighlight = settings.hskHighlight === true;
    // Only flip suppression when the host explicitly asked for it — saved
    // per-site toggles (no panel key) must not silently re-enable the popup.
    if (typeof s.panel === 'boolean') panelSuppressed = s.panel === false;
    setHskState();
  }

  function cleanup() {
    stopPageReader(false);
    stopTtsForPopup();
    hideTranslationPopup();
    removeAnnotations();
    removeStandaloneHsk();
    document.removeEventListener('mouseup', onSelectionMouseUp);
    document.removeEventListener('selectionchange', onSelectionChange);
    if (panel) { panel.remove(); panel = null; }
  }

  function init(s) {
    defaultSettings = Object.assign(
      { pinyin: true, translation: true, selection: false, lang: 'en', hsk: 'off', disabled: [], hskHighlight: false },
      s || {}
    );
    applySettings(defaultSettings);
    const saved = loadSavedSettings();
    if (saved) applySettings(saved); // per-site toggles win over the bookmark defaults
    panelSuppressed = defaultSettings.panel === false; // the host hides the popup
    if (!panelSuppressed) {
      buildPanel();
      wirePanel();
      syncPanel();
    }
    if (selectionEnabled) {
      document.addEventListener('mouseup', onSelectionMouseUp);
      document.addEventListener('selectionchange', onSelectionChange);
    }
    if (hskHighlight && hskMode !== 'off') applyStandaloneHsk();
    if (isEnabled) processPage();
    if (!panelSuppressed) setStatus('王软音 ready — use the toggles above.');
  }

  // Live re-annotation driven by the host page's header toggles (the website
  // viewer): apply the new settings, drop the old annotations and rebuild
  // cleanly — exactly like the panel toggles — so changing a header switch
  // re-annotates the open page instantly.
  function setSettings(s) {
    applySettings(s || defaultSettings || settings);
    removeAnnotations();
    removeStandaloneHsk();
    if (!panelSuppressed) syncPanel();
    if (selectionEnabled) {
      document.addEventListener('mouseup', onSelectionMouseUp);
      document.addEventListener('selectionchange', onSelectionChange);
    } else {
      document.removeEventListener('mouseup', onSelectionMouseUp);
      document.removeEventListener('selectionchange', onSelectionChange);
    }
    if (hskHighlight && hskMode !== 'off') applyStandaloneHsk();
    if (isEnabled) processPage();
    if (!panelSuppressed) setStatus('王软音 settings updated.');
  }

  window.WryPageRunner = { init, cleanup, applySettings, setSettings };

  // Safety boot: the hosting page (parent) may postMessage us after load to
  // re-apply settings if our inline bootstrap somehow lost the race, and to
  // re-annotate live when the app's header toggles change.
  if (window.addEventListener) {
    window.addEventListener('message', (ev) => {
      const d = ev.data;
      if (d && window.WryPageRunner) {
        if (d.t === 'wryBoot') {
          window.WryPageRunner.init(d.s || window.__WRY_PAGE_SETTINGS__ || undefined);
        } else if (d.t === 'wrySettings') {
          window.WryPageRunner.setSettings(d.s || {});
        }
      }
    }, false);
  }
})();