// annotator.js
// Wangruanyin web app — pinyin annotation + HSK colour coding engine.
// Pure-DOM logic ported from the extension's content.js so the web app shows the
// exactly same annotations as the browser extension (no chrome.* runtime here).
(() => {
  'use strict';

  const CHINESE_RE = /[\u4e00-\u9fff]/;

  // --- HSK colour coding state -------------------------------------------
  let hskMode = "off";            // "off" | "hsk2" | "hsk3"
  let hskDisabledLevels = [];     // HSK levels (1-9) whose colouring is turned off

  function setHskState(mode, disabledLevels) {
    hskMode = ["off", "hsk2", "hsk3"].indexOf(mode) !== -1 ? mode : "off";
    hskDisabledLevels = Array.isArray(disabledLevels)
      ? disabledLevels.filter((n) => typeof n === "number" && n >= 1 && n <= 9)
      : [];
  }

  // --- Pinyin lookup ------------------------------------------------------
  // LOCAL_PINYIN_DICT is the big generated dictionary shipped with this folder.
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
      return 0; // user turned off colour coding for this HSK level
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

  // --- Sentence splitting --------------------------------------------------
  // Split text into sentences, keeping the trailing punctuation attached.
  function splitIntoSentences(text) {
    const parts = String(text).split(/(?<=[。！？!?；;…])/);
    const result = [];
    for (const part of parts) {
      const t = part.trim();
      if (t) result.push(t);
    }
    if (result.length === 0 && text.trim()) result.push(text.trim());
    return result;
  }

  // --- Fragment builders ---------------------------------------------------
  // Builds one annotated sentence: every Chinese character wrapped in a block
  // with its pinyin underneath, plus one translation row for the whole sentence.
  // opts.showPinyin / opts.showTranslation control which parts are rendered;
  // the characters are always coloured by HSK level when an HSK mode is active.
  function buildSentenceFragment(text, translation, opts) {
    const o = opts || {};
    const showPinyin = o.showPinyin !== false;
    const showTranslation = o.showTranslation !== false;
    const waitTranslation = o.waitTranslation === true;

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
          charEl.classList.add("hsk-lv" + hsk); // colour ONLY the character, not the pinyin
        }
        block.appendChild(charEl);
        if (showPinyin) {
          const pinyinEl = document.createElement("span");
          pinyinEl.className = "zh-pinyin";
          pinyinEl.textContent = getPinyinForChar(ch);
          block.appendChild(pinyinEl);
        }
        charsLine.appendChild(block);
      } else {
        // Space or punctuation: keep it as a plain non-Chinese fragment.
        const pad = document.createElement("span");
        pad.className = "zh-pad";
        pad.textContent = ch;
        charsLine.appendChild(pad);
      }
    }

    wrapper.appendChild(charsLine);

    // One translation for the whole sentence, on a separate row underneath.
    if (showTranslation) {
      const t = document.createElement("span");
      t.className = "zh-translation";
      // "…" means "translating…"; app.js replaces it with the fetched text.
      t.textContent = waitTranslation ? "…" : (translation || "");
      wrapper.appendChild(t);
    }

    return wrapper;
  }

  // HTML for the Chinese line of the selection popup (with HSK colours).
  function buildChineseHtml(text) {
    let html = "";
    for (const ch of text) {
      if (CHINESE_RE.test(ch)) {
        const hsk = getHskLevel(ch);
        if (hsk > 0) {
          html += '<span class="hsk-lv' + hsk + '" title="HSK ' + hsk + '">' + ch + "</span>";
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

  // HTML for the pinyin line of the selection popup (with HSK-coloured chips).
  function buildPinyinLine(text) {
    const parts = [];
    for (const ch of text) {
      if (CHINESE_RE.test(ch)) {
        const hsk = getHskLevel(ch);
        if (hsk > 0) {
          parts.push('<span class="hsk-lv' + hsk + ' zh-pinyin-span" title="HSK ' + hsk + '">' + getPinyinForChar(ch) + "</span>");
        } else {
          parts.push(getPinyinForChar(ch));
        }
      } else {
        parts.push(ch);
      }
    }
    return parts.join(" ");
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

  window.WryAnnotator = {
    CHINESE_RE,
    setHskState,
    getPinyinForChar,
    getHskLevel,
    getHskLevelUnfiltered,
    splitIntoSentences,
    buildSentenceFragment,
    buildChineseHtml,
    buildPinyinLine,
    chineseOnly
  };
})();