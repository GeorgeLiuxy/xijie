# Memories service — K04 / K05 文字授权与个人数据权利

K05 数据权利新增 `004_data_rights.sql`，保持已应用的 001–003 不变。Identity 编排通过独立 `XIJIE_DATA_RIGHTS_SERVICE_TOKEN` 调用内部端点，缺少配置时端点返回 404，不开放给客户端代理。Memories 再用本服务凭据向 Identity 核对当前申请、账号、用途和账号状态。

- `GET /internal/v1/accounts/{accountId}/data-export?requestId=UUID&scope=account_data|interaction_data`：返回版本化快照 `{schemaVersion:1,domain:'memories',accountId,capturedAt,revision,data:{memories:[],automaticMemories:[]}}`。两种 scope 在本域都包含当前可见确认原文及自动记忆的来源、状态和版本；仅 Identity 的 account_data 额外包括账号资料。派生正文只在条目当前有效、来源仍可用时导出，来源已删除或被替代的条目只留元数据；来源变化也参与稳定 SHA-256，使旧导出失效。原文按确认序号与 ID 排序，单库可重复读，摘要排除捕获时间。候选、移除原文、已删除人物、内部命令、密钥和队列均不导出；超过 20 MiB 明确 413，禁止静默截断。个人复制权不依赖继续允许 AI 或存储用途，也不调用模型。
- `POST /internal/v1/accounts/{accountId}/erase`：`{requestId}`，UUID 幂等键与 requestId 相同。仅接受该账号已经受理的注销申请、账号 deletion_pending/deleted，返回 `{accountId,requestId,erasedAt,alreadyErased}`。同库事务清除私人原文（含逻辑移除）、候选、任务、命令和 Outbox，并清除 pg-boss 12 所有状态的关联物理投递。保留最小账号门闩和回执，不保留正文。

`memory_account_write_gates` 是所有私人 INSERT/UPDATE 共用的持久行门闩。原写操作先通过游标的 INSERT 取得门闩再锁领域对象；擦除取得同门闩后设置 erased_at，再删除私有行。触发器拒绝迟到旧权限写入；旧 repeatable-read 快照通过 gate 行的 UPSERT 冲突产生序列化失败，也不能复活资料。账号归属不可通过 UPDATE 改换。清理与别的账号隔离，重复清理回同一回执；已在途 Worker 的晚结果无法重新入库。此本地围栏不宣称所有服务在同一事务中完成清理。

此服务负责用户确认的记忆原文、纠正、移除、星图检索、当前人物的确认记忆上下文及供用户编辑的 AI 候选。围坐可在独立回应许可及已捕获旧文字 AI 许可下读取当前发言人自己的获准珍藏／自动长期记忆；跨人物的旧共享回复依赖只作按原 owner 的引用验证，不读取其他人物私有正文。采用既定 TypeScript、NestJS、专用 PostgreSQL 16、pg-boss 和已验证版本的 AI SDK；不跨库读写 Identity、People 或 Conversations 的表。生成候选与确认原文分离，私人动态由后续服务接入。

## 自动长期文字记忆

`005_automatic_memories.sql` 新建独立的 `automatic_memory_sources/jobs/entries/receipts`，保留 001–004。画像和当前用途许可下的用户文字消息可以异步形成有来源的私人线索，无需点击珍藏；AI 前文仅解释语境，不能充当本人经历的依据。每个条目保留来源 ID／版本、说话者、来源时间、消息整数序号、证据片段、用途版本与状态；证据不足允许零条结果。自动结果不进入 `memories`，不分配珍藏确认序号、不发布 `MemoryConfirmed.v1`、不发邀请奖励，也不改写用户确认的原文。

启用须同时满足本机 `AUTOMATIC_MEMORY_ENABLED=true`、模型测试账号 allowlist、当前存储许可，以及 Identity 返回的当前 AI 授权与 `aiTextProcessing.automaticMemoryAllowed === true`。缺省开关为 `false`；缺失或为 false 的用途标记都不能靠 `allowed:true` 补足。Identity 新迁移 `006_automatic_memory_permission.sql` 发布隐私告知 v3、AI 文字政策 v2，必须由用户在原浮层明确确认并重新授予，旧授权不能被升级。消息还须匹配其受理时的 AI 版本；旧版或此前已撤回授权下的聊天不自动回扫，旧任务也不会因重新授予而复活。

