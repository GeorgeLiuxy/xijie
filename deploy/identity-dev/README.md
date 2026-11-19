# 西界身份联调环境

此 Compose 仅用于本机联调。原 App 保留手机号、验证码逐屏交互，西界身份服务通过 BFF 持有 Logto Experience 交互，完成 OIDC 校验、账号映射与应用会话。Logto 和西界使用独立数据库及角色，宿主只开放回环地址。首次启动需下载 Logto 和 PostgreSQL 镜像。

## 启动

在仓库根目录使用 PowerShell 7。密码文件放在 Git 忽略的 `.tmp/identity-dev/`，首次生成后沿用原文件。

```powershell
$identityDev = Join-Path (Get-Location) '.tmp/identity-dev'
New-Item -ItemType Directory -Path $identityDev -Force | Out-Null
$composeEnv = Join-Path $identityDev 'compose.env'
if (-not (Test-Path -LiteralPath $composeEnv)) {
    $logtoPassword = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
    $identityPassword = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
    [IO.File]::WriteAllLines($composeEnv, @(
        "LOGTO_DB_PASSWORD=$logtoPassword",
        "XIJIE_IDENTITY_DB_PASSWORD=$identityPassword"
    ))
}
docker compose --project-name xijie-identity-dev --env-file $composeEnv --file deploy/identity-dev/compose.yaml up -d
```

## 配置 Logto

1. 打开 `http://localhost:3002` 初始化本机管理员。
2. 在 Applications 中创建 Traditional Web 应用，将回跳 URI 设置为 `http://127.0.0.1:5184/v1/auth/callback`。确认该应用的 `isThirdParty=false`，记录本机应用 ID 和 Secret。
3. Compose 启动时将镜像内官方 `connector-mock-sms` 链接到运行目录。进入 Connectors，添加 Mock SMS Service（connector ID 为 `mock-short-message-service`），填写下方测试配置。该步骤需要在租户中单独保存；仅启动容器不会自动创建短信渠道。
4. 在 Sign-in & account 中添加手机号登录方式，开启验证码，关闭手机号密码登录；注册标识添加手机号，开启验证、关闭注册密码要求（对应 `signUp.verify=true`、`signUp.password=false`）。保留用户名和密码登录方式及两位合成用户，供旧 OIDC 流程回归。
5. 在 `.tmp/identity-dev/server.env` 填入本机服务配置。

mock 渠道所需字段使用虚构值，验证码仍由 Logto 随机生成和校验。

```json
{
  "accountSID": "local-test",
  "authToken": "local-test",
  "fromMessagingServiceSID": "local-test",
  "templates": [
    { "usageType": "SignIn", "content": "Local sign-in code: {{code}}" },
    { "usageType": "Register", "content": "Local registration code: {{code}}" }
  ]
}
```

```dotenv
DATABASE_URL=postgres://xijie_identity:<XIJIE_IDENTITY_DB_PASSWORD>@127.0.0.1:5433/xijie_identity
OIDC_ISSUER=http://localhost:3001/oidc
OIDC_CLIENT_ID=<Logto Traditional Web App ID>
OIDC_CLIENT_SECRET=<Logto Traditional Web App Secret>
OIDC_CALLBACK_URL=http://127.0.0.1:5184/v1/auth/callback
IDENTITY_PORT=3101
# 本机默认启用；显式 false 可关闭最小 openid 技术授权处理
OIDC_FIRST_PARTY_EXPERIENCE=true
```

业务服务启动和迁移命令见 [后端说明](../../backend/README.md)。升级已有本机数据库时也要运行迁移，确保 `003_embedded_auth.sql` 已应用；不要修改已经应用的迁移文件。该表保存浏览器及手机号摘要、五分钟挑战、六十秒重发间隔、处理租约和加密桥接上下文。上下文及短时结果使用 AES-256-GCM 绑定挑战 ID 加密，密钥从当前 OIDC Client Secret 派生；更换 Secret 后应重新获取验证码。

打开联调前端后，在原页面输入合成手机号并获取验证码。本机测试可读取 Logto 容器内的 `/tmp/logto/mock_sms_record.txt`；该文件只保存最近一次 mock 投递，测试应串行读取并核对号码。它不会向真实手机投递短信，前端和公开 API 也没有读码入口。不要把此开发 mock 接入生产渠道。

`OIDC_FIRST_PARTY_EXPERIENCE=false` 会关闭自动最小授权处理；生产环境默认关闭，只有先确认当前登记应用的 `isThirdParty=false`，才可显式设为 `true`。允许范围仅为当前应用的精确 `openid`，同意数据还须匹配该应用及回跳，且没有额外 scope、资源、组织。此技术授权独立于原登录页协议和人物资料保存授权。旧授权 URL/回跳接口继续用于兼容回归，原 App 主入口使用短信挑战接口。

