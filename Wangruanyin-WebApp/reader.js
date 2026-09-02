// reader.js — 王软音 website reader.
// Opens a target website in a new tab of THIS web app, fetches the page
// through public CORS proxies (a plain web page can't script another site's
// tab), renders it in a sandboxed iframe, and injects the Wangruanyin engine
// so pinyin / translation / HSK are applied AUTOMATICALLY.
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const addrBar = $('addrBar');
  const backBtn = $('backBtn');
  const goBtn = $('goBtn');
  const realBtn = $('realBtn');
  const closeBtn = $('closeBtn');
  const statusEl = $('status');
  const loadBox = $('loadBox');
  const frame = $('siteFrame');
  const errorBox = $('errorBox');
  const errUrl = $('errUrl');
  $('homeLink').href = 'index.html';

  const GITHUB_OWNER = 'SoloJv';
  const GITHUB_REPO = 'WangRuanYin';
  const PAGES_BASE = 'https://' + GITHUB_OWNER.toLowerCase() + '.github.io/' + GITHUB_REPO + '/';
  const CDN_BASE = 'https://cdn.jsdelivr.net/gh/' + GITHUB_OWNER + '/' + GITHUB_REPO + '@main/Wangruanyin-WebApp/';

  // Engine files injected into the fetched page, IN THIS ORDER.
  const FILES = [
    'pinyin-dict-characters.js',
    'pinyin-data.js',
    'hsk2-char-levels.js',
    'hsk3-char-levels.js',
    'translator.js',
    'annotator.js',
    'page-runner.js'
  ];

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

  // Reads the toggles the user set on the index page (shared localStorage).
  function readSettings() {
    const s = { showPinyin: true, showTranslation: true, targetLang: 'en', hskMode: 'off', hskDisabledLevels: [] };
    try {
      const raw = localStorage.getItem('wry_webapp_state_v1');
      if (raw) {
        const o = JSON.parse(raw);
        if (typeof o.showPinyin === 'boolean') s.showPinyin = o.showPinyin;
        if (typeof o.showTranslation === 'boolean') s.showTranslation = o.showTranslation;
        if (typeof o.targetLang === 'string') s.targetLang = o.targetLang;
        if (['off', 'hsk2', 'hsk3'].indexOf(o.hskMode) !== -1) s.hskMode = o.hskMode;
        if (Array.isArray(o.hskDisabledLevels)) {
          s.hskDisabledLevels = o.hskDisabledLevels.filter((n) => typeof n === 'number' && n >= 1 && n <= 9);
        }
      }
    } catch (e) { /* private mode etc. */ }
    return s;
  }

  function runnerSettings(s) {
    return {
      pinyin: s.showPinyin !== false,
      translation: s.showTranslation !== false,
      selection: false,
      lang: s.targetLang || 'en',
      hsk: ['off', 'hsk2', 'hsk3'].indexOf(s.hskMode) !== -1 ? s.hskMode : 'off',
      disabled: s.hskDisabledLevels || [],
      hskHighlight: false
    };
  }

  // Inline engine bootstrap appended to the fetched page. Loads page-styles.css
  // + engine scripts from the first reachable base, then inits the runner so
  // the floating panel appears. Must not contain the literal `</script>`.
  function engineBootstrap(settings, bases) {
    const j = JSON.stringify;
    const safe = (x) => j(x).replace(/<\//g, '<\\/');
    return '<scr' + 'ipt>(function(){var s=' + safe(settings) +
      ';window.__WRY_PAGE_SETTINGS__=s;var bases=' + safe(bases) +
      ';var f=' + safe(FILES) + ';var i=0;' +
      'function pick(){if(window.WryPageRunner){window.WryPageRunner.init(s);return;}' +
      'if(i>=bases.length){if(window.console)console.warn("Wangruanyin: no base reachable.");return;}' +
      'var b=bases[i++],st=document.createElement("link");st.rel="stylesheet";st.href=b+"page-styles.css";' +
      '(document.head||document.documentElement).appendChild(st);' +
      'function L(j){if(j>=f.length){pick();return;}' +
      'var n=document.createElement("script");n.src=b+f[j];' +
      'n.onload=function(){L(j+1)};n.onerror=function(){pick()};' +
      '(document.head||document.documentElement).appendChild(n);}L(0);}pick();})();' +
      '</scr' + 'ipt>';
  }

  // Converts in-page links into reader navigation via window.parent.postMessage.
  function navHook() {
    return '<scr' + 'ipt>(function(d){function h(e){' +
      'var a=e.target&&e.target.closest?e.target.closest("a"):null;if(!a)return;' +
      'var href=a.getAttribute("href");if(!href)return;' +
      'var u;try{u=new URL(href,document.baseURI);}catch(x){return;}' +
      'if(u.protocol==="http:"||u.protocol==="https:"){e.preventDefault();' +
      'window.parent.postMessage({t:"wryNav",u:u.href},"*");}}' +
      'd.addEventListener("click",h,false);})(document);</scr' + 'ipt>';
  }

  // --- proxy fetching ----------------------------------------------------------
  const PROXIES = [
    (u) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
    (u) => 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(u),
    (u) => 'https://corsproxy.io/?url=' + encodeURIComponent(u)
  ];

  function proxyFetch(url) {
    const queue = PROXIES.slice();
    return new Promise((resolve, reject) => {
      (function next() {
        if (!queue.length) {
          reject(new Error('All proxies failed to fetch ' + url));
          return;
        }
        const proxy = queue.shift();
        setStatus('Fetching via proxy…');
        const ctl = new AbortController();
        const guard = setTimeout(() => ctl.abort(), 25000);
        fetch(proxy(url), { signal: ctl.signal })
          .then((r) => {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.text();
          })
          .then((html) => { clearTimeout(guard); resolve(html); })
          .catch(() => {
            clearTimeout(guard);
            setStatus('Proxy failed, trying next…');
            next();
          });
      })();
    });
  }

  function normalizeUrl(raw) {
    let u = (raw || '').trim();
    if (!u) return '';
    if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = 'https://' + u;
    return u;
  }
// --- load a site into the reader ----------------------------------------------
  const history = [];

  function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg || '';
  }

  function showError(url) {
    loadBox.hidden = true;
    frame.hidden = true;
    errorBox.hidden = false;
    if (errUrl) errUrl.textContent = url;
    if (addrBar) addrBar.value = url;
  }

  function clearError() {
    errorBox.hidden = true;
    loadBox.hidden = true;
    frame.hidden = false;
  }

  // Builds the sandboxed document: fetched page + our <base> (so relative
  // images/CSS resolve to the real site) + engine bootstrap + nav hook.
  function buildDocHtml(html, url, settings, bases) {
    let doc = html.replace(/<base[^>]*>/gi, ''); // only the first <base> is honoured
    const baseTag = '<base href="' + url.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '">';
    if (/<head[^>]*>/i.test(doc)) {
      doc = doc.replace(/<head([^>]*)>/i, '<head$1' + baseTag);
    } else {
      doc = '<head>' + baseTag + '</head>' + doc;
    }
    const chunk = engineBootstrap(settings, bases) + navHook();
    if (/<\/body>/i.test(doc)) doc = doc.replace(/<\/body>/i, chunk + '</body>');
    else if (/<\/html>/i.test(doc)) doc = doc.replace(/<\/html>/i, chunk + '</html>');
    else doc = doc + chunk;
    return doc;
  }

  function loaderFail(url) {
    setStatus('');
    showError(url);
  }

  function loadSite(rawUrl) {
    const url = normalizeUrl(rawUrl);
    if (!url) { setStatus('Enter an address.'); return; }
    if (addrBar) addrBar.value = url;
    history.push(url);
    if (backBtn) backBtn.disabled = history.length <= 1;
    clearError();
    loadBox.hidden = false;
    frame.hidden = true;
    setStatus('Starting…');

    const settings = runnerSettings(readSettings());
    const bases = candidateBases();

    proxyFetch(url)
      .then((html) => {
        const doc = buildDocHtml(html, url, settings, bases);
        const blobUrl = URL.createObjectURL(new Blob([doc], { type: 'text/html;charset=utf-8' }));
        frame.onload = () => {
          try { frame.contentWindow.postMessage({ t: 'wryBoot', s: settings, b: bases }, '*'); } catch (e) {}
          setStatus('王软音 applied — use the floating panel on the page.');
        };
        frame.src = blobUrl;
        clearError();
      })
      .catch((err) => {
        loaderFail(url);
        console.warn('Wangruanyin reader:', err);
      });
  }

  function go(url) {
    const u = normalizeUrl(url);
    if (u) loadSite(u);
  }

  // --- toolbar ------------------------------------------------------------------
  if (backBtn) backBtn.addEventListener('click', () => {
    if (history.length < 2) return;
    history.pop();
    if (backBtn) backBtn.disabled = history.length <= 1;
    const prev = history[history.length - 1];
    if (prev) loadSite(prev);
  });
  if (goBtn) goBtn.addEventListener('click', () => go(addrBar.value));
  if (addrBar) addrBar.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(addrBar.value); });
  if (realBtn) realBtn.addEventListener('click', () => {
    const u = addrBar.value || history[history.length - 1] || '';
    if (u) window.open(u, '_blank', 'noopener');
  });
  if (closeBtn) closeBtn.addEventListener('click', () => window.close());

  // --- navigation from inside the fetched page -------------------------------------
  window.addEventListener('message', (ev) => {
    const d = ev.data;
    if (d && d.t === 'wryNav' && d.u) go(d.u);
  });

  // --- init ------------------------------------------------------------------------
  const params = new URLSearchParams(location.search);
  const startUrl = params.get('url') || '';
  if (startUrl) {
    loadSite(startUrl);
  } else {
    setStatus('No address given.');
    loadBox.hidden = true;
    errorBox.hidden = false;
  }
})();