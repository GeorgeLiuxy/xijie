# 正式运行准备

这是七个现有 Node 服务的宿主进程编排、独立 AI 正式授权、静态配置预检和仅本机 TLS 入口示例。模板不会启动现有 runtime、迁移现有库、签发证书、开公网、配置短信商户或创建支付渠道。所有模型、增长与可选 worker 默认关闭；配置完成后由操作者明确启用。

## 准备独立环境

使用仓库约定的 Node 22.12+、pnpm 10，并对每个服务按已锁定的 lockfile 安装、构建。运行 `pnpm install --frozen-lockfile` 与 `pnpm build` 的目录为 `backend/services/{identity,people,conversations,memories,social,media,gifts}`；根目录另行安装与构建前端。保留仓库目录结构，所有模型 provider 在 src/dist 均引用 `backend/runtime/model-execution.mjs`，部署时必须携带该目录。

将 `runtime.json.example` 复制到操作者私有配置目录，按每项 `envFile` 放入独立 `.env` 文件；参考各服务已有 `.env.example`，改成 `NODE_ENV=production`、各自独立数据库及专用最小权限角色、`127.0.0.1` 监听、所有对外/内部服务源为 HTTPS。禁止把开发 `.tmp/*-dev/server.env` 作为正式配置。Unix 私有文件权限必须 0600；Windows 文件与模型凭据使用只允许指定服务账号、当前操作者及 SYSTEM 的 ACL。配置目录、数据库备份、模型密钥和签名资料均不提交。

每个调用服务使用自己独立的 64 位十六进制 `XIJIE_*_SERVICE_TOKEN`，在相应被调服务也配置同一角色；不同角色不可复用。数据权利使用独立 `XIJIE_DATA_RIGHTS_SERVICE_TOKEN` 与 `DATA_EXPORT_ENCRYPTION_KEY`。Media 还需私有 S3 兼容桶、专用凭据和独立读取证明密钥，正式 S3 endpoint 必须 HTTPS。OIDC issuer、注册 client、callback 及真实 SMS provider 由身份服务部署配置；本机 mock SMS 不能用于正式运行。

## 预检、迁移、启动

登录的短信、密码、Google、Apple、微信（网页和 Android SDK）配置见 [登录渠道配置](../logto-auth/README.md)。自建固定 Logto 版本的手机号读取必须使用独立只读视图角色，不能给 Identity 配置 `all` 管理权限来代替 reader；密码更新仍走提供方原策略。正式短信和第三方应用资质未就绪时保持相应渠道关闭。

以下命令从仓库根目录运行，替换私有配置绝对路径：

```powershell
node deploy/production/launch.mjs check --config D:/private/xijie/runtime.json
# 先完成可恢复备份与恢复演练，再明确对这些独立库执行迁移：
node deploy/production/launch.mjs migrate --config D:/private/xijie/runtime.json
node deploy/production/launch.mjs start --config D:/private/xijie/runtime.json
```

`check` 读取私有文件、检查固定入口、生产/TLS模式、独立数据库、loopback 监听、端口与令牌格式，并在隔离子进程调用现有服务的 `readConfig`；不会连接数据库或 OIDC，不会启动 worker。它不能证明网络可达、数据库授权、真实商户或模型已通过验收。`migrate` 才显式写入选定库。`start` 只启动 manifest 明确启用的固定入口；某一进程退出便结束同组进程。它不自动无限重启失败服务。请用操作系统服务管理器运行并持久保管日志，不把会话令牌、提示正文或私有文件内容写到监控中。

先只启动 API 并完成 HTTPS 配置、备份和健康核查，再逐个启用 worker。对模型、自动记忆、回响、相册、回礼、真实支付、权利处理及举报任务，应分别完成其源系统配置和操作验证，不能只依据某一个 worker 启动成功。

## HTTPS 与真正前端

`Caddyfile.example` 提供同源网页/API 路由及七个私有 HTTPS 服务源，全部仅监听 127.0.0.1。替换域名、绝对路径和已有证书；配置私有名称解析到本机；若使用私有 CA，配置各 Node 进程的 `NODE_EXTRA_CA_CERTS`，不要关闭证书验证。私有端口 9443 和 `/internal/*` 不经外部入口。例子中的 8443 不是已发布服务，公网域名、证书、反向代理及防火墙仍由操作者配置并验收。

