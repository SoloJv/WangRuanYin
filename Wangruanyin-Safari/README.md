# 网软音 · Wangruanyin (Safari Web Extension)

This is the **Safari** build of the Wangruanyin pinyin/translation extension. Safari
does **not** allow sideloading a plain folder like Chrome/Edge; a Safari Web
Extension must be built and signed with **Xcode on macOS** and is normally
distributed through the Mac **App Store**. This folder is the ready-to-build source.

## What's inside

```
Wangruanyin-Safari/
├── manifest.json                 (MV3 manifest, Safari flavour)
├── background.js                 (browser.* API, translation via Google)
├── content.js                    (page annotation + selection popup)
├── pinyin-data.js                (pinyin lookup helpers)
├── pinyin-dict-characters.js     (large character→pinyin dictionary — REQUIRED)
├── popup.html                    (toolbar popup UI)
├── popup.js                      (browser.* storage + messaging)
├── styles.css                    (annotation + popup styles)
├── icon16/32/48/128.png          (placeholder icons; replace before release)
├── Info.plist                    (the `.appex` bundle plist)
└── SafariWebExtensionHandler.swift  (Swift "empty shell" host)
```

## Important Safari differences from Chrome

| Chrome | Safari |
|--------|--------|
| `chrome.*` API namespace | **`browser.*`** namespace |
| `background.service_worker` | `background.scripts` |
| `chrome.tabs.query()/sendMessage()` | **not available** — the toolbar popup sends via `browser.runtime.sendMessage` (routed to the active tab) |
| `chrome.scripting.executeScript()` | **not needed** — `content_scripts` in the manifest are injected automatically |

The JS in this folder has already been adapted: it uses `browser.*`, the
`(message, sender, sendResponse)` form for the message listener, and
promise-based `browser.runtime.sendMessage` from the content script. This matches
the API that Safari's next‑generation Web Extension really exposes.

> ⚠️ Safari's **storage** and the exact popup↔content routing can differ slightly
> by Safari version. If a state toggle (pinyin on/off) does not persist, adjust the
> two `browser.storage` calls in `popup.js` and `content.js` to the storage methods
> of your target Safari (e.g. `getItem`/`setItem`).

## Building (requires a Mac + Xcode)

1. Open **Xcode** → **File ▸ New ▸ Project…** → choose the **Safari Web Extension** app template.
2. Copy **everything in this folder** into the Xcode project's `Resources/` folder
   (keep `manifest.json` at `Resources/` root).
3. Keep `SafariWebExtensionHandler.swift` / `Info.plist` wired to the project’s
   native extension target.
4. Set your own bundle identifier + signing team in Xcode (Safari extensions must
   be code‑signed).
5. Run (⌘R). Safari will ask to enable the extension in **Safari → Settings →
   Extensions**.
6. To distribute: Package / archive the App™, publish through **App Store Connect**.

If you target an older Safari (pre‑15) use Apple’s **Safari Web Extension
Converter**, which accepts this manifest+scripts folder directly.

## Usage

Same behaviour as the Chrome original: toggle **Pinyin annotations** and
**Translate selection** from the toolbar popup; pick a target translation language.

The popup also includes **HSK colour coding** (**Off / HSK 2.0 / HSK 3.0**), which
highlights each Chinese character by its lowest official HSK level in both the page
annotations and the selection popup. HSK 2.0 covers levels 1–6; HSK 3.0 covers
levels 1–9 (the official 7–9 band is shown as **7-9**). Tap a level's colour in the
legend to hide/show that level only. The data files `hsk2-char-levels.js` and
`hsk3-char-levels.js` are included in this build.

## Notes

- Requires network access for the free Google Translate endpoint.
- Icons are solid‑colour placeholders (see `icons/make_icons.py`). Replace them
  with your own artwork before release.

## License

**Dual license.** Released under the **MIT License** (see `LICENSE`) for personal,
educational, and non-commercial use. Any **commercial / revenue-generating** use
(SaaS, paid product, white-label resale, internal business tooling) requires a
**paid commercial license** first — see `COMMERCIAL_LICENSE.md`.

> Copyright holder: **Jan Victor Zamboni** (janzamboni@hotmail.com).