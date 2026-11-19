# Conversations service — K03

此服务实现现有聊天界面的文字私聊、世界围坐、独立礼物卡投影，以及原人物信匣的书信与真实回信，使用 TypeScript、NestJS、专用 PostgreSQL 数据库和 pg-boss。API 与回复 Worker 是独立进程；同一 Worker 消费独立的聊天、围坐和书信队列。人物、账号和授权信息通过 Identity/People 内部接口读取，礼物权威来自独立 Gifts 服务，不跨库查询。真实 AI 回礼在 Gifts 的独立 return worker 中执行，不复用普通聊天派发。

本机专用账号的原入口三模式、真实即时／定时回信、撤权重授、导出／注销和新增原生恢复已验收，详见[统一书信记录](../../../docs/backend-api/conversations-memories.md)。

## 运行

### R01 明确虚拟行动与事件记忆（2026-11-14，本机验收完成）

本片沿原世界页「和你说说话」进入同一人物私聊，继续使用原文字发送、等待、重试和删除；权威范围见[明确虚拟行动实施基线](../../../docs/backend-api/conversations-memories.md)。只接当前账号、单个人物、当前世界与当前迁居阶段的 `main` 主线中一次立即、有限、纯叙事行动。People 继续拥有人物所在地与迁居，`worldVersion` 只计迁居；正式事件和事件摘要记忆由 Conversations 的 `world-actions` 模块拥有，不写入旧 Memories 的用户事实或珍藏，也不代表画面、背包、资产或持久物件发生变化。

Identity018 的独立用途 `person_world_actions` v1 对应 `worldActionProcessing:{allowed,authorizationVersion}`，同时要求当前 `storyStorage` 与 `aiTextProcessing`。旧许可不扩义，未授新用途时仍沿原普通聊天管线。受理捕获精确新授权版本；模型前后及提交前复核账号、人物、世界、消息／事件来源和授权。撤回停止新处理及事件记忆的模型使用，重授不恢复旧任务；已保存聊天仍按文字保存权限读取。

`012_world_actions.sql` 新增 `person_world_events`，并为原 `generation_jobs` 增加捕获授权、`pending/chat/clarify/execute` 决策、事件／消息来源、叙事版本和模型出处。复用 `chat_reply`、原 POST 和现有 Worker，不增加服务、进程或队列种类。模型返回严格候选 `{text,decision,action?}`；只有 `execute` 包含原文引用、事件摘要和记忆摘要，事件、真实回复及任务成功在本库同一事务提交。同源最多一份事件和回复；未知结果复用完整原请求与幂等键，外部模型调用不承诺恰好一次。

新消息在受理时标为 `world_action_pending`，不能提前进入自动记忆或珍藏候选。只有任务成功判为 `chat`、事件引用为空且来源为 `private_text` 才回到旧自动来源链。`clarify/execute` 及继承虚拟事件的原文、回复和上下文保持隔离；公开文字 DTO 用 `sourceDomain:virtual_action|virtual_context` 与 `canSuggestMemory:false` 保留这一边界。事件记忆按同人物、当前 `worldId+worldVersion` 检索并保留完整引用，迁出再迁回不会重用旧阶段的场景经历。删源或删原事件回复会停止该事件及其衍生上下文的模型使用，仍保留的聊天正文不被改写成时间倒流。

模型出处使用 `promptVersion:'person-world-actions-v1'`。当前提供方另存 `promptRevision:'recipient-v2'`，明确用户可以是叙事受众，而唯一执行者仍是当前 persona；不能把其他人物的行动纳入执行。初稿出处省略该修订字段并继续保留。真实验证共八条回复：初稿四条回复保留，其中明确行动原请求被误判为 `chat`，没有正式事件，原失败证据未覆盖；新稿四轮的首次实际调用产生一份执行事件，后续回忆实际引用该事件，否定与假设两轮没有新增事件。未知受理案例沿原意图找回同一任务；该任务实际被 Worker 领取一次（`attempt_count=1`），在模型调用前因权限阻断，不能把它记作零次领取。

数据权利新增 `worldEvents` 与 `worldActionJobs`，行字段沿数据库命名，计入统一导出预算与 revision；导出有效事件及必要任务来源，不要求重新授予行动用途。源删除后有效事件不再导出，历史任务仍可保留在导出中。账号擦除覆盖正式事件、相关任务、消息、命令、Outbox 和物理队列。恢复校验核对历史授权、原消息／回复／任务／事件、永久回执、场景及来源闭包，保留成功事实并隔离未完成任务；校验报告只含数量，不输出正文。

隔离 PostgreSQL 测试已覆盖 pending 来源隔离、提交／删除竞态、撤权重授、真实锁等待后的租约过期，以及记忆检索等待期间删除事件来源后 provider 零调用。真实原页面与本机闭环已完成，详见[虚拟行动验收记录](../../../docs/backend-api/conversations-memories.md)：八库179表实际恢复、源库未变及副本清理通过，`releaseReady=false`。行动用途撤回后完成第一次七域导出，包含1份有效事件、9份任务；删除源后再次七域导出，有效事件为0、历史任务仍为9份。

