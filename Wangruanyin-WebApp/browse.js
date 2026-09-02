// browse.js — Wangruanyin "website mode".
// 1) Opens the website typed by the user in a separate tab.
// 2) Generates a bookmarklet that, when clicked on ANY website, loads the
//    engine scripts (+ styles) and applies 王软音 to that page with the
//    toggles currently set on this index page.
//
// A bookmarklet is the standard way to get extension-like behaviour from a
// plain web page (same-origin policy prevents injecting into another tab).
//
// SCRIPT SOURCES (tried in order, first one that loads wins):
//   1. GitHub Pages  — https://solojv.github.io/WangRuanYin/
//                      (needs: repository PUBLIC + Settings → Pages → "GitHub Actions")
//   2. jsDelivr CDN — https://cdn.jsdelivr.net/gh/SoloJv/WangRuanYin@main/...
//                      (needs only: repository PUBLIC — no Pages setup at all)
//   3. local server — the origin the app is currently served from (http/https only)
// So the bookmarklet works as soon as any one of those bases is reachable —
// even if the GitHub Pages site itself still returns 404.
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const siteUrl = $('siteUrl');
  const openBtn = $('openSiteBtn');
  const bmLink = $('bookmarkletLink');
  const bmCode = $('bookmarkletCode');
  const copyBtn = $('copyBookmarkletBtn');
  const fileWarning = $('browseFileWarning');
  const probeEl = $('browseProbe');
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

  const GITHUB_OWNER = 'SoloJv';
  const GITHUB_REPO = 'WangRuanYin';
  const PAGES_BASE = 'https://' + GITHUB_OWNER.toLowerCase() + '.github.io/' + GITHUB_REPO + '/';
  const CDN_BASE = 'https://cdn.jsdelivr.net/gh/' + GITHUB_OWNER + '/' + GITHUB_REPO + '@main/Wangruanyin-WebApp/';

  // The directory of the current page (strip query/hash and trailing filename),
  // always ending with a slash. Works on any hosting layout (sub-path, root,
  // custom domain, nested folders, localhost).
  function baseUrl() {
    const origin = location.origin || '';
    const dir = (location.pathname || '/').split(/[?#]/)[0].replace(/[^/]*$/, '');
    return origin + (dir.charAt(dir.length - 1) === '/' ? dir : dir + '/');
  }

  // Ordered, deduplicated list of script bases the bookmarklet will try.
  function candidateBases() {
    const bases = [PAGES_BASE, CDN_BASE];
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      bases.push(baseUrl());
    }
    const seen = {};
    return bases.filter((b) => b && !seen[b] && (seen[b] = true));
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

  // Builds the compact javascript: URI bookmarklet. The loader tries every
  // candidate base in order and stops at the first one whose scripts load.
  function buildBookmarklet() {
    const settings = collectSettings();
    const bases = candidateBases();
    const code =
      "(function(){var s=" + JSON.stringify(settings) +
      ";window.__WRY_PAGE_SETTINGS__=s;var bases=" + JSON.stringify(bases) +
      ";var f=" + JSON.stringify(FILES) + ";var i=0;" +
      "function pick(){if(window.WryPageRunner){window.WryPageRunner.init(s);return;}" +
      "if(i>=bases.length){if(window.console)console.warn('Wangruanyin: no script base reachable.');return;}" +
      "var b=bases[i++],st=document.createElement('link');st.rel='stylesheet';st.href=b+'page-styles.css';" +
      "(document.head||document.documentElement).appendChild(st);" +
      "function L(j){if(j>=f.length){pick();return;}" +
      "var n=document.createElement('script');n.src=b+f[j];" +
      "n.onload=function(){L(j+1)};n.onerror=function(){pick()};" +
      "(document.head||document.documentElement).appendChild(n);}L(0);}pick();})();";
    return 'javascript:' + code;
  }

  function refreshBookmarklet() {
    const local = location.protocol === 'file:';
    // Always generate the bookmarklet: from file:// it still points at the
    // published GitHub bases, which load from any page (once the repo is
    // public). Only the local-server base is omitted when on disk.
    fileWarning.hidden = !local;
    copyBtn.disabled = false;
    bmCode.value = buildBookmarklet();
    bmLink.setAttribute('href', buildBookmarklet());
    bmLink.setAttribute('draggable', 'true');
    bmLink.title = 'Drag to your bookmarks bar, open your website, then click it.';
    bmLink.textContent = local ? '王软音 · Wangruanyin (from disk)' : '王软音 · Wangruanyin';
    renderProbes();
  }
// --- reachability probes ---------------------------------------------------
  // Loads a tiny harmless engine file from `base` and reports whether the
  // base actually serves the app (script onload = reachable, onerror = 404/offline).
  // This turns the "404" mystery into visible diagnostics on the index page.
  function probeBase(base) {
    return new Promise((resolve) => {
      const s = document.createElement('script');
      const done = (ok) => { try { s.remove(); } catch (e) {} resolve(ok); };
      s.onload = () => done(true);
      s.onerror = () => done(false);
      s.src = base + 'translator.js?wryprobe=1&t=' + Date.now();
      (document.head || document.documentElement).appendChild(s);
    });
  }

  function describeBase(base) {
    if (base === PAGES_BASE) return ['GitHub Pages', 'needs public repo + Pages enabled'];
    if (base === CDN_BASE) return ['jsDelivr CDN', 'needs public repo (no Pages setup)'];
    return ['Local / current origin', 'only reachable while this server runs'];
  }

  async function renderProbes() {
    if (!probeEl) return;
    probeEl.innerHTML = '<span class="probe-title">Checking where the 王软音 engine can be loaded from…</span>';
    const bases = candidateBases();
    await Promise.all(bases.map(async (base) => {
      const ok = await probeBase(base);
      const [name, note] = describeBase(base);
      const row = document.createElement('div');
      row.className = 'probe-row';
      row.innerHTML = '<span class="probe-dot ' + (ok ? 'ok' : 'bad') + '">' + (ok ? '✓' : '✗') + '</span>' +
        '<span class="probe-name">' + name + '</span>' +
        '<span class="probe-note">' + note + '</span>' +
        (ok ? '' : '<a class="probe-url" href="' + base + '" target="_blank" rel="noopener">open</a>');
      probeEl.appendChild(row);
    }));
  }

  // --- URL field: open the website in a separate tab --------------------------
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