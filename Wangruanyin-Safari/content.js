// Regex per caratteri cinesi
const CHINESE_RE = /[\u4e00-\u9fff]/;

// Stato dell'estensione
let isEnabled = true;
let isPageProcessed = false;
let selectionEnabled = false;
let targetLang = "en";
let hskMode = "off"; // "off" | "hsk2" | "hsk3"
let hskDisabledLevels = []; // HSK levels (1-9) whose colour coding is turned off

// Inizialitza l'estat des de l'storage (Safari: namespace browser.*)
try {
  browser.storage.local.get(['pinyinEnabled', 'selectionEnabled', 'targetLang', 'hskMode', 'hskDisabledLevels'], (result) => {
    isEnabled = result.pinyinEnabled !== false; // default ON
    selectionEnabled = result.selectionEnabled === true; // default OFF
    targetLang = result.targetLang || "en"; // default English
    hskMode = result.hskMode || "off";
    hskDisabledLevels = Array.isArray(result.hskDisabledLevels) ? result.hskDisabledLevels : [];
    if (selectionEnabled) {
      document.addEventListener('mouseup', onSelectionMouseUp);
    }
  });
} catch (e) {
  // no hi ha storage API en context de script: mantenim els defaults
}

// ===== Gestió de missatges des del popup (Safari: browser.* + sendResponse) =====
browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.action === "undefined") return;

  if (msg.action === "annotate_page") {
    if (!isEnabled) {
      sendResponse({ status: "disabled", message: "Pinyin disabled" });
      return;
    }
    if (isPageProcessed) {
      sendResponse({ status: "already_processed" });
      return;
    }
    processPage()
      .then(() => {
        isPageProcessed = true;
        sendResponse({ status: "success" });
      })
      .catch(err => {
        sendResponse({ status: "error", error: err.message });
      });
    return true;
  }

  if (msg.action === "disable_pinyin") {
    isEnabled = false;
    try { browser.storage.local.set({ pinyinEnabled: false }); } catch (e) {}
    if (isPageProcessed) {
      removeAnnotations();
      isPageProcessed = false;
    }
    sendResponse({ status: "disabled" });
    return;
  }

  if (msg.action === "enable_pinyin") {
    isEnabled = true;
    try { browser.storage.local.set({ pinyinEnabled: true }); } catch (e) {}
    if (!isPageProcessed) {
      processPage()
        .then(() => { isPageProcessed = true; })
        .catch(err => console.error("Enable error:", err));
    }
    sendResponse({ status: "enabled" });
    return;
  }

  if (msg.action === "enable_selection_mode") {
    selectionEnabled = true;
    try { browser.storage.local.set({ selectionEnabled: true }); } catch (e) {}
    document.addEventListener('mouseup', onSelectionMouseUp);
    sendResponse({ status: "enabled" });
    return;
  }

  if (msg.action === "disable_selection_mode") {
    selectionEnabled = false;
    try { browser.storage.local.set({ selectionEnabled: false }); } catch (e) {}
    document.removeEventListener('mouseup', onSelectionMouseUp);
    hideTranslationPopup();
    sendResponse({ status: "disabled" });
    return;
  }

  if (msg.action === "set_target_lang") {
    targetLang = msg.lang || "en";
    try { browser.storage.local.set({ targetLang }); } catch (e) {}
    // Si el pinyin és actiu, reprocessa la pàgina a la nova llengua
    if (isEnabled && isPageProcessed) {
      removeAnnotations();
      isPageProcessed = false;
      processPage()
        .then(() => { isPageProcessed = true; })
        .catch(err => console.error("Re-translate error:", err));
    }
    sendResponse({ status: "ok", lang: targetLang });
    return;
  }

  if (msg.action === "set_hsk_mode") {
    hskMode = msg.mode || "off";
    try { browser.storage.local.set({ hskMode }); } catch (e) {}
    // Aplica els colors immediatament: si la pàgina ja està anotada es torna a
    // generar; si el pinyin està actiu però encara no s'ha processat, s'anota per
    //què els colors HSK es mostrin de seguida.
    if (isEnabled) {
      if (isPageProcessed) {
        removeAnnotations();
        isPageProcessed = false;
      }
      processPage()
        .then(() => { isPageProcessed = true; })
        .catch(err => console.error("HSK mode error:", err));
    }
    sendResponse({ status: "ok", mode: hskMode });
    return;
  }

  if (msg.action === "set_hsk_levels") {
    hskDisabledLevels = Array.isArray(msg.levels)
      ? msg.levels.filter(n => typeof n === "number" && n >= 1 && n <= 9)
      : [];
    try { browser.storage.local.set({ hskDisabledLevels }); } catch (e) {}
    if (isEnabled && isPageProcessed) {
      removeAnnotations();
      isPageProcessed = false;
      processPage()
        .then(() => { isPageProcessed = true; })
        .catch(err => console.error("HSK levels error:", err));
    }
    sendResponse({ status: "ok", levels: hskDisabledLevels });
    return;
  }

  if (msg.action === "hsk_sync") {
    // Lleugera comprovació/actualització quan s'obre el popup. No re-anota.
    hskMode = (typeof msg.mode === "string") ? msg.mode : hskMode;
    if (Array.isArray(msg.levels)) {
      hskDisabledLevels = msg.levels.filter(n => typeof n === "number" && n >= 1 && n <= 9);
    }
    sendResponse({ status: "ok", applied: true, mode: hskMode });
    return;
  }

  if (msg.action === "tts_page") {
    // Read-page-aloud control from the popup (toggle area). Commands:
    // start / toggle (play/pause/resume) / stop / restart / status.
    switch (msg.cmd) {
      case "start":
        startPageReader(0);
        break;
      case "toggle":
        if (pageTtsStatus() === "playing") pausePageReader();
        else if (pageTtsStatus() === "paused") resumePageReader();
        else startPageReader(0);
        break;
      case "pause":
        pausePageReader();
        break;
      case "resume":
        resumePageReader();
        break;
      case "stop":
        stopPageReader();
        break;
      case "restart":
        restartPageReader();
        break;
    }
    const ctx = {
      status: pageTtsStatus(),
      index: pageTts.index,
      total: pageTts.sentences.length,
      hasJump: !!pageTts.pendingJump,
      error: (msg.cmd === "start" && !pageTts.active && pageTts.sentences.length === 0) ? "no_annotations" : undefined
    };
    sendResponse(ctx);
    return;
  }
});