原UI注销及独立擦除回读已完成：69张私有表、相关物理队列、账号对象前缀和实际 Logto 用户的该账号剩余记录均为0，保留17份必要围栏／收据。15个源服务角色已恢复基础配置，专用模型 scope 已移除，活跃工作为0。此次新测试账号均已擦除，不可重跑或复用；隔离验收档案与备份仍按恢复规则保留。本机首片通过不等于世界剧情整模块完成，也不表示生产发布。

### R01 原围坐与各自记忆

`010_gather.sql` 扩展统一会话／消息，新增 `gather_reply_jobs/gather_reply_participants/gather_reply_slots`。direct／gather 的目标和消息归属由原生复合 FK、互斥检查及唯一回复槽约束；旧直聊任务仍只属于 direct。围坐一轮在账号围栏锁下同时接受用户消息、序号、永久命令、固定名单、槽及 `gather.reply.v1` 队列。名单按 SHA256(clientMessageId + ':' + personId) 排序，最多三位；每个 slot 独立租约和最多三次实际尝试，后台有限重试，不重跑成功槽。API／Worker 启动检查 010；没有增加进程。

CHAT-02 支持 `{kind:'gather',worldId}`，新建／发送要求当前 enabled 世界至少两位居民。已有会话零居民仍保留历史、原 UUID 和 `canSend=false`。POST 文字仍是 1–4000 Unicode 字符；返回 `generationKind:'gather_reply'`，对应 GEN 请求加 `?kind=gather_reply`。GEN 返回部分 `replyIds` 和 `participants` 最小状态；原界面不新增重试按钮或任务面板；等待与失败沿原轻提示。未知结果固定原完整意图和键，已接受重放不重新选人、不要求恢复生成许可。

普通保存与读取要求 `storyStorage`，新生成另外要求独立 `gatherReplies`。受理捕获准确授权版本；若当时旧文字 AI 有效，才捕获 `memory_ai_authorization_version` 并读取当前发言人的珍藏／自动长期记忆。没有旧 AI 时这些接口零调用；已捕获时缺失配置／适配明确失败，不把依赖缺失当空记忆。每槽只使用自己参与过旧轮次的最多 20 条共享文本和当前用户消息；不会读取本轮别人的新回复、任何原始私聊、书信或照片。模型保留真实作者与 AI 标识，移除人物在模型历史与页面均泛称。

共享旧回复继承的私有记忆仅按原 owner 调用 Boolean 校验，每批最多八条，不加载其他人物正文。持久化只有消息／记忆的引用版本、最小人物版本、世界引用及 OpenAI provenance；不复制人物故事。继承消息来源最多 1000、记忆引用最多 64，超限明确失败。撤权重授、迁出迁回、源删除、Worker 中断或晚到输出均经过权限、来源与 attempt／lease 复核。普通资料更新允许领取时使用当前版本，模型期间变化阻断提交。共享历史不会自动提炼或珍藏。

首页摘要、完整字面搜索和 UUID 锚点同时支持 direct／gather。搜索 hit 新增 `conversationKind`；围坐 `personId:null` 且 `worldId` 必填。人物移除不使整段世界历史 404，当前不可链接作者不返回 personId。导出增加 `gatherReplyJobs/gatherReplyParticipants/gatherReplySlots`，原文、来源与任务计入同一预算／revision；注销覆盖新表和物理队列。恢复副本保留成功来源并隔离未完成任务，不自动执行。

隔离测试包含真实 PostgreSQL／Nest／pg-boss、隐藏子进程强杀后的新 attempt、各人物私有记忆隔离、未参与轮次排除、部分成功、撤权／迁回／删除／擦除晚到、完整搜索及 SDK 拦截。隔离测试与原页面验收分别记录。新增专用合成账号已完成真实围坐回复、刷新／摘要／完整搜索 UUID 定位与原气泡删除；实际丢失一次已受理 202 响应后，在居民由两位迁至零位并刷新页面的情况下，仍沿原键／完整请求／同一回执重放，未重复保存或选人。撤回旧文字 AI 后产生两条仅资料回应，私有记忆引用为零；围坐许可撤回阻断剩余槽、重授不复活，文字保存 403／重授边界及七域导出通过。

