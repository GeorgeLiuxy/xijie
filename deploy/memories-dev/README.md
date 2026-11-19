# K04 珍藏与重读本机联调

沿用 Identity、People、Conversations 三个服务与原前端，新增独立记忆数据库和 API：`127.0.0.1:5436`、`127.0.0.1:3104`。容器复用现有开发桥接网络，数据库账号和数据卷独立。

仓库根目录启动数据库：

```powershell
docker compose --project-name xijie-memories-dev --env-file .tmp/memories-dev/compose.env --file deploy/memories-dev/compose.yaml up -d --wait
```

在 `backend/services/memories` 构建并启动：

```powershell
pnpm install --frozen-lockfile
pnpm build
node --env-file=../../../.tmp/memories-dev/server.env dist/migrate.js
node --env-file=../../../.tmp/memories-dev/server.env dist/main.js
```

`compose.env` 配置独立 `XIJIE_MEMORIES_DB_PASSWORD`。API 配置见[服务示例](../../backend/services/memories/.env.example)，本机文件均被 Git 忽略。记忆服务使用自己的 `XIJIE_MEMORIES_SERVICE_TOKEN`，Identity、People、Conversations 的本机配置也需允许此凭据。原有 People/Conversations 服务凭据保持独立，记忆服务另配置 `XIJIE_CONVERSATIONS_SERVICE_TOKEN` 验证聊天上下文读取。修改环境后重启对应进程。

Conversations 增加 `XIJIE_MEMORIES_URL=http://127.0.0.1:3104`；API 与 Worker 均加载更新后的服务配置。模型密钥继续只在现有 Worker 本机文件中，不转给记忆 API 或浏览器。若已启用记忆依赖但服务暂时不可用，回复任务失败并保留已保存消息，不绕过记忆检查。

从根目录启动原前端：

```powershell
$env:VITE_XIJIE_AUTH_MODE = 'service'
$env:XIJIE_IDENTITY_URL = 'http://127.0.0.1:3101'
$env:XIJIE_PEOPLE_URL = 'http://127.0.0.1:3102'
$env:XIJIE_CONVERSATIONS_URL = 'http://127.0.0.1:3103'
$env:XIJIE_MEMORIES_URL = 'http://127.0.0.1:3104'
pnpm dev --host 127.0.0.1 --port 5184
```

前端代理先匹配人物下的记忆路径和 `/v1/search`，其余人物路径仍归 People。内部接口不经前端代理。People 的内部世界目录是全局登记数据，只要求服务凭据；私人账号、人物、记忆和消息仍校验各自范围。

原页面验收路径：聊天气泡「珍藏」→ 原弹层编辑并确认 → 人物资料「记忆」或星图搜索打开同一原文。原文内的记忆操作复用原弹层完成修改和删除。另用独立会话登录同账号，验证正文、版本、删除结果一致；后续聊天读取当前已确认内容，并在写回前复核引用版本。原消息珍藏现后台生成可编辑候选，用户确认后才归档；手写不调用模型。动态回响、会话全文搜索、旧资料导入按后续批次接入。

本轮数据库结构、事务与时间规则对应[实际迁移](../../backend/services/memories/db/001_memories.sql)、[生命周期](../../docs/backend-data-lifecycle.md)和[接口契约](../../docs/backend-api/conversations-memories.md)。本机 Web 验证不替代移动安装版验收。

候选 Worker 在记忆服务目录运行：

```powershell
node --use-env-proxy --env-file=../../../.tmp/memories-dev/server.env --env-file=../../../.tmp/conversations-dev/model.env dist/worker.js
```

此本机命令复用现有已授权模型配置；API 不加载密钥。候选 GEN 请求携带 `?kind=memory_suggestion` 路由到记忆服务，旧聊天 GEN 路由保持。新迁移为 `002_memory_candidates.sql`，不修改已应用的 001。候选未确认前不进入原文、检索或聊天记忆；已采用候选失效时原输入保留，显式选择「按手写保存」才建立新的手写确认操作。


K05 新增 `003_ai_text_processing.sql`，保持 001/002 不变。Identity 先部署新的 `aiTextProcessing` 内部上下文，然后应用本库迁移并重启 API 与 Worker。新候选整理和实际失败重试须显式 AI 授权；已有 ready 候选读取与人工确认、原文重读和手写仍按原存储／人物权限工作。旧任务版本 0 不继承后续许可；本机 allowlist 不能代替同意。

## 自动长期文字记忆的升级与小批启用

此能力沿用原聊天、人物资料与授权浮层，不增加用户逐条确认步骤。人物画像及当前许可下的用户文字消息由 People／Conversations 保留原始事实，Memories 独立记录自动线索、来源与版本。它不增加珍藏数量、不触发珍藏邀请奖励；AI 前文只作语境，自动世界剧情仍未接入。

