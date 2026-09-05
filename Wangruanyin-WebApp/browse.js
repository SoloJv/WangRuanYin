// browse.js — 王软音 "website viewer": surf + translate IN THE SAME VIEW.
//
// The web app is the environment: the target website is fetched through mirrors
// a web page can reach (Jina Reader, Wikipedia's own CORS API, public CORS
// proxies), rebuilt with ABSOLUTE resource URLs so all images/CSS render, and
// shown in a sandboxed iframe below the app's toggles. The 王软音 engine is
// injected into that page so pinyin / translations / HSK are applied there —
// and the header toggles re-annotate it live, like the extension's popup.
// Clicking links navigates the SAME iframe (address bar updates, next page is
// annotated), and if fetching a clicked page fails we fall back to loading it
// directly, so surfing never stops.
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const siteUrl = $('siteUrl');
  const openBtn = $('openSiteBtn');
  const browseStatus = $('browseStatus');
  const toolsPanel = $('toolsPanel');
  const toolsToggle = $('toolsToggle');
  const viewerCloseBtn = $('viewerCloseBtn');
  const siteHost = $('siteHost');
  const loadBar = $('loadBar');
  const frame = $('siteFrame');
  const realViewBtn = $('realViewBtn');
  const realNotice = $('realNotice');
  const realNoticeText = $('realNoticeText');
  const embedBlocked = $('embedBlocked');
  const embedBlockedUrl = $('embedBlockedUrl');
  const embedOpenTab = $('embedOpenTab');
  const bmLink = $('bookmarkletLink');
  const bmCode = $('bookmarkletCode');
  const copyBtn = $('copyBookmarkletBtn');
  const recentSitesEl = $('recentSites');

  const RECENTS_KEY = 'wry_viewer_recents_v1';
  const RECENTS_MAX = 6;

  // 'annotated' = fetched + 王软音 injected; 'real' = real page loaded directly.
  let viewMode = 'annotated';

  // Cached copy of the most recent site so re-opening is instant.
  const CACHE_KEY = 'wry_viewer_cache_v1';
  const CACHE_TTL = 15 * 60 * 1000;
  const CACHE_MAX_CHARS = 1200000;

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

  // Reads the header toggles. panel:false means "no floating panel in the page
  // — the app's own toggles drive the annotation", which is what the user wants
  // (toggles + commands stay in the web app).
  function collectSettings() {
    const pinyin = $('togglePinyin') && $('togglePinyin').checked;
    const translation = $('toggleTranslation') && $('toggleTranslation').checked;
    const selection = $('toggleSelection') ? $('toggleSelection').checked : true;
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
      disabled: disabled.sort((a, b) => a - b),
      hskHighlight: false,
      panel: false
    };
  }

  // The bookmarklet uses the extension's method: the user clicks it ON the real
  // page, so the floating 王软音 panel SHOULD appear (no panel:false — that's the
  // in-app viewer's setting only).
  function collectBookmarkletSettings() {
    const s = collectSettings();
    delete s.panel;
    return s;
  }

  // The exact content-script technique the extension uses, delivered as a
  // javascript: URL: it injects page-styles.css + the engine scripts INTO the
  // page you're viewing and initialises the runner — the same floating panel as
  // the extension, on any real site (even ones the in-app reader can't reach).
  function buildBookmarklet() {
    const s = collectBookmarkletSettings();
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

  function refreshBookmarklet() {
    if (!bmCode || !bmLink) return;
    const code = buildBookmarklet();
    bmCode.value = code;
    bmLink.setAttribute('href', code);
    bmLink.setAttribute('draggable', 'true');
    bmLink.title = 'Drag to your bookmarks bar, open any website, then click it — the extension method, no install.';
    bmLink.textContent = '王软音 · Wangruanyin';
  }

  function copyBookmarklet() {
    if (!bmCode) return;
    bmCode.select();
    bmCode.setSelectionRange(0, bmCode.value.length);
    const okNow = () => setStatus('Bookmarklet copied — add it to your bookmarks (or drag the green link above).');
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(bmCode.value).then(okNow).catch(() => setStatus('Copy failed — select the text manually.'));
        return;
      }
    } catch (e) { /* fall through */ }
    document.execCommand('copy');
    okNow();
  }

  function normalizeUrl(raw) {
    let u = (raw || '').trim();
    if (!u) return '';
    if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = 'https://' + u;
    return u;
  }

  // --- recent sites (mobile-friendly quick access, no bookmark needed) --------
  function loadRecents() {
    try {
      const raw = localStorage.getItem(RECENTS_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter((u) => typeof u === 'string' && u) : [];
    } catch (e) { return []; }
  }
  function saveRecents(list) {
    try { localStorage.setItem(RECENTS_KEY, JSON.stringify(list.slice(0, RECENTS_MAX))); } catch (e) { /* ignore */ }
  }
  function recordRecent(url) {
    const list = loadRecents();
    const l = list.filter((u) => u !== url);
    l.unshift(url);
    saveRecents(l);
    renderRecents();
  }
  function renderRecents() {
    if (!recentSitesEl) return;
    const list = loadRecents();
    if (!list.length) { recentSitesEl.hidden = true; recentSitesEl.innerHTML = ''; return; }
    recentSitesEl.hidden = false;
    recentSitesEl.innerHTML = '';
    const label = document.createElement('span');
    label.className = 'recent-label';
    label.textContent = 'Recent:';
    recentSitesEl.appendChild(label);
    list.forEach((u) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'recent-chip';
      b.textContent = u.replace(/^https?:\/\//, '').replace(/\/$/, '');
      b.title = u;
      b.addEventListener('click', () => {
        if (siteUrl) siteUrl.value = u;
        loadSite(u);
      });
      recentSitesEl.appendChild(b);
    });
  }

function setStatus(msg) {
    if (!browseStatus) return;
    browseStatus.textContent = msg || '';
    browseStatus.hidden = false;
    window.setTimeout(() => {
      if (browseStatus.textContent === msg) browseStatus.hidden = true;
    }, 6000);
  }

  function startLoading() {
    if (openBtn) openBtn.classList.add('loading');
    if (loadBar) loadBar.hidden = false;
  }
  function endLoading() {
    if (openBtn) openBtn.classList.remove('loading');
    if (loadBar) loadBar.hidden = true;
  }

  let viewerActive = false;
  function enterViewer() {
    const first = !viewerActive;
    viewerActive = true;
    document.body.classList.add('viewing');
    if (first) setToolsCollapsed(true); // site takes all the space by default
    if (siteHost) siteHost.hidden = false;
    if (viewerCloseBtn) viewerCloseBtn.hidden = false;
  }
  function exitViewer() {
    viewerActive = false;
    viewMode = 'annotated';
    document.body.classList.remove('viewing');
    hideEmbedBlocked();
    if (siteHost) siteHost.hidden = true;
    if (viewerCloseBtn) viewerCloseBtn.hidden = true;
    if (realViewBtn) realViewBtn.hidden = true;
    if (realNotice) realNotice.hidden = true;
    if (frame) { frame.src = ''; frame.onload = null; }
    if (lastBlobUrl) { try { URL.revokeObjectURL(lastBlobUrl); } catch (e) {} }
    lastBlobUrl = null;
  }

  // --- session cache ---------------------------------------------------------
  function readCache(url) {
    const stores = [localStorage, sessionStorage];
    for (const store of stores) {
      try {
        const raw = store.getItem(CACHE_KEY);
        if (!raw) continue;
        const o = JSON.parse(raw);
        if (o && o.url === url && o.t && (Date.now() - o.t) < CACHE_TTL) return o;
      } catch (e) { /* try next store */ }
    }
    return null;
  }
  function writeCache(url, res) {
    const o = { url, t: Date.now(), kind: res.kind, label: res.label, source: res.source, html: res.html || undefined, text: res.text || undefined };
    const s = JSON.stringify(o);
    if (!s || s.length >= CACHE_MAX_CHARS) return;
    const stores = [localStorage, sessionStorage];
    for (let i = 0; i < stores.length; i++) {
      try { stores[i].setItem(CACHE_KEY, s); break; } catch (e) { /* try next */ }
    }
  }
// --- fetching: parallel multi-mirror, first *usable* result wins ------------
  const SOURCES = [
    { name: 'jina-raw', label: 'Jina Reader', kind: 'html', build: (u) => 'https://r.jina.ai/' + u, headers: { 'X-Return-Format': 'html', 'Accept': 'text/html' }, timeout: 12000 },
    { name: 'jina-readable', label: 'Jina Reader (readable)', kind: 'md', build: (u) => 'https://r.jina.ai/' + u, timeout: 15000 },
    { name: 'wikipedia-api', label: 'Wikimedia API', kind: 'wiki', matches: (u) => /^https?:\/\/([a-z0-9-]+\.)*wikipedia\.org\//i.test(u), build: wikiApiUrlFor, timeout: 8000 },
    { name: 'allorigins', label: 'AllOrigins', kind: 'html', build: (u) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u) },
    { name: 'allorigins-get', label: 'AllOrigins', kind: 'json', build: (u) => 'https://api.allorigins.win/get?url=' + encodeURIComponent(u) },
    { name: 'codetabs', label: 'CodeTabs', kind: 'html', build: (u) => 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(u) },
    { name: 'corsproxy', label: 'CORSProxy.io', kind: 'html', build: (u) => 'https://corsproxy.io/?url=' + encodeURIComponent(u) }
  ];
  const FETCH_TIMEOUT = 15000;

  function fetchWithTimeout(url, ms, headers) {
    return new Promise((resolve, reject) => {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), ms);
      const opts = { signal: ctl.signal };
      if (headers) opts.headers = headers;
      fetch(url, opts)
        .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
        .then((txt) => { clearTimeout(t); resolve(txt); })
        .catch((e) => { clearTimeout(t); reject(e); });
    });
  }

  // Wikipedia article URL -> Wikimedia CORS API query.
  function wikiApiUrlFor(u) {
    try {
      const url = new URL(u);
      if (!/\.wikipedia\.org$/i.test(url.hostname)) return '';
      const m = url.pathname.match(/^\/wiki\/(.+)$/i);
      const page = m ? decodeURIComponent(m[1]) : 'Wikipedia';
      return url.origin + '/w/api.php?action=parse&page=' + encodeURIComponent(page) +
        '&prop=text&format=json&origin=*&disableeditsection=1&redirects=1';
    } catch (e) { return ''; }
  }
