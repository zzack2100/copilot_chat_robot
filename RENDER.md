# Render Deployment Guide

## Overview / 概覽

This project can be deployed to Render using a Docker-based backend Web Service plus a separate Static Site for the Vite frontend.

本專案可部署到 Render，方式為：後端使用 Docker Web Service，前端使用獨立的 Vite Static Site。

The Docker setup remains aligned with the existing backend service, while the frontend is deployed separately as static assets.

目前 Docker 配置仍然只負責後端；Vite 前端則改為獨立的靜態站點部署，不會硬塞進同一個執行容器。

## Division of Labor / 分工說明

### Docker Responsibilities / Docker 負責什麼

- Build a reproducible runtime image for the backend.
- Install dependencies with a fixed Node.js environment.
- Compile TypeScript server code into `dist-server`.
- Define the runtime startup behavior with the container `CMD`.

- 建立可重現的後端執行映像。
- 以固定 Node.js 環境安裝相依套件。
- 將 TypeScript 後端程式編譯到 `dist-server`。
- 透過容器 `CMD` 定義啟動方式。

### Render Responsibilities / Render 負責什麼

- Pull the source repository.
- Build and run the Docker container.
- Inject environment variables and secrets.
- Expose a public HTTPS endpoint.
- Run health checks and restart the service when needed.
- Manage logs, deploy history, and free-tier spin-down behavior.

- 拉取原始碼倉庫。
- 建置並執行 Docker 容器。
- 注入環境變數與機密資訊。
- 提供公開 HTTPS 網址。
- 執行健康檢查並在需要時重啟服務。
- 管理日誌、部署歷史，以及免費層休眠行為。

## Files / 檔案

- [Dockerfile](Dockerfile)
- [.dockerignore](.dockerignore)
- [render.yaml](render.yaml)

## Recommended Architecture / 建議架構

- Backend: Render Web Service using Docker
- Frontend: Render Static Site for the Vite build output

- 後端：使用 Docker 的 Render Web Service
- 前端：使用 Render Static Site 發佈 Vite 編譯產物

## Render Dashboard Fields / Render Dashboard 關鍵欄位

If you create the service manually in the Render Dashboard, use the following values.

若你改用 Render Dashboard 手動建立服務，請填以下欄位。

### Basic Settings / 基本設定

- Service Type: `Web Service`
- Runtime: `Docker`
- Name: `copilot-mcp-backend`
- Region: `Singapore` recommended for Taiwan users
- Branch: your deployment branch, usually `main`
- Root Directory: leave empty
- Dockerfile Path: `./Dockerfile`
- Docker Context: `.`
- Plan: `Free`
- Health Check Path: `/health`
- Auto-Deploy: `On`

- 服務類型：`Web Service`
- 執行環境：`Docker`
- 服務名稱：`copilot-mcp-backend`
- 區域：建議 `Singapore`，較接近台灣使用者
- 分支：你的部署分支，通常是 `main`
- Root Directory：留空
- Dockerfile Path：`./Dockerfile`
- Docker Context：`.`
- 方案：`Free`
- 健康檢查路徑：`/health`
- 自動部署：`開啟`

### Commands / 指令欄位

For Docker-based services, you typically do not fill `Build Command` or `Start Command`.

對 Docker 服務來說，通常不需要再填 `Build Command` 或 `Start Command`。

Render will use the Dockerfile build stages and the final `CMD`.

Render 會直接使用 Dockerfile 的 build stages 與最終 `CMD`。

## Frontend Static Site Fields / 前端 Static Site 欄位

If you create the frontend manually in Render, use the following values.

如果你手動建立前端站點，請使用以下欄位。

- Service Type: `Static Site`
- Name: `copilot-web-frontend`
- Branch: your deployment branch, usually `main`
- Root Directory: leave empty
- Build Command: `npm ci && npm run web:build`
- Publish Directory: `dist`
- Auto-Deploy: `On`

- 服務類型：`Static Site`
- 名稱：`copilot-web-frontend`
- 分支：你的部署分支，通常是 `main`
- Root Directory：留空
- Build Command：`npm ci && npm run web:build`
- Publish Directory：`dist`
- 自動部署：`開啟`

### Frontend Environment Variables / 前端環境變數

- `VITE_BACKEND_ORIGIN` = your Render backend URL, such as `https://copilot-mcp-backend.onrender.com`
- `VITE_MCP_MODE` = `live`
- `VITE_APP_VERSION` = optional display version such as `1.0.0-render`

- `VITE_BACKEND_ORIGIN` = 你的 Render 後端網址，例如 `https://copilot-mcp-backend.onrender.com`
- `VITE_MCP_MODE` = `live`
- `VITE_APP_VERSION` = 可選的顯示版本，例如 `1.0.0-render`

