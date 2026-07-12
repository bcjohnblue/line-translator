// 集中管理環境變數，啟動時就檢查必要設定，避免執行到一半才發現漏設。

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`缺少必要的環境變數：${name}（請參考 .env.example 設定）`);
  }
  return value;
}

export const config = {
  line: {
    channelSecret: required('LINE_CHANNEL_SECRET'),
    channelAccessToken: required('LINE_CHANNEL_ACCESS_TOKEN'),
  },
  translation: {
    provider: process.env.TRANSLATION_PROVIDER || 'gemini',
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY,
    model: process.env.GEMINI_MODEL || 'gemini-flash-latest',
  },
  groq: {
    apiKey: process.env.GROQ_API_KEY,
    model: process.env.GROQ_MODEL || 'qwen/qwen3.6-27b',
  },
  port: Number(process.env.PORT) || 8080,
};
