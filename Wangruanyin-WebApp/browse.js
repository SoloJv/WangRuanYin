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
  const loadBox = $('loadBox');
  const frame = $('siteFrame');
  const errorBox = $('siteError');
  const errUrl = $('errUrl');
  const toolsPanel = $('toolsPanel');
  const toolsToggle = $('toolsToggle');
  const viewerCloseBtn = $('viewerCloseBtn');
  const siteHost = $('siteHost');

  // Cached copy of the most recent site (sessionStorage) so re-opening a
  // website is instant instead of re-fetching the whole page.
  const CACHE_KEY = 'wry_viewer_cache_v1';
  const CACHE_TTL = 10 * 60 * 1000; // 10 minutes
  const CACHE_MAX_CHARS = 1200000;  // keep under sessionStorage quota

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
    { name: 'jina-raw', label: 'Jina Reader', kind: 'html', build: (u) => 'https://r.jina.ai/' + u, headers: { 'X-Return-Format': 'html', 'Accept': 'text/html' }, timeout: 20000 },
    { name: 'jina-readable', label: 'Jina Reader (readable)', kind: 'md', build: (u) => 'https://r.jina.ai/' + u, timeout: 25000 },
    { name: 'wikipedia-api', label: 'Wikimedia API', kind: 'wiki', matches: (u) => /^https?:\/\/([a-z0-9-]+\.)*wikipedia\.org\//i.test(u), build: wikiApiUrlFor, timeout: 12000 },
    { name: 'allorigins', label: 'AllOrigins', kind: 'html', build: (u) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u) },
    { name: 'allorigins-get', label: 'AllOrigins', kind: 'json', build: (u) => 'https://api.allorigins.win/get?url=' + encodeURIComponent(u) },
    { name: 'codetabs', label: 'CodeTabs', kind: 'html', build: (u) => 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(u) },
    { name: 'corsproxy', label: 'CORSProxy.io', kind: 'html', build: (u) => 'https://corsproxy.io/?url=' + encodeURIComponent(u) }
  ];
  const FETCH_TIMEOUT = 25000;

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

  // Reject proxy error pages so a real (if slow) source still wins.
  function isUsableHtml(html) {
    if (!html || html.length < 300) return false;
    if (/<title[^>]*>(Cloudflare|522|502|524|504|Access denied|Just a moment|Attention Required|error[^<]*)/i.test(html)) return false;
    if (/<body[^>]*class="error-page"/i.test(html)) return false;
    if (/Enable JavaScript and cookies to continue/i.test(html)) return false;
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
  // others). Real-site HTML is preferred: markdown is accepted only once every
  // HTML source has failed.
  function fetchPage(url) {
    return new Promise((resolve, reject) => {
      const live = SOURCES.filter((s) => !s.matches || s.matches(url));
      if (live.length === 0) { reject(new Error('No mirror available for ' + url)); return; }
      let settled = 0;
      let bestHtml = null;
      let bestMd = null;
      const finish = () => {
        if (bestHtml) { resolve(bestHtml); return; }
        if (settled >= live.length) {
          if (bestMd) resolve(bestMd);
          else reject(new Error('No source returned a usable copy of ' + url));
        }
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
          .then(() => { settled++; finish(); });
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

  // Converts in-page links into viewer navigation via window.parent.postMessage.
  function navHook() {
    return '<scr' + 'ipt>(function(d){function h(e){' +
      'var a=e.target&&e.target.closest?e.target.closest("a"):null;if(!a)return;' +
      'var href=a.getAttribute("href");if(!href)return;' +
      'var u;try{u=new URL(href,document.baseURI);}catch(x){return;}' +
      'if(u.protocol==="http:"||u.protocol==="https:"){e.preventDefault();' +
      'window.parent.postMessage({t:"wryNav",u:u.href},"*");}}' +
      'd.addEventListener("click",h,false);})(document);</scr' + 'ipt>';
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
    loadBox.hidden = true;
    frame.hidden = true;
    if (errUrl) errUrl.textContent = url;
    errorBox.hidden = false;
  }

  function clearError() {
    errorBox.hidden = true;
    loadBox.hidden = true;
    frame.hidden = false;
  }

  function renderInFrame(doc) {
    const blobUrl = URL.createObjectURL(new Blob([doc], { type: 'text/html;charset=utf-8' }));
    frame.src = blobUrl;
    clearError();
  }

  // Switches the app to "website viewer": the site fills the whole viewport,
  // the paste tool hides, the tools panel stays for the toggles.
  function enterViewer() {
    document.body.classList.add('viewing');
    if (siteHost) siteHost.hidden = false;
    if (viewerCloseBtn) viewerCloseBtn.hidden = false;
  }

  function exitViewer() {
    document.body.classList.remove('viewing');
    if (siteHost) siteHost.hidden = true;
    if (viewerCloseBtn) viewerCloseBtn.hidden = true;
    if (frame) frame.src = '';
  }

  // Cached copy of the most recent site, so re-opening it is instant.
  function readCache(url) {
    try {
      const raw = sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (o && o.url === url && o.t && (Date.now() - o.t) < CACHE_TTL) return o;
    } catch (e) { /* quota / corrupted */ }
    return null;
  }

  function writeCache(url, res) {
    try {
      const o = {
        url, t: Date.now(),
        kind: res.kind, label: res.label, source: res.source,
        html: res.html || undefined, text: res.text || undefined
      };
      const s = JSON.stringify(o);
      if (s && s.length < CACHE_MAX_CHARS) sessionStorage.setItem(CACHE_KEY, s);
    } catch (e) { /* quota */ }
  }

  function showResult(res, url) {
    const settings = collectSettings();
    const bases = candidateBases();
    const doc = res.kind === 'md'
      ? buildArticleDoc(res.text, url, settings, bases)
      : buildDocHtml(res.html, url, settings, bases);
    renderInFrame(doc);
    frame.onload = () => {
      try { frame.contentWindow.postMessage({ t: 'wryBoot', s: settings, b: bases }, '*'); } catch (e) {}
      setStatus('王软音 applied — change the toggles in the app header to re-annotate live.');
    };
    setStatus('Fetched via ' + (res.label || 'a mirror') + ' — applying 王软音…');
  }

  function loadSite(rawUrl) {
    const url = normalizeUrl(rawUrl);
    if (!url) { setStatus('Enter an address.'); if (siteUrl) siteUrl.focus(); return; }
    if (siteUrl) siteUrl.value = url;
    clearError();
    loadBox.hidden = false;
    frame.hidden = true;
    enterViewer();
    setStatus('Starting…');

    const cached = readCache(url);
    if (cached) {
      const c = { kind: cached.kind, label: cached.label || 'cached copy', source: cached.source || 'cache', html: cached.html, text: cached.text };
      setStatus('Loaded from cache — applying 王软音…');
      showResult(c, url);
      return;
    }

    fetchPage(url)
      .then((res) => {
        writeCache(url, res);
        showResult(res, url);
      })
      .catch((err) => {
        showError(url);
        console.warn('Wangruanyin viewer:', err);
      });
  }

  // --- events ------------------------------------------------------------------
  if (openBtn) openBtn.addEventListener('click', () => loadSite(siteUrl.value));
  if (siteUrl) siteUrl.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadSite(siteUrl.value); });

  // Collapsible tools — hide/show the annotation toggles so the website takes all the space.
  function setToolsCollapsed(collapsed) {
    if (toolsPanel) toolsPanel.classList.toggle('collapsed', collapsed);
    if (toolsToggle) {
      toolsToggle.setAttribute('aria-expanded', String(!collapsed));
      toolsToggle.textContent = collapsed ? '⚙ Show tools ▴' : '⚙ Hide tools ▾';
    }
  }
  if (toolsToggle) toolsToggle.addEventListener('click', () => {
    const collapsed = toolsPanel ? !toolsPanel.classList.contains('collapsed') : false;
    setToolsCollapsed(collapsed);
  });
  if (viewerCloseBtn) viewerCloseBtn.addEventListener('click', exitViewer);

  // Live re-annotation: the header toggles ARE the extension's popup. Changing
  // one re-applies a clean set of settings to the open page.
  function pushSettings() {
    if (!frame || !frame.contentWindow) return;
    try { frame.contentWindow.postMessage({ t: 'wrySettings', s: collectSettings() }, '*'); } catch (e) {}
  }
  ['togglePinyin', 'toggleTranslation', 'targetLang'].forEach((id) => {
    const el = $(id);
    if (el) el.addEventListener('change', pushSettings);
  });
  document.querySelectorAll('input[name="hskMode"]').forEach((r) => r.addEventListener('change', pushSettings));
  document.querySelectorAll('#hskLegend .hsk-color').forEach((sw) => sw.addEventListener('click', pushSettings));

  // Navigation from inside the fetched page (its links post wryNav to us).
  window.addEventListener('message', (ev) => {
    const d = ev.data;
    if (d && d.t === 'wryNav' && d.u) loadSite(d.u);
  });
})();
