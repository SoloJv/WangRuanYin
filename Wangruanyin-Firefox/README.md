# 网软音 · Wangruanyin (Firefox)

Mozilla Firefox build of the Wangruanyin pinyin / translation extension.

## Firefox differences handled here

| Chrome | Firefox edition |
|--------|-----------------|
| `background.service_worker` | `background.scripts` (Firefox runs background **scripts/pages**, not service workers) |
| — | `browser_specific_settings.gecko.id` (**required** identifier) |
| `"scripting"` permission | relies on declared `content_scripts` (simpler) |

The JavaScript uses the `chrome.*` API namespace. Firefox intentionally supports
this namespace for cross‑browser compatibility, so the same `background.js`,
`content.js` and `popup.js` run unchanged. All platform differences are handled in
`manifest.json`.

## Install (unpacked add-on)

> **Quick path:** a ready‑to‑install **`Wangruanyin-Firefox.xpi`** is provided one folder
> up, at `C:\Users\Utente\Documents\Jan\SW\` — use **Install Add‑on From File…** and pick
> it directly, no zipping needed.

1. In **Firefox** go to **about:addons** → click the gear (⚙) →
   **Install Add‑on From File…**.
   > If the gear option is missing, enable developer mode first:
   > `about:config` → set `xpinstall.signatures.required` to `false`,
   > then restart Firefox and repeat.
2. Select the `manifest.json`-containing files. Firefox expects a packaged add‑on;
   for the unpacked folder, use the “Install Add‑on From File…” after zipping the
   folder contents into `<name>.xpi` (a normal zip), **or** load it via Developer
   Mode:
   - **about:config** → set `extensions.experimental.enabled` = `true`.
   - **about:addons** → gear → **Install Add‑on From File…** → pick the `.xpi`.

   Quickest for local testing: right‑click the folder → *Send to ZIP*, rename the
   `.zip` to `.xpi`, then *Install Add‑on From File…*.
3. Enable **网软音 (Wangruanyin)** on the add‑ons page and pin it to the toolbar.

## Verify it loads

- In `about:addons` you should see **网软音 – Wangruanyin (Firefox)** with no errors.
- Open a page with Chinese text (e.g. `zh.wikipedia.org`), click the toolbar icon,
  turn on **Pinyin annotations**.

## Notes
- Requires network for the free Google Translate endpoint.
- The dictionary `pinyin-dict-characters.js` is required and shipped with this folder.

## HSK colour coding
The popup includes an **HSK colour coding** selector (**Off / HSK 2.0 / HSK 3.0**):
- **HSK 2.0** → characters coloured by their lowest HSK level (1–6).
- **HSK 3.0** → characters coloured by their lowest HSK level (1–9; the official
  7–9 band is shown as **7-9**).

Tap a level's colour in the legend to **hide/show that HSK level only**; hovering
a hidden character still shows its real level ("colour hidden"). The colouring
works in the page annotations and in the selection popup. Data files
`hsk2-char-levels.js` and `hsk3-char-levels.js` are shipped with this build.

## License

**Dual license.** Released under the **MIT License** (see `LICENSE`) for personal,
educational, and non-commercial use. Any **commercial / revenue-generating** use
(SaaS, paid product, white-label resale, internal business tooling) requires a
**paid commercial license** first — see `COMMERCIAL_LICENSE.md`.

> Copyright holder: **Jan Victor Zamboni** (janzamboni@hotmail.com).