// ===== Gestió de la selecció de text (popup automàtic) =====
function onSelectionMouseUp(e) {
  if (!selectionEnabled) return;
  if (e.target.closest && e.target.closest("#wry-translation-popup")) return;

  setTimeout(() => {
    const selection = document.getSelection();
    const selectedText = selection.toString().trim();
    if (!selectedText) return;

    let position = { x: e.clientX, y: e.clientY + 12 };
    if (selection.rangeCount > 0) {
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      if (rect.width > 0 || rect.height > 0) {
        position = { x: rect.left + rect.width / 2, y: rect.bottom + 12 };
      }
    }

    showTranslationPopup(selectedText, position).catch(err => {
      console.error("Popup error:", err);
    });
  }, 50);
}

// Desfà les anotacions de la pàgina
function removeAnnotations() {
  stopTts(); // cancel·la qualsevol lectura en veu alta abans d'esborrar les anotacions
  document.querySelectorAll('.zh-sentence').forEach(el => {
    const parent = el.parentNode;
    if (!parent) return;
    const chineseChars = [];
    el.querySelectorAll('.zh-char').forEach(charEl => {
      chineseChars.push(charEl.textContent);
    });
    parent.insertBefore(document.createTextNode(chineseChars.join('')), el);
    parent.removeChild(el);
  });
  document.body.normalize();
}

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
  const textNodes = walkTextNodes(document.body);
  for (const node of textNodes) {
    // El DOM pot canviar mentre esperem traduccions (provocat per SPA,
    // navegació o re-anotació). Omet els nodes que han quedat desconnectats.
    const parent = node.parentNode;
    if (!parent || !parent.contains(node)) continue;

    const original = node.nodeValue;
    if (!original || !original.trim()) continue;

    const sentences = splitIntoSentences(original);
    const outer = document.createDocumentFragment();

    for (const sentence of sentences) {
      let translation = "";
      try {
        translation = await requestTranslation(sentence);
      } catch (e) {
        translation = "";
      }
      // Comprovació final abans de mutar el DOM.
      if (!parent.contains(node)) break;
      outer.appendChild(buildSentenceFragment(sentence, translation));
    }

    if (parent.contains(node)) {
      parent.replaceChild(outer, node);
    }
  }
  return Promise.resolve();
}
// Divideix el text en frases (mantenint la puntuació apegada a la frase)
function splitIntoSentences(text) {
  const parts = text.split(/(?<=[。！？!?；;…])/);
  const result = [];
  for (const part of parts) {
    const t = part.trim();
    if (t) result.push(t);
  }
  if (result.length === 0 && text.trim()) result.push(text.trim());
  return result;
}