根目录构建前设置 `VITE_XIJIE_AUTH_MODE=service` 和 `XIJIE_IDENTITY_URL=https://你的同源网页域名`，执行 `pnpm build`；由 TLS 入口提供根目录 `dist/`。静态构建中的相对 `/v1/...` 统一经入口分发，不使用 Vite 开发代理或预览成功数据。收到未知 API 必须返回 404，不能回退成 index.html。支付回调路径在同一个 HTTPS 公网入口转发至 Gifts，并保留原始请求内容及签名头。

## 正式 AI

把 `model.env.example` 的适用项合入 Identity 和四类模型 worker 的私有配置，配置绝对 `MODEL_API_KEY_FILE`，模型只允许 `https://api.openai.com/v1`。保持 `MODEL_EXECUTION_ENABLED=false` 与 `MODEL_PRODUCTION_APPROVED=false`，直到运营明确批准该环境后才同时置 true。小范围可指定 1–100 个账号 UUID；普通用户发布可明确设置 `MODEL_ALLOWED_ACCOUNT_IDS=*`，此值只在 production 且已批准时有效。

数据库迁移 023 引入独立 `production_model_execution` 当前政策，并为八个具体 AI 用途增加版本；不改历史政策、不替用户授权。原隐私设置提供独立的正式处理阅读/允许/撤回。每次实际模型调用既要求该账号当前正式 grant，也要求该用途所有独立 grant。旧合成账号许可不足以调用正式模型。

Identity 事务统一限制每账号 UTC 日调用尝试数和全局并发。默认每日 100、并发 4，可分别通过 `MODEL_DAILY_ACCOUNT_LIMIT`（1–10000）和 `MODEL_MAX_CONCURRENT`（1–100）调整。每个 attempt 只 claim 一次；失败仍计次数；45 秒 lease 不释放日额度；transport 最长 30 秒，完成时再次核对账号、全部当前授权及 lease。结果迟到或撤回后的写入会被拒绝。后台自动记忆/回响在 wildcard 模式下按 UUID 游标每页至多检查 100 个 active 账号，只读取当前符合全部授权的账号，再使用原来源分页与确认机制。

邀请和公开相册还各需独立 `REFERRALS_PRODUCTION_APPROVED=true` / `SHARED_ALBUMS_PRODUCTION_APPROVED=true`、原 feature 开关、独立 token key、HTTPS 公共源和可用审核/worker；默认不会因模型获准自动开放。

## 核心使用路径的只读指标

给 `XIJIE_METRICS_IDENTITY_DATABASE_URL`、`XIJIE_METRICS_PEOPLE_DATABASE_URL`、`XIJIE_METRICS_CONVERSATIONS_DATABASE_URL`、`XIJIE_METRICS_MEMORIES_DATABASE_URL` 配置只读连接，再运行 `node deploy/production/activation-metrics.mjs --since 2026-11-01 --until 2026-11-18`。日期使用 UTC，结束日期不计入注册范围。输出仅含汇总及计算口径。

统计覆盖当前有效账号的建人、私聊发送和回复、首条正式珍藏、实际回信及已读确认。第七日观察注册后第 168 至 192 小时内是否主动发送过私聊文字，分母只含已走完该窗口的账号。本机结果包含测试账号，只用于验证统计实现。

## 尚需操作者和真实环境验收

真实短信和第三方身份凭据、正式 OIDC 回调、支付商户/Stripe 钱包域验证/PayPal 等渠道、模型真实生产账号及费用、私有存储、域名与证书、正式签名 keystore、备份恢复介质及通知支持流程，均需实际配置和验证。这里的本机编译、SDK 合成传输或静态检查只证明各自范围，不代表真实生产发布。Android 发行准备见 `mobile/README.md`。

## Apple / 微信网页登录

