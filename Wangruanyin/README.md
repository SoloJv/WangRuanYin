# 王软音 · Wangruanyin (Chrome Extension)

A Chrome extension that adds **pinyin** (Romanized pronunciation) and **translations** to Chinese text on any webpage. It works on both pinyin rendering (annotations over the page) and on-demand text selection translation.

## Features

- **Pinyin annotations** (toggle): renders each Chinese character with its pinyin directly underneath, plus a whole-sentence translation row below the character group.
- **Translate selection** (toggle): select any Chinese text on a page → a floating popup appears showing the **Chinese**, **Pinyin**, and **Translation** of the selection.
- **Target language selector**: choose the language the translations are shown in (English is the default; Spanish, French, German, Italian, Portuguese, Russian, Japanese, Korean, Dutch, Polish, Turkish also available).
- **HSK colour coding** (Off / HSK 2.0 / HSK 3.0): use the **HSK colour coding toggle** to highlight all Chinese characters on the page by their HSK level directly. HSK 2.0 uses levels 1–6; HSK 3.0 uses levels 1–9. The colours appear both in the page annotations and in the selection popup. Level data was generated from the official HSK syllabus PDF (HSK 3.0) and the official HSK 2010/2012 word lists (HSK 2.0). In HSK 3.0 the official standard lists levels 7–9 as one band; those characters are subdivided into three tiers (7 / 8 / 9) so they can be colour-coded distinctly.
- **Per-level colour toggles**: in the popup's legend you can tap the colour swatch of a specific HSK level (1–9) to hide/show the colouring of that level only. Hidden levels keep their real HSK level on hover (\*colour hidden\*), so you can focus on exactly the levels you are currently studying.

## Installation (Developer / Unpacked)

> These instructions load the extension in "developer mode" (i.e. not from the Chrome Web Store). This is fine for personal / testing use.

### 1. Get the extension folder
Make sure you have the whole `Wangruanyin` folder, containing at least:
```
Wangruanyin/
├── manifest.json
├── background.js
├── content.js
├── pinyin-data.js
├── pinyin-dict-characters.js
├── hsk2-char-levels.js
├── hsk3-char-levels.js
├── popup.html
├── popup.js
└── styles.css
```

> The `pinyin-dict-characters.js` file is the large character→pinyin dictionary. It is **required** — without it the pinyin will not display correctly.

### 2. Open Chrome's extension page
- Launch **Google Chrome**.
- Go to: `chrome://extensions/`  (or click the puzzle-piece menu → “Extensions”)
- **Enable “Developer mode”** using the toggle at the top-right.

### 3. Load the extension
- Click the **“Load unpacked”** (Carregar descomprimida) button.
- In the file picker, select the **`Wangruanyin`** folder itself (the one that contains `manifest.json`).
- Click **Select Folder**.
- The extension **“王软音 (Wangruanyin)”** should now appear in the list.

### 4. Pin it to the toolbar (optional but recommended)
- Click the puzzle-piece icon (Extensions) in the top-right.
- Find **王软音 (Wangruanyin)** and click the **pin 📌** so its icon stays visible in the toolbar.

---

### Usage

1. Open a web page that contains Chinese text (for example `zh.wikipedia.org`).
2. Click the **王软音** icon in the toolbar to open the popup.
3. In the popup:
   - Toggle **“Pinyin annotations”** ON → the page gets pinyin under each Chinese character and a sentence translation below.
   - Toggle **“Translate selection”** ON → then select any Chinese text on the page; a popup appears with Chinese/pinyin/translation.
   - Change **“Translation language”** → the annotations and selection translations switch to that language.
4. Toggle **Pinyin annotations** off to restore the original page (removes the annotations).

---

### License

**Dual license.** This project is released under the **MIT License** (see `LICENSE`)
for personal, educational, and non-commercial use. If you or your organisation use
it in any **commercial / revenue-generating** context (SaaS, paid product,
white-label resale, internal business tooling), you must obtain a **paid commercial
license** first. See `COMMERCIAL_LICENSE.md` for the commercial terms and how a
royalty / license fee is arranged.

> Copyright holder: **Jan Victor Zamboni** (janzamboni@hotmail.com).

### Notes / Troubleshooting

- **No pinyin displayed?** Make sure `pinyin-dict-characters.js` is present in the folder. If you recently edited the dictionary, reload the extension: `chrome://extensions/` → refresh it or re-“Load unpacked”.
- **Selection popup not appearing?** Make sure the **Translate selection** toggle is ON. If the content script was injected before, try reloading the page.
- **Reload after editing**: after any code change in VS Code, click the **↻** (reload) on the extension card in `chrome://extensions/`, then refresh the target web page.
- Translation uses the free Google Translate endpoint (`translate.googleapis.com`) — it needs an internet connection.