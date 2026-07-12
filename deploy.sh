#!/usr/bin/env bash
#
# 一鍵部署到 Google Cloud Run（機密走 Secret Manager）。
#
# 用法：
#   ./deploy.sh                                  # 部署到 gcloud 目前設定的專案
#   PROJECT=my-project ./deploy.sh               # 指定專案
#   PROJECT=my-project REGION=asia-east1 ./deploy.sh
#
# 可用環境變數覆蓋的設定：
#   PROJECT       GCP 專案 ID（預設：gcloud config 目前的專案）
#   REGION        部署區域（預設：asia-east1，台灣）
#   SERVICE_NAME  Cloud Run 服務名稱（預設：line-translator）
#
# 憑證會自動從 .env 讀取：
#   - 機密（LINE secret / token、API keys）→ 存進 Secret Manager，以 --set-secrets 掛載
#   - 非機密（provider、model 名稱）→ 一般環境變數 --set-env-vars

set -euo pipefail
cd "$(dirname "$0")"

SERVICE_NAME="${SERVICE_NAME:-line-translator}"
REGION="${REGION:-asia-east1}"

# 哪些 .env 變數視為機密（存 Secret Manager），哪些是一般設定。
SECRET_KEYS="LINE_CHANNEL_SECRET LINE_CHANNEL_ACCESS_TOKEN GROQ_API_KEY GEMINI_API_KEY"
PLAIN_KEYS="TRANSLATION_PROVIDER GROQ_MODEL GEMINI_MODEL"

# ── 前置檢查 ──────────────────────────────────────────────
command -v gcloud >/dev/null 2>&1 || { echo "❌ 未安裝 gcloud CLI，請先安裝：https://cloud.google.com/sdk/docs/install"; exit 1; }

if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null | grep -q .; then
  echo "❌ 尚未登入 gcloud，請先執行：gcloud auth login"
  exit 1
fi

PROJECT="${PROJECT:-$(gcloud config get-value project 2>/dev/null)}"
if [ -z "$PROJECT" ] || [ "$PROJECT" = "(unset)" ]; then
  echo "❌ 未指定專案。請執行 gcloud config set project YOUR_PROJECT_ID，或用 PROJECT=xxx ./deploy.sh"
  exit 1
fi

if [ ! -f .env ]; then
  echo "❌ 找不到 .env，請先依 .env.example 建立並填入憑證"
  exit 1
fi

# 讀 .env 的值：比照 Node --env-file，去除 \r、前後空白、成對引號。
get() {
  local v
  v=$(grep -E "^$1=" .env | head -1 | cut -d= -f2-)
  v="${v%$'\r'}"
  v="${v#"${v%%[![:space:]]*}"}"
  v="${v%"${v##*[![:space:]]}"}"
  case "$v" in
    \"*\") v="${v#\"}"; v="${v%\"}";;
    \'*\') v="${v#\'}"; v="${v%\'}";;
  esac
  printf '%s' "$v"
}

# 判斷值是否有效（非空、非範本佔位）。
is_set() {
  local v="$1"
  [ -n "$v" ] || return 1
  case "$v" in your_*) return 1;; esac
  return 0
}

# 環境變數名 → Secret Manager 的 secret ID（小寫、底線轉連字號）。
secret_id() { printf '%s' "$1" | tr '[:upper:]_' '[:lower:]-'; }

# ── 顯示部署目標並請使用者確認 ─────────────────────────────
echo "──────────────────────────────────────────"
echo " 服務名稱 : $SERVICE_NAME"
echo " 專案     : $PROJECT"
echo " 區域     : $REGION"
echo " 帳號     : $(gcloud auth list --filter=status:ACTIVE --format='value(account)')"
echo " 機密處理 : Secret Manager"
echo "──────────────────────────────────────────"
# 設定 ASSUME_YES=1 可跳過互動確認（用於明確授權的非互動部署）。
if [ "${ASSUME_YES:-}" = "1" ]; then
  echo "（ASSUME_YES=1，略過確認）"
else
  read -r -p "確認部署到以上目標？(y/N) " ans
  case "$ans" in [yY]*) ;; *) echo "已取消"; exit 0;; esac
fi

# ── 啟用必要的 API ────────────────────────────────────────
echo "🔧 確認必要的 API 已啟用..."
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  --project "$PROJECT"

# Cloud Run 執行時用的服務帳號（預設為 Compute 預設 SA），要授權它讀取 secret。
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format="value(projectNumber)")
RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

# ── 建立/更新 Secret，並授權 Cloud Run 讀取 ────────────────
SECRETS_ARG=""
echo "🔐 同步機密到 Secret Manager..."
for key in $SECRET_KEYS; do
  val="$(get "$key")"
  if ! is_set "$val"; then
    echo "   （略過 $key：未設定）"
    continue
  fi
  sid="$(secret_id "$key")"

  if gcloud secrets describe "$sid" --project "$PROJECT" >/dev/null 2>&1; then
    printf '%s' "$val" | gcloud secrets versions add "$sid" --project "$PROJECT" --data-file=- >/dev/null
    echo "   ✔ 更新 secret：$sid"
  else
    printf '%s' "$val" | gcloud secrets create "$sid" --project "$PROJECT" --replication-policy=automatic --data-file=- >/dev/null
    echo "   ✔ 建立 secret：$sid"
  fi

  # 授權 Cloud Run 執行帳號讀取此 secret（已存在則為 no-op）。
  gcloud secrets add-iam-policy-binding "$sid" \
    --project "$PROJECT" \
    --member="serviceAccount:${RUNTIME_SA}" \
    --role="roles/secretmanager.secretAccessor" >/dev/null

  # 累積 --set-secrets 參數：環境變數名=secret:latest
  if [ -z "$SECRETS_ARG" ]; then SECRETS_ARG="${key}=${sid}:latest"; else SECRETS_ARG="${SECRETS_ARG},${key}=${sid}:latest"; fi
done

# ── 組出非機密的一般環境變數 ──────────────────────────────
VARS=""
for key in $PLAIN_KEYS; do
  val="$(get "$key")"
  is_set "$val" || continue
  if [ -z "$VARS" ]; then VARS="${key}=${val}"; else VARS="${VARS}|${key}=${val}"; fi
done

# ── 部署（--source . 會用 Dockerfile 自動建置）─────────────
echo "🚀 開始部署..."
DEPLOY_ARGS=(
  --source .
  --project "$PROJECT"
  --region "$REGION"
  --allow-unauthenticated
  --memory 256Mi
  --cpu 1
  --min-instances 0
  --max-instances 3
  --timeout 60
)
[ -n "$VARS" ] && DEPLOY_ARGS+=(--set-env-vars "^|^$VARS")
[ -n "$SECRETS_ARG" ] && DEPLOY_ARGS+=(--set-secrets "$SECRETS_ARG")

gcloud run deploy "$SERVICE_NAME" "${DEPLOY_ARGS[@]}"

# ── 輸出結果 ──────────────────────────────────────────────
URL=$(gcloud run services describe "$SERVICE_NAME" --project "$PROJECT" --region "$REGION" --format="value(status.url)")
echo ""
echo "✅ 部署完成！"
echo "   服務網址        ： $URL"
echo "   LINE Webhook URL： $URL/callback"
echo ""
echo "👉 到 LINE Developers Console 把上面的 Webhook URL 填入，按 Verify、開啟 Use webhook 即可。"