// ===== HSK colour coding =====
// Returns the HSK level (1-9) for a character based on the active mode,
// or 0 if colouring is off / char not found / that level was toggled off.
function getHskLevel(ch) {
  let lv = 0;
  if (hskMode === "hsk2") {
    if (typeof HSK2_CHAR_LEVEL !== "undefined" && HSK2_CHAR_LEVEL[ch]) lv = HSK2_CHAR_LEVEL[ch];
  } else if (hskMode === "hsk3") {
    if (typeof HSK3_CHAR_LEVEL !== "undefined" && HSK3_CHAR_LEVEL[ch]) lv = HSK3_CHAR_LEVEL[ch];
  }
  if (lv > 0 && hskDisabledLevels.indexOf(lv) !== -1) {
    return 0; // l'usuari ha desactivat els colors per a aquest nivell HSK
  }
  return lv;
}

// Returns the HSK level (1-9) even if that level's colours are disabled
// (used for the title/hover so the learner still knows the level).
function getHskLevelUnfiltered(ch) {
  if (hskMode === "hsk2") {
    if (typeof HSK2_CHAR_LEVEL !== "undefined" && HSK2_CHAR_LEVEL[ch]) return HSK2_CHAR_LEVEL[ch];
  } else if (hskMode === "hsk3") {
    if (typeof HSK3_CHAR_LEVEL !== "undefined" && HSK3_CHAR_LEVEL[ch]) return HSK3_CHAR_LEVEL[ch];
  }
  return 0;
}

// Construeix una frase anotada: per cada caràcter el pinyin a sota,
// i UNA sola traducció per a tota la frase, a una línia separada sota.
function buildSentenceFragment(text, translation) {
  const wrapper = document.createElement("span");
  wrapper.className = "zh-sentence";

  const charsLine = document.createElement("span");
  charsLine.className = "zh-chars-line";

  for (const ch of text) {
    if (CHINESE_RE.test(ch)) {
      const block = document.createElement("span");
      block.className = "zh-char-block";
      const hsk = getHskLevel(ch);
      const realHsk = getHskLevelUnfiltered(ch);
      if (realHsk > 0) {
        block.setAttribute("title", hsk > 0 ? "HSK " + hsk : "HSK " + realHsk + " (colour hidden)");
      }
      const charEl = document.createElement("span");
      charEl.className = "zh-char";
      charEl.textContent = ch;
      if (hsk > 0) {
        charEl.classList.add("hsk-lv" + hsk); // acoloreix NOMÉS el caràcter, no el pinyin
      }
      const pinyinEl = document.createElement("span");
      pinyinEl.className = "zh-pinyin";
      pinyinEl.textContent = getPinyinForChar(ch);
      block.appendChild(charEl);
      block.appendChild(pinyinEl);
      charsLine.appendChild(block);
    } else {
      // Espai o puntuació: deixem-los com a text senzill no xinès
      const pad = document.createElement("span");
      pad.className = "zh-pad";
      pad.textContent = ch;
      charsLine.appendChild(pad);
    }
  }

  wrapper.appendChild(charsLine);

  // Una sola traducció per a tota la frase, a una línia separada sota
  if (translation) {
    const t = document.createElement("span");
    t.className = "zh-translation";
    t.textContent = translation;
    wrapper.appendChild(t);
  }

  return wrapper;
}

