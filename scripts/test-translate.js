// 本機翻譯測試：不透過 LINE，直接呼叫翻譯層確認品質。
//
// 用法：
//   pnpm test:translate                 # 跑內建的範例句子
//   pnpm test:translate "你今天好嗎"     # 翻譯自訂句子
//
// 需先在 .env 填好 GEMINI_API_KEY（LINE 憑證這裡用不到，會自動帶假值）。

// 這個腳本只需要翻譯層，補上假的 LINE 憑證讓 config 檢查通過。
process.env.LINE_CHANNEL_SECRET ||= 'test';
process.env.LINE_CHANNEL_ACCESS_TOKEN ||= 'test';

const { createTranslator } = await import('../src/translation/index.js');

const LANG_LABEL = { zh: '中文', id: '印尼文', en: '英文', other: '其他' };

// 命令列有帶句子就用它，否則跑內建範例。
const custom = process.argv.slice(2);
const samples = custom.length > 0 ? custom : [
  '大家早安，今天天氣真好！',        // 中文 -> 印尼文
  '請問這個多少錢？可以算便宜一點嗎？', // 中文 -> 印尼文
  'Selamat pagi, apa kabar semua?',   // 印尼文 -> 中文
  'Terima kasih banyak, sampai jumpa besok ya', // 印尼文 -> 中文
  'Can you send me the file later?',  // 英文 -> 中文
];

const translator = createTranslator();
console.log(`翻譯引擎：${translator.name}\n`);

for (const text of samples) {
  try {
    const start = performance.now();
    const { sourceLang, targetLang, translatedText } = await translator.translate(text);
    const ms = Math.round(performance.now() - start);
    console.log(`原文 (${LANG_LABEL[sourceLang] || sourceLang}): ${text}`);
    console.log(`譯文 (${LANG_LABEL[targetLang] || targetLang}): ${translatedText}`);
    console.log(`耗時: ${ms}ms\n`);
  } catch (err) {
    console.error(`翻譯失敗："${text}"`);
    console.error(err.message, '\n');
  }
}
