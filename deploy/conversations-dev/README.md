# K03 文字会话本机联调

先启动现有 Identity、People 和它们的数据库。当前目录仅增加专用 PostgreSQL 16，API 和 Worker 分别运行。开发容器复用 `xijie-identity-dev_default` 网络，数据库、凭据和数据卷独立；无需删除其他 Docker 网络。

从仓库根目录执行：

```powershell
docker compose --project-name xijie-conversations-dev --env-file .tmp/conversations-dev/compose.env --file deploy/conversations-dev/compose.yaml up -d --wait
cd backend/services/conversations
pnpm install --frozen-lockfile
pnpm build
node --env-file=../../../.tmp/conversations-dev/server.env dist/migrate.js
node --env-file=../../../.tmp/conversations-dev/server.env dist/main.js
```

另一个终端在会话服务目录启动回复进程：

```powershell
node --env-file=../../../.tmp/conversations-dev/server.env --env-file=../../../.tmp/conversations-dev/model.env dist/worker.js
```

两个本机配置文件均被 Git 忽略。`server.env` 的字段见 [服务配置示例](../../backend/services/conversations/.env.example)；`compose.env` 配置独立的 `XIJIE_CONVERSATIONS_DB_PASSWORD`。Identity、People 和 Conversations 均需设置相同的 `XIJIE_CONVERSATIONS_SERVICE_TOKEN`，原 People 服务凭据保持独立。更改配置后重启相应进程。

模型配置使用 `MODEL_BASE_URL`、`MODEL_NAME`、`MODEL_API_KEY` 和明确获授权的本机测试账号 `MODEL_ALLOWED_ACCOUNT_IDS`。本机使用 OpenAI `gpt-6-luna` 已通过合成资料真实请求。若网络依赖系统代理，Node 不一定自动继承：可仅在 Worker 配置 `HTTPS_PROXY`、`NO_PROXY=localhost,127.0.0.1,::1`，并使用支持此选项的 Node 加 `--use-env-proxy` 启动；当前本机 Node 24 和 Node 22 容器均已检查该选项。无需更改系统网络设置。不要向浏览器传递模型密钥。

从根目录启动原前端：

```powershell
$env:VITE_XIJIE_AUTH_MODE = 'service'
$env:XIJIE_IDENTITY_URL = 'http://127.0.0.1:3101'
$env:XIJIE_PEOPLE_URL = 'http://127.0.0.1:3102'
$env:XIJIE_CONVERSATIONS_URL = 'http://127.0.0.1:3103'
pnpm dev --host 127.0.0.1 --port 5184
```

打开 `http://127.0.0.1:5184`，沿用原登录、相见和聊天界面。输入文字后，`202` 表示已保存并排队；生成成功后通过原消息区域显示。刷新、返回首页及原消息删除入口均回读服务端。模型故障保留已保存消息，未接通功能沿用原反馈，不制造演示回复。任务取消、失败重试接口已提供；K05 首片已接通独立 AI 文字授权及撤回；先从原「我 → 设置 → 隐私与 AI 说明」确认当前告知并明确允许。完整历史搜索、数据导出／注销、媒体、礼物、语音、安装包及生产发布仍属于后续验收范围。

本轮证据：独立 PostgreSQL/pg-boss、HTTP 与 SDK 请求验证；原聊天页通过真实 Identity/People/会话服务/Worker/OpenAI 跑通发送、唯一回复、重复请求消重、刷新回读、原入口删除和离开聊天后的首页摘要更新。浏览器验收使用合成账号与资料，没有替代 Android 安装版验收。


K05 新增 `002_ai_text_authorization.sql`，旧任务 AI 版本 0 不继承新许可；请先迁移并重启 Identity，再迁移会话库并重启 API/Worker。本机模型 allowlist 只限制可执行账号，不能授予用途授权。所有同意均由原 UI 的真实操作产生，不在迁移或配置脚本中自动建立。

R01 世界迁居增量：先构建并迁移 People 至 007、本库至 `005_virtual_world_context.sql`，Identity 须包含 People 只读账号上下文许可；随后重启这三个 API 与本库回复 Worker。旧任务世界引用保持 NULL，新回复使用 People 的虚拟主线权威上下文并记录版本／摘要／迁居引用。原 UI 未授权 AI 迁居、明确允许 AI 后真实模型接续、往返后阻挡旧场景，以及原隐私四域导出均已另验，详见[迁居与聊天接续契约](../../docs/backend-api/conversations-memories.md#r01-迁居与文字聊天接续首片2026-11-12)。上文早期 K03 对导出／注销的限制已由 K05 接通；安装版与生产发布仍须独立验收。
