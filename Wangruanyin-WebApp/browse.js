// browse.js — Wangruanyin "website mode".
// 1) Opens the website typed by the user in a separate tab.
// 2) Generates a bookmarklet that, when clicked on ANY website, loads the
//    engine scripts (+ styles) from this web app and applies 王软音 to that
//    page with the toggles currently set on this index page.
// A bookmarklet is the standard way to get extension-like behaviour from a
// plain web page (same-origin policy prevents injecting into another tab).
// Website mode therefore requires the app to be served over HTTP(S).
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const siteUrl = $('siteUrl');
  const openBtn = $('openSiteBtn');
  const bmLink = $('bookmarkletLink');
  const bmCode = $('bookmarkletCode');
  const copyBtn = $('copyBookmarkletBtn');
  const fileWarning = $('browseFileWarning');
  const browseStatus = $('browseStatus');

  // Engine files loaded into the visited page, IN THIS ORDER
  // (dictionary first, engine last — the data files declare the globals the
  // annotator and the runner rely on).
  const FILES = [
    'pinyin-dict-characters.js',
    'pinyin-data.js',
    'hsk2-char-levels.js',
    'hsk3-char-levels.js',
    'translator.js',
    'annotator.js',
    'page-runner.js'
  ];

  // Base URL used to load the scripts. index.html sits at the folder root, so
  // the folder URL is "origin + path without the trailing filename".
  function baseUrl() {
    return (location.origin || '') + location.pathname.replace(/[^/]*$/, '');
  }

  // Reads the current state of the index toggles so they are baked into the
  // bookmarklet (a bookmark cannot read this page's localStorage later).
  function collectSettings() {
    const pinyin = $('togglePinyin') && $('togglePinyin').checked;
    const translation = $('toggleTranslation') && $('toggleTranslation').checked;
    const lang = ($('targetLang') && $('targetLang').value) || 'en';
    let hsk = 'off';
    const checked = document.querySelector('input[name="hskMode"]:checked');
    if (checked) hsk = checked.value;
    const disabled = [];
    document.querySelectorAll('#hskLegend .hsk-color.off').forEach((sw) => {
      const lv = parseInt(sw.getAttribute('data-level'), 10);
      if (lv >= 1 && lv <= 9) disabled.push(lv);
    });
    return {
      pinyin: pinyin !== false,
      translation: translation !== false,
      selection: false,
      lang,
      hsk,
      disabled: disabled.sort((a, b) => a - b)
    };
  }

  // Builds the compact javascript: URI bookmarklet.
  function buildBookmarklet() {
    if (location.protocol === 'file:') return '';
    const base = baseUrl();
    const settings = collectSettings();
    const code =
      "(function(){var b=" + JSON.stringify(base) +
      ";var s=" + JSON.stringify(settings) +
      ";window.__WRY_PAGE_SETTINGS__=s;" +
      "var st=document.createElement('link');st.rel='stylesheet';st.href=b+'page-styles.css';(document.head||document.documentElement).appendChild(st);" +
      "var f=" + JSON.stringify(FILES) + ";" +
      "function L(i){if(i>=f.length){if(window.WryPageRunner)window.WryPageRunner.init(s);return;}var n=document.createElement('script');n.src=b+f[i];n.onload=n.onerror=function(){L(i+1)};(document.head||document.documentElement).appendChild(n);}L(0);})();";
    return 'javascript:' + code;
  }

  function refreshBookmarklet() {
    if (location.protocol === 'file:') {
      fileWarning.hidden = false;
      bmCode.value = '';
      bmLink.setAttribute('href', '#');
      bmLink.removeAttribute('draggable');
      copyBtn.disabled = true;
      bmLink.textContent = '王软音 · Wangruanyin (needs HTTP)';
      return;
    }
    fileWarning.hidden = true;
    copyBtn.disabled = false;
    bmLink.setAttribute('href', buildBookmarklet());
    bmLink.setAttribute('draggable', 'true');
    bmLink.title = 'Drag to your bookmarks bar, open your website, then click it.';
    bmLink.textContent = '王软音 · Wangruanyin';
    bmCode.value = buildBookmarklet();
  }
// --- URL field: open the website in a separate tab ----------------------------
  function normalizeUrl(raw) {
    let u = (raw || '').trim();
    if (!u) return '';
    if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = 'https://' + u;
    return u;
  }

  openBtn.addEventListener('click', () => {
    const url = normalizeUrl(siteUrl.value);
    if (!url) {
      siteUrl.focus();
      setBrowseStatus('Enter a website to open.');
      return;
    }
    const win = window.open(url, '_blank');
    if (win) {
      setBrowseStatus('Opened in a new tab — click the 王软音 bookmark there.');
    } else {
      setBrowseStatus('Popup blocked — allow popups for this page, or open the link yourself.');
      window.location.href = url;
    }
  });

  siteUrl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') openBtn.click();
  });

  // --- copy bookmarklet -------------------------------------------------------
  copyBtn.addEventListener('click', () => {
    bmCode.select();
    bmCode.setSelectionRange(0, bmCode.value.length);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(bmCode.value)
          .then(() => setBrowseStatus('Bookmarklet copied.'))
          .catch(() => setBrowseStatus('Copy failed — select the text manually.'));
        return;
      }
    } catch (e) { /* fall through */ }
    document.execCommand('copy');
    setBrowseStatus('Bookmarklet copied.');
  });

  function setBrowseStatus(msg) {
    if (!browseStatus) return;
    browseStatus.textContent = msg;
    window.setTimeout(() => {
      if (browseStatus.textContent === msg) browseStatus.textContent = '';
    }, 6000);
  }

  // --- regenerate the bookmarklet whenever the toggles change ------------------
  const refresh = () => window.setTimeout(refreshBookmarklet, 0);
  ['togglePinyin', 'toggleTranslation', 'targetLang'].forEach((id) => {
    const el = $(id);
    if (el) el.addEventListener('change', refresh);
  });
  document.querySelectorAll('input[name="hskMode"]').forEach((r) => r.addEventListener('change', refresh));
  document.querySelectorAll('#hskLegend .hsk-color').forEach((sw) => {
    sw.addEventListener('click', refresh);
  });

  refreshBookmarklet();
})();