原登录页的「其他方式 → Apple/微信 → 确认」流程已连接真实 OIDC attempt。`GET /v1/auth/providers` 仅返回两项配置能力；未启用时原按钮仍不可继续。对已启用方式，确认后发起固定 provider 的幂等请求并同 tab 跳转，回调复用原 browser cookie、nonce、state、PKCE、issuer/subject 验证和会话切换约束；取消和失败返回原登录页。不会以第三方邮件或昵称自动合并账号。

在独立自建 Logto 1.46.0 中配置官方 Apple Universal 和 WeChat Web connector，并在 sign-in experience 启用；固定上游与原始源码见 `social-login-source-lock.json`。Logto direct-sign-in 的 social 目标是 connector 的 `target`（apple / wechat），不是控制台随机 connector id。Apple / WeChat 各自的回调地址须复制 Logto 控制台显示的 callback，而西界注册 OIDC client 的 callback 是 `https://网页源/v1/auth/callback`，两者不能混淆。[Logto 官方 direct sign-in 文档](https://docs.logto.io/end-user-flows/authentication-parameters/direct-sign-in) 与 [Apple connector 说明](https://docs.logto.io/integrations/apple) 提供渠道配置入口。

Apple 的 Services ID、Team ID、Key ID 与私钥、WeChat Web 网站应用的 App ID/secret、各自审核域名和 HTTPS 回调，在 Logto 的私有 connector 配置中保存，不交给前端或西界普通 API。按 `social-login.env.example` 仅启用已配置的具体方式。手机号短信仍走原独立 Experience API；本功能不替代真实 SMS 配置，也不绑定或猜测手机号。

本地验证使用真实 openid-client 的发现、code exchange、RSA/JWKS 签名与 S256 校验，合成身份和独立库；它不能证明 Apple/WeChat 已审核或实际认证成功。Capacitor 使用独立系统浏览器完成授权，cookie 不搬到 WebView。Identity026 的短时一次性 handoff 与固定第一方 HTTPS AppLink，需原 WebView 私有 verifier、browser cookie 和捕获 ExpectedSession 才能兑换会话。原生 NativeAuth bridge 通过 AndroidKeyStore AES-GCM 加密私有 pending；App 被杀后能恢复，取消和注销清除 proof，失败不产生会话。`OIDC_NATIVE_HANDOFF_ENABLED` 默认 false；原生代码和真实 OIDC/数据库协议反例已在本机验证，真实 Android AppLink/Keystore、Apple/微信渠道与发行证书仍需实机验收。发布时把 `assetlinks.json.example` 的空指纹列表填写为实际安装 APK 的签名证书 SHA256（商店重签时使用实际应用签名证书），经实际域名 `/.well-known/assetlinks.json` 提供并核验；空列表不会授权任何 App，不要把示例域或 unsigned APK 标成已关联。


## 有界 AI 语音部署

`model.env.example` 的 `VOICE_CALLS_ENABLED` 默认 false；启用 Conversations 前先迁移 Identity027/Conversations015，确认独立 voice grant、production v2 grant、共享中央日预算与并发限制。官方 key 仍从私有绝对文件读取；普通文字许可或原声样本保存许可不允许语音模型处理。`VOICE_MODEL` 默认 `gpt-realtime-2.1`，最大时长默认 60、上限 120 秒。

允许 Conversations 服务器出站 TLS/WebSocket 至 `api.openai.com:443`，并为客户端到第一方 `/v1/call-sessions/*` 配置原生 WebSocket upgrade；Caddy 模板已匹配该路由。不要记录 WS 子协议／Cookie／消息 payload，不加跨域反代，不把提供方 key 或一次 grant 放 query。调用后端仍绑定原 verified session，失效、撤权、人物变更、超时或无法及时复核均停止音频。恢复介质中的 grants 一律删除；活跃通话隔离，不自动重拨。

本地受控提供方和浏览器音频路径已验证；一次 5 秒真实提供方探测未收到有效握手而超时。启用前必须在实际域名、网络、模型凭据、合法用户许可和真机上完成接通、静音／打断／挂断、撤权、后台与断网核查；unsigned 构建和协议测试不代替这些结果。