## Required Environment Variables / 必要環境變數

Set the following variables on the Render backend service.

請在 Render 後端服務上設定以下變數。

- `GEMINI_API_KEY` = your real Gemini key
- `MCP_REVIEW_MODE` = `live`
- `MCP_TRANSPORT` = `sse`
- `MCP_WEB_HOST` = `0.0.0.0`
- `GEMINI_MODEL_CANDIDATES` = `gemini-2.5-flash,gemini-2.0-flash-exp,gemini-1.5-flash`
- `MCP_WEB_CORS_ORIGIN` = your frontend origin, such as `https://your-frontend.onrender.com`

### Important / 重要提醒

Do not put `VITE_BACKEND_ORIGIN` on the Render backend Web Service.

不要把 `VITE_BACKEND_ORIGIN` 設在 Render 後端 Web Service 上。

`VITE_BACKEND_ORIGIN` is a frontend build-time variable and belongs in the frontend deployment environment.

`VITE_BACKEND_ORIGIN` 是前端建置期變數，應設定在前端站點的部署環境。

Render will inject `PORT` automatically. Your server already supports that behavior.

Render 會自動注入 `PORT`，你目前的後端已支援這個行為。

## Free Tier Spin-down / 免費層休眠提醒

Render Free instances spin down after inactivity. The first request after idle time can be slow.

Render 免費實例在閒置後會休眠，因此閒置後的第一個請求可能明顯變慢。

### Recommended Handling / 建議處理方式

1. Call `/health` when the frontend first loads.
2. Show a short UI message such as `Waking up backend...`.
3. Expect the first interactive request to have cold-start latency.
4. Upgrade to a paid instance if consistent low latency is required.

1. 前端首次載入時先呼叫 `/health`。
2. UI 顯示簡短提示，例如 `Waking up backend...`。
3. 預期第一個互動請求會有 cold start 延遲。
4. 若要穩定低延遲，升級到付費方案才是真正解法。

### Not Recommended / 不建議

Do not rely on unofficial external ping loops to keep a free service awake.

不建議依賴非正式的外部 ping 機制去強行維持免費服務常駐。

## Migration From Railway / 從 Railway 遷移

### What Changes / 會改變什麼

- Railway used a single service definition centered on [railway.toml](railway.toml).
- Render is better modeled here as two deployable units: backend service and frontend static site.

- Railway 目前是以 [railway.toml](railway.toml) 為核心的單服務配置。
- Render 在這個專案中更適合拆成兩個部署單位：後端服務與前端靜態站點。

### Migration Checklist / 遷移檢查清單

1. Deploy the backend first.
2. Verify `/health` on the Render backend URL.
3. Create the frontend static site.
4. Set `VITE_BACKEND_ORIGIN` to the backend Render URL.
5. Redeploy the frontend and verify live mode in the UI.

1. 先部署後端。
2. 驗證 Render 後端網址的 `/health`。
3. 建立前端 Static Site。
4. 將 `VITE_BACKEND_ORIGIN` 指向 Render 後端網址。
5. 重新部署前端，並確認 UI 中的 live mode 正常。

## Deployment Flow / 部署流程

1. Commit and push your repository.
2. In Render, create a new Blueprint and point it to [render.yaml](render.yaml).
3. Enter secret values when prompted, especially `GEMINI_API_KEY`, `MCP_WEB_CORS_ORIGIN`, and `VITE_BACKEND_ORIGIN`.
4. Deploy the backend and verify `/health`.
5. Deploy the static frontend.
6. Open the frontend and confirm the live backend metadata is visible.

1. 提交並推送你的倉庫。
2. 在 Render 建立新的 Blueprint，並讓它讀取 [render.yaml](render.yaml)。
3. 依提示輸入機密值，尤其是 `GEMINI_API_KEY`、`MCP_WEB_CORS_ORIGIN` 與 `VITE_BACKEND_ORIGIN`。
4. 先部署後端並驗證 `/health`。
5. 再部署前端靜態站點。
6. 開啟前端並確認 live backend metadata 正常顯示。

## Current Scope / 目前範圍

This deployment setup targets both the backend service in [src/server.ts](src/server.ts) and the Vite frontend build.

這套部署配置同時涵蓋 [src/server.ts](src/server.ts) 後端服務與 Vite 前端建置產物。

If you want, the next step can be adding a small frontend warm-up flow so the UI handles Render Free cold starts more gracefully.

如果需要，下一步可以再補一段前端 warm-up 流程，讓 UI 更平順地處理 Render 免費層 cold start。