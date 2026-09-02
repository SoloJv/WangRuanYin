// Safari build - uses browser.* (Safari Web Extension API).
// Safari has no chrome.tabs / chrome.scripting, so the toolbar popup talks to the
// active tab's content script via browser.runtime.sendMessage (Safari routes it).

async function loadSettings() {
  try {
    const result = await browser.storage.local.get([
      'pinyinEnabled',
      'selectionEnabled',
      'targetLang',
      'hskMode',
      'hskDisabledLevels',
    ]);
    if (result && typeof result === 'object') return result;
  } catch (e) {
    // fallthrough to defaults
  }
  return {};
}

async function initPopup() {
  const result = await loadSettings();

  const pinyinToggle = document.getElementById('togglePinyin');
  const selectionToggle = document.getElementById('toggleSelection');
  const langSelect = document.getElementById('targetLang');

  const pinyinEnabled = result.pinyinEnabled !== false; // default ON
  const selectionEnabled = result.selectionEnabled === true; // default OFF
  const targetLang = result.targetLang || 'en';
  const hskMode = result.hskMode || 'off';
  const hskDisabledLevels = Array.isArray(result.hskDisabledLevels) ? result.hskDisabledLevels : [];

  pinyinToggle.checked = pinyinEnabled;
  selectionToggle.checked = selectionEnabled;
  langSelect.value = targetLang;

  // HSK mode radios
  const hskOff = document.querySelector('input[name="hskMode"][value="off"]');
  const hsk2 = document.querySelector('input[name="hskMode"][value="hsk2"]');
  const hsk3 = document.querySelector('input[name="hskMode"][value="hsk3"]');
  if (hsk2) hsk2.checked = (hskMode === 'hsk2');
  if (hsk3) hsk3.checked = (hskMode === 'hsk3');
  if (hskOff) hskOff.checked = (hskMode === 'off');

  function updateHskLegend(mode, disabledLevels) {
    const maxLevel = mode === 'hsk3' ? 7 : (mode === 'hsk2' ? 6 : 0);
    document.querySelectorAll('#hskLegend .hsk-color').forEach(sw => {
      const lv = parseInt(sw.getAttribute('data-level'), 10);
      const visible = (lv >= 1 && lv <= maxLevel);
      // Use BOTH 'hidden' and explicit display so a swatch can never
      // accidentally collapse for the mode it belongs to.
      sw.hidden = !visible;
      sw.style.display = visible ? '' : 'none';
      if (visible) {
        sw.textContent = (mode === 'hsk3' && lv === 7) ? '7-9' : String(lv);
        sw.classList.toggle('off', disabledLevels.indexOf(lv) !== -1);
        sw.setAttribute('aria-pressed', disabledLevels.indexOf(lv) !== -1 ? 'false' : 'true');
      }
    });
  }
  updateHskLegend(hskMode, hskDisabledLevels);

  // Click a colour to turn that HSK level's colouring on/off
  document.querySelectorAll('#hskLegend .hsk-color').forEach(sw => {
    sw.addEventListener('click', () => {
      const lv = parseInt(sw.getAttribute('data-level'), 10);
      if (!lv || hskMode === 'off') return;
      const idx = hskDisabledLevels.indexOf(lv);
      if (idx === -1) hskDisabledLevels.push(lv); else hskDisabledLevels.splice(idx, 1);
      hskDisabledLevels.sort((a, b) => a - b);
      updateHskLegend(hskMode, hskDisabledLevels);
      try { browser.storage.local.set({ hskDisabledLevels }); } catch (e) {}
      browser.runtime.sendMessage({ action: 'set_hsk_levels', levels: hskDisabledLevels });
    });
  });

  // Pinyin annotation toggle
  pinyinToggle.addEventListener('change', () => {
    const newState = pinyinToggle.checked;
    try { browser.storage.local.set({ pinyinEnabled: newState }); } catch (e) {}
    browser.runtime.sendMessage({
      action: newState ? 'enable_pinyin' : 'disable_pinyin',
    });
  });

  // Selection translation toggle
  selectionToggle.addEventListener('change', () => {
    const newState = selectionToggle.checked;
    try {
      browser.storage.local.set({ selectionEnabled: newState });
    } catch (e) {}
    const action = newState ? 'enable_selection_mode' : 'disable_selection_mode';
    browser.runtime.sendMessage({ action });
  });

  // Target language selector
  langSelect.addEventListener('change', () => {
    const newLang = langSelect.value || 'en';
    try { browser.storage.local.set({ targetLang: newLang }); } catch (e) {}
    browser.runtime.sendMessage({ action: 'set_target_lang', lang: newLang });
  });

  // --- Read-page-aloud controls (TTS) ----------------------------------
  const ttsToggle = document.getElementById('ttsToggle');
  const ttsStop = document.getElementById('ttsStop');
  const ttsRestart = document.getElementById('ttsRestart');
  const ttsHint = document.getElementById('ttsHint');

  function setTtsButtons(resp) {
    if (!resp) return;
    const status = resp.status || 'idle';
    const total = resp.total || 0;
    const hasJump = !!resp.hasJump;
    const playing = status === 'playing';
    const paused = status === 'paused';
    ttsToggle.disabled = false;
    ttsStop.disabled = !playing && !paused;
    ttsRestart.disabled = !playing && !paused;
    ttsToggle.textContent = playing ? '⏸ Pause' : '▶ Play';
    ttsToggle.classList.toggle('playing', playing);
    ttsToggle.classList.toggle('paused', paused);
    if (ttsHint) {
      if (status === 'idle') {
        ttsHint.textContent = total === 0
          ? 'Enable "Pinyin annotations" first, then press play.'
          : 'Reads the pinyin annotations aloud with Coqui TTS (browser TTS as fallback).';
      } else if (paused) {
        ttsHint.textContent = hasJump
          ? 'Will resume from the highlighted word.'
          : 'Paused — highlight a word on the page, then press play to resume from it.';
      } else {
        ttsHint.textContent = 'Reading aloud — each character is highlighted as it is read.';
      }
    }
  }

  function sendTtsCmd(cmd) {
    try {
      const res = browser.runtime.sendMessage({ action: 'tts_page', cmd });
      if (res && typeof res.then === 'function') {
        res.then(setTtsButtons).catch(() => setTtsButtons(null));
      }
    } catch (e) {}
  }

  ttsToggle.addEventListener('click', () => sendTtsCmd('toggle'));
  ttsStop.addEventListener('click', () => sendTtsCmd('stop'));
  ttsRestart.addEventListener('click', () => sendTtsCmd('restart'));
  // Reflect the current reading state when the popup opens.
  sendTtsCmd('status');

  // HSK colour coding mode
  const hskRadios = document.querySelectorAll('input[name="hskMode"]');
  hskRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      const mode = radio.value;
      updateHskLegend(mode, hskDisabledLevels);
      try { browser.storage.local.set({ hskMode: mode }); } catch (e) {}
      browser.runtime.sendMessage({ action: 'set_hsk_mode', mode });
      browser.runtime.sendMessage({ action: 'set_hsk_levels', levels: hskDisabledLevels });
    });
  });

  // On popup open, sync settings to the active tab (lightweight).
  if (hskMode !== 'off') {
    browser.runtime.sendMessage({ action: 'hsk_sync', mode: hskMode, levels: hskDisabledLevels });
  }
}

initPopup().catch(err => {
  console.error('Wangruanyin popup init error:', err);
});