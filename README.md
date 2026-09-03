# 王软音 · Wangruanyin

Translation and learning service for HSK learners 

**王软音 (Wangruanyin)** adds **pinyin** (Romanized pronunciation) annotations and **translations** to Chinese text, plus **HSK colour coding** and **read-aloud**. It ships in four forms: a **web app** and browser extensions for **Chrome, Edge, Firefox and Safari**.

This is the single, central README. The browser-specific folders each contain their own build, but read **this** file for installation and operation.

---

## Which form should I use?

| Situation | Recommended form |
|---|---|
| You want pinyin + translations **on any website you visit** (Wikipedia, news, forums…) | Browser extension (Chrome / Edge / Firefox / Safari) — or the web app's **website viewer** |
| You want a **standalone tool** — paste text you already have (a PDF, an article, your own notes) and annotate it | **Web app** (works in any browser, no installation) |
| You develop / test locally without distributing | Developer-mode extension, or the web app |

All forms share the same features: pinyin under every Chinese character, a whole-sentence translation row, a target-language selector, HSK colour coding, per-level colour toggles, a selection translation popup, and read-aloud.

---

## Web app (recommended for standalone use)

The **`Wangruanyin-WebApp`** folder is a self-contained single-page app. No installation, no server — just open it (for the **website viewer** a simple local HTTP server is needed, see below).

### Install / run

1. Keep the whole **`Wangruanyin-WebApp`** folder together (see “Files you must keep” below).
2. Open **`index.html`** in any modern browser (Chrome, Edge, Firefox, Safari). You can double-click it, or serve it with e.g. `python -m http.server` / VS Code **Live Server**.
3. A sample sentence is pre-loaded. Paste or type your own Chinese text in the left pane — the annotations update live in the right pane.

> **Hosted on GitHub Pages:** this repo ships a GitHub Actions workflow (`.github/workflows/deploy-pages.yml`) that deploys the `Wangruanyin-WebApp` folder. After you push to `main`, enable **Settings → Pages → Source: “GitHub Actions”** once and the web app is live at **`https://solojv.github.io/WangRuanYin/`** (see “Hosting on GitHub Pages” below).

### Operate the web app

- **Pinyin annotations** toggle — show/hide the pinyin under each character.
- **Sentence translation** toggle — show/hide the translation row under each sentence (uses Google Translate; needs internet).
- **Translation language** — switch the translation language (English is the default; Spanish, French, German, Italian, Portuguese, Russian, Japanese, Korean, Dutch, Polish, Turkish are also available).
- **HSK colour coding** — **Off / HSK 2.0 / HSK 3.0**. Colours every Chinese character by its lowest official HSK level (HSK 2.0 = levels 1–6; HSK 3.0 = levels 1–9). Tap a colour in the legend to hide/show that single level.
- **Select any Chinese text** in the output pane → a floating popup shows **Chinese / Pinyin / Translation** (with a **Read aloud** button).
- **Read page aloud** — Play / Pause / Stop / Restart. Reads every annotated sentence with the browser's Chinese voice, highlighting the character being read.
- Settings persist between sessions (localStorage). Use **Clear** to empty the input.

### Use Wangruanyin on any website (website viewer)

The web app's features (pinyin, translation, HSK, read-aloud) sit in the header and stay visible while
you browse. The **Website viewer** opens other websites **in this same page** (no new tab): the target
page is fetched through mirrors a web page can actually reach — **Jina Reader** (which re-hosts any page
server-side and serves it with CORS), **Wikimedia's own CORS API** for Wikipedia articles, and public CORS
proxies as last resort — rendered in a sandboxed iframe below the toggles, and annotated automatically.

1. **Open the app** at `https://solojv.github.io/WangRuanYin/` (or serve it locally: `python -m http.server 8000` in the `Wangruanyin-WebApp` folder, then open `http://localhost:8000/`).
2. In the **🌐 Website viewer** card, type a website (e.g. `https://zh.wikipedia.org`) and click **Open in this page**.
3. The site loads right here, and pinyin / sentence translations / HSK colours are applied automatically.
   The header toggles act like the extension's popup: change any toggle and the page re-annotates live.
   Internal links navigate inside the viewer.

> Why not open the real site in a tab? A plain web page cannot run scripts inside another website's tab
> (same-origin policy), so fetching and rendering here is the only way the app's features can control the
> page. Sites that need login, block readers/proxies, or render only with client-side JavaScript can't be
> fetched — for those, install and use the browser **extension**, which runs in every page natively.

### Hosting on GitHub Pages

The web app is published with GitHub Pages (repo **`SoloJv/WangRuanYin`**) and is **live**:

