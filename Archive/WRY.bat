@echo off
setlocal enabledelayedexpansion

echo Creating wangruanyin Chrome extension...

:: Create folder
mkdir wangruanyin

:: ---------------------------
:: manifest.json
:: ---------------------------
echo {> wangruanyin\manifest.json
echo   "manifest_version": 3,>> wangruanyin\manifest.json
echo   "name": "网软音 - Wangruanyin",>> wangruanyin\manifest.json
echo   "description": "Annotate Chinese text with pinyin and translate it using Google Translate.",>> wangruanyin\manifest.json
echo   "version": "0.1.0",>> wangruanyin\manifest.json
echo   "permissions": [>> wangruanyin\manifest.json
echo     "scripting",>> wangruanyin\manifest.json
echo     "activeTab",>> wangruanyin\manifest.json
echo     "storage">> wangruanyin\manifest.json
echo   ],>> wangruanyin\manifest.json
echo   "host_permissions": [">> wangruanyin\manifest.json
echo     "<all_urls>">> wangruanyin\manifest.json
echo   ],>> wangruanyin\manifest.json
echo   "background": {>> wangruanyin\manifest.json
echo     "service_worker": "background.js">> wangruanyin\manifest.json
echo   },>> wangruanyin\manifest.json
echo   "content_scripts": [>> wangruanyin\manifest.json
echo     {>> wangruanyin\manifest.json
echo       "matches": ["<all_urls>"],>> wangruanyin\manifest.json
echo       "js": ["pinyin-data.js", "content.js"],>> wangruanyin\manifest.json
echo       "css": ["styles.css"],>> wangruanyin\manifest.json
echo       "run_at": "document_idle">> wangruanyin\manifest.json
echo     }>> wangruanyin\manifest.json
echo   ],>> wangruanyin\manifest.json
echo   "action": {>> wangruanyin\manifest.json
echo     "default_title": "网软音 - Wangruanyin">> wangruanyin\manifest.json
echo   }>> wangruanyin\manifest.json
echo }>> wangruanyin\manifest.json

:: ---------------------------
:: background.js
:: ---------------------------
echo // background.js> wangruanyin\background.js
echo const DEFAULT_TARGET_LANG = "en";>> wangruanyin\background.js
echo chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {>> wangruanyin\background.js
echo   if (message.type === "TRANSLATE_TEXT") {>> wangruanyin\background.js
echo     const { text } = message;>> wangruanyin\background.js
echo     chrome.storage.sync.get({ targetLang: DEFAULT_TARGET_LANG }, async (items) => {>> wangruanyin\background.js
echo       const targetLang = items.targetLang || DEFAULT_TARGET_LANG;>> wangruanyin\background.js
echo       try {>> wangruanyin\background.js
echo         const translation = await translateWithGoogle(text, targetLang);>> wangruanyin\background.js
echo         sendResponse({ ok: true, translation });>> wangruanyin\background.js
echo       } catch (err) {>> wangruanyin\background.js
echo         sendResponse({ ok: false, error: String(err) });>> wangruanyin\background.js
echo       }>> wangruanyin\background.js
echo     });>> wangruanyin\background.js
echo     return true;>> wangruanyin\background.js
echo   }>> wangruanyin\background.js
echo });>> wangruanyin\background.js

echo async function translateWithGoogle(text, targetLang) {>> wangruanyin\background.js
echo   const url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=zh-CN&tl=" + targetLang + "&dt=t&q=" + encodeURIComponent(text);>> wangruanyin\background.js
echo   const resp = await fetch(url);>> wangruanyin\background.js
echo   const data = await resp.json();>> wangruanyin\background.js
echo   let translated = "";>> wangruanyin\background.js
echo   if (Array.isArray(data[0])) translated = data[0].map(part => part[0]).join("");>> wangruanyin\background.js
echo   return translated || text;>> wangruanyin\background.js
echo }>> wangruanyin\background.js

