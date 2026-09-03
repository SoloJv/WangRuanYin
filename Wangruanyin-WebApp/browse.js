// browse.js — 王软音 "website mode": the REAL site, with 王软音 added on top.
//
// A plain web page cannot run scripts inside another website's tab (same-origin
// policy), so to give the browser-extension experience — the actual page with
// every image, link and script working, plus pinyin / translations / HSK — the
// app:
//   1. opens the REAL website in a new tab (nothing fetched / proxied),
//   2. provides a bookmarklet that injects the Wangruanyin engine straight into
//      that page: once dragged to the bookmarks bar, clicking it brings up the
//      same floating panel as the extension's content script.
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const siteUrl = $('siteUrl');
  const openBtn = $('openSiteBtn');
  const browseStatus = $('browseStatus');
  const bmLink = $('bookmarkletLink');
  const bmCode = $('bookmarkletCode');
  const copyBtn = $('copyBookmarkletBtn');
  const fileWarning = $('browseFileWarning');
  const probeEl = $('browseProbe');
  const toolsPanel = $('toolsPanel');
  const toolsToggle = $('toolsToggle');

  // Engine files injected into the visited page, IN THIS ORDER.
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

  // Reads the header toggles — baked into the bookmarklet as its defaults.
  // (No `panel` key is sent: the floating panel appears on the real page, the
  // same as the extension's popup.)
  function collectSettings() {
    const pinyin = $('togglePinyin') && $('togglePinyin').checked;
    const translation = $('toggleTranslation') && $('toggleTranslation').checked;
    const selection = $('toggleSelection') ? $('toggleSelection').checked : false;
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
      selection: selection !== false,
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
    }, 9000);
  }

  // --- PRIMARY: open the REAL website natively ---------------------------------
  // Nothing is fetched or re-rendered — the actual site opens in a new tab, so
  // images, links and scripts behave exactly like the extension's page. The 王软音
  // features are added there with the bookmarklet below.
  if (openBtn) openBtn.addEventListener('click', () => {
    const url = normalizeUrl(siteUrl.value);
    if (!url) { siteUrl.focus(); setBrowseStatus('Enter a website to open.'); return; }
    copyBookmarklet(true);
    const win = window.open(url, '_blank', 'noopener');
    if (win) {
      setBrowseStatus('The real site opened in a new tab — click the 王软音 bookmark there to add the features (the bookmark code was copied to your clipboard).');
    } else {
      setBrowseStatus('Popup blocked — allow popups for this app. The bookmarklet was copied: add it as a bookmark, then click it on any page.');
    }
  });
  if (siteUrl) siteUrl.addEventListener('keydown', (e) => { if (e.key === 'Enter') openBtn.click(); });

  // --- bookmarklet --------------------------------------------------------------
  // Builds a javascript: URL that loads page-styles.css + the engine scripts from
  // the first reachable base and initialises the runner on the REAL page.
  function buildBookmarklet() {
    const s = collectSettings();
    const bases = candidateBases();
    const j = JSON.stringify;
    const safe = (x) => j(x).replace(/<\//g, '<\\/');
    const code =
      '(function(){var s=' + safe(s) + ';window.__WRY_PAGE_SETTINGS__=s;' +
      'var bases=' + safe(bases) + ';var f=' + safe(FILES) + ';var i=0;' +
      'function pick(){if(window.WryPageRunner){window.WryPageRunner.init(s);return;}' +
      'if(i>=bases.length){if(window.console)window.console.warn("王软音: no script base reachable.");return;}' +
      'var b=bases[i++],st=document.createElement("link");st.rel="stylesheet";st.href=b+"page-styles.css";' +
      '(document.head||document.documentElement).appendChild(st);' +
      'function L(j){if(j>=f.length){pick();return;}' +
      'var n=document.createElement("script");n.src=b+f[j];' +
      'n.onload=function(){L(j+1)};n.onerror=function(){pick()};' +
      '(document.head||document.documentElement).appendChild(n);}L(0);}pick();})();';
    return 'javascript:' + code;
  }

  function copyBookmarklet(suppressStatus) {
    if (!bmCode) return;
    bmCode.select();
    bmCode.setSelectionRange(0, bmCode.value.length);
    const okNow = () => { if (!suppressStatus) setBrowseStatus('Bookmarklet copied — add it to your bookmarks (or drag the link above).'); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(bmCode.value).then(okNow).catch(() => { if (!suppressStatus) setBrowseStatus('Copy failed — select the text manually.'); });
        return;
      }
    } catch (e) { /* fall through */ }
    document.execCommand('copy');
    okNow();
  }

  function refreshBookmarklet() {
    if (!bmCode || !bmLink) return;
    if (fileWarning) fileWarning.hidden = location.protocol !== 'file:';
    if (copyBtn) copyBtn.disabled = false;
    const code = buildBookmarklet();
    bmCode.value = code;
    bmLink.setAttribute('href', code);
    bmLink.setAttribute('draggable', 'true');
    bmLink.title = 'Drag to your bookmarks bar, open any website, then click it — like the extension.';
    bmLink.textContent = '王软音 · Wangruanyin';
    renderProbes();
  }

  if (copyBtn) copyBtn.addEventListener('click', () => copyBookmarklet(false));
// --- reachability probes (which engine base will the bookmarklet load from) ---
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
      ? '✅ All engine sources are reachable — the bookmarklet will work on any page.'
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

  // --- tools panel: a simple collapsible block (the bookmarklet reads its toggles) ---
  function setToolsCollapsed(collapsed) {
    if (toolsPanel) toolsPanel.classList.toggle('collapsed', collapsed);
    if (toolsToggle) {
      toolsToggle.setAttribute('aria-expanded', String(!collapsed));
      toolsToggle.textContent = collapsed ? '⚙ Show tools ▴' : '⚙ Hide tools ▾';
    }
  }
  if (toolsToggle) toolsToggle.addEventListener('click', () => {
    const collapsed = toolsPanel ? toolsPanel.classList.contains('collapsed') : false;
    setToolsCollapsed(!collapsed);
  });

  // --- regenerate the bookmarklet + probes when the toggles change --------------
  const refresh = () => window.setTimeout(refreshBookmarklet, 0);
  ['togglePinyin', 'toggleTranslation', 'toggleSelection', 'targetLang'].forEach((id) => {
    const el = $(id);
    if (el) el.addEventListener('change', refresh);
  });
  document.querySelectorAll('input[name="hskMode"]').forEach((r) => r.addEventListener('change', refresh));
  document.querySelectorAll('#hskLegend .hsk-color').forEach((sw) => sw.addEventListener('click', refresh));

  // Hide the status bubble initially.
  if (browseStatus) browseStatus.hidden = true;
  refreshBookmarklet();
})();