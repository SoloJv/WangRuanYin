# 网软音 · Wangruanyin (Android / Mobile)

A mobile build of the Wangruanyin pinyin + translation tool for **Android** devices.

## Why an app / web app? (Android vs desktop browsers)

Android's **Chrome**, **Edge**, and **Safari** do **not** allow installing desktop browser
extensions (`Load unpacked` does not exist there). So this folder ships two practical
Android‑friendly versions that reuse the same pinyin dictionary:

| File | What it does |
|------|--------------|
| `index.html` (+ `pinyin-data.js`, `pinyin-dict-characters.js`, `webmanifest.webmanifest`, `icons/`) | **Offline mobile web app / PWA** — paste Chinese text, get pinyin under every character + a translation row. |
| `bookmarklet.html` | Builds a **bookmarklet** — a tap‑able bookmark that annotates selected text on *any* web page (needs internet). |

## Option A — Mobile web app (recommended; works offline for pinyin)

1. Put the **whole `Wangruanyin-Android` folder** on the phone, or host it (local network / static host).
2. Open `index.html` in Chrome / Edge / Brave / Opera / Firefox for Android.
3. Use the browser menu (⋮) → **Add to home screen** — a full‑screen app icon is created.
4. Paste Chinese text → tap **Annotate**.

- Pinyin comes from the **bundled offline dictionary** (`pinyin-dict-characters.js`);
  only the translation row needs internet (Google Translate, same as the desktop builds).
- The app already declares a `webmanifest` + icons so "Add to home screen" gives it a proper name and icon.

## Option B — Bookmarklet (annotate the page you're reading)

1. Open `bookmarklet.html` in the phone's browser.
2. Tap **Copy bookmarklet**.
3. Add a bookmark and paste it as the bookmark **URL** (name it *Wangruanyin*).
4. On a Chinese page, select Chinese text → tap the bookmark → a panel shows pinyin + translation.

> The bookmarklet is intentionally small (a bookmark URL can't carry the 797 KB dictionary), so its
> pinyin map covers common characters and falls back to showing the character. Translation uses
> Google Translate and therefore needs internet.

## Folder contents

```
Wangruanyin-Android/
├── index.html                  mobile web app (PWA)
├── bookmarklet.html            bookmarklet builder
├── pinyin-data.js               pinyin helpers (bundled)
├── pinyin-dict-characters.js    full character→pinyin dictionary (bundled, offline)
├── hsk2-char-levels.js          HSK 2.0 char → level data (colour coding)
├── hsk3-char-levels.js          HSK 3.0 char → level data (colour coding)
├── webmanifest.webmanifest      PWA manifest for 'Add to home screen'
├── make_icons.py                regenerates the placeholder app icons
└── icons/icon192.png, icon512.png
```

## HSK colour coding
`index.html` has an **HSK colour coding** selector (**Off / HSK 2.0 / HSK 3.0**)
that colours each Chinese character by its lowest official HSK level (HSK 2.0:
1–6; HSK 3.0: 1–9, with the official 7–9 band shown as **7-9**). Tap a level's
colour below the selector to hide/show that level only. Works entirely offline.

## Notes
- Replace the placeholder app icons (`icons/`) with your own artwork if you plan to publish the PWA.
- Android Firefox *can* load desktop add‑ons only in a limited way; the PWA above is the general,
  reliable approach.

## License

**Dual license.** Released under the **MIT License** (see `LICENSE`) for personal,
educational, and non-commercial use. Any **commercial / revenue-generating** use
(SaaS, paid product, white-label resale, internal business tooling) requires a
**paid commercial license** first — see `COMMERCIAL_LICENSE.md`.

> Copyright holder: **Jan Victor Zamboni** (janzamboni@hotmail.com).