:: ---------------------------
:: content.js
:: ---------------------------
echo // content.js> wangruanyin\content.js
echo const CHINESE_RE = /[\u4e00-\u9fff]/;>> wangruanyin\content.js
echo function walkTextNodes(root) {>> wangruanyin\content.js
echo   const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);>> wangruanyin\content.js
echo   const nodes = []; let node;>> wangruanyin\content.js
echo   while ((node = walker.nextNode())) if (CHINESE_RE.test(node.nodeValue)) nodes.push(node);>> wangruanyin\content.js
echo   return nodes;>> wangruanyin\content.js
echo }>> wangruanyin\content.js

echo async function processPage() {>> wangruanyin\content.js
echo   const textNodes = walkTextNodes(document.body);>> wangruanyin\content.js
echo   for (const node of textNodes) {>> wangruanyin\content.js
echo     const originalText = node.nodeValue.trim();>> wangruanyin\content.js
echo     if (!originalText) continue;>> wangruanyin\content.js
echo     try {>> wangruanyin\content.js
echo       const translation = await requestTranslation(originalText);>> wangruanyin\content.js
echo       const annotated = buildAnnotatedFragment(originalText, translation);>> wangruanyin\content.js
echo       node.parentNode.replaceChild(annotated, node);>> wangruanyin\content.js
echo     } catch (e) {}>> wangruanyin\content.js
echo   }>> wangruanyin\content.js
echo }>> wangruanyin\content.js

echo function requestTranslation(text) {>> wangruanyin\content.js
echo   return new Promise((resolve, reject) => {>> wangruanyin\content.js
echo     chrome.runtime.sendMessage({ type: "TRANSLATE_TEXT", text }, (response) => {>> wangruanyin\content.js
echo       if (!response || !response.ok) reject("Translation error");>> wangruanyin\content.js
echo       else resolve(response.translation);>> wangruanyin\content.js
echo     });>> wangruanyin\content.js
echo   });>> wangruanyin\content.js
echo }>> wangruanyin\content.js

echo function buildAnnotatedFragment(text, translation) {>> wangruanyin\content.js
echo   const fragment = document.createDocumentFragment();>> wangruanyin\content.js
echo   for (const ch of text) {>> wangruanyin\content.js
echo     if (CHINESE_RE.test(ch)) {>> wangruanyin\content.js
echo       const pinyin = getPinyinForChar(ch);>> wangruanyin\content.js
echo       const block = document.createElement("span"); block.className = "zh-block";>> wangruanyin\content.js
echo       block.innerHTML = "<span class='zh-char'>" + ch + "</span><br><span class='zh-pinyin'>" + pinyin + "</span><br><span class='zh-translation'>" + translation + "</span>";>> wangruanyin\content.js
echo       fragment.appendChild(block);>> wangruanyin\content.js
echo     } else fragment.appendChild(document.createTextNode(ch));>> wangruanyin\content.js
echo   }>> wangruanyin\content.js
echo   return fragment;>> wangruanyin\content.js
echo }>> wangruanyin\content.js

echo processPage();>> wangruanyin\content.js

:: ---------------------------
:: pinyin-data.js
:: ---------------------------
echo const PINYIN_MAP = {> wangruanyin\pinyin-data.js
echo   "你": "nǐ",>> wangruanyin\pinyin-data.js
echo   "好": "hǎo",>> wangruanyin\pinyin-data.js
echo   "中": "zhōng",>> wangruanyin\pinyin-data.js
echo   "国": "guó",>> wangruanyin\pinyin-data.js
echo   "汉": "hàn",>> wangruanyin\pinyin-data.js
echo   "字": "zì">> wangruanyin\pinyin-data.js
echo };>> wangruanyin\pinyin-data.js
echo function getPinyinForChar(ch) { return PINYIN_MAP[ch] || ""; }>> wangruanyin\pinyin-data.js

:: ---------------------------
:: styles.css
:: ---------------------------
echo .zh-block { display:inline-block; text-align:center; margin:2px; font-size:14px; } > wangruanyin\styles.css
echo .zh-char { font-size:18px; font-weight:bold; } >> wangruanyin\styles.css
echo .zh-pinyin { font-size:12px; color:#555; } >> wangruanyin\styles.css
echo .zh-translation { font-size:11px; color:#0070c0; } >> wangruanyin\styles.css

echo Done!
pause