先保持 `AUTOMATIC_MEMORY_ENABLED=false`，停止自动 Worker，分别在四个服务目录构建，再从仓库根运行原迁移器。迁移器按顺序应用缺少的 SQL 并校验既有文件，不要手工覆盖旧迁移：

| 服务 | 本批增量 |
| --- | --- |
| Identity | `006_automatic_memory_permission.sql`：新用途能力标记、隐私告知 v3、AI 文字政策 v2 |
| People | `006_automatic_memory_sources.sql`：画像来源事件的独立逐条确认 |
| Conversations | `004_automatic_memory_sources.sql`：消息来源／版本核验、事件确认及实际记忆引用字段 |
| Memories | `005_automatic_memories.sql`：四张自动表、状态／来源约束及账号擦除围栏 |

```powershell
node --env-file=.tmp/identity-dev/server.env backend/services/identity/dist/migrate.js
if ($LASTEXITCODE -ne 0) { throw 'Identity migration failed.' }
node --env-file=.tmp/people-dev/server.env backend/services/people/dist/migrate.js
if ($LASTEXITCODE -ne 0) { throw 'People migration failed.' }
node --env-file=.tmp/conversations-dev/server.env backend/services/conversations/dist/migrate.js
if ($LASTEXITCODE -ne 0) { throw 'Conversations migration failed.' }
node --env-file=.tmp/memories-dev/server.env backend/services/memories/dist/migrate.js
if ($LASTEXITCODE -ne 0) { throw 'Memories migration failed.' }
```

迁移后重启四个 API 及原有聊天／候选／数据权利 Worker。由用户在原「隐私与 AI 说明」浮层确认当前告知并明确重新允许 AI；只有当前授权返回 `aiTextProcessing.automaticMemoryAllowed:true` 才具备自动记忆用途。旧版 `allowed:true`、缺失／false 的能力标记和本机 allowlist 均不能代替新授权。旧聊天受理时的 AI 版本不匹配当前版本时不自动回扫，撤权或更换政策不会自动恢复旧任务。

开启前审查指定合成账号的来源待处理量和已有自动任务量。以下只读 SQL 分别在 People／Conversations 的本域数据库执行，替换为明确选定的合成账号 UUID；只统计数量，不读取原文：

```sql
SELECT e.type, count(*) AS pending
FROM outbox_events e
WHERE e.account_id = '<指定合成账号UUID>'::uuid
  AND e.type IN ('PersonConfirmed.v1','PersonUpdated.v1','PersonAccessRevoked.v1',
                 'MessageAccepted.v1','MessageRemoved.v1')
  AND NOT EXISTS (SELECT 1 FROM automatic_memory_event_acks a WHERE a.event_id=e.event_id)
GROUP BY e.type;
```

在 Memories 数据库另查 `SELECT state,count(*) FROM automatic_memory_jobs WHERE account_id='<指定合成账号UUID>'::uuid GROUP BY state;`。从一位新建合成账号、少量新画像／新聊天开始，确认范围后才将本机 Memories `server.env` 的 `AUTOMATIC_MEMORY_ENABLED` 改为 `true` 并重启记忆 API。模型配置中的 `MODEL_ALLOWED_ACCOUNT_IDS` 只列这批明确指定的合成账号；不要把全部账号或积累的历史批量送给供应方。该名单限制来源拉取范围，业务授权仍由 Identity 逐次决定。

在 `backend/services/memories` 另起自动 Worker，沿用独立服务配置与现有模型配置；原候选 `worker.js` 继续独立运行：

```powershell
node --use-env-proxy --env-file=../../../.tmp/memories-dev/server.env --env-file=../../../.tmp/conversations-dev/model.env dist/automatic-worker.js
```

API 不加载模型文件，浏览器不接触模型或服务密钥。自动 Worker 通过源服务的受控接口按当前 allowlist 拉元数据、持久入库后逐条确认，再由 `memory.extract.v1` 调用模型；不是在轮询时把所有历史原文一次交给供应方。部署开关为 false 时不运行自动整理，不能凭开关为 true 推导用户同意。

验证在专用测试数据库内使用随机 schema 与合成资料：

```powershell
# 在本服务目录，先 pnpm build；连接串由操作者在进程环境中提供，不提交到仓库
$env:XIJIE_TEST_DATABASE_URL = '<专用测试数据库连接串>'
node --test test/automatic.test.mjs test/automatic-queue.test.mjs test/automatic-provider.test.mjs test/automatic-audit.test.mjs
```

反例覆盖重复／乱序、超安全整数的消息序号、同毫秒更正、源与上下文移除、旧派发、用途标记缺失、撤权、跨账号／人物、导出失效和在途注销。导出与擦除已包含新增自动表和物理派发；[恢复工具](../recovery/README.md)已扩展自动任务隔离，但生产恢复放行及最新删除回放仍单独验收。上述模块测试不表示原页面与真实提供方联调或移动安装包已经验收。
