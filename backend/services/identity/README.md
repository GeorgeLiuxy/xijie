# Identity：账号、应用会话与用途授权

独立 NestJS/TypeScript 服务，通过 Logto 验证登录身份；账号、会话、政策版本、用途决定和事务 Outbox 属于本服务数据库。不读取其他领域的业务表。

## 模型调用用量

先应用 `032_model_attempt_usage.sql` 并更新 Identity，再启动发送用量的 Conversations、Memories、Social 与 Gifts。既有调用和历史行可省略用量。文字、看图及异步内容共用现有的调用额度、用途授权和结果写回检查。实时通话继续使用原独立租约。

每次已结束的模型尝试可以保存一份用量。记录所用供应商、配置模型、SDK 返回的模型标识、调用状态与耗时，并保存供应商实际报告的输入、输出及命中缓存的输入 token 数。缺失量记录为 `null`，明确返回的零保留为零。收到模型结果后即使因撤权或过期而无法写回，仍能区分该次实际用量与最终拒绝结果。重复结束请求不能修改已保存记录。

完整账号导出包含本人的用量摘要，注销会清理对应记录。用量字段不含提示、生成正文、密钥或响应 ID。以下只读查询可用来核对最近七天的用量，并用各列样本数判断覆盖范围。供应商价格、账单和发布后的真实消费须另行核对。

```sql
SELECT service, purpose, usage->>'provider' AS provider,
       COALESCE(usage->>'resolvedModel', usage->>'model') AS model,
       COUNT(*) AS attempts, COUNT(usage) AS metered_attempts,
       COUNT(usage->>'inputTokens') AS input_samples,
       SUM((usage->>'inputTokens')::bigint) AS input_tokens,
       COUNT(usage->>'outputTokens') AS output_samples,
       SUM((usage->>'outputTokens')::bigint) AS output_tokens,
       COUNT(usage->>'cachedInputTokens') AS cache_samples,
       SUM((usage->>'cachedInputTokens')::bigint) AS cached_input_tokens
FROM model_executions
WHERE claimed_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'
GROUP BY 1, 2, 3, 4
ORDER BY 1, 2, 3, 4;
```

## R01 单张聊天照片与真实看图回应

`016_private_chat_photo_storage.sql` 新增 `private_chat_photo_storage` v1 → `chatPhotoStorage`；`017_person_chat_image_replies.sql` 新增 `person_chat_image_replies` v1 → `chatImageReplies`。两个独立用途都精确绑定同账号当前隐私告知确认，旧政策和决定保持原样。授权历史 meta、内部 session/account context 返回各自的 `{allowed,authorizationVersion}`；grant 不自动允许旧 AI、其他照片用途或彼此。

原选图即发送流程同时要求私人文字保存、聊天照片保存、看图回应三项许可。图片保存仅覆盖本人虚构人物直聊的单张规范化私有成品及来源。看图用途允许 OpenAI 处理本条图片、必要人物文字及虚拟世界，不读取旧照片、私聊、珍藏、长期记忆、书信或围坐；本片照片及其文字回复也不进入后续文字 AI、自动记忆、候选珍藏或围坐。实际模型及原 UI 验收由主任务另外执行，不以授权测试代替。

撤回分别产生 `ChatPhotoStorageRevoked.v1`、`ChatImageRepliesRevoked.v1`。撤看图停止待办和迟到写回，已保存回复仍按私人文字保存读取。撤照片保存隐藏照片及字节，保留其余文字历史；重授可读仍有效成品，不恢复旧上传或任务。独立导出和注销不要求重授；授权事件、精确告知绑定及版本自动进入 Identity 权利快照，实际照片字节和来源由 Media／Conversations 提供。

隔离 PostgreSQL 与真实 Nest HTTP 测试覆盖旧政策不扩义、独立授权组合、精确告知、并发键、撤回重放、后续政策失效，以及全部撤权后的导出和擦除。

## R02 赠礼旅途留影授权

`013_gift_delivery_photo_storage.sql` 增加独立 `gift_delivery_photo_storage` v1，用途上下文为 `giftPhotoStorage`。仅覆盖用户完成已抵达寄件的原旅途动画后，保存应用渲染的虚拟场景、私有读取、替换、导出与擦除；不代表真实交付证明，也不进入 AI。业务侧同时检查虚拟赠礼保存授权，不要求文字、人物照片、动态照片或 AI 用途。此前已发布政策与授权记录保持原样。

