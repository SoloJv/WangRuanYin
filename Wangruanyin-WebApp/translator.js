// translator.js
// Wangruanyin web app — translation via the free Google Translate endpoint.
// Same endpoint, retry policy and result parsing as the extension's background.js,
// so the web app behaves identically to the browser extension.
(() => {
  'use strict';

  // Bump this if Google throttles the free endpoint while testing locally.
  const MAX_ATTEMPTS = 3;

  async function translateWithGoogle(text, targetLang, attempt = 0) {
    if (!text || !String(text).trim()) return "";
    const url =
      "https://translate.googleapis.com/translate_a/single?client=dict-chrome-ex&sl=auto&tl=" +
      encodeURIComponent(targetLang) +
      "&dt=t&q=" +
      encodeURIComponent(text);

    let resp;
    try {
      resp = await fetch(url);
    } catch (e) {
      // Network failure (offline, DNS, blocked host …). Retry a little, then soft-fail.
      if (attempt < MAX_ATTEMPTS) {
        await sleep(600 * (attempt + 1));
        return translateWithGoogle(text, targetLang, attempt + 1);
      }
      return "";
    }

    // 429 / 5xx are transient (Google rate-limits the free endpoint). Retry.
    if (resp.status === 429 || resp.status >= 500) {
      if (attempt < MAX_ATTEMPTS) {
        await sleep(600 * (attempt + 1));
        return translateWithGoogle(text, targetLang, attempt + 1);
      }
      return "";
    }
    if (!resp.ok) return "";

    let data;
    try {
      data = await resp.json();
    } catch (e) {
      // A non-JSON body (e.g. an HTML error page) can slip past the status check.
      if (attempt < 1) {
        await sleep(600);
        return translateWithGoogle(text, targetLang, attempt + 1);
      }
      return "";
    }

    // Standard shape: data[0] = [[translated, original, lang, ...], ...]
    if (Array.isArray(data) && Array.isArray(data[0])) {
      return data[0]
        .filter((seg) => Array.isArray(seg) && typeof seg[0] === "string")
        .map((seg) => seg[0])
        .join("");
    }
    return "";
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  window.WryTranslator = {
    translate(text, targetLang) {
      return translateWithGoogle(text, targetLang || "en");
    }
  };
})();