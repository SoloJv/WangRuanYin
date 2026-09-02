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

  // --- fetching: parallel multi-source with validation --------------------------
  // Each source is raced in parallel (first *usable* page wins). Many public
  // CORS proxies are flaky, so we give each a generous timeout and validate the
  // result so a Cloudflare error page or a captcha never "wins".
  const SOURCES = [
    { name: 'allorigins', kind: 'html', build: (u) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u) },
    { name: 'allorigins-get', kind: 'json', build: (u) => 'https://api.allorigins.win/get?url=' + encodeURIComponent(u) },
    { name: 'codetabs', kind: 'html', build: (u) => 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(u) },
    { name: 'corsproxy', kind: 'html', build: (u) => 'https://corsproxy.io/?url=' + encodeURIComponent(u) },
    { name: 'jina-readable', kind: 'md', build: (u) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent('https://r.jina.ai/' + u) }
  ];
  const FETCH_TIMEOUT = 45000;

  function fetchWithTimeout(url, ms) {
    return new Promise((resolve, reject) => {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), ms);
      fetch(url, { signal: ctl.signal })
        .then((r) => {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.text();
        })
        .then((txt) => { clearTimeout(t); resolve(txt); })
        .catch((e) => { clearTimeout(t); reject(e); });
    });
  }

  // Reject proxy error pages so a real (if slow) source still wins.
  function isUsableHtml(html) {
    if (!html || html.length < 300) return false;
    if (/<title[^>]*>(Cloudflare|522|502|524|504|Access denied|Just a moment|Attention Required|error[^<]*)/i.test(html)) return false;
    if (/<body[^>]*class="error-page"/i.test(html)) return false;
    if (!/<[a-zA-Z][\s>]/.test(html)) return false;
    return true;
  }

  function isUsableMd(text) {
    if (!text || text.length < 40) return false;
    if (/^(cloudflare|522|502|524|504|error|access denied)/i.test(text.trim())) return false;
    // A markdown source must not hand us an HTML error/redirect page.
    if (/<!DOCTYPE|<html|<title>/i.test(text)) return false;
    return true;
  }

  // Fetches the page from all sources in parallel and returns the first usable
  // one: { kind:'html', html } or { kind:'md', text }.
  function fetchPage(url) {
    setStatus('Fetching the page from several mirrors…');
    const tasks = SOURCES.map(async (src) => {
      let body;
      try {
        body = await fetchWithTimeout(src.build(url), FETCH_TIMEOUT);
      } catch (e) { return null; }
      try {
        if (src.kind === 'json') {
          const parsed = JSON.parse(body);
          if (parsed && typeof parsed.contents === 'string') body = parsed.contents;
          else return null;
          if (!isUsableHtml(body)) return null;
          return { kind: 'html', html: body, source: src.name };
        }
        if (src.kind === 'md') {
          if (!isUsableMd(body)) return null;
          return { kind: 'md', text: body, source: src.name };
        }
        if (!isUsableHtml(body)) return null;
        return { kind: 'html', html: body, source: src.name };
      } catch (e) { return null; }
    });
    // Real-site HTML is always preferred over the readable-text fallback:
    // prefer any usable raw-html result, and only then fall back to markdown.
    return Promise.all(tasks).then((results) => {
      const html = results.find((r) => r && r.kind === 'html');
      if (html) return html;
      const md = results.find((r) => r && r.kind === 'md');
      if (md) return md;
      throw new Error('No source returned a usable copy of ' + url);
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

  // Minimal, safe markdown → HTML for the readable-render fallback (jina).
  function mdToHtml(text) {
    const esc = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const blocks = esc.split(/\n\s*\n/).map((b) => b.replace(/^\s+|\s+$/g, ''));
    const out = [];
    for (const b of blocks) {
      if (!b) continue;
      const h = b.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        const lv = h[1].length;
        out.push('<h' + lv + '>' + h[2] + '</h' + lv + '>');
        continue;
      }
      if (/^[-*]\s+/.test(b)) {
        const items = b.split('\n').map((l) => l.replace(/^[-*]\s+/, '')).filter((l) => l);
        out.push('<ul><li>' + items.join('</li><li>') + '</li></ul>');
        continue;
      }
      if (/^>\s?/.test(b)) {
        out.push('<blockquote>' + b.replace(/^>\s?/gm, '').replace(/\n/g, '<br>') + '</blockquote>');
        continue;
      }
      out.push('<p>' + b.replace(/\n/g, '<br>') + '</p>');
    }
    return out.join('\n');
  }

  // Builds a styled, safe article document from the readable-text fallback.
  function buildArticleDoc(text, url, settings, bases) {
    const safeUrl = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const title = (text.trim().split('\n')[0] || 'Article').slice(0, 120).replace(/[#\s]+/g, ' ').trim();
    const html =
      '<!DOCTYPE html><html><head><meta charset="utf-8">' +
      '<title>' + title + '</title>' +
      '<style>' +
      'body{font-family:Georgia,serif;max-width:840px;margin:20px auto;padding:0 20px 60px;line-height:1.75;color:#222;}' +
      '.wry-src{font-family:Arial,sans-serif;font-size:13px;color:#666;background:#f3f5f7;border:1px solid #dfe4ea;' +
      'border-radius:8px;padding:8px 12px;margin:0 0 18px;}' +
      '.wry-src a{color:#1f5fa6;}' +
      'h1{font-size:26px;line-height:1.3;} h2{font-size:20px;} h3{font-size:17px;}' +
      'p{font-size:17px;} blockquote{color:#444;border-left:3px solid #bbb;padding-left:12px;margin:14px 0;}' +
      'pre{background:#f6f8fa;padding:10px;border-radius:6px;overflow:auto;}' +
      'code{background:#f1f3f5;padding:1px 4px;border-radius:4px;}' +
      '</style></head><body>' +
      '<div class="wry-src">Readable render of <a href="' + safeUrl + '" target="_blank" rel="noopener">' + safeUrl + '</a>' +
      ' — click <strong>↗ Real site</strong> above for the original layout.</div>' +
      mdToHtml(text) +
      engineBootstrap(settings, bases) + navHook() +
      '</body></html>';
    return html;
  }

  function loaderFail(url) {
    setStatus('');
    showError(url);
  }

  function renderInFrame(doc) {
    const blobUrl = URL.createObjectURL(new Blob([doc], { type: 'text/html;charset=utf-8' }));
    frame.src = blobUrl;
    clearError();
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

    fetchPage(url)
      .then((res) => {
        const doc = res.kind === 'md'
          ? buildArticleDoc(res.text, url, settings, bases)
          : buildDocHtml(res.html, url, settings, bases);
        renderInFrame(doc);
        frame.onload = () => {
          try { frame.contentWindow.postMessage({ t: 'wryBoot', s: settings, b: bases }, '*'); } catch (e) {}
          setStatus('王软音 applied — use the floating panel on the page.');
        };
        setStatus('Rendering…');
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