// Safari: browser.runtime.sendMessage retorna una Promise
async function requestTranslation(text) {
  let response;
  try {
    response = await browser.runtime.sendMessage(
      { type: "TRANSLATE_TEXT", text, targetLang }
    );
  } catch (err) {
    throw new Error(String(err));
  }
  if (!response || !response.ok) throw new Error("Translation error");
  return response.translation;
}

// ===== Anotació de pàgina compacta =====

function getPinyinForChar(ch) {
  if (typeof LOCAL_PINYIN_DICT !== "undefined" && LOCAL_PINYIN_DICT[ch]) {
    return LOCAL_PINYIN_DICT[ch][0];
  }
  if (typeof pinyin === "function") {
    const r = pinyin(ch);
    if (r && r.length > 0) return r[0];
  }
  return ch;
}

// ===== Popup de traducció de la selecció =====

function buildPinyinLine(text) {
  const parts = [];
  for (const ch of text) {
    if (CHINESE_RE.test(ch)) {
      const hsk = getHskLevel(ch);
      if (hsk > 0) {
        parts.push('<span class="hsk-lv' + hsk + ' zh-pinyin-span" title="HSK ' + hsk + '">' + getPinyinForChar(ch) + '</span>');
      } else {
        parts.push(getPinyinForChar(ch));
      }
    } else {
      parts.push(ch);
    }
  }
  return parts.join(" ");
}

// ===== Text-to-speech (TTS) =====
// Pronounces the selected Chinese text out loud. Tries the local Coqui TTS
// server first (https://github.com/coqui-ai/TTS, e.g. `python -m TTS.server.server`
// or the official Docker image, listening on http://localhost:5002), then
// falls back to the browser's native speech synthesis ("Firefox TTS" / Web
// Speech API) with a Chinese (zh-CN) voice.

const COQUI_TTS_URL = "http://localhost:5002/api/tts";

let activeTtsAudio = null;
let ttsSpeaking = false;
let ttsCancelled = false;
// Handle for the *current* Coqui <audio> playback so stopTts() can settle its
// pending promise (a paused <audio> would never fire ended/error on its own).
let currentCoquiSettle = null;
// Handle for the *current* speechSynthesis utterance (popup or sentence).
let currentUtterance = null;

function speakWithCoqui(text) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const audio = new Audio(COQUI_TTS_URL + "?text=" + encodeURIComponent(text));
    const handle = {
      audio,
      settle: function (ok) {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (currentCoquiSettle === handle) currentCoquiSettle = null;
        if (activeTtsAudio === audio) activeTtsAudio = null;
        if (ok) {
          resolve(true);
        } else {
          reject(new Error("Coqui TTS unavailable (server not reachable on " + COQUI_TTS_URL + ")"));
        }
      }
    };
    currentCoquiSettle = handle;
    const timeout = setTimeout(() => handle.settle(false), 15000);

    audio.onended = () => handle.settle(true);
    audio.onerror = () => handle.settle(false);
    audio.play().then(() => {
      if (!settled) activeTtsAudio = audio;
    }).catch(() => handle.settle(false));
  });
}

