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
  const errorBox = $('siteError');
  const errUrl = $('errUrl');
  const errHint = $('errHint');
  const openRealSiteBtn = $('openRealSiteBtn');

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

  function normalizeUrl(raw) {
    let u = (raw || '').trim();
    if (!u) return '';
    if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = 'https://' + u;
    return u;
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
    document.body.classList.remove('viewing');
    if (siteHost) siteHost.hidden = true;
    if (viewerCloseBtn) viewerCloseBtn.hidden = true;
    if (frame) { frame.src = ''; frame.onload = null; }
    if (lastBlobUrl) { try { URL.revokeObjectURL(lastBlobUrl); } catch (e) {} }
    lastBlobUrl = null;
    if (siteHost) siteHost.classList.remove('has-error');
    errorBox.hidden = true;
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
    errorBox.hidden = true;
    frame.hidden = false;
    if (openRealSiteBtn) openRealSiteBtn.hidden = true;
    if (siteHost) siteHost.classList.remove('has-error');
  }

  function showError(url) {
    endLoading();
    const hint = errHintText(url);
    if (errHint) errHint.textContent = hint;
    // Keep the previous page visible; show the error as an overlay card.
    if (lastBlobUrl && frame.src) {
      if (siteHost) siteHost.classList.add('has-error');
      errorBox.hidden = false;
      if (openRealSiteBtn) openRealSiteBtn.hidden = false;
      if (errUrl) errUrl.textContent = url;
      setStatus('Could not load ' + url);
      return;
    }
    frame.hidden = true;
    if (errUrl) errUrl.textContent = url;
    errorBox.hidden = false;
    if (openRealSiteBtn) openRealSiteBtn.hidden = false;
  }

  function errHintText(url) {
    if (/weibo\.com/i.test(url)) {
      return 'Weibo shows only a "Sina Visitor System" login wall to readers — it requires you to be\n' +
        'signed in, so its content can\'t be shown inside the web app.';
    }
    return 'Causes are usually login-required pages, sites that block readers/proxies, or apps\n' +
      'that render only with client-side JavaScript.';
  }

  function showResult(res, url) {
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
    setStatus('Fetching…');

    const cached = readCache(url);
    if (cached) {
      const c = { kind: cached.kind, label: cached.label || 'cached copy', source: cached.source || 'cache', html: cached.html, text: cached.text };
      setStatus('Loaded a cached copy — applying 王软音…');
      showResult(c, url);
      return;
    }
fetchPage(url, (htmlRes) => {
      if (token !== renderToken) return;
      writeCache(url, htmlRes);
      showResult(htmlRes, url);
    })
      .then((res) => {
        if (token !== renderToken) return;
        writeCache(url, res);
        showResult(res, url);
      })
      .catch((err) => {
        if (token !== renderToken) return;
        // Surf must never stop: navigate the SAME iframe directly to the clicked
        // URL (works for any site that allows framing, e.g. Wikipedia).
        if (viewerActive && frame && !framingBlocked(url)) {
          if (lastBlobUrl) { try { URL.revokeObjectURL(lastBlobUrl); } catch (e) {} }
          lastBlobUrl = null;
          frame.src = url;
          endLoading();
          setStatus('Opened ' + url + ' directly — 王软音 annotations paused on this page.');
          return;
        }
        showError(url);
        console.warn('Wangruanyin viewer:', err);
      });
  }

  // Sites that refuse to be framed can't be shown directly — keep the error card.
  function framingBlocked(url) {
    return /weibo\.com/i.test(url);
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
  if (toolsToggle) toolsToggle.addEventListener('click', () => setToolsCollapsed(!toolsCollapsed()));
  if (viewerCloseBtn) viewerCloseBtn.addEventListener('click', exitViewer);
  if (openRealSiteBtn) openRealSiteBtn.addEventListener('click', () => {
    const u = (errUrl && errUrl.textContent) || siteUrl.value;
    if (u) window.open(u, '_blank', 'noopener');
  });
  if (openRealSiteBtn) openRealSiteBtn.hidden = true;

  // Live re-annotation from the header toggles (the extension-popup equivalent).
  function pushSettings() {
    if (!frame || !frame.contentWindow) return;
    try { frame.contentWindow.postMessage({ t: 'wrySettings', s: collectSettings() }, '*'); } catch (e) {}
  }
  ['togglePinyin', 'toggleTranslation', 'toggleSelection', 'targetLang'].forEach((id) => {
    const el = $(id);
    if (el) el.addEventListener('change', pushSettings);
  });
  document.querySelectorAll('input[name="hskMode"]').forEach((r) => r.addEventListener('change', pushSettings));
  document.querySelectorAll('#hskLegend .hsk-color').forEach((sw) => sw.addEventListener('click', pushSettings));

  // In-page links navigate the SAME iframe (surf + translate stay together).
  window.addEventListener('message', (ev) => {
    const d = ev.data;
    if (d && d.t === 'wryNav' && d.u) {
      if (siteUrl) siteUrl.value = d.u;
      loadSite(d.u);
    }
  });
})();