// Minimal full-page shell around MediaWiki's parsed article HTML.
  function wrapWikiDoc(html) {
    return '<!DOCTYPE html><html><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<style>' +
      'body{font-family:Georgia,\'Times New Roman\',serif;max-width:900px;margin:0 auto;' +
      'padding:0 20px 80px;line-height:1.75;color:#202122;}' +
      '.mw-parser-output{font-size:16px;} .mw-parser-output a{color:#0645ad;}' +
      '.mw-parser-output img{max-width:100%;height:auto;}' +
      '.mw-parser-output table{border-collapse:collapse;} .mw-parser-output td,' +
      '.mw-parser-output th{border:1px solid #a2a9b1;padding:6px 10px;vertical-align:top;}' +
      '.mw-parser-output .infobox{float:right;clear:right;margin:0 0 14px 20px;background:#f8f9fa;}' +
      '.mw-parser-output .thumbinner{display:flex;flex-direction:column;align-items:center;}' +
      '.mw-editsection{display:none;}' +
      '@media(max-width:640px){.mw-parser-output .infobox{float:none;clear:both;margin:0 0 12px;}}' +
      '</style></head><body>' + html + '</body></html>';
  }

  function isUsableHtml(html) {
    if (!html || html.length < 300) return false;
    if (/<title[^>]*>(Cloudflare|522|502|524|504|Access denied|Just a moment|Attention Required|Sina Visitor System|Please (sign|log) in|Login|登录|error[^<]*)/i.test(html)) return false;
    if (/(Sina Visitor System|请先登录|请登录|登录后|需要登录)/i.test(html)) return false;
    if (!/<[a-zA-Z][\s>]/.test(html)) return false;
    return true;
  }
  function isUsableMd(text) {
    if (!text || text.length < 120) return false;
    if (/^(cloudflare|522|502|524|504|error|access denied)/i.test(text.trim())) return false;
    if (/<!DOCTYPE|<html|<title>/i.test(text)) return false;
    if (/(Sina Visitor System|Please (sign|log) in|请先登录|请登录)/i.test(text)) return false;
    return true;
  }

  // Turns a mirror's raw response into {kind, ...} or null.
  function parseSource(src, body) {
    try {
      if (src.kind === 'json') {
        const parsed = JSON.parse(body);
        if (!parsed || typeof parsed.contents !== 'string') return null;
        body = parsed.contents;
        if (!isUsableHtml(body)) return null;
        return { kind: 'html', html: body, source: src.name, label: src.label };
      }
      if (src.kind === 'wiki') {
        const j = JSON.parse(body);
        const t = j && j.parse && j.parse.text && (j.parse.text['*'] || j.parse.text);
        if (typeof t !== 'string' || t.length < 300) return null;
        return { kind: 'html', html: wrapWikiDoc(t), source: src.name, label: src.label };
      }
      if (src.kind === 'md') {
        if (!isUsableMd(body)) return null;
        return { kind: 'md', text: body, source: src.name, label: src.label };
      }
      if (!isUsableHtml(body)) return null;
      return { kind: 'html', html: body, source: src.name, label: src.label };
    } catch (e) { return null; }
  }

  function fetchPage(url, onUpgrade) {
    return new Promise((resolve, reject) => {
      const live = SOURCES.filter((s) => !s.matches || s.matches(url));
      if (live.length === 0) { reject(new Error('No mirror available for ' + url)); return; }
      let settled = 0, bestHtml = null, bestMd = null, delivered = null;
      const settle = () => {
        if (delivered === 'md' && bestHtml && onUpgrade) { const h = bestHtml; bestHtml = null; onUpgrade(h); return; }
        if (delivered) return;
        if (bestHtml) { delivered = 'html'; resolve(bestHtml); return; }
        if (bestMd) { delivered = 'md'; resolve(bestMd); return; }
        if (settled >= live.length) { delivered = 'done'; reject(new Error('No source returned a usable copy of ' + url)); }
      };
      live.forEach((src) => {
        const ms = src.timeout || FETCH_TIMEOUT;
        let p;
        try { const u = src.build(url); p = u ? fetchWithTimeout(u, ms, src.headers) : Promise.reject(new Error('no mirror url')); }
        catch (e) { p = Promise.reject(e); }
        p.then((body) => {
          const r = parseSource(src, body);
          if (r && r.kind === 'html' && !bestHtml) bestHtml = r;
          else if (r && r.kind === 'md' && !bestMd) bestMd = r;
        }).catch(() => {}).then(() => { settled++; settle(); });
      });
    });
  }
