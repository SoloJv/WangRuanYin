# 网软音 · Wangruanyin (Microsoft Edge)

Microsoft **Edge** (Chromium) build of the Wangruanyin pinyin / translation
extension.

Edge is built on the same engine as Chrome, so this folder is the identical
Manifest V3 extension — only the install flow and packaged source differ.

## Install (developer / unpacked)

> **Packaged copy:** a zipped copy of this folder is also provided at
> `C:\Users\Utente\Documents\Jan\SW\Wangruanyin-Edge.zip` (manifest at zip root) if you
> want to load it from an archive.

1. Launch **Microsoft Edge**.
2. Go to: `edge://extensions/` (or use the ⋯ menu → **Extensions**).
3. Enable **Developer mode** using the toggle in the top‑right.
4. Click **Load unpacked** (Carregar descomprimida).
5. Select the **`Wangruanyin-Edge`** folder (the one that contains `manifest.json`),
   then click **Select Folder**.
6. **网软音 – Wangruanyin (Edge)** should now appear. Pin it to the toolbar.

> The whole folder (including the large `pinyin-dict-characters.js`) must stay in
> place after loading — don’t delete it from disk or Edge disables the extension.

## Verify it loads

- In the extension list, **网软音 – Wangruanyin (Edge)** should show **On**.
- Open `zh.wikipedia.org`, click the toolbar icon, and turn on **Pinyin annotations**
  to see pinyin under Chinese characters plus a translation row.

## Usage
Identical to the Chrome original: toggle **Pinyin annotations**, toggle
**Translate selection** (select any Chinese text for a floating popup), and pick a
**Translation language**.

**HSK colour coding** — the popup includes an **HSK colour coding** selector
(**Off / HSK 2.0 / HSK 3.0**). It highlights each Chinese character by its lowest
official HSK level:
- **HSK 2.0** → levels 1–6 (from the official HSK 2010/2012 word lists).
- **HSK 3.0** → levels 1–9 (levels 7–9 are one official band, shown as **7-9**).

Tap a level's colour in the legend to **hide/show that HSK level only** (the
characters of a hidden level become neutral again, but hovering still shows the
real level). The colours appear in the page annotations and in the selection
popup. The data lives in `hsk2-char-levels.js` and `hsk3-char-levels.js`
(regenerated from
`C:\Users\Utente\Documents\Jan\SW\Dict\Official_HSK_Vocabulary\`).

## Notes
- Requires network access for the free Google Translate endpoint used for translations.
- No code changes were needed vs. Chrome — Edge accepts the same MV3 manifest.

## License

**Dual license.** Released under the **MIT License** (see `LICENSE`) for personal,
educational, and non-commercial use. Any **commercial / revenue-generating** use
(SaaS, paid product, white-label resale, internal business tooling) requires a
**paid commercial license** first — see `COMMERCIAL_LICENSE.md`.

> Copyright holder: **Jan Victor Zamboni** (janzamboni@hotmail.com).