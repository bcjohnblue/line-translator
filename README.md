# LINE 翻譯機器人

一個放在 LINE 群組裡的翻譯 Bot：

- 有人傳**中文** → 自動翻成**印尼文**
- 有人傳**印尼文 / 英文** → 自動翻成**繁體中文**

架構：`LINE → Serverless (Cloud Run) webhook → 翻譯 API`。
翻譯引擎採用**可抽換介面**，預設使用 **Groq（免費、免綁卡、速度快）**，也支援 Gemini，未來可再擴充 Modal(SeaLLM) 等。

## 專案結構

```
src/
├── server.js            進入點：Express + LINE webhook
├── config.js            環境變數集中管理
├── handler.js           收到訊息 → 翻譯 → 回覆的流程
└── translation/
    ├── index.js         翻譯引擎工廠（依設定選 provider）
    ├── groq.js          Groq adapter（預設）
    ├── gemini.js        Gemini adapter
    └── prompt.js        翻譯規則（各引擎共用）
```

要換翻譯引擎，只需新增一個 `translation/<provider>.js` 並在 `translation/index.js` 加一個 case，其餘程式不動。

---

## 一、取得憑證

### 1. LINE Messaging API

1. 到 [LINE Developers Console](https://developers.line.biz/console/) 建立一個 **Provider**。
2. 建立一個 **Messaging API channel**。
3. 在 channel 的 **Basic settings** 取得 `Channel secret` → 填入 `LINE_CHANNEL_SECRET`。
4. 在 **Messaging API** 分頁 issue 一個 `Channel access token`（long-lived）→ 填入 `LINE_CHANNEL_ACCESS_TOKEN`。
5. 同一頁把 **Auto-reply messages** 與 **Greeting messages** 關掉（不然會有官方罐頭回覆干擾）。
6. 開啟 **Allow bot to join group chats**（要能加入群組）。

### 2. Groq API Key（預設，免費、免綁卡）

到 [Groq Console](https://console.groq.com) 用 Google 帳號登入 → **API Keys** → **Create API Key** → 填入 `GROQ_API_KEY`。

`.env` 保持 `TRANSLATION_PROVIDER=groq`（預設）即可，模型預設為 `qwen/qwen3.6-27b`（中↔印品質好、速度快、每日額度大）。

### （可選）改用 Gemini

若要改用 Google Gemini：到 [Google AI Studio](https://aistudio.google.com/apikey) 產生 API key → 填入 `GEMINI_API_KEY`，並把 `.env` 的 `TRANSLATION_PROVIDER` 改成 `gemini`。

> 注意：Gemini 免費層是否可用依地區而定；部分地區僅提供預付制（prepay），餘額歸零就會停用。

---

## 二、本機開發測試

```bash
pnpm install
cp .env.example .env   # 填入上面取得的憑證
pnpm dev
```

伺服器預設跑在 `http://localhost:8080`，webhook 路徑是 `/callback`。

本機要讓 LINE 打得到，用 [ngrok](https://ngrok.com/) 開一個公開網址：

```bash
ngrok http 8080
```

把 ngrok 給的 `https://xxxx.ngrok-free.app/callback` 填到 LINE Console 的 **Webhook URL**，並按 **Verify** 測試連線、開啟 **Use webhook**。

---

## 三、部署到 Cloud Run

需要先安裝 [gcloud CLI](https://cloud.google.com/sdk/docs/install) 並登入（`gcloud auth login`）。

列出你所有的 GCP 專案、切換與確認 gcloud 目前的預設專案（不指定 `PROJECT` 時，`pnpm deploy` 會用這個）：

```bash
gcloud projects list                        # 列出所有專案（PROJECT_ID / NAME / 編號）
gcloud config set project YOUR_PROJECT_ID   # 切換預設專案，例如 line-translator-bcjohn
gcloud config get-value project             # 確認目前的預設專案
```

### 一鍵部署

憑證會自動從 `.env` 讀取並帶到 Cloud Run，直接執行：

```bash
pnpm deploy            # 部署到 gcloud 目前設定的專案
# 或指定專案 / 區域：
PROJECT=my-project REGION=asia-east1 pnpm deploy
```

腳本會先顯示「服務名稱 / 專案 / 區域 / 帳號」並請你確認，接著自動啟用必要 API、同步機密、用 Dockerfile 建置部署，最後印出你要填回 LINE Console 的 **Webhook URL**。

可用環境變數覆蓋預設值：

| 變數 | 說明 | 預設 |
|------|------|------|
| `PROJECT` | GCP 專案 ID | gcloud 目前的專案 |
| `REGION` | 部署區域 | `asia-east1`（台灣） |
| `SERVICE_NAME` | Cloud Run 服務名稱 | `line-translator` |

### 憑證如何處理（Secret Manager）

腳本會依機密程度分兩種方式帶到 Cloud Run：

| 類型 | .env 變數 | 處理方式 |
|------|-----------|---------|
| **機密** | `LINE_CHANNEL_SECRET`、`LINE_CHANNEL_ACCESS_TOKEN`、`GROQ_API_KEY`、`GEMINI_API_KEY` | 存進 **Secret Manager**，以 `--set-secrets` 掛載（Console 看不到明文） |
| **非機密** | `TRANSLATION_PROVIDER`、`GROQ_MODEL`、`GEMINI_MODEL` | 一般環境變數 `--set-env-vars` |

機密會以 `.env` 的值建立/更新對應的 secret（secret 名稱為變數小寫加連字號，例如 `groq-api-key`），並自動授權 Cloud Run 執行帳號讀取。**`.env` 仍是單一真相來源**：改了值重跑 `pnpm deploy` 就會建立新的 secret 版本。

部署完成後會得到一個 `https://line-translator-xxxx.run.app` 網址，
把 `https://line-translator-xxxx.run.app/callback` 填回 LINE Console 的 **Webhook URL**。

---

## 四、把 Bot 加進群組

1. 在 LINE Console 的 **Messaging API** 分頁掃描 QR code 加 Bot 為好友。
2. 把 Bot 邀請進你的群組。
3. 在群組裡傳中文 / 印尼文 / 英文，Bot 就會自動回覆翻譯。

---

## 環境變數

| 變數 | 說明 | 預設 |
|------|------|------|
| `LINE_CHANNEL_SECRET` | LINE channel secret | （必填） |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE channel access token | （必填） |
| `TRANSLATION_PROVIDER` | 翻譯引擎（`groq` \| `gemini`） | `groq` |
| `GROQ_API_KEY` | Groq API key | （用 groq 時必填） |
| `GROQ_MODEL` | Groq 模型 | `qwen/qwen3.6-27b` |
| `GEMINI_API_KEY` | Gemini API key | （用 gemini 時必填） |
| `GEMINI_MODEL` | Gemini 模型 | `gemini-flash-latest` |
| `PORT` | 伺服器 port | `8080` |