- ✅ Repository **public**
- ✅ Latest app code on `main`
- ✅ GitHub Pages **enabled** (the deploy workflow enables it automatically via the API, or you can set it manually under **Settings → Pages → Source: “GitHub Actions”**)
- ✅ Deployed at **`https://solojv.github.io/WangRuanYin/`**

The included workflow (`.github/workflows/deploy-pages.yml`) runs on every push to `main` (or manually via **Actions → Deploy Web App to GitHub Pages → Run workflow**): it confirms Pages is enabled (auto-enabling it via the REST API if needed), then uploads the `Wangruanyin-WebApp` folder and deploys it. A `.nojekyll` file ships in the folder so Pages serves files raw.

> **How the workflow can auto-enable Pages:** it first tries `POST /repos/{owner}/{repo}/pages` with the workflow token (`permissions: pages: write`). If that succeeds (or Pages is already on) it continues; if not it aborts with an explicit message. If you ever need automatic enabling from a fresh repo, add a repo secret **`PAGES_PAT`** (a classic PAT with the `repo` scope, or a fine-grained PAT with **Pages: write** and **Administration: read**).

> If the repo owner uses a **custom domain**, the app is served at that domain's root instead; `browse.js` computes all script URLs relative to the current page, so it works with any Pages URL (project sub-path or root) without extra configuration.

### Files you must keep

```
Wangruanyin-WebApp/
├── index.html                  (the app UI, incl. website-mode card)
├── styles.css                  (app styles)
├── page-styles.css             (styles injected into fetched/visited pages)
├── app.js                      (paste-text controller: rendering, popup, TTS)
├── annotator.js                (pinyin annotation + HSK engine)
├── translator.js               (Google Translate call)
├── page-runner.js              (injected engine + floating panel)
├── browse.js                   (in-page website viewer: fetch → iframe → auto-annotate)
├── reader.html                 (redirect shim for old reader.html?url=… links)
├── pinyin-data.js              (pinyin lookup helpers)
├── pinyin-dict-characters.js   (large character→pinyin dictionary — REQUIRED)
├── hsk2-char-levels.js         (HSK 2.0 char→level data)
├── hsk3-char-levels.js         (HSK 3.0 char→level data)
├── .nojekyll                   (tells GitHub Pages to serve files raw)
├── LICENSE
└── COMMERCIAL_LICENSE.md
```

> The **`pinyin-dict-characters.js`** file is the huge character→pinyin dictionary and is **required** — without it the pinyin will not display.

---

## Browser extensions

### Google Chrome

1. Make sure you have the **`Wangruanyin`** folder (the one that contains `manifest.json`).
2. Launch **Chrome** → go to `chrome://extensions/` (or the puzzle-piece menu → **Extensions**).
3. Turn on **Developer mode** (top-right).
4. Click **Load unpacked** → select the **`Wangruanyin`** folder itself → **Select Folder**.
5. The extension **王软音 (Wangruanyin)** appears in the list. Pin 📌 it to the toolbar (optional, recommended).

### Microsoft Edge

1. Make sure you have the **`Wangruanyin-Edge`** folder (the one that contains `manifest.json`).
2. Launch **Edge** → go to `edge://extensions/` (or the ⋯ menu → **Extensions**).
3. Turn on **Developer mode** (top-right).
4. Click **Load unpacked** → select the **`Wangruanyin-Edge`** folder itself → **Select Folder**.
5. The extension **网软音 (Wangruanyin)** appears in the list. Pin it to the toolbar if you like.

### Mozilla Firefox

Firefox installs the add‑on from a packaged **`.xpi`** file (a normal ZIP renamed to `.xpi`). To build it, right‑click the `Wangruanyin-Firefox` folder → *Send to ZIP* (or `Compress`), then rename the resulting `.zip` to `Wangruanyin-Firefox.xpi`.

1. In **Firefox** go to **about:addons** → click the gear (⚙) → **Install Add‑on From File…**.
   > If the gear option is missing: `about:config` → set `xpinstall.signatures.required` to `false`, restart Firefox, and repeat.
2. Pick the **`Wangruanyin-Firefox.xpi`** you just built (the contents of the folder, zipped — not the folder itself).
3. Enable **王软音 – Wangruanyin (Firefox)** on the add‑ons page and pin it to the toolbar.

**Firefox note:** the JavaScript uses the `chrome.*` API namespace — Firefox intentionally supports it for cross‑browser compatibility, so the same scripts run unchanged. All platform differences are handled in `manifest.json`.

### Safari (macOS)

Safari does **not** allow sideloading a plain folder; a Safari Web Extension must be built and signed with **Xcode on macOS** and is normally distributed through the **App Store**. The **`Wangruanyin-Safari`** folder is the ready-to-build source.

