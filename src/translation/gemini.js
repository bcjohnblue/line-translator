// Gemini 翻譯引擎 adapter。
// 實作統一的 translator 介面：translate(text) => { sourceLang, targetLang, translatedText }

import { GoogleGenAI } from '@google/genai';
import { SYSTEM_INSTRUCTION, RESPONSE_SCHEMA } from './prompt.js';

export function createGeminiTranslator({ apiKey, model }) {
  if (!apiKey) {
    throw new Error('使用 gemini 翻譯引擎需要設定 GEMINI_API_KEY');
  }

  const ai = new GoogleGenAI({ apiKey });

  return {
    name: 'gemini',
    async translate(text) {
      const response = await ai.models.generateContent({
        model,
        contents: text,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
          // 翻譯任務不需要發散，溫度調低讓輸出穩定。
          temperature: 0.2,
        },
      });

      const raw = response.text;
      if (!raw) {
        throw new Error('Gemini 回傳空結果');
      }

      const result = JSON.parse(raw);
      return {
        sourceLang: result.sourceLang,
        targetLang: result.targetLang,
        translatedText: result.translatedText,
      };
    },
  };
}
