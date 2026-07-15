// Groq 翻譯引擎 adapter。
// 用 Groq 的 OpenAI 相容 API（chat completions），免綁卡、免費層額度大。
// 實作統一的 translator 介面：translate(text) => { sourceLang, targetLang, translatedText }

import { SYSTEM_INSTRUCTION } from './prompt.js';

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

// 從模型輸出裡抽出 JSON。
// Qwen 等 reasoning 模型可能夾帶 <think>...</think> 或前後多餘文字，
// 這裡先移除 think 區塊，再取第一個 { 到最後一個 } 之間的內容，確保 parse 得動。
function extractJson(content) {
  const withoutThink = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const start = withoutThink.indexOf('{');
  const end = withoutThink.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`Groq 回傳非預期格式：${content.slice(0, 200)}`);
  }
  return JSON.parse(withoutThink.slice(start, end + 1));
}

// 檢查翻譯結果是否可信：目標是印尼文時，譯文不該出現任何漢字。
// （qwen3.6-27b 關 reasoning 時偶爾會偷懶，只把中文轉成簡體就標成印尼文。）
function looksWrong({ targetLang, translatedText }) {
  return targetLang === 'id' && /\p{Script=Han}/u.test(translatedText);
}

export function createGroqTranslator({ apiKey, model }) {
  if (!apiKey) {
    throw new Error('使用 groq 翻譯引擎需要設定 GROQ_API_KEY');
  }

  const isQwen = /qwen/i.test(model);

  // withReasoning=false 走快速路徑（Qwen 關思考）；true 則開思考，準確但慢，只在重試時用。
  async function callGroq(text, { withReasoning }) {
    const body = {
      model,
      messages: [
        { role: 'system', content: SYSTEM_INSTRUCTION },
        { role: 'user', content: text },
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' },
    };
    if (isQwen && !withReasoning) {
      body.reasoning_effort = 'none';
    }

    const res = await fetch(GROQ_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Groq API 錯誤 ${res.status}：${errText}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('Groq 回傳空結果');
    }

    const result = extractJson(content);
    return {
      sourceLang: result.sourceLang,
      targetLang: result.targetLang,
      translatedText: result.translatedText,
    };
  }

  return {
    name: `groq (${model})`,
    async translate(text) {
      const result = await callGroq(text, { withReasoning: false });
      if (!looksWrong(result)) {
        return result;
      }

      // 譯文標成印尼文卻含漢字 → 模型偷懶，開 reasoning 重打一次。
      console.warn(`翻譯結果含漢字卻標成印尼文，開 reasoning 重試："${text}" → "${result.translatedText}"`);
      return callGroq(text, { withReasoning: true });
    },
  };
}