1. Open **Xcode** → **File ▸ New ▸ Project…** → choose the **Safari Web Extension** app template.
2. Copy everything in the `Wangruanyin-Safari` folder into the project's `Resources/` folder (keep `manifest.json` at `Resources/` root).
3. Keep `SafariWebExtensionHandler.swift` / `Info.plist` wired to the native extension target.
4. Set your bundle identifier + signing team in Xcode (Safari extensions must be code‑signed).
5. Run (⌘R). Safari will ask to enable the extension in **Safari → Settings → Extensions**.
6. To distribute: archive the App™ and publish through **App Store Connect**.

**Safari note:** this build already uses the **`browser.*`** API namespace (not `chrome.*`). If a state toggle does not persist on an older Safari, adjust the two `browser.storage` calls in `popup.js` / `content.js` to your target Safari's storage methods (`getItem` / `setItem`).

---

## Using any extension

Operation is the same across Chrome and Edge (Firefox and Safari behave identically):

1. Open a page with Chinese text (e.g. `zh.wikipedia.org`).
2. Click the **王软音 / 网软音** toolbar icon to open the extension popup.
3. In the popup:
   - **Pinyin annotations** ON → the page gets pinyin under each Chinese character and a sentence translation below.
   - **Translate selection** ON → select any Chinese text on the page; a popup appears with Chinese / pinyin / translation.
   - **Translation language** → annotations and selection translations switch to that language.
   - **HSK colour coding**: choose **Off / HSK 2.0 / HSK 3.0** to colour all Chinese characters by their lowest HSK level; tap a colour in the legend to hide/show that single level.
   - **Read page aloud**: Play / Pause / Stop / Restart — reads the annotated sentences with a Chinese voice (local Coqui TTS with the browser voice as fallback).
4. Toggle **Pinyin annotations** off to restore the original page.

---

## Troubleshooting

- **No pinyin displayed?** Make sure `pinyin-dict-characters.js` is in the folder. After editing the dictionary, reload the extension (or re-open the web app page) and refresh the page.
- **Selection popup not appearing (extension)?** Make sure **Translate selection** is ON. If the content script was injected before, reload the page.
- **Reload after editing (extension)?** Click the ↻ (reload) on the extension card on the extensions page, then refresh the target web page.
- **Translations not showing?** Translation uses the free Google Translate endpoint (`translate.googleapis.com`) — it needs an internet connection. Check your connection and that nothing is blocking the host.
- **Read-aloud silent?** A Chinese browser voice must be installed (most desktop browsers include one). The web app uses only the browser voice; the extensions first try a local Coqui TTS server (`http://localhost:5002`) and fall back to the browser voice.
- **GitHub Pages URL shows “There isn't a GitHub Pages site here” / 404?** That message means the **Pages feature was not enabled** for the repo. It is now enabled and the app is live at **`https://solojv.github.io/WangRuanYin/`** — the deploy workflow also auto-enables Pages as a safety net, so a fresh clone/rebuild will self-heal.
- **Website viewer: can't load a site?** The viewer fetches pages through Jina Reader, the Wikimedia CORS API (for Wikipedia articles) and public CORS proxies. Sites that block all of those (or require login, or render only via client-side JS) show an error — try a server-rendered address, or use the browser **extension**, which annotates any page natively.
- **Website viewer: why does it fetch instead of opening the real site in a tab?** A plain web page cannot run scripts inside another website's tab (same-origin policy), so the app fetches and renders the site in its own page — that's the only way the header toggles can annotate it. This is the same engine the browser extension uses.
- **Website viewer toggles not remembered?** The floating panel stores them per website in that site's `localStorage`; if the site blocks storage, they won't persist (they still apply for the current session). Use **Reset** in the panel to restore the defaults.

---

## License

**Dual license.** This project is released under the **MIT License** (see `LICENSE`) for personal, educational, and non-commercial use. If you or your organisation use it in any **commercial / revenue-generating** context (SaaS, paid product, white-label resale, internal business tooling), you must obtain a **paid commercial license** first — see `COMMERCIAL_LICENSE.md` for the commercial terms and how a royalty / license fee is arranged.

> Copyright holder: **Jan Victor Zamboni** (janzamboni@hotmail.com).

---

## Project layout

```
WRY/
├── README.md                  ← this unified guide
├── .github/workflows/deploy-pages.yml ← GitHub Pages deployment (web app)
├── Wangruanyin-WebApp/        ← standalone web app (+ .nojekyll)
├── Wangruanyin/               ← Chrome extension source
├── Wangruanyin-Edge/          ← Edge extension source
├── Wangruanyin-Firefox/       ← Firefox add-on source
├── Wangruanyin-Safari/        ← Safari Web Extension source
├── Wangruanyin.zip            ← Chrome/Edge dev-package
└── Wangruanyin-Edge.zip       ← Edge dev-package
```