授权绑定当前隐私说明确认版本；撤回产生 `GiftPhotoStorageRevoked.v1`。重新允许可读取当前仍有效的已保存结果，但不会恢复旧授权下未完成的上传或任务。`gift-photos.test.mjs` 通过真实 HTTP 检查独立授权、旧政策不变、原键重试、版本冲突、撤回和再次确认说明后的失效。

## 个人数据导出与账号注销（K05 第二片）

新增 `005_data_rights.sql`，保留 001–004 不变。`reauthenticate` 复用现有短信验证码桥，严格核验 OIDC `auth_time` 和同账号主体，不允许未知手机号自动注册；成功保持原会话／Cookie，仅更新专用 `reauthenticated_at`。权利受理、下载及会话内重试要求 10 分钟内的这项可信证据，兼容登录的时间回填不算重验。

公开接口：

| 路径 | 行为 |
| --- | --- |
| `POST /v1/accounts/me/data-requests` | `export` 明确选择 `interaction_data/account_data`，或 `delete_account` 携带事先生成的 `deletionReceiptId` 与 32 字节随机数的 43 字符 base64url `statusProof`；返回 202，同键回同申请 |
| `GET /v1/accounts/me/data-requests?limit=10`、`.../{id}` | 只读当前账号申请及状态，重新打开浮层可恢复 |
| `POST .../{id}/retry` | 空对象和原操作 UUID，显式继续同一失败申请 |
| `POST .../{id}/download` | 近期重验、空对象与幂等键；签发最长 60 秒、本 session 专用的同源内容 URL；同键仍回原 grant，不延长期限 |
| `GET .../{id}/content?grant=UUID` | 再验会话、重验时效、授权／资源当前摘要，输出禁止缓存的 JSON 附件。已知本会话 grant 过期为 `410 DOWNLOAD_GRANT_EXPIRED`；文件过期为 `410 EXPORT_EXPIRED`；内容变化为 `409 EXPORT_STALE` |
| `GET /v1/data-request-receipts/{receiptId}`、`POST .../{receiptId}/retry` | `X-Data-Request-Proof` 只授权该注销单进度与显式重试，不授权原文或下载。证明摘要有效 7 天；按收据和来源地址限制每分钟 120 次，重试另需精确 Origin 与 UUID 幂等键 |

内部 `GET /internal/v1/data-requests/{id}/context` 仅允许 People／Conversations／Memories 的既有服务凭据读取申请、账号状态及访问版本。编排使用另一个独立的 `XIJIE_DATA_RIGHTS_SERVICE_TOKEN` 调三个数据域的快照与擦除接口；不访问其他数据库。

申请、注销冻结、访问版本推进和 pg-boss 入队同一个 Identity 事务。独立 Worker 使用 `identity_rights_queue` schema 和 `data-rights.process.v1`，队列载荷仅含申请／派发 ID 和派发代次。业务有当前尝试、90 秒租约、四次有界恢复及显式失败重试，旧尝试不能提交；长期 accepted 且物理派发不再有效会归并可恢复失败。三个域擦除进度分别持久化，重复投递沿同一个 requestId 去重。

导出包括四个域各自的快照时间和 SHA-256，不声称跨库全局时点。适配器重算每个域的 `JSON.stringify(data)` 摘要，流式读取每域最大 21 MiB（20 MiB 内容及 envelope 余量）；汇总文件最大 64 MiB，超出明确失败而不截断。文件由独立 256 位 key 采用 AES-256-GCM 存在本库，AAD 绑定 requestId，下载前验证密文与正文摘要，申请起最长 24 小时有效，Worker 清理过期件。Outbox 和幂等命令不存正文。

