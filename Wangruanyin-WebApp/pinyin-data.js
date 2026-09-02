// pinyin-data.js
// Usa SOLO il dizionario generato da Python: LOCAL_PINYIN_DICT

function getPinyinForChar(ch) {
    if (typeof LOCAL_PINYIN_DICT !== "undefined" && LOCAL_PINYIN_DICT[ch]) {
        return LOCAL_PINYIN_DICT[ch][0];
    }
    return ch;
}

function pinyin(text) {
    const result = [];
    for (const ch of text) {
        if (/[\u4e00-\u9fff]/.test(ch)) {
            result.push(getPinyinForChar(ch));
        } else {
            result.push(ch);
        }
    }
    return result;
}