来源分别由 People `006_automatic_memory_sources.sql` 与 Conversations `004_automatic_memory_sources.sql` 的受控事件／逐条确认接口提供。仅先持久接收再确认来源事件，不用全局时间高水位跳过并发提交；来源已不存在时记录终态，临时 503 留待重试。原文仍由来源服务拥有，不复制到事件或任务载荷。专用 `memory.extract.v1` 队列与独立 `automatic-worker.js` 负责整理，按人物的来源顺序处理，带派发／尝试／租约保护和有界恢复。

新信息中的明确更正可替代相同人物、较早来源的指定旧条目；删除新来源不会重新激活已被替代的结论。读取和回复写回前重新检查账号、人物、来源和用途版本；仅校验实际引用组，不因无关新记忆异步到达而阻断回复。删除任一实际依赖的消息也会停止相关派生，用户独立确认的珍藏按自身权限保留。自动引用由 Conversations 保存到直聊 `generation_jobs.memory_context_refs` 或围坐 `gather_reply_slots.memory_context_refs`；围坐引用明确保留实际 personId。它们不是对原始历史的替代，围坐消息本身不进入自动提炼来源。

`GET /internal/v1/persons/:personId/automatic-memories/context?q=...` 返回当前相关条目，`POST .../validate` 用 `{refs:[{id,version}]}` 验证本次引用；只允许 Conversations 的服务凭据和当前账号／人物，内部接口不经前端代理。数据导出、账号擦除与账号写围栏已扩展到四张自动表及关联物理投递；恢复工具也识别并阻断自动任务，恢复副本仍保持限制。生产恢复切换和可信最新删除／撤权回放另行验收，见[恢复工具](../../../deploy/recovery/README.md)。

`009_automatic_memory_controls.sql` 在原自动条目保存用户更正和最新操作回执。部署前先应用迁移并更新记忆 API 及自动 Worker。用户通过人物资料的「记忆 → 自动记忆」查阅当前获准的条目，展开来源片段，修改标题／正文或停用单条线索。更正会升级引用版本，模型上下文只读更正后的正文和标题。停用会移出检索，旧引用校验随即失败。人物资料、聊天原文与珍藏仍按各自用途处理。前端走同源 `GET /v1/persons/:personId/memories/automatic` 分页，以及该路径下的 `PATCH /:id` 和 `DELETE /:id`。写入需要当前会话、同源、操作键和 `If-Match`，同一条目的最新操作可以按原键重试。管理接口不发送模型请求。