注销受理即 `deletion_pending` 并递增账号访问版本，旧会话和生成上下文立即不可用。只有 People、Conversations、Memories、提供方四项进度全部成功，才清理本域私人记录并标 `deleted/completed`；失败不解冻。保留禁用的最小主体映射，旧 `issuer+sub` 不会自动重建原账号。Logto 用户删除只在明确自有租户配置开启时执行；缺配置、其他提供方或供应方失败均不可假报完成。使用官方 [M2M 管理 API](https://docs.logto.io/integrate-logto/interact-with-management-api) 的 `client_credentials` 和 [DELETE /api/users/{userId}](https://openapi.logto.io/operation/operation-deleteuser)，OSS resource 为 `https://default.logto.app/api`；受控 URL 禁止重定向。

额外服务端配置（密钥只放本机 ignored env）：

```dotenv
DATA_RIGHTS_ENABLED=true
DATA_RIGHTS_QUEUE_SCHEMA=identity_rights_queue
DATA_EXPORT_ENCRYPTION_KEY=<64 hex characters; independent random key>
XIJIE_DATA_RIGHTS_SERVICE_TOKEN=<64 hex characters; independent service token>
XIJIE_PEOPLE_URL=http://127.0.0.1:3102
XIJIE_CONVERSATIONS_URL=http://127.0.0.1:3103
XIJIE_MEMORIES_URL=http://127.0.0.1:3104
LOGTO_MANAGEMENT_CLIENT_ID=<owned-tenant M2M application id>
LOGTO_MANAGEMENT_CLIENT_SECRET=<M2M secret>
LOGTO_MANAGEMENT_RESOURCE=https://default.logto.app/api
LOGTO_MANAGEMENT_DELETE_USERS=true
```

应用迁移后，API 沿原命令启动；独立 Worker 在服务目录运行 `node --env-file=../../../.tmp/identity-dev/server.env dist/rights-worker.js`。只有服务配置齐备时启用，不在迁移中替用户建立重验或注销申请。本机五库加密备份与隔离恢复验证见[恢复工具](../../../deploy/recovery/README.md)；生产恢复切换和可信的最新删除／撤权回放尚未实现。当前对象存储、媒体、支付／交易及旧原型导入仍在后续范围；已下载的副本由用户管理。

验证使用隔离 PostgreSQL schema、真实 pg-boss/Nest 及 HTTP 提供方夹具，包含原账号登录／切号／退出和 AI 授权回归。真实 Logto 及原前端的完整验收由主任务单独完成，不以本模块夹具代替。

## AI 文字用途（K05 首片）

迁移 `004_ai_text_processing.sql` 增加 `ai_text_processing`，发布文字联调隐私告知 v2 与 OpenAI 纯文本处理政策 v1。已应用的 001–003 不变，历史文案和决定仍可读取；不会把旧的告知或文字存储授权自动转换成 AI 同意。

沿用 `GET /v1/policies/current`、`GET/POST /v1/accounts/me/consents`。AI 用途只允许 `grant/revoke`，写入仍需要原站、有效会话、可选的精确预期会话、UUID 幂等键和当前用途授权版本。授予前须明确确认当前隐私告知；撤回不要求先确认新告知。

内部 session/account context 同时返回 `storyStorage` 与 `aiTextProcessing`，基础字段为 `{allowed,authorizationVersion}`。只有当前政策与明确授权都包含自动长期文字记忆时，`aiTextProcessing` 额外返回 `automaticMemoryAllowed:true`；消费者必须按 `===true` 判断，缺失或 false 均不允许自动处理。公开授权历史的 `meta.aiTextProcessing` 与内部结果使用相同权威计算；不要仅靠历史 `currentDecisions` 的 grant 字样判断当前许可。

`GET /internal/v1/accounts/{id}/context` 的只读服务调用方为 People、Conversations 与 Memories，使用各自已配置凭据；People 在读取迁居上下文前复核账号仍为 active。缺失／错误凭据或不可用账号均拒绝。此服务凭据不代替用户会话，也不授予公开授权写入或数据权利管理权限。角色测试使用三套独立凭据，避免共用测试 token 掩盖服务间权限缺口。

AI grant 绑定同账号的准确隐私告知授权版本，数据库以生成的固定用途与复合外键约束该引用。告知更新并重新确认后，旧 grant 不会在相同 AI 版本下自动生效；必须重新明确授予。AI 政策更新也使旧决定失效，授权计数不重置。

撤回只推进本用途的版本并写 `AiTextProcessingRevoked.v1`；文字保存授权不被改动。生成服务须在受理、调用模型与写回时核验版本。事件只是通知，跨服务最终读取仍以当前授权为准，不提供跨库原子事务保证。已有正文的读写与删除沿其独立权限处理，不由 AI 撤回隐式删除。

004 的 AI 文字政策 v1只针对原回复与珍藏候选，明确不含自动长期记忆。数据导出／注销已由 005 单独接入；其他提供方、多媒体及生产发布仍需各自验收。变更提供方和范围时需发布新政策并获得新的明确授权。

### 自动长期记忆的新用途许可

`006_automatic_memory_permission.sql` 为 `policy_versions` 增加 `ai_automatic_memory_enabled boolean NOT NULL DEFAULT false`，保留已发布政策及历史决定。新隐私告知 v3 与 AI 文字政策 v2说明画像和获准聊天的私人自动整理；只有该 AI 政策标记为 true。新迁移不授予任何用户同意，不重置用途版本，也不将旧 grant 升级。当前告知必须重新明确确认，随后在原 AI 授权浮层授予当前政策；新的授权仍绑定准确的告知授权版本。

自动服务同时要求 `allowed:true`、`automaticMemoryAllowed:true`、当前接受时的用途版本与本机运行开关／名单。缺少专属用途标记的老上下文即使 `allowed:true` 也不能读取、入队或执行自动记忆。撤回后的在途产物不能写回，重新允许不会恢复旧派发或自动回扫旧授权版本的聊天。原聊天、珍藏与复制／删除仍分别按自己的授权和来源规则处理。

在本服务目录先构建，再执行原迁移器：

```powershell
pnpm build
node --env-file=.env.local dist/migrate.js
```

配套 People 006、Conversations 004、Memories 005 的迁移顺序和小批启用说明见[自动记忆本机联调](../../../deploy/memories-dev/README.md#自动长期文字记忆的升级与小批启用)。Identity 不加载模型密钥、不直接运行整理模型；自动结果由 Memories 拥有，其导出、擦除及恢复副本隔离已扩展，生产发布仍单独验收。

## R01 私人文字动态授权与第五域数据权利

先应用增量 `007_private_feed_permission.sql`，不修改已发布政策或替旧账号授予新范围。新告知 v4、文字与私人空间存储政策 v2 明确私人文字动态、手动点赞／评论和已提交迁居事实的私人读投影，不包含媒体、公开分享、自动互动或向模型发送这些内容。007 阶段的 AI 政策仍为 v2，未扩大其用途；后续独立 AI 升级见下节 008。新存储 grant 绑定精确告知授权序号；只有当前合法 grant 对应 `private_feed_enabled=true`，内部 `storyStorage` 与公开授权历史 `meta.storyStorage` 才带 `privateFeedAllowed:true`。旧 grant、缺失标记、告知重确认或用途撤回均不能补领；复制／删除继续按各自数据权利权限办理。

`XIJIE_SOCIAL_SERVICE_TOKEN` 是可选且独立的 64 位十六进制服务凭据，只允许 Social 读取内部 session、active account 与 data-request context，不代替用户会话。启用 Social 部署时，再配置 `XIJIE_SOCIAL_URL` 并重启 API／数据权利 Worker。未配置 URL 的既有部署继续四域导出与原注销路径；配置后 Social 必须参与第五域导出和擦除，故障不可跳过。导出完成与注销最终提交均检查所需领域齐全，失败可沿原申请重试；同意历史导出保留告知绑定序号。

相关真实 PostgreSQL／Nest HTTP 全量 28 项测试通过，覆盖新范围明确授权、旧许可不升级、角色凭据隔离、禁用账号、五域缺失／故障和旧四域兼容；这些集成测试不代替本轮新 Social 服务的实际部署与原 UI 验收。

## R01 珍藏回响的独立 AI 用途

增量 `008_private_feed_processing.sql` 仅追加 AI 政策 v3 与 `private_feed_processing_enabled`，保留已发布告知 v4／存储 v2，不替现有账号作决定。新政策保留自动长期文字记忆，并明确仅在新允许之后新确认／主动修订的珍藏，以及其回响下新手动评论，才可用于回响与来源人物回应；不回扫旧珍藏或评论，不处理普通用户帖／迁居帖，不递归触发或执行世界副作用。

`private_feed_processing_enabled` 默认为 false，数据库约束仅允许 AI 文字政策置 true。公开当前 Policy DTO 在该 marker 为真时附 `privateFeedProcessingEnabled:true`，只用于原浮层在允许前说明范围；它不是账号授权。内部 session/account context 与公开授权历史 `meta.aiTextProcessing` 只有当前合法 grant 才附 `privateFeedProcessingAllowed:true`。消费者必须同时检查 `allowed:true`、新用途标记 `===true` 和受理时保存的精确 `authorizationVersion`，不得按政策版本号推断能力。旧 v2 grant、缺失或 false 的 marker 均不得使用新用途；需在原浮层明确授予 AI v3。此次不更新告知 v4／存储 v2，不要求仍然有效的独立存储许可重新授予；告知绑定规则继续有效。

珍藏版本在新许可下确认／修订时，由正式来源事件记录正数 `echoAiAuthorizationVersion`；旧事件缺失／0 不因后来允许而补扫。当前 grant B 可供用户在合法旧回响下新提交的评论读取原来获准版本 A 的原文，这属于新的意图；旧任务仍必须匹配其受理时的准确 AI 版本 A，不能借 B 恢复。撤回 AI 后已有回响仍按存储、人物及原文版本权限读取，原文修订／删除会使对应旧回响与回应失效，不要求先重新允许 AI。

AI v3 保留 `automaticMemoryAllowed:true` 的独立条件，既有自动记忆任务和新聊天选取仍校验当前 grant 的精确版本。历史记忆可按来源与数据权利权限导出；升级／重新授予不会把旧授权版本的自动记忆默认带入新聊天，也不回扫旧聊天或自动恢复旧任务。此批 Identity 构建与全量 29 项回归通过；来源、Social Worker 真实供应方与原 UI 验收由整体切片另外记录。

## K02 独立人物照片授权

`010_private_person_photo_storage.sql` 新增 `private_person_photo_storage` v1；空间照片政策 v1 明确排除人物照片，不能沿用其许可。新 context `personPhotoStorage` 仅当前合法 grant 且精确绑定当前告知时允许。独立撤回事件为 `PersonPhotoStorageRevoked.v1`，未有决定默认为拒绝；告知 v4、文字 v2、AI v3、空间照片 v1 与所有旧决定均保持。原隐私浮层提供单独决定，数据权利不要求重新允许照片。人物照片只存储／显示／导出，不参与模型处理。

## R02 独立赠礼与 AI 回礼授权

`011_virtual_gift_storage.sql` 增加独立虚拟赠礼存储 v1，context 和 consent meta 返回 `giftStorage:{allowed,authorizationVersion}`；绑定当前告知授权版本，撤回发布 `GiftStorageRevoked.v1`。旧文字／AI／两项照片政策及决定不变。`XIJIE_GIFTS_SERVICE_TOKEN` 是独立领域凭据；配置 `XIJIE_GIFTS_URL` 后 Gifts 必须参加导出、修订复核和注销完成检查，失败不会生成缺域导出或过早标记注销成功。用途撤回不影响独立数据权利授权。本机七域的实际证据以交付接续为准。

增量 `012_person_gift_returns.sql` 追加 `person_gift_returns` v1，返回独立 `giftReturns:{allowed,authorizationVersion}`。本次不修改告知 v4、文字／AI／照片政策或 `virtual_gift_storage` v1，不扩大旧 grant。新决定仍使用原 policy/consent API、当前用途版本、原操作幂等键，并精确绑定当前告知授权版本；消费者还须检查当前 `storyStorage` 与 `giftStorage`，不能把普通 AI 文字许可或部署名单当作回礼同意。

新用途仅允许此后新寄出并实际送达的礼物名称／数量／赠言和最小人物文字画像交给 OpenAI，由模型决定不回礼或生成一件目录内物件与最多 120 字的附言；包含来礼保存、来源证据、拆开／陈列和站内通知已读。它不读取照片、聊天、珍藏、自动记忆或迁居历史，不发放邮资／券／库存，不启动普通聊天生成或 OS 推送。进入来礼详情保存拆开状态，通知已读独立保存。模型 `none` 不生成来礼，失败不以模板兜底。

Gifts 在新寄件接受时捕获账号访问、赠礼保存、文字保存和回礼用途的精确版本。回礼未允许不妨碍普通寄件，但后来 grant 不补扫旧寄件；任何相关撤回／版本改变阻断旧任务和旧版本收件来源，重新允许不会恢复。People 专用来源和 Conversations 收件投影分别复核当前权限，Identity 不加载模型凭据或直接调用模型。`GIFTS_AI_ENABLED=false` 是 Gifts 默认运行状态，额外的非生产合成账号名单仅限制开发调用，不能替代新用途决定。

启用 Social、Media、Gifts 后，数据权利的所需集合是 Identity、People、Conversations、Memories、Social、Media、Gifts 七个业务域；前文四域／五域说明记录当时切片，不能作为当前完成条件。Gifts 收件、生成来源、通知和操作收据都随域快照导出，任一配置域失败均不得跳过；全部擦除及提供方步骤成功后才完成注销。恢复另包括 Logto，共八库，并隔离模型／投影任务。实现与自动化检查已完成，当前真实 AI、原 UI 和新增事实的恢复验收仍由主任务进行，不以模块测试宣称端到端通过。

## R01 独立书信保存与真实回信授权

`014_private_letters.sql` 追加 `private_letter_storage` v1 和 `person_letter_replies` v1。原政策、告知版本和已有决定保持不变，旧许可不自动升级。当前 policy/consent API、授权历史 meta、内部 session/account context 增量返回 `letterStorage` 和 `letterReplies`，两者各为 `{allowed,authorizationVersion}`，分别绑定当前 `privacy_notice` 的精确授权版本。撤回事件分别为 `LetterStorageRevoked.v1` 与 `LetterRepliesRevoked.v1`；旧幂等决定重放不会覆盖后来的撤回或重新允许。

书信保存管理原信、实际回信、时间偏好、排程、已读位置和必要来源；`none` 只保存原信，没有模型任务。在账号和人物仍可访问的前提下，普通保存／读取只要求 `letterStorage`，不要求 `storyStorage`、`letterReplies` 或旧 AI 用途。请求回信是独立 AI 用途，不要求旧 `ai_text_processing`，但新回信申请的受理及实际执行必须同时验证当前 `letterStorage`、`letterReplies` 与读取人物文字所需的 `storyStorage`。已受理请求的同意图回放只读原资源，不重新申请回信或绑定新授权。Identity 仅公布每个独立用途的决定，不把这些组合条件合并成另一个隐含授权；Conversations 必须核对并捕获各用途和账号访问的准确版本。

回信用途明确 OpenAI 输入仅本封原信、当前必要人物文字及当前虚拟世界／最近已提交迁居，不读取照片、其他原信、聊天、珍藏或自动记忆，不自动学习书信，不发送推送、循环来信或执行世界操作。逐封选择尽快回信或选定 IANA 时区内严格晚于受理时点的第一个 08:00；保存 UTC 时点和时区，允许到期离线执行。有限故障重试最多三次业务尝试，每封信最多保存一份真实回信，失败不能用模板补成功。

撤回回信用途停止新处理、未完成任务及迟到写回，已有原信／回信仍按书信保存和人物权限读取。撤回保存用途停止普通读写及回信处理；重新允许后可读取仍有效的已保存内容，但任何相关授权的撤回再授予都不能恢复旧任务。导出与注销不要求重新授予这两项用途；Identity 的账号导出自动包含新用途历史和告知绑定序号，注销清理这些记录。Conversations 负责书信事实、排程、来源、已读和任务的导出／清理；原生恢复须保留事实并隔离待执行任务。本机专用合成账号的实际 AI、原 UI 三模式、撤权重授、七域导出／注销及新增书信原生恢复已验收；具体范围与验证边界见[统一书信记录](../../../docs/backend-api/conversations-memories.md)。

## R01 独立围坐回应授权

`015_person_gather_replies.sql` 追加独立 `person_gather_replies` v1，不改告知、旧政策或旧 grant。当前授权历史 meta 与内部 session/account context 增量返回 `gatherReplies:{allowed,authorizationVersion}`；grant 必须绑定同账号当前告知的精确授权版本，撤回写 `GatherRepliesRevoked.v1`／`gather_replies_authorization`。旧键重放只返回原决定，不覆盖后来的撤回／重授；缺少新政策或新 grant 不能被当成围坐许可。

新围坐发言由 Conversations 同时检查 `storyStorage` 与 `gatherReplies`，Identity 保持两项决定独立。本授权不自动授予 `aiTextProcessing`：仅当受理时旧 AI 用途也已允许并捕获其精确版本，当前发言人才能使用自己的获准珍藏和私聊自动长期记忆，可能在本账号共享围坐中提及；不能读取其他人物的原始私聊或私有记忆正文。未允许旧 AI 时仍可依据必要人物资料、虚拟世界及本人实际参加过的旧围坐回应。后来允许旧 AI 不为旧任务补加记忆。

政策只授权 OpenAI 文字回应：每轮固定两至三人、每人一条真实结果、每人最多三次业务尝试，不自动轮聊，不以模板补成功。使用本轮用户文字、当前发言人必要画像／虚拟世界／近期迁居和最多二十条本人参加过的旧围坐文字；不传本轮其他槽刚生成的结果。源消息、记忆实际 owner、人物／世界和所捕获权限由 Conversations 在模型前后及写回前复核。图片、音视频、书信、自动学习围坐、自动珍藏、世界剧情、推送、资产发放、支付和跨账号通信均不在范围。

撤回围坐许可终止新处理、剩余任务和迟到写回，已保存消息仍按文字保存权限读取；任何相关撤回／重授或迁出／迁回都不复活旧槽。独立导出和注销不要求重授；通用 Identity 快照包含新用途的政策、决定、授权版本与告知绑定，擦除清理该账号全部新记录而保留其他账号。本轮专用合成账号已沿原隐私入口验证围坐撤权阻断、重授不复活、旧文字 AI 撤回后仍可按新用途生成仅资料回应，以及文字保存读取边界；七域导出与围坐原生恢复通过。完整质量与范围见[围坐记录](../../../docs/backend-api/conversations-memories.md)；原入口注销及独立擦除回读已完成，63 张私有表、3 个物理队列的该账号剩余记录为零，七域删除回执及身份提供方删除回执完成，必要删除围栏保留；不据此宣称生产验收。

## 构建与验证

`018_person_world_actions.sql` 新增 `person_world_actions` v1，独立返回 `worldActionProcessing:{allowed,authorizationVersion}`，不修改旧政策或 grant。新 grant 绑定同账号当前隐私告知的精确授权版本；撤回写 `WorldActionProcessingRevoked.v1`／`world_action_processing_authorization`。Identity 保持各用途决定独立，Conversations 同时检查 storyStorage、旧 aiTextProcessing 和新用途，才判断当前直聊的明确行动并生成有限虚拟叙事。

范围为一个人物、当前世界及当前迁居阶段的 main 主线、一次立即有限的纯叙事行动。愿望、假设、引用、否定、未来或现实要求不直接执行；不执行资产、迁居、赠礼、多人、离线生活、循环或分支，不声称场景物件改变。事件、摘要、真实回复与任务同事务保存，事件记忆独立于真实用户事实和珍藏；后续模型取用仍须当前新授权。撤回停止新处理、记忆模型使用及迟到写回，重授不复活旧任务；已保存历史按 storyStorage 读取。独立导出、注销包含新用途决定与告知绑定，不要求重授。本片源码及隔离验证不代表真实模型或原 UI 已验收。

`node node_modules/typescript/bin/tsc -p tsconfig.json` 编译，`node dist/migrate.js` 使用本服务的 `DATABASE_URL` 按校验和迁移。

测试使用独立 PostgreSQL 连接 `XIJIE_TEST_DATABASE_URL`；每个用例创建自己的随机 schema，结束时仅清理该 schema。执行 `node --run test`，包括数据权利和私人空间授权回归。

AI 授权测试覆盖旧账号升级、政策版本重确认、无默认 AI 许可、两次独立登录、账号隔离、不同用途独立、同键并发、旧操作重放、用途版本竞争、撤回／再允许、告知 ABA、政策更新及数据库级来源约束；测试不调用模型、不修改业务数据库。

本片整体验收现已完成：原UI真实OpenAI回礼、收件与通知、撤权后的七域导出、八库165表恢复及合成账号注销清理均通过。测试开关与名单已关闭，仍仅为本机合成验证；详见[交付接续](../../../docs/backend-delivery-priorities.md)的2026-11-13回礼记录，替代上文进行中的状态说明。
