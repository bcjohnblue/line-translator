// 處理 LINE webhook 事件：收到文字訊息 -> 翻譯 -> 回覆群組。

// 翻譯後目標語言的顯示標籤。
const TARGET_LABEL = {
  zh: '🇹🇼 中文',
  id: '🇮🇩 Bahasa Indonesia',
};

// 判斷是否值得翻譯：純空白、純 emoji、純數字/符號的訊息就跳過，省 API 額度。
function shouldTranslate(text) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  // 至少要有一個中文、印尼文/英文字母，才視為需要翻譯的內容。
  return /[\p{Script=Han}a-zA-Z]/u.test(trimmed);
}

export function createEventHandler({ lineClient, translator }) {
  return async function handleEvent(event) {
    // 只處理文字訊息，其餘（貼圖、圖片、加入群組等）忽略。
    if (event.type !== 'message' || event.message.type !== 'text') {
      return null;
    }

    const text = event.message.text;
    if (!shouldTranslate(text)) {
      return null;
    }

    try {
      const { targetLang, translatedText } = await translator.translate(text);

      const label = TARGET_LABEL[targetLang] || '🌐';
      const replyText = `${label}\n${translatedText}`;

      return lineClient.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: replyText }],
      });
    } catch (err) {
      console.error('翻譯或回覆失敗：', err);
      // 回覆失敗時不要讓整個 webhook 掛掉，靜默略過即可。
      return null;
    }
  };
}
