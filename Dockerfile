FROM node:22-slim

WORKDIR /app

# 啟用 corepack 以使用 pnpm。
RUN corepack enable

# 先複製 package 檔案安裝相依，善用 Docker layer cache。
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY . .

# Cloud Run 會透過 PORT 環境變數注入實際 port。
ENV PORT=8080
EXPOSE 8080

CMD ["node", "src/server.js"]