验证应覆盖错码后更正、同键同参重试、换码后新键提交、重发冷却、切号取消及退出后旧结果无法恢复会话。正式短信渠道、原生授权回跳和生产 HTTPS 由后续批次验收。

维护者可对照固定版本官方源码：[Experience API](https://github.com/logto-io/logto/blob/v1.46.0/packages/core/src/routes/experience/index.ts)、[验证码接口](https://github.com/logto-io/logto/blob/v1.46.0/packages/core/src/routes/experience/verification-routes/verification-code.ts)、[已验证身份注册合流](https://github.com/logto-io/logto/blob/v1.46.0/packages/experience/src/apis/experience/index.ts)、[技术授权接口](https://github.com/logto-io/logto/blob/v1.46.0/packages/core/src/routes/interaction/consent/index.ts)、[官方 mock SMS](https://github.com/logto-io/logto/blob/v1.46.0/packages/connectors/connector-mock-sms/src/index.ts)。升级 Logto 后需重跑这些接口的契约及原页面端到端验证。

停止联调环境时，使用相同的 Compose 参数运行 `stop`，保留本机测试库。


## K05 文字数据权利联调

先应用 Identity 005、People 005、Conversations 003、Memories 004，再重启四个 API，另起 Identity 的 `node --env-file=../../../.tmp/identity-dev/server.env dist/rights-worker.js`。四域配置独立 `XIJIE_DATA_RIGHTS_SERVICE_TOKEN`；Identity 再配置 `DATA_RIGHTS_ENABLED=true`、256 位 `DATA_EXPORT_ENCRYPTION_KEY`、三域 URL。自有 Logto 租户开启凭据删除时需独立 M2M 的 `LOGTO_MANAGEMENT_CLIENT_ID/SECRET/RESOURCE` 与显式 `LOGTO_MANAGEMENT_DELETE_USERS=true`；没有这项能力不得假报注销完成。密钥仅置于本机忽略配置，API 不返回这些凭据。

前端公共 `/v1/data-request-receipts` 需与 accounts/auth 一样代理至 Identity。内部 request context、data-export/erase 不进入前端代理。原设置浮层完成重新验证、导出、注销确认和收据查询，普通登录与切号路径保持。导出单域内容最多20MiB，内部封装最多21MiB，总件最多64MiB，超出明确失败。

当前只验证四域文字与自有本地 Logto 凭据；没有重置已有库，测试删除仅使用新建合成账号。[本机加密备份与隔离恢复工具](../recovery/README.md)已接入，生产恢复切换与可信最新删除／撤权回放仍未完成。证明7天后的人工身份恢复、旧资料导入、私有媒体及正式发布均需后续验收。已发布004的notice v2和AI政策v1保留不变；新范围通过新增政策处理，不把功能测试当合规验收。

## 自动长期文字记忆用途升级

先构建各服务，保持 Memories `AUTOMATIC_MEMORY_ENABLED=false`、自动 Worker 关闭，再按 [Memories 升级说明](../memories-dev/README.md#自动长期文字记忆的升级与小批启用)应用 Identity `006_automatic_memory_permission.sql`、People `006_automatic_memory_sources.sql`、Conversations `004_automatic_memory_sources.sql` 和 Memories `005_automatic_memories.sql`。Identity 的迁移从仓库根执行：

```powershell
node --env-file=.tmp/identity-dev/server.env backend/services/identity/dist/migrate.js
if ($LASTEXITCODE -ne 0) { throw 'Identity migration failed.' }
```

006 默认把历史政策的 `ai_automatic_memory_enabled` 设为 false，新增隐私告知 v3和AI文字政策v2，不改历史政策正文、不预设任何用户同意。重启四个 API 后，在原「隐私与 AI 说明」中明确确认当前告知并重新允许 AI；只有当前授权会带 `aiTextProcessing.automaticMemoryAllowed:true`。旧 grant、缺失／false 的用途标记、服务开关与测试账号名单都不能补领该许可。

自动 Worker 独立加载 Memories `server.env` 和原模型 `model.env`，Identity 与浏览器不加载模型密钥。开启前核对明确选定合成账号的来源待处理量，从小批新资料验证，不能因升级而开放全部历史给供应方。旧授权版本的聊天不回扫，重新允许不恢复旧任务。自动结果、来源、导出、擦除与恢复隔离由对应领域保持，原登录／切号／退出与数据权利浮层路径不变。
