// 進入點：建立 Express 伺服器，掛上 LINE webhook。

import express from 'express';
import * as line from '@line/bot-sdk';

import { config } from './config.js';
import { createTranslator } from './translation/index.js';
import { createEventHandler } from './handler.js';

const lineClient = new line.messagingApi.MessagingApiClient({
  channelAccessToken: config.line.channelAccessToken,
});

const translator = createTranslator();
console.log(`翻譯引擎：${translator.name}`);

const handleEvent = createEventHandler({ lineClient, translator });

const app = express();

// 健康檢查（Cloud Run 會用到）。
app.get('/', (_req, res) => {
  res.status(200).send('LINE translator bot is running.');
});

// LINE webhook。middleware 會驗證簽章並解析 req.body.events，
// 注意：這個 middleware 需要拿到原始 body，所以不要在它前面掛 express.json()。
app.post('/callback', line.middleware({ channelSecret: config.line.channelSecret }), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error('webhook 處理失敗：', err);
      res.status(500).end();
    });
});

// 簽章驗證失敗等錯誤處理。
app.use((err, _req, res, next) => {
  if (err instanceof line.SignatureValidationFailed) {
    res.status(401).send('Invalid signature');
    return;
  }
  if (err instanceof line.JSONParseError) {
    res.status(400).send('Invalid JSON');
    return;
  }
  next(err);
});

app.listen(config.port, () => {
  console.log(`伺服器啟動，監聽 port ${config.port}`);
});
