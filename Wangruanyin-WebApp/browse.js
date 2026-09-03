// browse.js — 王软音 "website viewer": open any website IN THIS PAGE.
//
// The app keeps its features (pinyin / translation / HSK / TTS toggles) as the
// page header, and other websites open below them in a sandboxed iframe — no new
// tab. A plain web page cannot script another site's tab (same-origin policy),
// so the target page is fetched through mirrors a web page can actually reach
// (Jina Reader — which re-hosts any page server-side and serves it with CORS;
// Wikimedia's own CORS API for Wikipedia articles; public CORS proxies as last
// resort), rendered here, and the engine is injected so pinyin / translation /
// HSK are applied AUTOMATICALLY. The header toggles act like the extension's
// popup: change one and the page is re-annotated live.
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const siteUrl = $('siteUrl');
  const openBtn = $('openSiteBtn');
  const browseStatus = $('browseStatus');
  const frame = $('siteFrame');
  const errorBox = $('siteError');
  const errUrl = $('errUrl');
  const errHint = $('errHint');
  const toolsPanel = $('toolsPanel');
  const toolsToggle = $('toolsToggle');
  const viewerCloseBtn = $('viewerCloseBtn');
  const siteHost = $('siteHost');
  const loadBar = $('loadBar');
  const openRealSiteBtn = $('openRealSiteBtn');

  // Cached copy of the most recent site (persisted in localStorage, session as a
  // fallback) so re-opening a website is instant instead of re-fetching the page.
  const CACHE_KEY = 'wry_viewer_cache_v1';
  const CACHE_TTL = 15 * 60 * 1000; // 15 minutes
  const CACHE_MAX_CHARS = 1200000;  // keep under storage quota

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

  // Reads the header toggles — the same settings the app uses for the text pane.
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
      panel: false // the web app's header toggles are the panel — don't inject the floating popup
    };
  }

  function normalizeUrl(raw) {
    let u = (raw || '').trim();
    if (!u) return '';
    if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = 'https://' + u;
    return u;
  }

  // --- fetching: parallel multi-mirror with validation ------------------------
  // Mirrors are raced in parallel and the FIRST *usable* result wins, so a fast
  // healthy mirror never has to wait for a dead one to time out. Real-site HTML
  // is preferred over the readable-text (markdown) fallback because it keeps the
  // original layout and images; markdown is only used when every HTML source
  // fails.
  //
  // Mirror choices (all verified to send Access-Control-Allow-Origin for this
  // origin, which a plain web page needs):
  //  r.jina.ai             Jina Reader — fetches any page server-side and
  //                        re-hosts it with CORS. With X-Return-Format: html it
  //                        returns the real page HTML (original layout, images);
  //                        without it, readable markdown. Rate-limited on the
  //                        free tier, hence the fallbacks.
  //  *.wikipedia.org       Wikimedia's own CORS API (action=parse&origin=*) — no
  //                        third party involved, always up for Wikipedia articles.
  //  api.allorigins.win / api.codetabs.com / corsproxy.io — classic public CORS
  //                        proxies, kept as last-resort mirrors (go up/down).
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


  // Wikipedia article URL -> Wikimedia CORS API query. action=parse returns the
  // rendered article HTML inside JSON; origin=* is Wikimedia's own CORS opt-in.
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

  // Minimal, safe full-page shell around MediaWiki's parsed article HTML (the
  // viewer's buildDocHtml() adds the real <base> + engine bootstrap afterwards).
  function wrapWikiDoc(html) {
    return '<!DOCTYPE html><html><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<style>' +
      'body{font-family:Georgia,\'Times New Roman\',serif;max-width:880px;margin:0 auto;' +
      'padding:0 20px 80px;line-height:1.75;color:#202122;}' +
      '.mw-parser-output{font-size:16px;} .mw-parser-output a{color:#0645ad;}' +
      '.mw-parser-output img{max-width:100%;height:auto;}' +
      '.mw-parser-output table{border-collapse:collapse;} .mw-parser-output td,' +
      '.mw-parser-output th{border:1px solid #a2a9b1;padding:6px 10px;vertical-align:top;}' +
      '.mw-parser-output .infobox{float:right;clear:right;margin:0 0 14px 20px;background:#f8f9fa;}' +
      '.mw-parser-output .infobox{border:1px solid #a2a9b1;padding:8px;font-size:90%;}' +
      '.mw-parser-output .thumbinner{display:flex;flex-direction:column;align-items:center;}' +
      '.mw-editsection{display:none;}' +
      '@media(max-width:640px){.mw-parser-output .infobox{float:none;clear:both;margin:0 0 12px;}}' +
      '</style></head><body>' + html + '</body></html>';
  }

  // Reject proxy error pages so a real (if slow) source still wins. Also reject
  // login/visitor walls (Weibo's "Sina Visitor System", login prompts) — those
  // can't be annotated, so the viewer shows the real-site fallback instead.
  function isUsableHtml(html) {
    if (!html || html.length < 300) return false;
    if (/<title[^>]*>(Cloudflare|522|502|524|504|Access denied|Just a moment|Attention Required|Sina Visitor System|Please (sign|log) in|Login|登录|error[^<]*)/i.test(html)) return false;
    if (/<body[^>]*class="error-page"/i.test(html)) return false;
    if (/Enable JavaScript and cookies to continue/i.test(html)) return false;
    if (/(Sina Visitor System|请先登录|请登录|登录后|需要登录)/i.test(html)) return false;
    if (!/<[a-zA-Z][\s>]/.test(html)) return false;
    return true;
  }

  function isUsableMd(text) {
    if (!text || text.length < 120) return false;
    if (/^(cloudflare|522|502|524|504|error|access denied)/i.test(text.trim())) return false;
    // A markdown source must not hand us an HTML error/redirect page.
    if (/<!DOCTYPE|<html|<title>/i.test(text)) return false;
    // Jina's readable fallback for a login wall: just a title + empty body.
    if (/(Sina Visitor System|Please (sign|log) in|请先登录|请登录)/i.test(text)) return false;
    return true;
  }

  // Turns a mirror's raw response into a usable {kind, …} result, or null.
  function parseSource(src, body) {
    try {
      if (src.kind === 'json') {
        const parsed = JSON.parse(body);
        if (parsed && typeof parsed.contents === 'string') body = parsed.contents;
        else return null;
        if (!isUsableHtml(body)) return null;
        return { kind: 'html', html: body, source: src.name, label: src.label };
      }
      if (src.kind === 'wiki') {
        const j = JSON.parse(body);
        const t = j && j.parse && j.parse.text && (j.parse.text['*'] || j.parse.text);
        if (typeof t !== 'string' || t.length < 300 || !isUsableHtml('<div>' + t.slice(0, 2000) + '</div>')) return null;
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

  // Fetches the page from every usable mirror in parallel and settles on the
  // FIRST usable result (a mirror that already failed/succeeded never blocks the
  // others). The readable-text (markdown) result is returned IMMEDIATELY so the
  // content appears fast; if a full-HTML mirror finishes shortly after, onUpgrade
  // fires so the page can be swapped to the real layout.
  function fetchPage(url, onUpgrade) {
    return new Promise((resolve, reject) => {
      const live = SOURCES.filter((s) => !s.matches || s.matches(url));
      if (live.length === 0) { reject(new Error('No mirror available for ' + url)); return; }
      let settled = 0;
      let bestHtml = null;
      let bestMd = null;
      let delivered = null;
      const settle = () => {
        if (delivered === 'md' && bestHtml && onUpgrade) {
          const h = bestHtml; bestHtml = null;
          onUpgrade(h);
          return;
        }
        if (delivered) return;
        if (bestHtml) { delivered = 'html'; resolve(bestHtml); return; }
        if (bestMd) { delivered = 'md'; resolve(bestMd); return; }
        if (settled >= live.length) { delivered = 'done'; reject(new Error('No source returned a usable copy of ' + url)); }
      };
      live.forEach((src) => {
        const ms = src.timeout || FETCH_TIMEOUT;
        let p;
        try {
          const u = src.build(url);
          p = u ? fetchWithTimeout(u, ms, src.headers) : Promise.reject(new Error('no mirror url'));
        } catch (e) { p = Promise.reject(e); }
        p
          .then((body) => {
            const r = parseSource(src, body);
            if (r && r.kind === 'html' && !bestHtml) bestHtml = r;
            else if (r && r.kind === 'md' && !bestMd) bestMd = r;
          })
          .catch(() => {})
          .then(() => { settled++; settle(); });
      });
    });
  }


  // --- building the sandboxed document -----------------------------------------
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

  // Converts in-page navigation into viewer navigation via window.parent.postMessage.
  // Uses CAPTURE phase so our handler fires even if a site's own script stops
  // propagation. Hash-only links keep the browser default; target="_blank" links
  // are left to the sandbox (they open as popups).
  function navHook() {
    return '<scr' + 'ipt>(function(d){function h(e){' +
      'var a=e.target&&e.target.closest?e.target.closest("a"):null;if(!a)return;' +
      'if(a.target==="_blank")return;' +
      'var href=a.getAttribute("href");if(!href||href.charAt(0)==="#")return;' +
      'var u;try{u=new URL(href,document.baseURI);}catch(x){return;}' +
      'if(u.protocol!=="http:"&&u.protocol!=="https:")return;' +
      'e.preventDefault();e.stopPropagation();' +
      'window.parent.postMessage({t:"wryNav",u:u.href},"*");}' +
      'd.addEventListener("click",h,true);})(document);</scr' + 'ipt>';
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

  // Minimal, safe markdown -> HTML for the readable-render fallback (jina).
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
      '<div class="wry-src">Readable render of <a href="' + safeUrl + '" target="_blank" rel="noopener">' + safeUrl + '</a></div>' +
      mdToHtml(text) +
      engineBootstrap(settings, bases) + navHook() +
      '</body></html>';
    return html;
  }


  // --- load a site into the in-page frame --------------------------------------
  function setStatus(msg) {
    if (!browseStatus) return;
    browseStatus.textContent = msg;
    browseStatus.hidden = false;
    window.setTimeout(() => {
      if (browseStatus.textContent === msg) browseStatus.hidden = true;
    }, 6000);
  }

  function showError(url) {
    endLoading();
    // Explain why a site failed — e.g. Weibo shows only a login/visitor wall.
    const hint = loginWallHint(url);
    if (errHint) errHint.textContent = hint;
    // If the viewer is already showing a page, keep it visible and show the
    // error as an overlay card on top — never blank/black the screen.
    if (lastBlobUrl && frame.src) {
      if (siteHost) siteHost.classList.add('has-error');
      errorBox.hidden = false;
      if (openRealSiteBtn) openRealSiteBtn.hidden = false;
      if (errUrl) errUrl.textContent = url;
      setStatus('Could not load ' + url + ' — the previous page stays open.');
      return;
    }
    frame.hidden = true;
    if (errUrl) errUrl.textContent = url;
    errorBox.hidden = false;
    if (openRealSiteBtn) openRealSiteBtn.hidden = false;
  }

  // Known login/visitor walls get a specific, honest explanation.
  function loginWallHint(url) {
    if (/weibo\.com/i.test(url)) {
      return 'Weibo shows only a "Sina Visitor System" login wall to readers — it requires you to be\n' +
        'signed in, so its content can\'t be shown inside the web app. Open it in a new tab and use the\n' +
        'browser extension to annotate it there.';
    }
    return 'Causes are usually login-required pages, sites that block readers/proxies, or apps\n' +
      'that render only with client-side JavaScript.';
  }

  function clearError() {
    errorBox.hidden = true;
    frame.hidden = false;
    if (openRealSiteBtn) openRealSiteBtn.hidden = true;
    if (siteHost) siteHost.classList.remove('has-error');
  }

  let lastBlobUrl = null;
  function renderInFrame(doc) {
    const blobUrl = URL.createObjectURL(new Blob([doc], { type: 'text/html;charset=utf-8' }));
    if (lastBlobUrl) { try { URL.revokeObjectURL(lastBlobUrl); } catch (e) {} }
    lastBlobUrl = blobUrl;
    frame.src = blobUrl;
    clearError();
  }

  function startLoading() {
    if (openBtn) openBtn.classList.add('loading');
    if (loadBar) loadBar.hidden = false;
  }
  function endLoading() {
    if (openBtn) openBtn.classList.remove('loading');
    if (loadBar) loadBar.hidden = true;
  }

  // Switches the app to "website viewer": the site fills the whole viewport and
  // the paste tool hides. The tools panel stays a normal collapsible panel at
  // the top — collapsed by default so the website gets all the space.
  let viewerActive = false;
  function enterViewer() {
    const first = !viewerActive;
    viewerActive = true;
    document.body.classList.add('viewing');
    if (first) setToolsCollapsed(true); // collapse tools only when first entering
    if (siteHost) siteHost.hidden = false;
    if (viewerCloseBtn) viewerCloseBtn.hidden = false;
  }

  function exitViewer() {
    viewerActive = false;
    document.body.classList.remove('viewing');
    setToolsCollapsed(false);
    if (siteHost) siteHost.hidden = true;
    if (viewerCloseBtn) viewerCloseBtn.hidden = true;
    if (frame) { frame.src = ''; frame.onload = null; }
    if (lastBlobUrl) { try { URL.revokeObjectURL(lastBlobUrl); } catch (e) {} }
    lastBlobUrl = null;
    if (siteHost) siteHost.classList.remove('has-error');
    errorBox.hidden = true;
  }

  // Cached copy of the most recent site, so re-opening it is instant.
  function readCache(url) {
    const stores = [localStorage, sessionStorage];
    for (const store of stores) {
      try {
        const raw = store.getItem(CACHE_KEY);
        if (!raw) continue;
        const o = JSON.parse(raw);
        if (o && o.url === url && o.t && (Date.now() - o.t) < CACHE_TTL) return o;
      } catch (e) { /* quota / corrupted — try next store */ }
    }
    return null;
  }

  function writeCache(url, res) {
    const o = {
      url, t: Date.now(),
      kind: res.kind, label: res.label, source: res.source,
      html: res.html || undefined, text: res.text || undefined
    };
    const s = JSON.stringify(o);
    if (!s || s.length >= CACHE_MAX_CHARS) return;
    const stores = [localStorage, sessionStorage];
    for (let i = 0; i < stores.length; i++) {
      try { stores[i].setItem(CACHE_KEY, s); break; } catch (e) { /* try next */ }
    }
  }

  function showResult(res, url) {
    const settings = collectSettings();
    const bases = candidateBases();
    const doc = res.kind === 'md'
      ? buildArticleDoc(res.text, url, settings, bases)
      : buildDocHtml(res.html, url, settings, bases);

    // Attach the load handler BEFORE swapping the src so the boot message can
    // never be missed. The inline bootstrap in the page also inits the engine,
    // and init is idempotent — so this single message + the bootstrap never
    // cause a page to be annotated/translated twice.
    frame.onload = () => {
      try { frame.contentWindow.postMessage({ t: 'wryBoot', s: settings, b: bases }, '*'); } catch (e) {}
      setStatus('王软音 applied — change the toggles in the app header to re-annotate live.');
    };

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
    startLoading();               // slim progress bar + spinner in the Open button
    setStatus('Fetching…');

    const cached = readCache(url);
    if (cached) {
      const c = { kind: cached.kind, label: cached.label || 'cached copy', source: cached.source || 'cache', html: cached.html, text: cached.text };
      setStatus('Loaded a cached copy — applying 王软音…');
      showResult(c, url);
      return;
    }

    // The markdown may arrive first (instant); when a full-HTML mirror finishes
    // a moment later we seamlessly upgrade the page to the real layout.
    fetchPage(url, (htmlRes) => {
      if (token !== renderToken) return; // user navigated elsewhere meanwhile
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
        // We're already browsing a site inside the viewer — fall back to
        // navigating the iframe DIRECTLY to the clicked URL, the way a normal
        // browser would. Works for any site that allows framing (Wikipedia
        // sends no X-Frame-Options, so wiki links always open like this).
        if (viewerActive && lastBlobUrl && frame && !framingBlocked(url)) {
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

  // Sites that refuse to be framed (X-Frame-Options: SAMEORIGIN / DENY) can't
  // be shown directly inside the viewer — keep the error + real-site fallback.
  function framingBlocked(url) {
    return /weibo\.com/i.test(url);
  }

  // --- events ------------------------------------------------------------------
  if (openBtn) openBtn.addEventListener('click', () => loadSite(siteUrl.value));
  if (siteUrl) siteUrl.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadSite(siteUrl.value); });

  // Tools visibility: a plain collapsible panel (slider) at the top. Hidden by
  // default when a site is open so the website takes all the space; the ⚙
  // button in the header slides it down when needed.
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
  // Fallback for sites that can't be fetched (Weibo, login walls…): open the
  // real site in a new tab where the browser extension can annotate it.
  if (openRealSiteBtn) openRealSiteBtn.addEventListener('click', () => {
    const u = (errUrl && errUrl.textContent) || siteUrl.value;
    if (u) window.open(u, '_blank', 'noopener');
  });
  if (openRealSiteBtn) openRealSiteBtn.hidden = true;

  // Live re-annotation: the header toggles ARE the extension's popup. Changing
  // one re-applies a clean set of settings to the open page.
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

  // Navigation from inside the fetched page: update the top address bar exactly
  // like a normal browser, then load the target. The annotated mirror-fetch is
  // tried first; if it fails (rate-limited reader, blocked mirror) loadSite
  // falls back to navigating the iframe directly to the URL.
  window.addEventListener('message', (ev) => {
    const d = ev.data;
    if (d && d.t === 'wryNav' && d.u) {
      if (siteUrl) siteUrl.value = d.u;
      loadSite(d.u);
    }
  });
})();