迁移顺序、开关、待处理范围检查及独立 Worker 命令见[本机联调](../../../deploy/memories-dev/README.md#自动长期文字记忆的升级与小批启用)。当前仍为指定合成账号的开发联调；真实模型、原页面端到端和生产发布分别以相应交付证据验收，模块测试不能替代。

## 本轮范围与运行

需要 Node.js 22.12+、pnpm 10.34.3。配置项见 `.env.example`。在本目录执行：

```powershell
pnpm install --frozen-lockfile
pnpm build
node --env-file=.env.local dist/migrate.js
node --env-file=.env.local dist/main.js
```

默认 API 地址 `127.0.0.1:3104`。数据库与业务服务凭据独立。迁移按序执行，事务、advisory lock 和 SHA-256 校验禁止修改已应用 SQL。`002_memory_candidates.sql` 增加本库候选任务、候选与永久生成命令引用，保留已应用的 001。生产入口应使用 HTTPS 和精确前端 Origin。当前实现 MEM-01–07 与 FIND-01 的 `scope=atlas`；动态回响沿独立 Social 接口，会话全文搜索由 Conversations 拥有并包含 direct／gather，不能以本域 Atlas 搜索替代。

另一个进程使用同一服务配置及本机模型配置启动 `node --env-file=.env.local --env-file=.env.model.local dist/worker.js`。API 不加载模型密钥。`MEMORIES_QUEUE_SCHEMA` 默认 `memory_queue`，真实物理队列为 `memory.suggest.v1`。模型适配器使用固定 `ai@7.0.169`、`@ai-sdk/openai-compatible@3.0.90`、Zod schema 与 `Output.object`；OpenAI 请求使用 `max_completion_tokens:1600`、`store:false`，GPT-5/6 设 `reasoning_effort:none`，SDK 自动重试关闭，30 秒限时。密钥、原始正文和 Cookie 不进入队列或事件。

| 方法 | 接口与行为 |
| --- | --- |
| POST | `/v1/persons/:personId/memories`：用户手写或直接摘录，`clientMemoryId,title,body`；可选成对 `sourceMessageId,sourceMessageVersion`。返回 201 正式原文 |
| POST | `/v1/persons/:personId/memory-candidates`：`{sourceMessageId}`，202 返回 `generationJobId`，任务与真实入队同事务 |
| GET | `.../memory-candidates/:id`：只有当前可读 ready 候选返回建议标题、正文；其他状态只返回元数据，消费后可含 `consumedByMemoryId` |
| GET/POST | `/v1/generation-jobs/:id?kind=memory_suggestion`、`.../cancel?kind=memory_suggestion`、`.../retry?kind=memory_suggestion`：当前账号任务的查询、取消、显式重试 |
| GET | 同一路径：按确认时间、ID倒序分页，默认返回 excerpt，`include=body` 返回原页面正文投影 |
| GET | `.../memories/:id`：同一正式原文，带 ETag；原文弹层应重新鉴权读取 |
| PATCH | `.../memories/:id`：title/body至少一项，需 If-Match、幂等键；保留首次确认时间、来源及确认序号 |
| DELETE | `.../memories/:id`：需 If-Match、幂等键，200 `{id,removedAt,version}`；移除后详情和旧成功重放均不可返回正文 |
| GET | `/v1/search?scope=atlas&q=...`：真实人物、世界和已确认记忆，支持签名分页、NFKC、中文词对、否定谓词及单句证据 |

所有私有接口使用身份服务确认的会话，支持 `X-Xijie-Expected-Session`；写操作必须有精确 Origin 和 UUID `Idempotency-Key`。同参同客户端记忆身份只保存一次，异参409。正文1–10000个Unicode字符，标题1–120；错误采用既定 `{error:{code,message,requestId}}`。401为登录失效，403为用途未授权，404为对象不可见，412为旧版本，428为缺条件，503为依赖不可用。

## 数据与一致性

`memory_account_cursors` 为本库确认序号权威。取锁顺序为账号cursor、命令记录、原文；同账号所有写操作串行。原文、永久客户端请求指纹、确认序号、结果引用和 Outbox 同事务。`memory_commands` 只保存资源 ID、版本，7天过期；永久 `(account_id,person_id,client_memory_id)` 和指纹仍阻止旧请求复活。Outbox 不保存私人正文；珍藏等事实的通用跨服务投递仍待后续接入，自动记忆只消费专门的 People／Conversations 来源事件并逐条确认。

已确认原文以 `confirmed_at` 成立、`removed_at` 移除，没有生成中的状态。创建、修改、移除时间由数据库产生，version条件写保护并发。`origin=manual` 表示用户直接编辑确认；从候选确认时传 `candidateId,candidateVersion`，与直接消息来源字段互斥，`origin=ai_candidate`。同账号同人物候选外键及唯一索引保证一份候选只能消费一次。用户最终编辑的标题、正文才成为正式原文，确认序号、候选消费、原文、普通命令引用与事件同事务。旧客户端键回读现存原文，已删除记录不返回旧正文。

### 候选与任务恢复

申请时通过受控 Conversations `memory-context` 接口读取被选 AI 回复及其仍可见的本人父消息。任务记录全部实际来源 ID/版本和账号、人物、用途版本；申请、生成前后、ready 读取及确认复核，RPC 在数据库事务外。AI 回复只辅助解释语境，不作为本人经历依据；模型只整理本人消息与用户提供的故事。证据不足进入 `blocked / NO_MEMORY_FACTS`，不造模板候选。

同源按账号、人物和来源消息 ID 识别，不用消息版本绕开复用或同时执行限制。同一当前有效来源的 queued/running 任务和有效 ready 建议复用；同一完整版本快照的 failed/blocked 任务也复用，失败重试由显式 GEN 操作触发。已消费候选复用其原任务和已消费元数据，防止反复生成同一条事实。过期、撤回、取消可由新的请求键重新申请。若来源、人物或授权快照变化且当前仍可读，新请求键可创建新任务；仍活跃的旧任务先在同一游标事务中标记 blocked，旧尝试不能再写回。旧请求键永远只返回原任务引用，`candidate_commands` 保留永久指纹而不使用七天缓存推断付费意图。新 GEN 重试复用业务任务 ID，但更新物理 `dispatch_id/dispatch_generation`；旧派发不能领取新一代。

候选成功生成后有效 24 小时，状态仅 `ready → consumed/expired/withdrawn`。读取和确认按服务端时间拒绝过期，后台清理延迟不延长有效期；失效候选隐藏正文，临时依赖 503 不永久撤回。独立已确认原文不会因候选或来源后来失效被改写。候选未确认前不进入原文列表、星图检索或聊天确认记忆上下文。

任务带创建、排队、执行开始、租约、结束、尝试、派发代次等字段。45 秒业务租约、60 秒物理投递期限和有上限的重投用于进程崩溃恢复；正常停止释放当前尝试并拒绝物理投递，使重启能够接管。Worker 定期用 pg-boss 公开查询接口归并物理重试耗尽的陈旧非终态任务。正常模型错误只写可查失败，等待显式业务重试，不在后台无限调用模型。取消、源资料变更和旧尝试都不能发布迟到候选。

模型调用同时要求 Identity 的当前独立 AI 用途授权，以及 `MODEL_ALLOWED_ACCOUNT_IDS` 明确列出的本机授权测试账号；空名单阻断，`NODE_ENV=production` 不启用此开发机制。本片只接 OpenAI 文字用途门禁，正式运行仍需解除开发限制并完成相应发布验收。现有数据存储授权不自动代替模型用途授权。

### K05 独立 AI 用途门禁

Identity 内部 session/account 上下文必须同时提供 `storyStorage` 和 `aiTextProcessing:{allowed,authorizationVersion}`。缺失或格式错误返回依赖不可用，未授权的合法版本 0 仍可完成各自允许的原文读取、手写、取消和删除。已有文字存储授权和本机模型名单均不能推导出 AI 同意。

新增迁移 `003_ai_text_processing.sql` 在候选任务保存独立 `ai_authorization_version`，已存在任务为 0。新整理申请必须有当前 AI 授权并绑定该版本；Worker 在慢来源读取之后、调用模型前、调用后及提交前校验同一版本。撤回后重新授予也不会自动恢复旧排队或执行中任务，旧结果进入不可自动重试的 `blocked / AI_PERMISSION_REQUIRED`。来源、账号、人物和存储快照使用独立 `validSourceSnapshot`，AI 门禁使用 `validAiAuthorization`，避免撤回 AI 用途时无声撤回已成功生成的 ready 候选。

只有 failed 且可重试的任务能够通过用户显式重试，重新检查当前授权、捕获新版本并更新物理派发代次；旧派发仍不能执行。queued/running/succeeded 的 retry 只回读既有任务，没有新模型调用，不受新增 AI 门禁影响。已成功的旧幂等键只回原结果；AI 权限拒绝不是已受理生成命令，不永久缓存为同键失败。ready 候选的读取和人工确认仍按来源、存储和人物权限校验，不要求继续授予 AI。

当前政策只覆盖 OpenAI：真实模型 `MODEL_BASE_URL` 必须为 `https://api.openai.com/v1`（允许末尾 `/`），其他提供方、路径、凭据或附加查询配置直接拒绝，SDK 请求禁用重定向。适配器再次检查账号与接受时授权版本，本机名单及 production 禁用仍作为额外运行限制，不能代替权威授权。

来源消息删除后只省略来源链接，原文仍按自身权限读取；来源服务临时不可用时复核原文当前账号、人物及存储授权，再省略可选来源链接。人物删除后详情、列表、搜索、上下文、旧成功重放全部遵循当前 People 权限，不返回旧正文。撤销故事存储授权后禁止读取与新写，但允许用户移除自己的记录。

Identity/People/Conversations 的 HTTP 复核和本库写入之间存在跨数据库竞态窗口，不能声称跨服务原子撤权。本库事务只保证自己的数据、版本、幂等和事件一致；每次私有读取重新检查权威权限。

## 受控内部接口

`GET /internal/v1/persons/:personId/memories/context` 仅接受 Conversations 的独立服务凭据和 `X-Xijie-Account-Id`，可选 `q` 为当前消息（最多4000字符）。返回 `{personId,memories:[{id,version,title,body}]}`，有确定性相关证据时最多8条，默认最近4条，每条正文最多1200字符。不调用 Conversations 来源接口，避免循环；只返回当前允许的正式原文，供模型引用前后按 ID、版本复核。模型调用和晚到回复保护由会话服务负责。

## 验证

```powershell
pnpm build
# XIJIE_TEST_DATABASE_URL 指向允许创建随机测试schema的专用测试数据库
pnpm test
# 全量 test 已包含自动记忆与 Social 来源；只需定向复核时可运行下列子集
node --test test/automatic.test.mjs test/automatic-queue.test.mjs test/automatic-provider.test.mjs test/automatic-audit.test.mjs
```

测试真实 PostgreSQL 事务、并发序号、Outbox失败回滚、幂等缓存过期后的永久去重、CAS/删除、来源撤回、人物删除、权限撤销、中文否定检索、上下文上限及真实 Nest HTTP/内部HTTP契约。自动验证使用合成数据和隔离随机schema；原页面与实际多服务/模型联调由应用侧另行验证。

模型标题与正文跟随用户本人消息的主要语言；已用合成中英文资料核对真实结构化返回，英文不会因系统说明语言而强制转成中文。原文仍以用户最终确认的文字为准。

## R01 珍藏回响来源

增量 `006_social_memory_sources.sql` 为 Social 增加独立的 `social_memory_event_acks`，以原 Outbox 同账号复合外键绑定并在擦除时级联。新确认／主动修订在原有短事务的事件 payload 捕获当次已核验 AI 的 `echoAiAuthorizationVersion`；只有新 `privateFeedProcessingAllowed===true` 的有效授权记录正版本，否则为 0。旧事件缺失视为 0，移除事件不要求 AI。保存原文仍不受回响异步结果影响，不改变确认顺序或奖励资格。

`XIJIE_SOCIAL_SERVICE_TOKEN` 只开放 `/internal/v1/social/memory-events`、`.../{eventId}/ack`、`/internal/v1/social/persons/{personId}/memories/{id}/context` 和同层 `memories/validate`。事件读取按明确账号集合最多 100、单页最多 100，逐 UUID ack 而非时间高水位，来源正文不进入事件。正文 context 必须带正整数 `expectedVersion`／`expectedAiVersion`，前后复核账号、人物、当前存储／私人空间及精确的新 AI 授权；该准确原文版本还必须曾由正式 upsert 事件捕获正 AI 版本，后来 grant 不会使原先无许可的版本可被回扫。已有合法回响下的新评论可使用当前新 grant 读取原文，不让旧任务借新 grant 恢复。

metadata validate 最多 64 个 `{id,version}`，只返回当前有效引用，不返回正文，也不要求重新允许 AI 或存储，用于既有结果失效与数据复制。确认原文保持独立，原聊天消息删除或临时故障不影响其合法性；原文更新／删除、人物撤权和账号擦除则收回相关引用。ack 元数据参与域导出及 revision；原 Outbox 擦除级联清除 ack，迟到 ack／旧 RR 写入不能恢复账号数据。本域真实 PostgreSQL／Nest HTTP 全量 69 项通过；部署、原 UI 与实际 Social 模型效果另行验收。


## 围坐记忆引用验证（2026-11-14）

`POST /internal/v1/persons/:personId/memories/validate`仅接受既有Conversations凭据和账号header，输入`{refs:[{id,version}]}`，最多8个唯一引用。返回`{personId,valid}`，不返回或读取珍藏正文。当前文字保存和旧AI授权、同账号有效人物在异步读取前后核对；擦除围栏阻断旧调用。缺失、跨归属、删除或更正的引用返回false，授权／来源变化明确拒绝。围坐调用方按引用原owner分批验证，不把其他人物的私有记忆正文装入模型；实际模型用途仍须另外验证gatherReplies。现有上下文接口和自动记忆验证保留原行为。

专项4项及完整Memories 73项回归、TypeScript编译通过；本轮实际围坐使用两条真实私聊及两份各自自动记忆作为来源，核对各自私有正文隔离与共享回复引用继承闭包；撤回旧文字 AI 后新围坐私有引用为零。首次与澄清后的真实质量结果分别保留，详见[围坐记录](../../../docs/backend-api/conversations-memories.md)。


## M03 共创投稿来源

`007_shared_contributions.sql` 增加 `origin:shared_contribution` 和精确 album/contribution/version 来源，保留独立永久采纳回执。只有 Social 专用凭据可调用 `/internal/v1/shared-albums/:albumId/contributions/:id/adopt`，输入仅 `sourceVersion`；正文和目标人物从当前 Social 来源读取，浏览器不能提供或冒充 manual。确认事件明确 `qualifiesForReferral:false`，不产生邀请资格，也不自动安排珍藏回响。

本来源与用户自己确认的聊天珍藏具有不同撤回规则：作者同意或来源失效后，普通列表、详情、检索、模型上下文、引用验证和导出都重新验证并排除该正文；源服务不明时拒绝读取，不用缓存放行。新增 `XIJIE_SOCIAL_URL` 用于来源回读。`revoke` 由同一 Social 凭据调用，以 durable tombstone 阻止撤回与迟到采纳交错产生新副本，并清理正文；账号擦除删除本人的采纳回执。所有新增外部请求位于本库事务之外。既有 manual/ai_candidate 原文继续保持其原有独立权利，普通聊天源删除不删除那些用户确认原文。
