// Wangruanyin toolbar popup controller (Chrome / Edge / Firefox MV3).
// Files to inject when the content script isn't loaded yet (must match manifest).
const INJECT_FILES = [
  "pinyin-dict-characters.js",
  "pinyin-data.js",
  "hsk2-char-levels.js",
  "hsk3-char-levels.js",
  "content.js"
];

function getActiveTab(cb) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs && tabs[0]) cb(tabs[0].id);
  });
}

function ensureContentInjected(tabId, then) {
  chrome.scripting.executeScript(
    { target: { tabId }, files: INJECT_FILES },
    () => {
      if (chrome.runtime.lastError) {
        showStatus("Could not load Wangruanyin on this page.");
        return;
      }
      setTimeout(then, 250);
    }
  );
}

function sendMessage(tabId, message, then) {
  chrome.tabs.sendMessage(tabId, message, () => {
    if (chrome.runtime.lastError) {
      ensureContentInjected(tabId, () => {
        chrome.tabs.sendMessage(tabId, message, () => { if (then) then(); });
      });
    } else if (then) {
      then();
    }
  });
}

chrome.storage.local.get(
  ['pinyinEnabled', 'selectionEnabled', 'targetLang', 'hskMode', 'hskDisabledLevels'],
  (result) => {
    const pinyinToggle = document.getElementById('togglePinyin');
    const selectionToggle = document.getElementById('toggleSelection');
    const langSelect = document.getElementById('targetLang');

    pinyinToggle.checked = result.pinyinEnabled !== false;                 // default ON
    selectionToggle.checked = result.selectionEnabled === true;            // default OFF
    langSelect.value = result.targetLang || 'en';                          // default English

    const hskMode = result.hskMode || 'off';
    let hskDisabledLevels = Array.isArray(result.hskDisabledLevels) ? result.hskDisabledLevels : [];

    // --- HSK mode radios ------------------------------------------------
    const hskOff = document.querySelector('input[name="hskMode"][value="off"]');
    const hsk2 = document.querySelector('input[name="hskMode"][value="hsk2"]');
    const hsk3 = document.querySelector('input[name="hskMode"][value="hsk3"]');
    if (hsk2) hsk2.checked = (hskMode === 'hsk2');
    if (hsk3) hsk3.checked = (hskMode === 'hsk3');
    if (hskOff) hskOff.checked = (hskMode === 'off');

    // --- Legend renderer ------------------------------------------------
    function updateHskLegend(mode, disabledLevels) {
      const maxLevel = mode === 'hsk3' ? 7 : (mode === 'hsk2' ? 6 : 0);
      document.querySelectorAll('#hskLegend .hsk-color').forEach((sw) => {
        const lv = parseInt(sw.getAttribute('data-level'), 10);
        const visible = lv >= 1 && lv <= maxLevel;
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

    // Click a legend colour to toggle that HSK level's colouring.
    document.querySelectorAll('#hskLegend .hsk-color').forEach((sw) => {
      sw.addEventListener('click', () => {
        const lv = parseInt(sw.getAttribute('data-level'), 10);
        if (!lv || hskMode === 'off') return;
        const idx = hskDisabledLevels.indexOf(lv);
        if (idx === -1) { hskDisabledLevels.push(lv); } else { hskDisabledLevels.splice(idx, 1); }
        hskDisabledLevels.sort((a, b) => a - b);
        updateHskLegend(hskMode, hskDisabledLevels);
        chrome.storage.local.set({ hskDisabledLevels }, () => {
          getActiveTab((tabId) => {
            sendMessage(tabId, { action: 'set_hsk_levels', levels: hskDisabledLevels });
          });
        });
      });
    });

    document.querySelectorAll('input[name="hskMode"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        const mode = radio.value;
        updateHskLegend(mode, hskDisabledLevels);
        chrome.storage.local.set({ hskMode: mode }, () => {
          getActiveTab((tabId) => {
            sendMessage(tabId, { action: 'set_hsk_mode', mode });
            sendMessage(tabId, { action: 'set_hsk_levels', levels: hskDisabledLevels });
          });
        });
        showStatus({ off: 'HSK colouring Off', hsk2: 'HSK 2.0 colours', hsk3: 'HSK 3.0 colours' }[mode] || mode);
      });
    });
// --- On popup open, sync colours to the active tab ------------------
    if (hskMode !== 'off') {
      getActiveTab((tabId) => {
        chrome.tabs.sendMessage(tabId, { action: 'hsk_sync', mode: hskMode, levels: hskDisabledLevels }, (resp) => {
          if (chrome.runtime.lastError || !(resp && resp.applied)) {
            ensureContentInjected(tabId, () => {
              chrome.tabs.sendMessage(tabId, { action: 'set_hsk_mode', mode: hskMode }, () => {
                chrome.tabs.sendMessage(tabId, { action: 'set_hsk_levels', levels: hskDisabledLevels }, () => {});
              });
            });
          }
        });
      });
    }

    // --- Pinyin annotations toggle -------------------------------------
    pinyinToggle.addEventListener('change', () => {
      const newState = pinyinToggle.checked;
      chrome.storage.local.set({ pinyinEnabled: newState }, () => {
        getActiveTab((tabId) => {
          if (newState) {
            sendMessage(tabId, { action: 'enable_pinyin' });
          } else {
            sendMessage(tabId, { action: 'disable_pinyin' });
          }
        });
      });
    });

    // --- Translate-selection toggle ------------------------------------
    selectionToggle.addEventListener('change', () => {
      const newState = selectionToggle.checked;
      chrome.storage.local.set({ selectionEnabled: newState }, () => {
        getActiveTab((tabId) => {
          sendMessage(tabId, {
            action: newState ? 'enable_selection_mode' : 'disable_selection_mode'
          });
        });
      });
    });

    // --- Target language selector --------------------------------------
    langSelect.addEventListener('change', () => {
      const newLang = langSelect.value || 'en';
      chrome.storage.local.set({ targetLang: newLang }, () => {
        getActiveTab((tabId) => {
          sendMessage(tabId, { action: 'set_target_lang', lang: newLang });
        });
      });
    });

    // --- Read-page-aloud controls (TTS) --------------------------------
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

    function sendTtsCmd(cmd, then) {
      getActiveTab((tabId) => {
        chrome.tabs.sendMessage(tabId, { action: 'tts_page', cmd }, (resp) => {
          if (chrome.runtime.lastError || !resp) {
            ensureContentInjected(tabId, () => {
              chrome.tabs.sendMessage(tabId, { action: 'tts_page', cmd }, (r2) => {
                if (then) then(r2);
              });
            });
            return;
          }
          if (then) then(resp);
        });
      });
    }

    ttsToggle.addEventListener('click', () => sendTtsCmd('toggle', setTtsButtons));
    ttsStop.addEventListener('click', () => sendTtsCmd('stop', setTtsButtons));
    ttsRestart.addEventListener('click', () => sendTtsCmd('restart', setTtsButtons));
    // Reflect the current reading state when the popup opens.
    sendTtsCmd('status', setTtsButtons);
  }
);

function showStatus(message) {
  const statusEl = document.getElementById('status');
  if (!statusEl) return;
  statusEl.textContent = message;
  setTimeout(() => {
    statusEl.textContent = '';
  }, 5000);
}