// --- URL fixing so the re-rendered page looks like the real site -------------
  // Under a blob: iframe, protocol-relative links ("//host/…") resolve to
  // "blob://host/…" and FAIL (this is why images were missing). Rewrite them to
  // https: everywhere they appear; relative src/href/CSS resolve correctly via
  // the <base href> injected in buildDocHtml.
  function absolutizeResourceUrls(html) {
    if (!html) return html;
    // quoted attrs: src="//…", href="//…", content="//…", poster, data-src…
    html = html.replace(/(["'])\/\//g, '$1https://');
    // srcset: "//a.jpg 1x, //b.jpg 2x" — every comma-separated candidate
    html = html.replace(/\bsrcset=(["'])([\s\S]*?)\1/gi, (m, q, val) => {
      const out = val.split(',').map((chunk) => {
        let c = chunk.trim();
        if (c.indexOf('//') === 0) c = 'https:' + c;
        return c;
      }).join(', ');
      return 'srcset=' + q + out + q;
    });
    // inline CSS: url(//…) and url('//…')
    html = html.replace(/url\((['"]?)\/\//g, 'url($1https://');
    return html;
  }

  // Engine bootstrap appended to the fetched page: loads page-styles.css + the
  // engine scripts from the first reachable base, then inits the runner so the
  // page is annotated. Must not contain the literal `</script>`.
  function engineBootstrap(settings, bases) {
    const j = JSON.stringify;
    const safe = (x) => j(x).replace(/<\//g, '<\\/');
    return '<scr' + 'ipt>(function(){var s=' + safe(settings) +
      ';window.__WRY_PAGE_SETTINGS__=s;var bases=' + safe(bases) +
      ';var f=' + safe(FILES) + ';var i=0;' +
      'function pick(){if(window.WryPageRunner){window.WryPageRunner.init(s);return;}' +
      'if(i>=bases.length){if(window.console)window.console.warn("王软音: no base reachable.");return;}' +
      'var b=bases[i++],st=document.createElement("link");st.rel="stylesheet";st.href=b+"page-styles.css";' +
      '(document.head||document.documentElement).appendChild(st);' +
      'function L(j){if(j>=f.length){pick();return;}' +
      'var n=document.createElement("script");n.src=b+f[j];' +
      'n.onload=function(){L(j+1)};n.onerror=function(){pick()};' +
      '(document.head||document.documentElement).appendChild(n);}L(0);}pick();})();' +
      '</scr' + 'ipt>';
  }

  // Keeps surfing IN the viewer: any normal link click is intercepted (capture
  // phase) and forwarded to the host, which loads that page in the SAME iframe
  // with 王软音 re-applied. Hash links, modified-clicks and new-tab links are
  // left to the browser.
  function navHook() {
    return '<scr' + 'ipt>(function(d){function h(e){' +
      'if(e.defaultPrevented||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;' +
      'if(e.button&&e.button!==0)return;' +
      'var a=e.target&&e.target.closest?e.target.closest("a"):null;if(!a||a.target==="_blank")return;' +
      'var href=a.getAttribute("href");if(!href||href.charAt(0)==="#"||href.indexOf("javascript:")===0)return;' +
      'var u;try{u=new URL(href,document.baseURI);}catch(x){return;}' +
      'if(u.protocol!=="http:"&&u.protocol!=="https:")return;' +
      'e.preventDefault();e.stopPropagation();' +
      'window.parent.postMessage({t:"wryNav",u:u.href},"*");}' +
      'd.addEventListener("click",h,true);})(document);</scr' + 'ipt>';
  }
// Builds the iframe document: fetched page + protocol-relative URLs fixed + our
  // <base> + engine bootstrap + nav hook.
  function buildDocHtml(html, url, settings, bases) {
    let doc = absolutizeResourceUrls(html);
    doc = doc.replace(/<base[^>]*>/gi, '');
    const baseTag = '<base href="' + url.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '">';
    if (/<head[^>]*>/i.test(doc)) doc = doc.replace(/<head([^>]*)>/i, '<head$1>' + baseTag);
    else doc = '<head>' + baseTag + '</head>' + doc;
    const chunk = engineBootstrap(settings, bases) + navHook();
    if (/<\/body>/i.test(doc)) doc = doc.replace(/<\/body>/i, chunk + '</body>');
    else if (/<\/html>/i.test(doc)) doc = doc.replace(/<\/html>/i, chunk + '</html>');
    else doc = doc + chunk;
    return doc;
  }

  // Minimal markdown -> HTML for the readable fallback.
  function mdToHtml(text) {
    const esc = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const blocks = esc.split(/\n\s*\n/).map((b) => b.replace(/^\s+|\s+$/g, ''));
    const out = [];
    for (const b of blocks) {
      if (!b) continue;
      const h = b.match(/^(#{1,6})\s+(.*)$/);
      if (h) { out.push('<h' + h[1].length + '>' + h[2] + '</h' + h[1].length + '>'); continue; }
      if (/^[-*]\s+/.test(b)) {
        const items = b.split('\n').map((l) => l.replace(/^[-*]\s+/, '')).filter((l) => l);
        out.push('<ul><li>' + items.join('</li><li>') + '</li></ul>');
        continue;
      }
      if (/^>\s?/.test(b)) { out.push('<blockquote>' + b.replace(/^>\s?/gm, '').replace(/\n/g, '<br>') + '</blockquote>'); continue; }
      out.push('<p>' + b.replace(/\n/g, '<br>') + '</p>');
    }
    return out.join('\n');
  }

  // Builds a styled article document from the readable-text fallback.
  function buildArticleDoc(text, url, settings, bases) {
    const safeUrl = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const title = (text.trim().split('\n')[0] || 'Article').slice(0, 120).replace(/[#\s]+/g, ' ').trim();
    const doc =
      '<!DOCTYPE html><html><head><meta charset="utf-8">' +
      '<title>' + title + '</title>' +
      '<style>' +
      'body{font-family:Georgia,serif;max-width:860px;margin:20px auto;padding:0 20px 60px;line-height:1.75;color:#222;}' +
      '.wry-src{font-family:Arial,sans-serif;font-size:13px;color:#666;background:#f3f5f7;border:1px solid #dfe4ea;border-radius:8px;padding:8px 12px;margin:0 0 18px;}' +
      '.wry-src a{color:#1f5fa6;}' +
      'h1{font-size:26px;line-height:1.3;} h2{font-size:20px;} h3{font-size:17px;}' +
      'p{font-size:17px;} blockquote{color:#444;border-left:3px solid #bbb;padding-left:12px;margin:14px 0;}' +
      'pre{background:#f6f8fa;padding:10px;border-radius:6px;overflow:auto;}' +
      'code{background:#f1f3f5;padding:1px 4px;border-radius:4px;}' +
      'a{color:#0645ad;}' +
      '</style></head><body>' +
      '<div class="wry-src">Readable render of <a href="' + safeUrl + '" target="_blank" rel="noopener">' + safeUrl + '</a></div>' +
      mdToHtml(text) +
      engineBootstrap(settings, bases) + navHook() +
      '</body></html>';
    return doc;
  }
// --- rendering + navigation --------------------------------------------------
  let lastBlobUrl = null;
  function renderInFrame(doc) {
    const blobUrl = URL.createObjectURL(new Blob([doc], { type: 'text/html;charset=utf-8' }));
    if (lastBlobUrl) { try { URL.revokeObjectURL(lastBlobUrl); } catch (e) {} }
    lastBlobUrl = blobUrl;
    frame.src = blobUrl;
    clearError();
  }

  function clearError() {
    frame.hidden = false;
    hideEmbedBlocked();
  }

  function hideEmbedBlocked() {
    if (embedBlocked) embedBlocked.hidden = true;
  }

  function showResult(res, url, token) {
    if (typeof token === 'number' && token !== renderToken) return;
    setViewMode('annotated');
    recordRecent(url);
    const settings = collectSettings();
    const bases = candidateBases();
    const doc = res.kind === 'md'
      ? buildArticleDoc(res.text, url, settings, bases)
      : buildDocHtml(res.html, url, settings, bases);

    frame.onload = () => {
      try { frame.contentWindow.postMessage({ t: 'wryBoot', s: settings, b: bases }, '*'); } catch (e) {}
      try { frame.contentWindow.scrollTo && frame.contentWindow.scrollTo(0, 0); } catch (e) {}
      setStatus('王软音 applied — change the toggles in the app header to re-annotate live.');
    };
    try { frame.contentWindow.postMessage({ t: 'wrySettings', s: settings }, '*'); } catch (e) {}

    renderInFrame(doc);
    endLoading();
    setStatus('Fetched via ' + (res.label || 'a mirror') + ' — applying 王软音…');
  }

  let renderToken = 0;
  function loadSite(rawUrl) {
    const url = normalizeUrl(rawUrl);
    if (!url) { setStatus('Enter an address.'); if (siteUrl) siteUrl.focus(); return; }
    if (siteUrl) siteUrl.value = url;
    const token = ++renderToken;
    clearError();
    enterViewer();
    startLoading();

    // Sites like Weibo refuse to be shown inside ANY page (X-Frame-Options /
    // frame-ancestors). The browser hard-blocks them — no website can override
    // that, so show what works instead of a raw ERR_BLOCKED_BY_RESPONSE.
    if (framingBlocked(url)) {
      endLoading();
      showEmbedBlocked(url);
      return;
    }
    setStatus('Loading ' + url + '…');

    // ALWAYS open the REAL site first and stay inside the app: real images,
    // links and scripts work natively and surfing never leaves this page.
    showRealPage(url);

    // Then add 王软音 on top when possible: fetch through the reader pipeline and,
    // if it succeeds, swap to the annotated view automatically.
    if (annotationEnabled()) fetchAndAnnotate(url, token);
  }

  // True if any annotation feature the user cares about is on.
  function annotationEnabled() {
    const pinyin = $('togglePinyin') && $('togglePinyin').checked;
    const translation = $('toggleTranslation') && $('toggleTranslation').checked;
    const hsk = document.querySelector('input[name="hskMode"]:checked');
    return pinyin !== false || translation !== false || (hsk && hsk.value !== 'off');
  }

  // Fetch the current page for the annotated view. On failure the real page
  // simply stays — never an error card, never a new tab.
  function fetchAndAnnotate(url, token) {
    startLoading();
    setStatus('Applying 王软音…');

    const cached = readCache(url);
    if (cached) {
      const c = { kind: cached.kind, label: cached.label || 'cached copy', source: cached.source || 'cache', html: cached.html, text: cached.text };
      setStatus('Loaded a cached copy — applying 王软音…');
      showResult(c, url, token);
      return;
    }
    fetchPage(url, (htmlRes) => {
      if (token !== renderToken) return;
      if (htmlRes.kind === 'html' && looksLikeEmptyShell(htmlRes.html)) {
        endLoading();
        setStatus('王软音 isn\'t available on this site (login/JS app) — you\'re viewing the real page.');
        return;
      }
      writeCache(url, htmlRes);
      showResult(htmlRes, url, token);
    })
      .then((res) => {
        if (token !== renderToken) return;
        if (res.kind === 'html' && looksLikeEmptyShell(res.html)) {
          endLoading();
          setStatus('王软音 isn\'t available on this site (login/JS app) — you\'re viewing the real page.');
          return;
        }
        writeCache(url, res);
        showResult(res, url, token);
      })
      .catch(() => {
        if (token !== renderToken) return;
        endLoading();
        setStatus('王软音 isn\'t available on this site — you\'re viewing the real page.');
      });
  }

  // A fetched "page" that is really a client-side JS shell (a login wall or an
  // app that renders everything in JS) has almost no server-rendered text — show
  // the real page directly instead of a blank shell.
  function looksLikeEmptyShell(html) {
    if (!html || typeof html !== 'string') return true;
    const textOnly = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return textOnly.length < 180;
  }

  // Switches the viewer between "annotated" (王软音 applied) and "real page"
  // (the actual site loaded directly — native images/scripts; no annotations).
  function setViewMode(mode) {
    viewMode = mode;
    if (realNotice) realNotice.hidden = mode !== 'real';
    if (realViewBtn) {
      realViewBtn.hidden = false;
      realViewBtn.textContent = mode === 'real' ? '✨ 王软音 view' : '↖ Real page';
      realViewBtn.title = mode === 'real'
        ? 'Show the page with 王软音 annotations (reader must be able to fetch it)'
        : 'Show the real page directly (native images/scripts; annotations paused)';
    }
  }

  // Sites that refuse to be framed (Weibo sends X-Frame-Options: SAMEORIGIN —
  // a hard, browser-enforced "can't embed me anywhere"). Match any weibo.com /
  // weibo.cn host (apex, subdomain, any path like /newlogin?…).
  function framingBlocked(url) {
    try {
      const host = (new URL(url).hostname || '').toLowerCase().replace(/\.$/, '');
      if (host === 'weibo.com' || host.endsWith('.weibo.com')) return true;
      if (host === 'weibo.cn' || host.endsWith('.weibo.cn')) return true;
    } catch (e) { /* keep going */ }
    if (/wbapp/i.test(url)) return true;
    return false;
  }

  // Friendlier than a raw ERR_BLOCKED_BY_RESPONSE: explains WHY and what works.
  function showEmbedBlocked(url) {
    viewMode = 'blocked';
    if (realNotice) realNotice.hidden = true;
    if (frame) { frame.src = ''; frame.onload = null; }
    if (lastBlobUrl) { try { URL.revokeObjectURL(lastBlobUrl); } catch (e) {} }
    lastBlobUrl = null;
    if (embedBlockedUrl) embedBlockedUrl.textContent = url;
    if (embedBlocked) embedBlocked.hidden = false;
    if (siteHost) siteHost.hidden = false;
    if (realViewBtn) realViewBtn.hidden = true;
    endLoading();
    setStatus('');
  }

  // Load the REAL site directly into the same iframe — the default experience:
  // native images, links and scripts; the 王软音 toggles then annotate on top.
  function showRealPage(url) {
    setViewMode('real');
    recordRecent(url);
    hideEmbedBlocked();
    if (realNoticeText) realNoticeText.textContent =
      '🌐 Real site — the actual website, so images and links work natively. ' +
      '王软音 annotates it automatically when the reader can reach it; otherwise you keep surfing the real page.';
    if (lastBlobUrl) { try { URL.revokeObjectURL(lastBlobUrl); } catch (e) {} }
    lastBlobUrl = null;
    frame.hidden = false;
    frame.onload = () => setStatus('Real site loaded — 王软音 enhances it when possible.');
    frame.src = url;
    endLoading();
  }

  function toggleView() {
    const current = (siteUrl && siteUrl.value) || '';
    if (!current) return;
    if (viewMode === 'real') {
      const token = ++renderToken;
      fetchAndAnnotate(current, token); // try the annotated view
    } else {
      showRealPage(current);
    }
  }

  // --- events ------------------------------------------------------------------
  if (openBtn) openBtn.addEventListener('click', () => loadSite(siteUrl.value));
  if (siteUrl) siteUrl.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadSite(siteUrl.value); });

  // Tools visibility: plain collapsible block above the site.
  function setToolsCollapsed(collapsed) {
    if (toolsPanel) toolsPanel.classList.toggle('collapsed', collapsed);
    if (toolsToggle) {
      toolsToggle.setAttribute('aria-expanded', String(!collapsed));
      toolsToggle.textContent = collapsed ? '⚙ Show tools ▴' : '⚙ Hide tools ▾';
    }
  }
  function toolsCollapsed() {
    return toolsPanel ? toolsPanel.classList.contains('collapsed') : true;
  }
  if (copyBtn) copyBtn.addEventListener('click', copyBookmarklet);
  if (toolsToggle) toolsToggle.addEventListener('click', () => setToolsCollapsed(!toolsCollapsed()));
  if (viewerCloseBtn) viewerCloseBtn.addEventListener('click', exitViewer);
  if (realViewBtn) realViewBtn.addEventListener('click', toggleView);
  if (embedOpenTab) embedOpenTab.addEventListener('click', () => {
    const u = (embedBlockedUrl && embedBlockedUrl.textContent) || (siteUrl && siteUrl.value) || '';
    if (u) window.open(u, '_blank', 'noopener');
  });

  // Live re-annotation from the header toggles: in the annotated view they
  // re-annotate instantly; in the REAL view they request the annotated version
  // of the current page (so toggling ON always tries to enhance the real page).
  function pushSettings() {
    const current = (siteUrl && siteUrl.value) || '';
    if (viewMode === 'real') {
      if (annotationEnabled() && current) {
        const token = ++renderToken;
        fetchAndAnnotate(current, token);
      }
      return;
    }
    if (!frame || !frame.contentWindow) return;
    try { frame.contentWindow.postMessage({ t: 'wrySettings', s: collectSettings() }, '*'); } catch (e) {}
  }
  ['togglePinyin', 'toggleTranslation', 'toggleSelection', 'targetLang'].forEach((id) => {
    const el = $(id);
    if (el) el.addEventListener('change', pushSettings);
  });
  document.querySelectorAll('input[name="hskMode"]').forEach((r) => r.addEventListener('change', pushSettings));
  document.querySelectorAll('#hskLegend .hsk-color').forEach((sw) => sw.addEventListener('click', pushSettings));

  // Keep the bookmarklet in sync with the header toggles.
  const refreshBm = () => window.setTimeout(refreshBookmarklet, 0);
  ['togglePinyin', 'toggleTranslation', 'toggleSelection', 'targetLang'].forEach((id) => {
    const el = $(id);
    if (el) el.addEventListener('change', refreshBm);
  });
  document.querySelectorAll('input[name="hskMode"]').forEach((r) => r.addEventListener('change', refreshBm));
  document.querySelectorAll('#hskLegend .hsk-color').forEach((sw) => sw.addEventListener('click', refreshBm));

  refreshBookmarklet();
  renderRecents();

  // In-page links navigate the SAME iframe (surf + translate stay together).
  window.addEventListener('message', (ev) => {
    const d = ev.data;
    if (d && d.t === 'wryNav' && d.u) {
      if (siteUrl) siteUrl.value = d.u;
      loadSite(d.u);
    }
  });
})();