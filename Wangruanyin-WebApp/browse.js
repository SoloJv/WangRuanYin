// browse.js — Wangruanyin "website mode".
//
// The web app does NOT fetch or re-render other websites — a plain web page
// cannot run scripts inside another site's tab (same-origin policy). Instead it
// works just like the browser extension, but on the REAL page:
//  "Open with 王软音" opens the actual website in a new tab,
//  the bookmarklet link injects the Wangruanyin engine straight into that page
//  (floating panel + toggles — pinyin, translations, HSK — exactly like the
//  extension's content script).
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

  // Engine files loaded into the visited page, IN THIS ORDER.
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

  function baseUrl() {
    const origin = location.origin || '';
    const dir = (location.pathname || '/').split(/[?#]/)[0].replace(/[^/]*$/, '');
    return origin + (dir.charAt(dir.length - 1) === '/' ? dir : dir + '/');
  }

  function candidateBases() {
    const bases = [PAGES_BASE, CDN_BASE];
    if (location.protocol === 'http:' || location.protocol === 'https:') bases.push(baseUrl());
    const seen = {};
    return bases.filter((b) => b && !seen[b] && (seen[b] = true));
  }

  // Reads the index toggles (also used by the reader via the shared localStorage).
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

  function normalizeUrl(raw) {
    let u = (raw || '').trim();
    if (!u) return '';
    if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = 'https://' + u;
    return u;
  }

  function setBrowseStatus(msg) {
    if (!browseStatus) return;
    browseStatus.textContent = msg;
    browseStatus.hidden = false;
    window.setTimeout(() => {
      if (browseStatus.textContent === msg) browseStatus.hidden = true;
    }, 6000);
  }

  // --- PRIMARY: open the REAL website in a new tab ------------------------------
  // No fetching, proxying or re-rendering: the actual site opens. The 王软音
  // engine is applied on that page with the bookmarklet link below — the
  // web-app equivalent of the extension's content script.
  openBtn.addEventListener('click', () => {
    const url = normalizeUrl(siteUrl.value);
    if (!url) { siteUrl.focus(); setBrowseStatus('Enter a website to open.'); return; }
    const win = window.open(url, '_blank', 'noopener');
    if (win) {
      setBrowseStatus('The real website is open in the new tab — click the 王软音 link (or bookmarklet) there to annotate it, like the extension.');
    } else {
      setBrowseStatus('Popup blocked — allow popups for this app, or copy the address and open it yourself.');
    }
  });

  siteUrl.addEventListener('keydown', (e) => { if (e.key === 'Enter') openBtn.click(); });

  // --- bookmarklet ----------------------------------------------------------------
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
    if (!bmCode || !bmLink) return;
    fileWarning.hidden = location.protocol !== 'file:';
    copyBtn.disabled = false;
    bmCode.value = buildBookmarklet();
    bmLink.setAttribute('href', buildBookmarklet());
    bmLink.setAttribute('draggable', 'true');
    bmLink.title = 'Drag to your bookmarks bar, open a website, then click it.';
    bmLink.textContent = '王软音 · Wangruanyin';
    renderProbes();
  }

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
// --- reachability probes (diagnostics inside the Advanced section) ------------
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
    if (base === PAGES_BASE) return ['GitHub Pages', 'hosted at ' + PAGES_BASE];
    if (base === CDN_BASE) return ['jsDelivr CDN', 'mirror of this repo'];
    return ['Local / current origin', 'reachable while served'];
  }

  async function renderProbes() {
    if (!probeEl) return;
    probeEl.innerHTML = '';
    const bases = candidateBases();
    const results = await Promise.all(bases.map(async (base) => {
      const ok = await probeBase(base);
      return { base, ok };
    }));
    const allOk = results.every((r) => r.ok);
    const line = document.createElement('div');
    line.className = 'probe-summary';
    line.textContent = allOk
      ? '✅ All engine sources are reachable — the reader and the bookmarklet will work.'
      : results.filter((r) => r.ok).length + '/' + results.length + ' engine sources reachable.';
    probeEl.appendChild(line);
    results.forEach((r) => {
      const [name, note] = describeBase(r.base);
      const row = document.createElement('div');
      row.className = 'probe-row';
      row.innerHTML = '<span class="probe-dot ' + (r.ok ? 'ok' : 'bad') + '">' + (r.ok ? '✓' : '✗') + '</span>' +
        '<span class="probe-name">' + name + '</span>' +
        '<span class="probe-note">' + note + '</span>';
      probeEl.appendChild(row);
    });
  }

  // --- regenerate the bookmarklet + probes when the toggles change --------------
  const refresh = () => window.setTimeout(refreshBookmarklet, 0);
  ['togglePinyin', 'toggleTranslation', 'targetLang'].forEach((id) => {
    const el = $(id);
    if (el) el.addEventListener('change', refresh);
  });
  document.querySelectorAll('input[name="hskMode"]').forEach((r) => r.addEventListener('change', refresh));
  document.querySelectorAll('#hskLegend .hsk-color').forEach((sw) => {
    sw.addEventListener('click', refresh);
  });

  // Hide the status bubble initially.
  if (browseStatus) browseStatus.hidden = true;
  refreshBookmarklet();
})();