真实质量证据保留首次结果：各自记忆暗号首轮命中 3/4，原完整命中判定仍为 false；唯一一次明确澄清后命中 4/4，未串入其他人物的私有暗号，跨轮引用继承闭包核对通过。两条直聊和两份各自自动记忆为真实来源，不能把后一次结果改写成首轮全中。八库原生恢复结果见[围坐恢复记录](../../../deploy/recovery/README.md#r01-围坐原生恢复记录2026-11-14)。本轮原入口注销与独立擦除回读已完成：63 张私有表、3 个物理队列的该账号剩余记录为零，七域删除回执及身份提供方删除回执完成，必要删除围栏保留。Android 安装版与生产发布未验收。

### R01 原书信与真实回信

`009_letters.sql` 增加独立 `letters/letter_reply_jobs/letter_replies/letter_read_cursors`。原信不进入聊天消息、自动记忆或珍藏来源；现有 Worker 同时消费 `letter.reply.v1`，不增加进程。API 与 Worker 启动均检查 009 四表。共享基线见[书信实施基线](../../../docs/backend-api/conversations-memories.md)。

`POST /v1/persons/:personId/letters` 接受 `{clientLetterId,body,replyMode:'none'|'now'|'next_morning',timeZone?,sourceMemory?:{id,version}}`，原信去首尾空白后 1–10000 Unicode 字符。使用同一 Idempotency-Key 和完整意图恢复未知结果；永久 clientLetterId 防止换键重复建信。已接受重试回读当前信件，不重新绑定 AI 授权或再次派发。none 只保存原信。

`017_letter_memory_source.sql` 为从珍藏打开的信记录可选原文版本。启动新版本前，应用 Conversations 017 并部署支持 `POST /internal/v1/persons/:personId/letter-memory/validate` 的 Memories。新关联核对私人故事存储授权以及同账号、同人物、仍可使用的原文版本。回信还在模型调用前和写入时复核原文。版本已变、删除或原文访问撤回时，未生成的回信终止，保存的原信与已提交回信按书信权限回读。Memories 仅返回是否匹配，回信模型收到的是用户确认的原信。

`GET .../letters` 使用默认 20、最多 100 条的签名分页；游标绑定账号、人物、页长和全结果 revision。完整历史最多 1000 封及 8MiB JSON，超限 `413 LETTER_HISTORY_TOO_LARGE`，变化 `409 SOURCE_CHANGED`。`GET .../letters/:id` 回读同形单封。DTO 包含原信、clientLetterId、时间偏好、任务状态／failure、真实回信和 unread；`reply.sequence` 是精确十进制字符串。`POST .../letters/read {throughReplyId}` 使用稳定幂等键，按同人物回信序号原子推进。前端完整回读快照后确认；更新较旧游标不会清除后来的来信。`DELETE .../letters/:id` 使用 If-Match 与永久键，删除不要求重新授予存储权限。

普通保存／读取要求 Identity `letterStorage`；生成另外要求独立 `letterReplies` 和人物文字 `storyStorage`，不用旧 aiTextProcessing 冒充授权。受理固定账号访问及三用途版本；撤回重授不恢复旧任务。每轮协调有界轮转检查未来排程的当前权限，依赖超时保留等待，确定失权使旧任务 blocked。已提交回信在回信用途撤回后仍按 letterStorage 可读。

next_morning 使用 PostgreSQL 受理时间和时区数据库，取严格晚于受理的第一个当地 08:00；不存在实际 08:00 的日期跳过。存定 UTC 后不随客户端时钟／时区移动，pg-boss startAfter 与业务 due 检查共同防止早跑。每次领取使用当时的当前人物和虚拟世界；仅本封原信、必要人物文字、当前虚拟世界及最近已提交迁居进入独立书信 provider。不会读取聊天、其他信件、珍藏、自动记忆或图片。

模型调用在锁外，返回前后复核来源、人物／世界与精确授权，提交由本库尝试与租约保护。最多三次业务尝试，短暂错误有限退避，进程中断可以恢复；失败不补模板。真实回信最多 4000 Unicode 字符，同一封信只提交一份回信，序号、回信事件与成功任务同事务。必要模型来源使用 `person-letter-replies-v1`，不保存密钥。外部模型调用不是恰好一次。

导出新增 `letters/letterReplies/letterReplyJobs/letterReadCursors`（各行保留数据库字段名），包含未删除信、实际回信、必要排程／任务来源和已读位置，统一计入 20MiB 预算与 revision；无需重新授予书信用途。擦除先围栏，清理四表、永久命令、事件和物理书信队列，迟到模型结果不能复活。恢复副本必须保留已提交内容和来源、隔离未完成任务，不能自动补跑旧包。

专项测试使用随机 PostgreSQL／pg-boss schema、真实 Nest HTTP 与 SDK fetch 拦截，覆盖固定键回放、跨账号／人物、时区跳日、完整分页、乱序已读、撤权重授、人物／来源失效、有界重试、真正杀掉 Worker 子进程后的恢复，以及独立导出／擦除。模型拦截和隔离测试不代替真实模型及原页面验收。

### K05 数据权利

新增 `003_data_rights.sql` 保留已应用的 001/002。独立配置 `XIJIE_DATA_RIGHTS_SERVICE_TOKEN` 才开启内部 `GET /internal/v1/accounts/{accountId}/data-export?requestId=UUID&scope=interaction_data|account_data` 与 `POST .../erase`，不经前端代理；未配置为404。每次用本服务原有 Identity 凭据核对权利申请当前归属、用途和账号状态。

导出为本库可重复读快照，保留当前可读会话和消息的原文、作者、时序及关联ID；已移除人物对应历史、已删除消息、命令、队列和普通旧聊天模型任务内部状态不导出。独立书信、围坐、单图及本片虚拟行动按各章节导出必要任务与来源；虚拟行动增加有效 `worldEvents` 和 `worldActionJobs`，后者可保留已删除原消息对应的历史任务。`revision=SHA256(JSON.stringify(data))` 与捕获时间分离，统一20MiB上限，超限413，不返回不完整成功。人物访问在快照前后核对。

擦除在本地账号写入围栏锁内清除全部私聊原文（含逻辑删除残留）、生成任务、pg-boss物理投递、命令及Outbox，只留最小账号/申请/时间回执。INSERT/UPDATE触发器同样经过门闩，旧远程授权、旧RR快照和迟到Worker都不能重建数据。HTTP已处理被清理后的缺失任务行；其他账号与其队列保持原状。擦除申请须为delete_account且账号deletion_pending/deleted，`Idempotency-Key`等于正文requestId。

运行前先部署Identity权利申请context，再由主任务迁移/重启。本片真实PG/Nest/pg-boss和旧Worker恢复回归已通过，未替代前端、安装包及生产部署验收。

需要 Node.js 22.12+、pnpm 10.34.3 和 PostgreSQL 16。复制 `.env.example` 为本机忽略的配置文件，设置独立数据库、三个服务一致的内部凭据、Identity/People 地址和前端 Origin。数据库账号需要创建业务表及 pg-boss 专用 schema 的权限。

在本目录依次执行：

```powershell
pnpm install --frozen-lockfile
pnpm build
node --env-file=.env.local dist/migrate.js
node --env-file=.env.local dist/main.js
```

另一终端启动 Worker：

```powershell
node --env-file=.env.local dist/worker.js
```

迁移采用事务、advisory lock 和已应用 SQL 的 SHA-256 校验，禁止修改已应用迁移。API 默认监听 `127.0.0.1:3103`，由现有前端开发代理转发；外部入口应使用 HTTPS 和精确的前端 Origin。启动不需要配置模型。

## 本轮接口

| 方法与路径 | 行为 |
| --- | --- |
| `GET /v1/conversations` | 本人 active 人物与最近直聊合并，并包含实际存在的世界围坐；可选 kind 过滤与分页，当前无消息的人物仍可进入直聊 |
| `POST /v1/conversations` | 按人物创建／返回唯一私聊，或按世界创建／返回唯一围坐；首次 201，已存在 200 |
| `GET /v1/conversations/:id` | 当前会话、版本、是否可发送 |
| `GET /v1/conversations/:id/messages` | older 倒序/ newer 正序；字符串 sequence、签名游标及增量 afterCursor |
| `GET /v1/conversations/:id/messages/:messageId/context` | UUID 锚点窗口，默认 20、最多 100 条，升序且包含有效锚点；返回两侧续读游标 |
| `GET /v1/search?scope=conversations&q=...` | 每个可读直聊／围坐的最新匹配消息，按该会话最新可读活动排序；关键词 1–160 Unicode 字符 |
| `POST /v1/conversations/:id/messages` | 接受 1–4000 Unicode 字符的文字，202 返回 message 和 generationJobId；围坐另带 generationKind=gather_reply |
| `DELETE /v1/conversations/:id/messages/:messageId` | If-Match 版本保护的逻辑删除，并取消未完成的源消息回复任务 |
| `GET /v1/generation-jobs/:id` | 读取权威任务状态、replyIds、失败原因和可否重试 |
| `POST /v1/generation-jobs/:id/cancel` | 取消 queued/running 任务；已结束的任务返回当前状态 |
| `POST /v1/generation-jobs/:id/retry` | 同业务任务重新排队，物理 dispatch ID 独立，最多三次业务尝试 |

成功信封为 `{data,meta?}`，错误为 `{error:{code,message,requestId,details?}}`。写请求需要原站 `Origin` 和 UUID `Idempotency-Key`。客户端可携带 `X-Xijie-Expected-Session` 拒绝切换账号后的旧请求。删除需要 `If-Match: "v1"` 等版本；会话/任务读取返回 ETag。游标绑定账号、会话、方向、页长，不能跨范围复用。afterCursor 绑定 newer 方向，页长应保持一致。

围坐 GEN 读／取消／重试接口均使用 `?kind=gather_reply`；显式重试也只能处理原名单中未成功、仍合格且有预算的槽，原 UI 不增加该操作入口。

同一客户端消息 ID 和同一请求参数不会重复建消息或任务；内容变化返回 409。消息接受、任务、实际 pg-boss 入队及 Outbox 事件在一个 PostgreSQL 事务提交。排队失败整体回滚。Outbox 当前是可靠事件记录，本轮未实现跨服务事件投递器。

## R01 原会话历史搜索与定位

本服务拥有 `scope=conversations`，`scope=atlas` 仍由 Memories 拥有，入口代理须按 scope 分流。搜索保持原 trim、大小写不敏感的字面包含匹配，保留标点和内部空格；没有 NFKC、中文词对、语义推断或 SQL 通配符。SQL 在当前账号完整未删除文字历史中以参数化 `strpos(lower(text),needle)>0` 过滤，再选每会话最新匹配；不会把最新 50 条当作完整历史。礼物候选只经 `giftMessage` 权威读取后，以原 `[礼物] 送出/收到 名称 ×数量 · 附言` 或英文同形文案匹配。来源 403/404 跳过并继续找更早命中；503 明确失败。

搜索返回 `{kind:'message',id,conversationKind,personId,worldId?,conversationId,messageId,sequence,version,messageKind,title,excerpt,author,createdAt,lastActivityAt}`。direct 的 title 为当前人物称呼；gather 的 personId 为 null、worldId 必填，title 为当前世界名称。片段来自实际可见消息，sequence 保持十进制字符串。人物资料匹配由前端与当前 People 数据合并，搜索不创建会话。排序为最新可读消息的 createdAt 降序，再按 direct 的 personId／gather 的 conversationId 升序；命中消息自身的时间不决定会话排序。HMAC 游标绑定账号、trim/lower 查询、locale（zh-CN/en）、limit 和完整结果 revision。revision 包含命中、实际源版本及读取所用账号／人物／世界居民 revision／用途版本；结果变化、撤回再授予后旧游标返回 `409 SOURCE_CHANGED`，不混合两轮分页。AI 授权不进入历史检索门禁或 revision。

锚点窗口默认 20、最大 100，包含精确 UUID 锚点，尽量均分前后并在边界补足。items 升序；beforeCursor 和 afterCursor 分别只续读 CHAT-04 的 older/newer 方向，页长必须相同，没有更多时为 null。锚点已删、跨账号／会话、直聊人物不可用或来源失效时明确拒绝，不以邻近消息替代。客户端应等真实锚点 DOM 出现后再定位，保存窗口及扩页，避免近期轮询覆盖用户正在阅读的位置。

普通文字历史、搜索和文字定位要求当前 storyStorage；AI 撤回不影响已保存文字的读取。CHAT-04／摘要按用途过滤：story 撤回时不返回文字，giftStorage 仍允许时继续按 Gifts 独立规则读取寄件卡，来礼保留原 story/gift/return 条件。两种读取用途均不可用才 403；过滤后的真实空页保持空页。远程调用不持有数据库事务，返回前再次核对当前人物、账号及实际使用的用途版本、消息版本与删除状态，礼物重新核对源版本。最后一次权威检查与响应间仍存在跨服务竞态窗口，不宣称原子撤权。

本片不增加表、迁移、索引、副本、查询记录或模型派发。单次读取最多处理 1,000 条候选／观察记录，人物范围最多 1,000，完整结果／窗口的 JSON 预算为 2 MiB；超限返回 `413 HISTORY_TOO_LARGE`，不静默截断。文字 SQL 仍需扫描账号范围的匹配数据，现有索引不保证任意数据规模下的延迟。隔离 5,002 条合成历史的 EXPLAIN ANALYZE 返回一条最终命中，当前本机查询约 1 ms；这仅是该测试规模证据。

本片编译和全套 92 项隔离 PostgreSQL／Nest／pg-boss 回归通过，其中新增 8 项覆盖深层历史、符号及 Unicode、精确 bigint 顺序、分页 revision、礼物权威来源、用途独立、锚点删除与最后一次 People 读取期间的撤权交错。未运行真实账号或模型；原 UI 完整联调由主任务独立验收。

## 普通聊天 Worker 与权限边界

本节说明文字私聊的上下文、授权与显式重试；围坐使用上方独立用途、各自记忆范围与每槽有限后台尝试。书信使用上方 R01 章节的独立用途和有限后台重试，不读取聊天、珍藏或自动记忆，也不使用聊天 GEN 管理接口。

K04 部署后通过 `XIJIE_MEMORIES_URL` 读取当前人物的已确认记忆片段，并放入模型引用数据。相关片段最多八条、每条正文最多 1200 字符；无相关片段时使用最近四条。生成前、写回前分别读取同一查询的记忆 ID/版本，集合或版本变化时阻断旧回复。依赖不可用时保留原消息与可重试失败，不以空记忆绕过检查；未配置此可选服务时仍兼容 K03。此机制复用原“珍藏后 TA 会记得”的交互提示，不把未确认候选当作原文。

队列只保存业务 job ID，Worker 从自己的数据库重建账号、人物和源消息上下文；不保存 Cookie。生成前和写回前分别查询当前账号状态、人物版本/访问版本、存储授权版本及独立的 AI 文字处理授权版本。人物移除后会话历史和任务读取立即通过当前 People 权限检查返回 404。

K05 首片复用 Identity 的 `ai_text_processing` 用途。内部 session/account context 必须包含合法 `aiTextProcessing:{allowed,authorizationVersion}`，缺失或格式不合法按依赖不可用拒绝。新 send 或显式 retry 在实际创建派发之前验证 AI 授权，返回 `403 AI_PERMISSION_REQUIRED` 时不创建新消息／任务。迁移 `002_ai_text_authorization.sql` 为任务保存 `ai_authorization_version`；已有任务值为 0，不会继承后来授予的权限。Worker 在读取上下文前、实际发起模型前、模型返回后及写入前核对同一版本，撤回或撤回再授予均使旧任务进入 `blocked / AI_PERMISSION_REQUIRED`。明确的新业务 retry 才可以在重新取得权限后采用新版本，blocked 任务不会自行恢复。

历史回读、删除和取消不要求 AI 授权。已受理 send 的同键或同客户端消息回读、已受理 retry 的同键回读只返回原资源，不触发新的模型调用，因此不会因撤回 AI 用途而误报成新的申请。AI 授权撤回不修改存储授权，也不删除已经保存的消息和珍藏。

已获文字 AI 授权的直聊遇到规则覆盖的明确当下自伤表达时，服务将原文与 `blocked / SELF_HARM_SUPPORT_REQUIRED` 同时保存，界面可展示独立的支持提示。该消息不进入后续直聊模型上下文或自动记忆抽取；旧队列在模型调用前也检查当次原文。规则只覆盖部分简中和英文的第一人称当前表达，并排除引用、回顾、假设和否定等场景，识别结果仅用于本次直聊的产品处理。

本库通过 attempt ID、状态、有效租约、源消息可见性和唯一回复约束阻挡取消、删除、旧进程迟到结果。写回在会话锁内复核实际送入模型的全部消息 ID/版本，旧上下文消息被删除后任务进入 `blocked / CONTEXT_REVOKED`。45 秒业务租约配合 60 秒队列超时及有上限的物理重投恢复进程崩溃。正常模型失败保存失败状态并确认当前队列投递，等待显式业务重试，不在后台反复调用模型。

正常关闭时中止外部请求，把当前 attempt 释放回 queued，并让 pg-boss 重投；不会把升级重启误记成模型超时。Worker 启动时及每 10 秒复核最多 50 个过期任务，使用 pg-boss `findJobs` 和同一事务连接检查实际投递；物理重投已终止且没有活跃投递时，业务任务归并为 `failed / DELIVERY_EXHAUSTED`。业务最多三次尝试，耗尽后不允许继续重试。

Identity/People 权限复核与本库写入分属不同数据库，最后一次上下文响应和消息提交之间存在竞态窗口；本实现不提供跨库原子撤权，也不能召回已经发给模型提供方的请求。每次读取均再次检查当前权限。本片接通版本化 AI 用途决策与运行门禁，生产发布仍需独立完成提供方、政策范围和运行配置的验收。

## R01 迁居上下文

People 的 `007_world_movements.sql` 与本库 `005_virtual_world_context.sql` 须先迁移。原迁居按钮仍调用 People；本库不写其他领域的表，也不因聊天中的愿望执行迁居。生成经 `GET /internal/v1/persons/{id}/world-context` 取得明确标为 `virtual/main` 的当前世界、独立世界版本和最近八条已提交迁居，校验完整版本链及规范 JSON 摘要。旧任务的 `world_context_ref` 保持空，不补造历史。

生成前、模型返回后、实际写回前核对当前快照。迁居、往返迁居、世界目录变化或人物版本变化会阻止旧结果写回。近期提示排除世界引用已失效的历史 AI 回复；已迁居人物也排除没有世界引用的旧 AI，页面历史与用户消息保留。普通画像编辑不改变世界摘要，仍受独立人物整体版本保护。实际世界引用随成功任务保存并进入数据导出；账号擦除覆盖相应任务。远程权威核对与本库提交之间仍有 RPC 窗口，不能宣称跨库原子一致。

迁居无需允许 AI，后续文字生成使用既有 AI 文字授权及开发运行名单。自动世界剧本、平行分支、小聚、私人动态、图片及书信均不在本片范围。共享契约见[迁居与文字聊天接续首片](../../../docs/backend-api/conversations-memories.md#r01-迁居与文字聊天接续首片2026-11-12)。

## 模型配置

### 私聊合成朗读试点

合成朗读独立于原声样本、浏览器朗读和通话，默认关闭。依次部署 Identity 的 `035_chat_reply_speech.sql` 与 Conversations 的 `016_chat_reply_speech.sql`。受控启用时设置 `CONVERSATIONS_SPEECH_ENABLED=true` 和明确的 `CONVERSATIONS_SPEECH_MODEL`（目前支持 `gpt-realtime-2.1-mini` 系列），重建前端时才设置 `VITE_CONVERSATIONS_SPEECH_ENABLED=true`。仍需现有正式模型开关、允许账号、私有凭据和独立用户授权。合成结果来自后台的一次文本转音频请求，不使用麦克风、人物原声及其他对话资料。

用户可对短于等于 240 字符的单条已保存私聊 AI 文字回应明确请求朗读。后台对同一回应版本及授权版本仅接受一个任务，未知调用结果不会自动二次发起模型调用。后台核对提供方回传的转写后，保存不超过 45 秒的私人 WAV 音频。试点每账号最多有四条待处理或可播放音频。重复播放读取原文件。撤回授权、移除内容、账号擦除和隔离恢复都会阻止正常读取或继续发布。合成文件可随有效源消息导出，账号擦除直接清理。标准音色、实际发音、模型计费和设备播放仍须通过获得授权的正式提供方实测。

聊天与书信的独立适配器使用固定版本 AI SDK 和 OpenAI-compatible provider；只有 `MODEL_BASE_URL`、`MODEL_NAME`、`MODEL_API_KEY` 全齐才配置。缺失配置时，聊天保留用户消息并将任务标记 `failed / MODEL_NOT_CONFIGURED`；书信保留原信，按自己的最多三次业务尝试预算记录失败，不生成模拟回复。

现有私密故事存储授权不代表可向模型供应商发送资料。聊天适配器要求合法且已允许的 `aiTextProcessing`，书信适配器要求独立 `letterReplies`；各自 Worker 另核对该任务的存储、人物与精确授权版本。两者随后都核对 `MODEL_ALLOWED_ACCOUNT_IDS` 本机联调运行名单。名单不能替代用户同意；默认空列表仍拒绝运行，`NODE_ENV=production` 仍关闭本机测试机制。本片政策限于 OpenAI，实际适配器只允许 `https://api.openai.com/v1`（可有末尾 `/`）；其他模型地址在已有同意下不会发送资料，须另行发布对应范围的政策与配置。不可把真实用户批量加入测试列表。密钥放本机忽略配置，不提交、打印或写入队列/模型请求 body。

请求转换中，文字私聊使用 `max_completion_tokens:1000`，书信与围坐分别使用独立 provider 的 `max_completion_tokens:3000`；三者均为 `store:false`，GPT-5/GPT-6 使用 `reasoning_effort:none`。模型调用不持有数据库事务，禁用 SDK 自动重试，30 秒请求超时，取消传播 AbortSignal。书信和围坐的最多三次实际尝试由各自业务任务调度器控制，不是 SDK 隐式重试。

## R02 寄件与收件卡片

006/007 为原寄件卡增加 `kind:gift`、`gift_delivery_id` 和受约束的 source projection。增量 `008_received_gift_cards.sql` 增加独立 `gift_received_id`，将必须绑定本库 reply/job 的 persona 约束保留在普通 `kind:text` 上；incoming gift 使用真实人物身份和独立 AI 回礼来源，不伪造聊天 generation job。

仅 `XIJIE_GIFTS_SERVICE_TOKEN` 可调用 `POST /internal/v1/gifts/conversations/ensure`、`PUT /internal/v1/gifts/deliveries/{id}` 和 `PUT /internal/v1/gifts/received/{id}`。ensure 对 account/person 保持唯一私聊。收到投影后，本服务分别以 Conversations 凭据回查 Gifts 的 `/internal/v1/gifts/deliveries/{id}?accountId=...` 或 `/internal/v1/gifts/received/{id}?accountId=...`，核对当前 owner/person/conversation、完整 source DTO 和版本。HTTP 复核在本库锁外完成；事务只写本库卡片、时序和事件。

旧 outgoing 公共形状继续是 `gift:{deliveryId,...GiftDelivery}`、`author:{kind:'self'}`。incoming 为 `gift:{direction:'received',receivedGiftId,...ReceivedGift}`，`author:{kind:'persona',personId,displayName,aiGenerated:true}`，两者均 `text:''`、`canSuggestMemory:false`。来礼的 `origin` 指向真实 Gifts generation job，原始人物故事、模型输入和提供方证据不进入卡片 DTO。来源版本更新只更新同一卡片，保留 message ID 和 sequence；已删除卡片的墓碑不会因拆开／陈列更新而复活。

先部署 Identity012 的独立 `giftReturns`、People 专用回礼来源和 Gifts002。incoming 读取同时检查当前文字保存、赠礼保存、回礼授权以及 Gifts 捕获的精确版本；撤回或版本改变后旧来源不可读，不以重新 grant 恢复。不可读的 403/404 卡片会跳过，普通文字历史、最近摘要和分页仍推进；真实依赖故障不伪装为空。所有 gift 继续排除普通模型历史、自动记忆事件／来源验证和珍藏提取，收件不会递归触发回复或回礼。

导出消息包含 `giftDeliveryId` 或 `receivedGiftId` 引用；完整来礼、实际生成证据、拆开／陈列和通知状态由 Gifts 导出。本域账号擦除清除投影及删除残留。恢复验证 incoming 的 sourceDelivery/received/job、人物会话归属、不可变快照和卡片版本，保留合法落后的投影；通知已读和礼物拆开仍由 Gifts 分开处理。

此增量构建与 Conversations 84 项隔离 PostgreSQL／Nest／pg-boss 回归通过，包括 incoming 真实性、原寄件兼容、文字约束、模型／记忆排除、删除墓碑与数据权利。它不替代正在进行的真实 AI、原 UI 和新事实恢复验收。

## 验证

```powershell
pnpm build
node --env-file=.env.local --run test
```

设置 `XIJIE_TEST_DATABASE_URL` 指向专用集成测试库。测试创建随机业务/队列 schema 并自行清理，不依赖真实账号、人物或模型密钥。覆盖真实 PostgreSQL、pg-boss、Nest HTTP、并发序号、客户端/传输幂等、队列回滚、分页/CAS、跨账号隔离、取消/删除/撤权迟到结果、租约接管、正常关闭重启、杀死独立 Worker 后实际队列重投及多次崩溃耗尽后的终态归并。崩溃测试只推进自己的过期时间戳以缩短等待；Windows 正常关闭测试使用 IPC 调用与 SIGTERM 共用的关闭处理函数。

模型适配测试通过实际 SDK 的 fetch 注入截获请求，验证独立同意、本机额外运行限制、提供方范围、厂商参数及返回解析；这些固定响应不等于真实模型验收。新增授权测试还覆盖旧任务版本 0、排队与执行中撤回、撤回再授予、提交前再次复核、幂等回读与显式重试、缺失或畸形内部上下文。正式供应商连通性和现有前端端到端联调需另外使用明确授权的合成测试账号完成。K03 原片不包括群聊、图片、语音、书信、SSE 和支付；书信现由上方 R01 增量接入。

本片整体验收现已完成：原UI真实OpenAI回礼、收件与通知、撤权后的七域导出、八库165表恢复及合成账号注销清理均通过。测试开关与名单已关闭，仍仅为本机合成验证；详见[交付接续](../../../docs/backend-delivery-priorities.md)的2026-11-13回礼记录，替代上文进行中的状态说明。


### R01 分支与离线生活（2026-11-15 本机验收完成）

013新增人物故事分支、独立分支消息/任务/事件，以及显式离线生活计划/执行来源。分支只从main当前末端建立，场景冻结为建立时People世界卡片；主线迁居不移动分支，其他分支和主线后来内容不进入本线。共同正式事件保存原引用及截止revision，删除沿跨线来源传播。分支聊天从存储层与旧用户事实自动记忆分离，仍可使用当前人物文字资料及已授权珍藏。

storyBranches与offlineLife来自Identity021独立用途，均需private story与旧文字AI；main离线生活另需worldActionProcessing。已保存内容依story读取；撤回、重授、暂停不会复活旧任务。离线默认关闭，首次启用固定IANA时区每日08:00；授权内持续，暂停随时生效。每人物UTC日及本地日唯一、24小时最多一次，漏日不补跑，无进展仍消耗当次；每次最多3次实际attempt。离线来源是plan/run，不创建用户消息，不发资产、不迁居、不公开。

Conversations Worker增加story.reply.v1和world.life.v1队列；真实SDK仅非生产名单内OpenAI、store:false、maxRetries=0。provider分别记录person-story-branches-v1/person-offline-life-v1，none不伪造事件。主线正式事件仍由person_world_events拥有，source_kind区分text与offline_life，现有文字来源约束保持。

导出新增storyBranches/storyMessages/storyJobs/storyEvents/offlineLifePlans/offlineLifeRuns，注销含六表及两条物理队列；恢复须保留成功来源和共同历史，隔离未完成任务并禁用所有离线计划。最新Conversations223/223隔离回归与相关编译通过；本片恢复23/23、统一八库210表原生恢复通过。全新合成账号原UI完成两条分支、主线迁居后的冻结场景、六份真实OpenAI结果（含自然UTC08:00一次离线经历）、准确主线回忆、撤权旧任务阻断、来源递归失效、两份七域导出及最终注销。独立核验93张私有表、队列、对象和实际Logto用户清理，17行必要围栏／回执保留；专用scope删除、worker恢复base。未知回包实际通过一次POST后的权威历史读取恢复，未冒称第二次同键POST；工具失败证据保留。正式DTO、恢复备份/run及未验证边界见[当前R01契约](../../../docs/backend-api/conversations-memories.md)。仍不代表Android或生产发布。


### X01 有界 AI 语音通话

Identity027 与 Conversations015 增加独立 `person_voice_calls`、`voice_call` 中央预算用途及 `call_sessions/call_grants`。服务端 `VoiceHub` 代理官方 OpenAI Realtime WebSocket，浏览器只持有同源的 10 秒一次性 WS grant；私密模型 key 不进入 URL、客户端、DB 或日志。现有原通话界面使用真实麦克风、WebAudio PCM24k 和双向音频，静音停止上传、打断发送真实 cancel，扬声器开关改变实际播放增益。标准音色偏好 warm/bright/deep 分别选 marin/coral/cedar，不使用已保存的原录音，不克隆声线；语气偏好只作为用户偏好传入。

默认 `VOICE_CALLS_ENABLED=false`，`VOICE_MODEL=gpt-realtime-2.1`，`VOICE_CALL_MAX_SECONDS=60`（1–120）。实际运行还需共享 `MODEL_EXECUTION_ENABLED`、运行范围、官方 key 和各自当前用途授权；生产需显式批准及当前 production v2 grant，旧文字或合成授权不会自动开启语音。生产 key 必须来自私有绝对 `MODEL_API_KEY_FILE`；Identity 每次实际尝试计入持久日预算，语音独享 150 秒 lease，其他模型仍为 45 秒。

创建、客户端计时或模板回复不能标记接通。只有实际提供方 `session.created/session.updated`、配置验证及当前来源复核通过才记 DB startedAt；可信正常关闭才记 endedAt/整秒时长。来源每 2 秒复核，超过 3 秒无法确认则断流；期限到达立即停转发。无法确认结束、失去 lease 或重启恢复均保留未知时长，不自动重连。只保存元数据；短暂音频和 AI 字幕不落库，不进后续模型或自动长期记忆。原影像为明确的动态资料照片预览，不调用麦克风／摄像头或视频生成。

元数据通过 `GET /v1/conversations/{id}/call-sessions?after=...` 每页 100 条按毫秒时间＋UUID 读全，在原聊天显示真实结束记录；撤回新语音处理不抹除依独立保存许可读取的历史。导出只含通话元数据、不含 WS grant/provider session credential；擦除清除两表，恢复删除全部 grants，并将活跃通话永久隔离为失败。生产入口需原 `/v1/conversations/*` 和 `/v1/call-sessions/*` 的 WebSocket 反代（Vite 与 Caddy 模板已包含）。

验证分开记录：隔离 PostgreSQL/Nest/真实 WebSocket 的授权、一次 grant、源版本、lease、未知结束、分页及数据权利通过；实际官方 SDK 协议的受控对端测试通过；Headless Edge 的真实 WebAudio 与原 CallOverlay 通过。一次获准的 5 秒官方 Realtime 合成探测在握手确认前超时、没有音频；未重试。不能据此宣称当前网络／凭据已真实接通。Android 真机麦克风、系统路由、前后台切换及正式模型和域名，仍须实际环境验收。