function speakWithBrowserTts(text) {
  return new Promise((resolve) => {
    if (!window.speechSynthesis) {
      resolve(false);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "zh-CN";
    utterance.rate = 0.9;
    if (window.speechSynthesis.getVoices) {
      const voices = window.speechSynthesis.getVoices();
      const zhVoice = voices.find((v) => /^zh([-_]|$)/i.test(v.lang || ""));
      if (zhVoice) utterance.voice = zhVoice;
    }
    const entry = {
      utterance,
      settle: function (ok) {
        if (currentUtterance === entry) currentUtterance = null;
        resolve(ok);
      }
    };
    currentUtterance = entry;
    utterance.onend = () => entry.settle(true);
    utterance.onerror = () => entry.settle(false);
    window.speechSynthesis.speak(utterance);
  });
}

// Pronounces `text` with Coqui first; if that fails (e.g. local server not
// running), falls back to the browser's built-in speech synthesis.
async function pronounceText(text) {
  if (!text) return false;
  stopTts(); // cancel any sentence/popup playback still running
  ttsCancelled = false;
  try {
    await speakWithCoqui(text);
    if (ttsCancelled) return false;
    ttsSpeaking = true;
    return true;
  } catch (err) {
    if (ttsCancelled) return false;
    try {
      const ok = await speakWithBrowserTts(text);
      if (ttsCancelled) return false;
      if (ok) ttsSpeaking = true;
      return ok;
    } catch (e2) {
      return false;
    }
  }
}

// ===== Page read-aloud (pinyin annotation feature) =====
// One read-aloud control lives in the extension popup (toggle area). It reads
// every annotated sentence (.zh-sentence) in order, highlighting the character
// currently being read (.wry-tts-active). Supports pause / resume / stop /
// restart. While paused, if the user highlights a word on the page (only when
// "Translate selection" is OFF), resuming jumps the reading to that sentence.

// State of the whole-page reader.
let pageTts = {
  active: false,
  paused: false,
  gen: 0,
  sentences: [],          // [{ wrapper, blocks, zhText }]
  index: 0,
  audio: null,            // current Coqui <audio>
  timer: null,            // browser-TTS fallback highlight interval
  boundarySeen: false,
  pendingJump: null       // .zh-sentence to jump to when resuming
};

function pageTtsStatus() {
  if (!pageTts.active) return "idle";
  return pageTts.paused ? "paused" : "playing";
}

function getZhBlocks(wrapper) {
  return Array.prototype.slice.call(wrapper.querySelectorAll(".zh-char-block"));
}

function highlightCharAt(blocks, index) {
  blocks.forEach((block, i) => {
    block.classList.toggle("wry-tts-active", i === index);
  });
}

function clearActiveHighlight(blocks) {
  blocks.forEach((block) => block.classList.remove("wry-tts-active"));
}

// Maps playback progress (0..1) to the character being read and highlights it.
function progressHighlight(blocks, progress) {
  if (!blocks.length) return;
  const idx = Math.min(blocks.length - 1, Math.max(0, Math.floor(progress * blocks.length)));
  highlightCharAt(blocks, idx);
}

function stopPageAudio() {
  if (pageTts.audio) {
    try { pageTts.audio.pause(); pageTts.audio.removeAttribute("src"); } catch (e) {}
    pageTts.audio = null;
  }
  if (pageTts.timer) { clearInterval(pageTts.timer); pageTts.timer = null; }
}

function collectPageSentences() {
  const list = [];
  document.querySelectorAll(".zh-sentence").forEach((wrapper) => {
    const blocks = getZhBlocks(wrapper);
    if (!blocks.length) return;
    const zhText = chineseOnly(blocks.map((b) => {
      const c = b.querySelector(".zh-char");
      return c ? c.textContent : "";
    }).join(""));
    if (!zhText) return;
    list.push({ wrapper, blocks, zhText });
  });
  pageTts.sentences = list;
}

// Reads the sentence at `index` using Coqui TTS; falls back to the browser's
// built-in speech synthesis if the local Coqui server is unavailable.
function readPageSentence(index) {
  if (!pageTts.active) return;
  if (index >= pageTts.sentences.length) {
    stopPageReader(); // finished the page
    return;
  }
  pageTts.index = index;
  clearActiveHighlight(pageTts.sentences[index].blocks);
  startCoquiPageSentence(index);
}

function startCoquiPageSentence(index) {
  const sent = pageTts.sentences[index];
  if (!sent || !pageTts.active) return;
  stopPageAudio();
  const gen = ++pageTts.gen;
  const audio = new Audio(COQUI_TTS_URL + "?text=" + encodeURIComponent(sent.zhText));
  pageTts.audio = audio;

  audio.ontimeupdate = () => {
    if (pageTts.gen !== gen || !pageTts.active || pageTts.paused) return;
    const dur = audio.duration;
    if (!dur || !isFinite(dur) || dur <= 0) return;
    progressHighlight(sent.blocks, audio.currentTime / dur);
  };
  audio.onended = () => {
    if (pageTts.gen !== gen || !pageTts.active || pageTts.paused) return;
    pageTts.audio = null;
    readPageSentence(index + 1);
  };
  audio.onerror = () => {
    if (pageTts.gen !== gen || !pageTts.active) return;
    pageTts.audio = null;
    startBrowserPageSentence(index);
  };
  audio.play().catch(() => {
    if (pageTts.gen !== gen || !pageTts.active) return;
    pageTts.audio = null;
    startBrowserPageSentence(index);
  });
}

function startBrowserPageSentence(index) {
  const sent = pageTts.sentences[index];
  if (!sent || !pageTts.active) return;
  stopPageAudio();
  if (!window.speechSynthesis) {
    if (pageTts.active) readPageSentence(index + 1); // no TTS available → skip
    return;
  }
  const gen = ++pageTts.gen;
  try { window.speechSynthesis.cancel(); } catch (e) {}
  const utterance = new SpeechSynthesisUtterance(sent.zhText);
  utterance.lang = "zh-CN";
  utterance.rate = 0.9;
  if (window.speechSynthesis.getVoices) {
    const voices = window.speechSynthesis.getVoices();
    const zhVoice = voices.find((v) => /^zh([-_]|$)/i.test(v.lang || ""));
    if (zhVoice) utterance.voice = zhVoice;
  }

  pageTts.boundarySeen = false;
  // Precise per-character highlight when the browser fires boundary events.
  utterance.onboundary = (e) => {
    if (pageTts.gen !== gen || !pageTts.active || pageTts.paused) return;
    pageTts.boundarySeen = true;
    const idx = e.charIndex || 0;
    const hanzi = (sent.zhText.substring(0, idx).match(/[\u4e00-\u9fff]/g) || []).length;
    highlightCharAt(sent.blocks, hanzi);
  };
  // Coarse fallback (some voices/platforms never fire boundary events):
  // advance the highlight with an estimated reading speed.
  const startTime = Date.now();
  const estimatedMs = Math.max(1200, sent.zhText.length * 260);
  pageTts.timer = setInterval(() => {
    if (pageTts.gen !== gen || !pageTts.active || pageTts.paused) return;
    if (pageTts.boundarySeen || !window.speechSynthesis || !window.speechSynthesis.speaking) return;
    const progress = Math.min(1, (Date.now() - startTime) / estimatedMs);
    progressHighlight(sent.blocks, progress);
  }, 200);

  utterance.onend = () => {
    if (pageTts.gen !== gen || !pageTts.active || pageTts.paused) return;
    stopPageAudio();
    readPageSentence(index + 1);
  };
  utterance.onerror = () => {
    if (pageTts.gen !== gen || !pageTts.active) return;
    stopPageAudio();
    readPageSentence(index + 1);
  };
  window.speechSynthesis.speak(utterance);
}

function clearPageHighlight() {
  pageTts.sentences.forEach((s) => clearActiveHighlight(s.blocks));
  document.querySelectorAll(".zh-char-block.wry-tts-active").forEach((b) => {
    b.classList.remove("wry-tts-active");
  });
}

// Stops the whole-page reader and clears the highlight.
function stopPageReader(stillCollect) {
  pageTts.active = false;
  pageTts.paused = false;
  pageTts.pendingJump = null;
  pageTts.gen++;
  stopPageAudio();
  if (window.speechSynthesis) { try { window.speechSynthesis.cancel(); } catch (e) {} }
  clearPageHighlight();
  if (!stillCollect) pageTts.sentences = [];
}

// Starts reading the whole annotated page from `fromIndex`.
function startPageReader(fromIndex) {
  stopPageReader(true);
  collectPageSentences();
  if (!pageTts.sentences.length) return false;
  pageTts.active = true;
  pageTts.paused = false;
  pageTts.pendingJump = null;
  readPageSentence(fromIndex || 0);
  return true;
}

function pausePageReader() {
  if (!pageTts.active || pageTts.paused) return;
  if (pageTts.audio) {
    try { pageTts.audio.pause(); } catch (e) {}
  } else if (window.speechSynthesis && !window.speechSynthesis.paused) {
    try { window.speechSynthesis.pause(); } catch (e) {}
  }
  pageTts.paused = true;
}

function resumePageReader() {
  if (!pageTts.active || !pageTts.paused) return;

  // Jump: the user highlighted a word while paused (translation selection OFF).
  if (pageTts.pendingJump) {
    const target = pageTts.pendingJump;
    pageTts.pendingJump = null;
    const idx = pageTts.sentences.findIndex((s) => s.wrapper === target);
    pageTts.paused = false;
    if (idx !== -1) {
      readPageSentence(idx); // restarts from the highlighted sentence
      return;
    }
  }

  if (pageTts.audio) {
    try { pageTts.audio.play(); } catch (e) {}
  } else if (window.speechSynthesis && window.speechSynthesis.paused) {
    try { window.speechSynthesis.resume(); } catch (e) {}
  }
  pageTts.paused = false;
}

function restartPageReader() {
  stopPageReader(true);
  startPageReader(0);
}

// While the page reader is paused and "Translate selection" is OFF, let the
// user pick where to resume by highlighting a word on the page.
function onPageReaderSelectionChange() {
  if (!pageTts.active || !pageTts.paused) return;
  if (selectionEnabled) return; // selection translation is ON → don't hijack it
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  if (!range) return;
  const container = range.commonAncestorContainer;
  const node = container && container.nodeType === 1 ? container : (container ? container.parentElement : null);
  if (!node || !node.closest) return;
  const sentence = node.closest(".zh-sentence");
  if (sentence) {
    pageTts.pendingJump = sentence;
  }
}

document.addEventListener("selectionchange", onPageReaderSelectionChange);

function stopTts() {
  ttsSpeaking = false;
  ttsCancelled = true;
  if (currentCoquiSettle) {
    const h = currentCoquiSettle;
    currentCoquiSettle = null;
    try { h.audio.pause(); h.audio.removeAttribute("src"); } catch (e) {}
    h.settle(true);
  } else if (activeTtsAudio) {
    try { activeTtsAudio.pause(); activeTtsAudio.src = ""; } catch (e) {}
    activeTtsAudio = null;
  }
  if (window.speechSynthesis) {
    try { window.speechSynthesis.cancel(); } catch (e) {}
  }
  if (currentUtterance) {
    const u = currentUtterance;
    currentUtterance = null;
    u.settle(false);
  }
  stopPageReader();
}

function hideTranslationPopup() {
  stopTts();
  const existing = document.getElementById("wry-translation-popup");
  if (existing) existing.remove();
}

// Returns only the Chinese (CJK) characters of a string — the read-aloud
// source, and never the pinyin letters or any translation text.
function chineseOnly(text) {
  if (!text) return "";
  let out = "";
  for (const ch of String(text)) {
    if (CHINESE_RE.test(ch)) out += ch;
  }
  return out;
}

async function showTranslationPopup(text, position) {
  hideTranslationPopup();

  const pinyinLine = buildPinyinLine(text);
  const speakText = chineseOnly(text);

  const popup = document.createElement("div");
  popup.id = "wry-translation-popup";
  popup.innerHTML =
    '<div class="wry-header">' +
    '<button type="button" class="wry-tts" title="Pronounce the Chinese text (Coqui TTS, browser TTS fallback)">🔊 Read aloud</button>' +
    '<button type="button" class="wry-close" title="Close">&times;</button>' +
    '</div>' +
    '<div class="wry-label">Chinese</div>' +
    '<div class="wry-chinese"></div>' +
    '<div class="wry-label">Pinyin</div>' +
    '<div class="wry-pinyin"></div>' +
    '<div class="wry-label">Translation</div>' +
    '<div class="wry-translation"></div>';

  function buildChineseHtml(text) {
    let html = "";
    for (const ch of text) {
      if (CHINESE_RE.test(ch)) {
        const hsk = getHskLevel(ch);
        if (hsk > 0) {
          html += '<span class="hsk-lv' + hsk + '" title="HSK ' + hsk + '">' + ch + '</span>';
        } else {
          html += ch;
        }
      } else {
        html += ch.replace(/[&<>"]/g, function (m) {
          return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m];
        });
      }
    }
    return html;
  }

  popup.querySelector(".wry-chinese").innerHTML = buildChineseHtml(text);
  popup.querySelector(".wry-pinyin").innerHTML = pinyinLine;
  popup.querySelector(".wry-translation").textContent = "";

  // "Read aloud" button: pronounce the Chinese text with Coqui TTS,
  // falling back to the browser (Firefox) built-in speech synthesis.
  const ttsBtn = popup.querySelector(".wry-tts");
  ttsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (ttsSpeaking) {
      stopTts();
      ttsBtn.textContent = "🔊 Read aloud";
      ttsBtn.classList.remove("wry-tts-playing");
      return;
    }
    ttsBtn.textContent = "⏹ Stop";
    ttsBtn.classList.add("wry-tts-playing");
    pronounceText(speakText).then(() => {
      ttsBtn.textContent = "🔊 Read aloud";
      ttsBtn.classList.remove("wry-tts-playing");
    });
  });

  document.body.appendChild(popup);

  const rect = popup.getBoundingClientRect();
  let left = Math.max(8, position.x - rect.width / 2);
  let top = position.y;

  if (left + rect.width > window.innerWidth - 8) {
    left = window.innerWidth - rect.width - 8;
  }
  if (top + rect.height > window.innerHeight - 8) {
    top = Math.max(8, position.y - rect.height - 24);
  }

  popup.style.left = left + "px";
  popup.style.top = top + "px";

  popup.querySelector(".wry-close").addEventListener("click", hideTranslationPopup);

  setTimeout(() => {
    document.addEventListener(
      "click",
      (e) => {
        if (!document.getElementById("wry-translation-popup")) return;
        if (!e.target.closest("#wry-translation-popup")) {
          hideTranslationPopup();
        }
      },
      { once: true }
    );
  }, 0);

  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape") hideTranslationPopup();
    },
    { once: true }
  );

  // Fetch the translation in the background: the popup (Chinese + pinyin) is
  // shown immediately, so a slow / failed translation never blocks it. The
  // read-aloud button stays focused on the Chinese pinyin source only.
  requestTranslation(text)
    .then((t) => {
      const live = document.getElementById("wry-translation-popup");
      if (live) {
        const el = live.querySelector(".wry-translation");
        if (el) el.textContent = t || "";
      }
    })
    .catch(() => {});

  return Promise.resolve();
}