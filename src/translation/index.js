// 翻譯引擎工廠：依設定回傳對應的 translator。
// 未來要接 Groq / Modal(SeaLLM) 等，只要在這裡多加一個 case + 一個 adapter 檔案即可，
// 其餘程式（server、handler）完全不用改。

import { config } from '../config.js';
import { createGeminiTranslator } from './gemini.js';
import { createGroqTranslator } from './groq.js';

export function createTranslator() {
  const provider = config.translation.provider;

  switch (provider) {
    case 'gemini':
      return createGeminiTranslator(config.gemini);

    case 'groq':
      return createGroqTranslator(config.groq);

    // 範例：未來擴充
    // case 'modal':
    //   return createModalTranslator(config.modal);

    default:
      throw new Error(`未知的翻譯引擎：${provider}`);
  }
}
