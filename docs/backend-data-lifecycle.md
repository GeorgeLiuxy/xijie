# 西界数据生命周期与一致性评审

## 已实施增量：跨迁居的连续虚拟经历（2026-11-15，本机验收完成）

Identity019追加世界行动v2和默认false的历史事件能力，旧v1不自动扩大。People只读解析同人物历史阶段的不可变迁居快照；Conversations事件保持原发生worldId/worldVersion，仅新版可引用更早main阶段，当前执行场景仍精确核验。旧阶段双方行动／回忆正文不重新参与当前聊天，必要人物资料直接输入，画像自动派生条目及其传递谱系不进入新版事件输入；既有更正／删除／撤权失效规则不豁免。事件表与导出形状不变，无跨库事务。

原UI真实模型A→B→A保存2事件／4回复，回忆不重做。撤用途后独立七域导出仍通过；删除第一阶段源使两个阶段的事件及3份继承上下文实际失效，后续导出排除有效事件而保留历史任务。原UI注销及69张私有表／队列／对象／实际Logto核对完成。八库179表原生恢复校验新历史许可与跨阶段谱系通过，源未变且未发布；备份早于后续删源与注销，未来发布必须使用最新权利检查点。详见[当前会话验收与旧记录边界](./backend-api/conversations-memories.md)。

## 已实施增量：明确虚拟行动与经历记忆（2026-11-14，本机验收完成）

Identity018新增独立`person_world_actions`／`worldActionProcessing`，新直聊只有同时获准story、旧AI和本用途才进入行动判定；旧任务不因后来授权改变用途。Conversations012将唯一行动源、正式`person_world_events`、事件记忆摘要、唯一真实回复及成功任务同库提交，People的人物／迁居版本不变。新源受理即标pending，只有最终普通chat且未引用虚拟事件时才开放旧自动记忆来源；执行、澄清及带事件谱系的文字不能混成user_reported或候选珍藏。

本片只在当前人物／世界／迁居阶段／main主线取有效事件。消息、事件、既有珍藏和自动记忆引用在检索后及模型前重验，提交在所有本库引用锁之后再查数据库租约。删事件源或原事件回复使事件及其依赖的后续事件停止用于生成；其余已保存聊天仍是历史，不宣称删除让虚拟时间倒流。撤回停止新处理和迟到提交，重授不复活旧任务；新任务对仍有效事件的读取须重新有本用途。

七域导出新增`worldEvents`与`worldActionJobs`，授权撤回不妨碍独立数据权利；新集合纳入20MiB前置估算和最终revision。账号注销先删除事件，再清原会话任务／消息及物理队列，保留擦除围栏。恢复保护所有状态的捕获用途、尝试预算、来源、模型出处及已成功事件，隔离只改可执行控制字段；实际两份七域导出、原UI注销及独立清理核查已通过：69张私有表、相关物理队列、对象前缀与实际Logto用户无残留，保留17行必要围栏／收据等。八库179表演练源未变、隔离副本清理且未发布；加密备份与验收档案保留，旧备份未来发布须重放最新删除／撤权检查点。详见[当前会话验收记录](./backend-api/conversations-memories.md)。

## 已实施增量：聊天单图与真实视觉回应（2026-11-14）

Identity016／017新增独立 `chatPhotoStorage` 与 `chatImageReplies`，旧授权不改义。Conversations011以 `message_media` 单张引用、`photo_reply_jobs` 及严格 `messages.photo_reply_job_id` 关联保存原图片与至多一份视觉回复；source仍是direct/self/photo，回复是带来源的direct/persona/text，围坐仍只接受文字。接受事实不可改，attempt最多3次；永久命令、消息序号、来源、任务与物理队列同库原子提交。图片及视觉文字不参与旧文字模型、自动记忆、候选珍藏或围坐上下文。

Media004新增 `conversation_attachment` 及 `media_conversation_grants`，精确锁定会话／clientMessageId。锁外内部HTTP预绑定60秒，本库锁后用数据库时钟检查截止；不使用旧表下文的跨域锁／同进程绑定示意。普通读取按当前story与照片许可、当前来源和短proof；视觉字节读取另需精确运行attempt／租约与捕获看图版本。撤权使旧上传／任务不可恢复，重新授权只可读取仍有效成品；删除源图片使proof与待办任务失效，但保留已保存文字回复，模型与记忆入口继续拒绝该视觉来源。

导出独立于普通授权，Conversations导出任务／来源，Media导出有效成品实际字节及绑定。注销先清物理图片队列并按本库deferred FK移除来源／任务，Media移除上传／成品对象与用途绑定，保留删除围栏。原UI七域导出、注销及只读核查通过：68张私有表、相关物理队列、7个已知对象key／账号前缀及实际Logto用户均无该合成账号残留。八库178表及对象原生恢复核对source／grant／哈希／历史授权与成功来源，未完成任务隔离逻辑另有反例测试；实际演练源未变，releaseReady=false。加密备份和受保护验收档案保留，不等同于在线账号数据。详细证据见[单图验收](./backend-api/conversations-memories.md)。

## 已实施增量：试用资产与真实寄件（2026-11-13）

独立 Gifts 领域拥有试用批次、账本、投递及可靠任务；该片覆盖下文旧“同进程人物／会话／账本事务”示意，不建立跨域外键或跨库 SQL 事务。服务端的 `asset_lots.balance_units` 与正数追加 `ledger_entries` 逐批次核对；账号门闩串行化扣减，锁后使用数据库当前时间核查到期，永久接受键与投递同存。单一来源不可静默切换，免费投递无需零额分录，失败冲正精确反转原批次且不延长到期。

Identity011 独立赠礼用途不扩大旧授权。未完成投递的 captured 授权或访问版本失效后停止并可靠冲正，重新允许不自动恢复旧任务／聊天卡。已受理但响应未知保留原键；人物归属、会话和投递均经各自权威服务校验，网络调用在 SQL 锁外。Conversations006／007 使用真实 gift kind，独立来源回读，不进模型、自动记忆或珍藏；删除后的卡片不可被抵达投影复活。只读资产 GET 不发余额，普通账号初始额度不自动发放。

配置 Gifts 后七域导出包含原始批次、分录、回执和聊天引用，任何缺域或来源修订不一致均拒绝完成；注销须等待全部域和身份提供方，Gifts 本库先围栏再清理纯试用流水、快照、任务与事件，仅留最小擦除收据。八库恢复验证全部批次余额、发放来源、扣减／冲正、每笔投递的真实人物／会话归属以及已有卡片的版本／快照／时间／分录引用，允许可靠投影尚未发生，不允许不一致卡片。恢复副本阻断全部可执行 Gifts 任务，保留账本／投递与成功任务，仍不自动发布。原生恢复和原页面实测结论见[交付接续](./backend-delivery-priorities.md)。

R02 回礼增量使用 Identity012 独立 `person_gift_returns`，普通文字 AI grant 不授权赠言处理。新寄件捕获 gift/story/return 授权版本，抵达后独立回礼 Worker 经最小 People 文字上下文调用 OpenAI；最多三次尝试（租约回收也计入），`none` 不制造来礼，失败不模板兜底。`gift_return_jobs` 保存来源、授权及真实模型证据，`received_gifts` 对源寄件唯一；完成来礼、通知、Outbox 与投影入队在 Gifts 本库提交，不增加可消费资产。当前人物改名／迁居不改写已有快照；在途模型发生人物／世界变更则停止旧任务。

`opened_at` 为空时 `placement` 为空；首次 open 设置一次服务器时间与 record，旧 open 重试不会覆盖 space。placement 使用 If-Match 和永久 `gift_mutation_receipts`，重试返回当前权威状态并保留原接受版本，不重新执行旧摆放。通知 read 只单向写首次时间。普通收件／incoming 来源读严格复核 captured 权限，撤回再重授不复活旧来礼的正常读取；独立导出仍包含这些资料。跨域 HTTP 前后复核无法等同跨库原子撤权，公开 source 的当前授权检查阻止旧结果被读取或投影。

导出新增来礼、必要生成来源、任务、通知、操作回执及通知所引用的事件，仍在同一有界快照内计算 revision。账号注销先围栏，再删 projection／notifications／mutation receipts／received／return jobs，随后原发件和流水；模型迟到结果不能越过围栏。恢复校验 source→真实模型任务→received→incoming 与通知事件引用，保留正文、opened/placement/read 时间和成功来源，只隔离所有未完成执行任务。新表缺失的旧包保持旧片范围，不由 arrived 源补造回礼。

## 已实施增量：空间私有图片（2026-11-13）

空间配图已按独立 Media 服务落地；下文早期媒体表及同事务绑定属于设计提案，不能据此建立跨服务 SQL 外键或宣称跨库原子提交。当前范围为私人空间的 1–9 张配图，不包含人物照片、聊天图片及音视频。具体字段、状态和约束以各域不可变迁移为准，接口以 [私人空间配图实施基线](./backend-api/identity-people.md) 为准。

| 权威数据 | 生命周期与一致性约束 |
| --- | --- |
| Identity 独立照片保存用途 | `private_photo_storage` v1 绑定确切告知事件和单调授权版本；不改变原告知 v4、文字保存 v2、AI v3 的决定。撤回阻止新上传、发布及读取，不删除已有内容；导出和注销独立受理。 |
| Media `media_objects`、`media_upload_slots` | 上传、验收、成品、撤权及清理分别记录状态与业务时间。槽具备截止、代次和租约；迟到执行不能覆盖新尝试。成品 WebP 的字节数、SHA-256 和对象引用不可变；暂存字节清理进度持久化。 |
| Media `media_use_grants` 与 Social `post_media` | Media 核验同账号、用途、意图及可用版本后预绑定；Social 在本库同事务保存动态、有序引用、幂等结果和 Outbox。跨库通过内部 HTTP 核验，不持有 SQL 锁执行网络请求；未提交预绑定有宽限期并由后台回收。 |
| Media `media_jobs` | 验收、清理使用独立 Worker、持久租约与尝试标识。成品和暂存文件清理可恢复；运行调度时间与业务版本分开，避免后台巡检改变导出内容版本。 |
| 私有读取与删除 | 60 秒读取证明绑定会话、授权版本及来源，交付字节前复核当前动态与引用。删帖先让来源不可读，再释放和清理对象；旧证明不能绕过删帖或撤权。浏览器只保留短期 Blob URL。 |
| 六域导出、注销及恢复 | 导出包含实际成品字节与摘要；注销完成须确认各域记录及对象字节清理，门闩和最小收据保留防止旧任务复活。恢复覆盖七个数据库和实际对象字节，旧五／六库包维持历史范围；数据库恢复不等于图片恢复。 |

本轮已验证原页面上传、未知结果重试、刷新、图库、撤回重授、删帖、实际字节导出及合成账号注销；七库148表和10张图片隔离恢复通过。验证边界是本机 Web 联调，尚不构成 Android 安装包或生产发布验收。接续证据见 [交付状态](./backend-delivery-priorities.md) 与 [恢复说明](../deploy/recovery/README.md)。

本稿按表规定时间、状态、约束与写入责任。ER 图用于查看关系，API 文档定义客户端字段和错误。本稿新增的物理字段属于迁移设计，涉及接口的修订已同步标记。K01–K05 先实施并验收，R01–M03 在各自批次锁定渠道及业务规则。 [ER 图](./backend-review-data.md) · [接口总规范](./backend-api-contract.md) · [交付顺序](./backend-delivery-priorities.md)

**K04 的物理边界。** 回忆由独立 `memories` 服务及数据库维护。本轮已实现 MEM-01–07、FIND-01 与候选独立 Worker；动态回响仍属后续阶段。账号、人物、消息在其他服务中是权威资源，本库只存外部 ID 和核验过的版本，不建立指向它们的 SQL 外键，也不在本库事务内锁其他服务的行。下文的同事务外键、行锁和原子提交均限定在所属服务的数据库内。跨服务先经受控内部 HTTP 校验当前归属、状态与授权；写入后的读取仍复核当前访问。HTTP 最后一次复核与本库提交之间存在竞态窗口，不将其表述为跨库原子撤权。

**K05 首片：独立 AI 用途。** Identity 的 `004_ai_text_processing.sql` 新增 `ai_text_processing` 与隐私告知 v2，旧政策和决定保留不变。AI grant 的 `notice_authorization_version` 与生成的 `notice_purpose` 通过同账号复合 FK 指向确切告知事件；用途版本单调递增，不能借告知重新确认复活旧 grant。Conversations `002_ai_text_authorization.sql` 和 Memories `003_ai_text_processing.sql` 为本库生成任务增加 `ai_authorization_version >= 0`，历史任务为 0；实际新受理只写已验证的正版本。Worker 前后与写回前校验来源及 AI 版本，真正的显式失败重试才可绑定新版本并使旧派发失效。撤回不抹除既有内容，也不取消文字保存授权。跨库复核与本地提交之间仍不是原子撤权。数据导出、账号注销和自动长期记忆尚未在本片实现。

**K05 第二片物理实施。** Identity `005_data_rights.sql` 增加 `app_sessions.reauthenticated_at`、账号注销时点及 `data_requests/data_request_receipts/data_rights_commands/data_exports/data_export_grants`。申请和入队／账号冻结同事务；请求具备单调版本、四次有界恢复、90 秒租约、派发代次、进度与全部业务时点。收据证明只存摘要、固定 7 天；加密导出最长 24 小时，下载授权最长 60 秒并绑定 session，原文件与明文摘要复核后才交付。People 005、Conversations 003 的 `account_erasure_fences` 与 Memories 004 的 `memory_account_write_gates/memory_erasure_receipts` 是各域独立表；所有私有 INSERT/UPDATE 与擦除锁同一持久门闩，旧 RR 快照也不能越过围栏。围栏与收据只留最小 ID/时间，其他私人正文、旧命令和队列关联均清除。完整字段和约束以各服务不可变迁移为准。

## 先统一这四条

1. **时间可解释。** 服务端时间用 `timestamptz`，表内 `?` 表示可空。`created_at` 记录插入事实，`updated_at` 仅随业务可见更新推进。`confirmed_at`、`verified_at`、`paid_at`、`refunded_at`、`revoked_at` 分别记录对应事实，缺事实时留空。`provider_occurred_at` 保留可信渠道时间及来源，业务 `verified_at` 记录西界核验时间。截止校验取得相关锁后用 `clock_timestamp()` 取一次判定点 `t`，`t >= expires_at` 即失效。可按时间失效的本地对象到期即拒绝。清理 Worker 随后落终态。相等时间的先后用 `sequence`、`confirmed_seq` 或稳定排序键。 [PostgreSQL 时钟语义](https://www.postgresql.org/docs/current/functions-datetime.html#FUNCTIONS-DATETIME-CURRENT)
2. **每个状态有唯一写入者。** 资源状态用具名 `status` 或 `state` 列，加合法值与时间组合的行内 `CHECK`。跨行关系靠外键和锁内验证，状态迁移由所属服务按旧状态、版本和条件推进。通知用 `read_at`、已提交账本用分录存在性、报价用截止与订单关联派生状态。订单页状态从支付、发放、退款和对账分别读出。普通 GET 不落任何业务状态。
3. **重复操作和竞争操作分别处理。** 同操作用请求键及指纹查回原结果。不同操作争同一资源时，编辑用 `UPDATE … WHERE version = expected` 或等价持锁校验。最后一份库存、最后一席、首次建号和跨行付款用同一权威行的锁、条件写和数据库唯一约束兜底。`version` 防覆盖，`access_version` 和 `authorization_version` 防旧授权，`dispatch_generation` 与 `attempt_id` 防旧执行。 [PostgreSQL 约束](https://www.postgresql.org/docs/current/ddl-constraints.html) · [行锁与死锁](https://www.postgresql.org/docs/current/explicit-locking.html)
4. **写入只有一个结果。** 数据库内的状态推进、业务记录、幂等结果及必要事件同事务。发码、换码、AI、对象存储、支付及退款在持锁事务外。外部请求先记稳定尝试或渠道请求号，未知结果查询同一尝试。受信外部通知先验真、持久化及登记任务，提交后才 ACK。消费可重放，用业务唯一键和当前事实决定是否产生副作用。

### 锁顺序与异常恢复

- 私有写入在同一服务的数据库内按固定顺序取锁，多账号按 `account_id` 排序。涉及本库账号门闩时先锁门闩，再处理幂等、领域父对象、子对象与任务，最后按固定 ID 顺序锁批次或事件游标；跨服务账号、人物和源消息通过内部接口核验，不加入本地锁链。K04 先锁 `memory_account_cursors`，再处理命令；候选动作进入 `candidate_commands → memory_generation_jobs/memory_candidates`，原文确认在 `memory_commands` 后先锁候选再写原文。同一回忆的修改、删除和创建重放沿用本地顺序。专属管理操作只锁自己的目录行，禁止反向取锁。简单单行更新可用条件更新；同库撤销与写回应竞争同一权威行，跨库撤销的窗口按上述边界处理。
- 认证是槽优先的独立入口，按 `槽 → 已验证涉及账号 → 尝试及会话`。注销或限制持账号锁并增加 `access_version`，因此会话立即不可用。会话清理异步执行，注销事务内不再反向取槽锁。新的提供方主体如果还没有账号行，由主体唯一索引决定谁建号，失败事务不得留下候选账号或注册事件。
- 外部入站、队列认领和消费分阶段。收件阶段只写收件记录与调度。消费按权威账号及领域锁序写结果。短暂数据库争用可沿原操作 ID 重试。可恢复的锁等待、死锁和序列化冲突滚回当前事务，再带原请求键和有限退避。业务拒绝，例如余额不足、状态终止或版本冲突，由调用者按状态决定后续动作。

## 通用写入表

| 表 | 状态与业务时间 | 完整性、幂等与同事务边界 |
| --- | --- | --- |
| `idempotency_records` | `created_at`、`completed_at`、`expires_at`。同步命令的占位只在本事务内，提交的记录存已完成的请求回执。异步 `202` 表示命令已受理，后续进度从业务任务读取。 | 唯一键 `(actor_kind,actor_key,operation,target_scope,idempotency_key)`，作用域列均非空。指纹包含规范化输入及原版本条件。相同键同指纹回读原结果，异指纹 `409 IDEMPOTENCY_CONFLICT`。并发占位用唯一索引，首事务回滚时后续请求可获得占位。受限等待结束时返回 `REQUEST_IN_PROGRESS`。普通缓存清理后仍靠消息／回忆／赠礼接受键、报价唯一键和账本业务键阻止重复副作用。返回前重新鉴权，凭据与过期签名链接按原接口重签。 |
| `outbox_events` | `occurred_at` 是业务发生时间。`created_at`、`dispatched_at?`、`next_retry_at?`。已派发只表示已提交目标任务。 | `event_id` 主键，记录聚合 ID、版本、事件版本和最小负载。域变更与事件同事务。派发者以行锁领取待派发事件，同库按 `(event_id,consumer)` 稳定调度键入队并标记派发。任一目标入队失败则回滚该次派发。 |
| `event_consumptions` | `processed_at` 仅记录已提交的业务处理。外部调用进度由各域的尝试记录承载。 | `(event_id,consumer)` 主键，消费去重标记和数据库副作用同事务。旧版本、乱序与重复事件回读权威状态，不重新产生已有副作用。 |
| `account_event_cursors`、`account_events` | 游标 `last_sequence`、`updated_at`。事件保存来源 `occurred_at` 和投影提交时间 `projected_at`。 | 按账号锁游标再分配序号，游标和事件同事务。`UNIQUE(account_id,sequence)`，源事件按账号、资源和类型防重。禁止先发序号再分别提交，避免读者越过较小的晚提交序号。撤权墓碑与展示按当前权限及相应版本区分。 |

## 领域表与状态迁移

### 账号、人物、素材与数据权利

下表为物理设计评审稿。状态沿用现有领域接口，标明「建议」的列、状态和索引属于实施前定稿项。时间均为服务端数据库 `timestamptz`，`?` 表示只有对应事件发生后才非空。省略的展示字段以领域契约为准。短事务在取得相应锁后从数据库 `clock_timestamp()` 取一次判定时间 `t`，截止边界为 `t >= expires_at`，以此处理刚好到期、因排队等锁而过期的回调。外部证明带来的认证时间与本地发生时间分别保存。 [账号、人物与私有素材接口](./backend-api/identity-people.md)

| 表与写入口 | 状态与合法迁移 | 时间字段 | 唯一性与完整性 | 幂等键、并发与一致性 |
| --- | --- | --- | --- | --- |
| K01 `accounts` · IAM-02/03、IAM-08、PRV-04 | `active → restricted`，解除受限时可回 `active`。`active/restricted → deletion_pending → deleted`，注销失败仍保持 `deletion_pending` | `registered_at` 为首次可信业务建档时间，`updated_at`。建议 `deletion_requested_at?`、`deleted_at?` 分别记录受理和完成，仅对应状态非空 | `id` 主键、`registration_id` 全局唯一，另建 `UNIQUE(id,registration_id)` 供归因复合外键。状态受限，`version`、`access_version` 正整数，`memory_confirmation_seq` 非负且初始为 0，仅为已有 Identity 迁移兼容保留；K04 不再用此列分配回忆序号 | 首次建档按可信 `(issuer,subject)` 识别。创建账号、身份、会话与注册事件同事务。竞争失败回滚候选账号后重读胜出者，禁止重发注册事件。资料更新按 `If-Match` 比对 `version`。账号限制、恢复及注销在账号行锁下递增 `access_version`，不在此事务反向锁会话槽 |
| K01 `auth_identities` · IAM-02/03、IAM-10/11 | `active → disabled`。恢复须验证同一主体及原账号，已注销主体的再注册另按产品策略 | `verified_at` 是服务端最近确认身份时间，建议 `created_at`、`disabled_at?` | `UNIQUE(issuer,subject)`，`UNIQUE(account_id,id)`。手机号、邮箱、昵称和设备标识均不参与账号归并。保留期内禁用关系仍占用全局主体键 | 首次绑定冲突回读原映射。已有账号操作锁账号再锁身份，复核是否仍保留可用登录方式。提供方只确认它管理的身份事实，本地在结果已可信时才更新绑定；未知则查证 |
| K01 `app_session_slots` · IAM-01/02/03/04/06 | 建议使用绑定与代次 `generation`，无需额外 `status`。设备端不存在有效会话时，槽可继续发起新登录 | 建议 `created_at`、`updated_at`，用于发起记录与受控清理 | `id` 主键，绑定证明只保存摘要，`generation >= 0`。槽可历史上归属不同账号，账号由实际应用会话确定 | 认证相关路径先锁槽，再按固定顺序锁涉及的账号。新尝试推进代次。只有当前代次的成功尝试可替换会话。重复发起走 HTTP 原键，避免无故推进代次。账号注销通过访问版本立即阻断各设备，不反向锁槽 |
| K01 `auth_attempts` · IAM-01/02/03/04 | `pending → completed/cancelled/expired`，终态不可反转。拒绝或取消只结束该次尝试。建议内部换码认领用带代次和期限的租约，不扩充公开状态 | `created_at`、`expires_at`，建议 `finished_at?` 仅在终态非空。换码租约 `exchange_lease_until?` | `(slot_id,id)` 唯一，`expected_generation` 与经白名单解析的 `client_registration_key` 必填。切号和重新认证需引用本槽发起会话。原生证明和 Web 状态保存摘要，认证码不落普通业务表或日志。回程页使用白名单 | `attemptId + 原绑定证明` 是回调业务去重依据。OIDC 换码在短事务外。回写时锁槽与相关账号再核对尝试、租约、代次、状态和时间。完成后重放只读原结果，取消先提交时旧回程无效。换码已消费但结果无法恢复时重新发起认证，原会话保持可用 |
| K01 `app_sessions` · IAM-02/03/05/06 | `active → revoked/expired`，过期由时间即时生效，落库清理可以稍后。不可复活原会话 | `authenticated_at` 来自可信认证事实，建议 `created_at` 记录本地启用，`expires_at`，`revoked_at?` 仅在撤销时非空 | `UNIQUE(auth_attempt_id)`，按 `status='active'` 对 `slot_id` 建部分唯一索引。用 `(slot_id,auth_attempt_id)` 和 `(account_id,auth_identity_id)` 复合外键防止串槽或串账号。会话保存尝试绑定并经回程验证的 `client_registration_key`，普通请求不得换用其他应用的凭据。会话关联 ID 不能替代身份凭证 | 槽锁下回看旧会话，到期活动行先转 `expired` 再建立新会话。正常切换先撤旧再启新，同事务提交。重新认证只接受原账号。重复退出等效，旧请求须同时通过会话有效期与账号 `access_version` 校验 |
| 按需 `identity_operations` · IAM-10/11 | `awaiting_proof → processing → succeeded/failed`，证明超期可 `awaiting_proof → expired`。已提交提供方但结果未知时维持 `processing` 并查证 | 建议 `created_at`、`expires_at`，`started_at?`、`finished_at?` 记录受理和确认结果 | 同账号外键绑定目标身份。建议每账号最多一个未完成换绑操作，提供方操作引用按提供方命名空间去重 | API 原幂等键回读本次操作。修改绑定时锁账号和身份，检查 `operationId`、当前状态和近期认证结果。提供方网络调用在事务外，未知结果用已记录的操作引用恢复 |
| K01 `policy_versions` · PRV-01 读、发布管理 | 已发布版本是不可变事实，是否为当前版本按生效期选择，无通用 `status` | 建议 `published_at`、`effective_at`、`retired_at?`，发布与生效不得颠倒 | 实际 Identity 使用 `UNIQUE(kind,version)`，同一行保存中英文文案。同意记录以 `(policy_id,policy_version)` 指向准确版本。被引用方同时建立普通唯一键 `(id,version)`。语言变体沿用同一业务规则版本 | 相同发布版本按自然键重复可回读，内容不同须新版本。管理流程串行修改同种规则的生效范围，历史同意仍引用旧版本 |
| K01 `consent_events` · PRV-03 | 只追加事实，`decision` 是 `acknowledge/accept/grant/revoke`，不需要工作流 `status`。告知与处理授权分别按目的校验 | `recorded_at` 为数据库收到并受理该决策的时间 | `UNIQUE(account_id,purpose,authorization_version)`，FK 指向有效政策版本及本账号。每个事件记录决策、目的、政策与授权版本 | HTTP 原键和指纹处理同一请求重放。账号与用途串行化。同事务追加事件、推进授权投影，并写必要的撤权事件。后到的旧授权不能靠记录时间覆盖新决定 |
| K01 `current_consents` · PRV-03、Worker 鉴权 | 当前授权是按 `purpose` 解释的结论，由指向的已受理事件读出。普通告知确认不能开启模型使用 | 建议 `updated_at`。原始决定时间由事件提供 | `PRIMARY KEY(account_id,purpose)`，用 `(account_id,purpose,authorization_version)` 外键指向授权历史。同一用途的版本单调递增 | 若记录尚未建立，先锁账号再创建，不用只锁可能不存在的投影行。写入必须比较提交时看到的授权版本。PRV-03 必须提交 `expectedAuthorizationVersion`，无当前行时为 0。PRV-02 返回当前各用途版本，独立于同意历史分页。同键重放先返回原已提交结果，新请求版本不符返回 `412 VERSION_CONFLICT` 和当前版本。客户端重读并让用户重新确认用途，禁止自动用新版本重放授权。 |
| K02 `worlds` · PER-17/24 读、目录发布 | `enabled` 表示可选，下架仍允许按授权展示历史。世界不跟随人物移动，不需要额外生命周期枚举 | 建议 `created_at`、`updated_at`，如需下架审计记录 `disabled_at?` | `code` 唯一且稳定，`catalog_version` 正整数。人物 `world_id` 引用现有目录，目录下架保留历史引用 | 同版发布检查指纹。目录发布锁世界行或使用版本 CAS。PER-07/12 在提交前锁定目标目录并查 `enabled`，目录发布不回头锁账号 |
| K02 `person_drafts` · PER-01/03/04/07 | `draft → confirmed/discarded/expired`，终态不可编辑。过期后可重建新草稿 | `created_at`、`updated_at`、`expires_at`，建议 `finished_at?` 仅终态非空 | `UNIQUE(account_id,id)`。可空旧人物来源仍必须属于同账号。`confirmedPersonId` 从正式人物的草稿外键查询 | 创建按原幂等键。更新、确认、丢弃锁草稿并检查 `If-Match` 与截止时间，草稿更新和旧预览失效同提交。确认后重放读既有同一人物，异参冲突 |
| K02 `person_previews` · PER-05/06/07 与预览 Worker | `queued → running → succeeded/failed`，有效待处理或已成功预览可转 `stale` 或按操作取消。有效期独立判断，失效结果不展示正文 | `created_at`、`expires_at`，建议 `started_at?`、`finished_at?`、`invalidated_at?` 分开记录生成和失效 | `(account_id,draft_id)` 外键。保存不可变 `draft_version`、策略及来源授权版本。建议一个草稿同一时刻只接受一份当前预览，重找保留旧记录并失效旧候选 | 重放按请求键或已存在的预览 ID。锁草稿再锁候选，写回比较任务、草稿和授权代次。PER-07 只接受仍有效的成功候选，前一次任务晚回不得替换新候选 |
| K02 `persons` · PER-07/09/12/13 | `active → removed`，删除后墓碑阻断旧任务与历史读取 | `created_at`、`updated_at`，建议 `removed_at?` 仅在移除时非空 | `UNIQUE(account_id,id)`，可空 `source_draft_id` 关联同账号草稿，有来源时 `UNIQUE(account_id,source_draft_id)`。主图必须引用该人物的有效关联 | 创建由草稿唯一键保护，和已授权媒体关联、草稿确认及事件同提交。更新和迁居按版本条件，迁居保留 ID。移除锁账号及人物后改状态与 `access_version`，提交撤权事件及清理任务。账务和历史回执按策略保留快照 |
| K02 `media_objects` · MED-01/02/05/06 与扫描 Worker | `awaiting_upload → verifying → ready/rejected`。删除时 `awaiting_upload/verifying/ready/rejected → revoked → deleted`，对象已撤权时不得回到 `ready` | `created_at`、`updated_at`。建议 `upload_accepted_at?`、`verified_at?`、`revoked_at?`、`deleted_at?` 分别记录不同事实 | `UNIQUE(account_id,id)`。字节数为正，`ready` 要求不可变对象引用、验证时间和校验结果。对同一用途授予与撤销另由用途记录管理 | MED-02 在事务外检查对象，锁账号、素材和当前槽后复核有效期、归属及不可变版本。写槽消费、素材状态与验收任务同事务。Worker 提交复核当前槽、任务代次与授权版本。MED-05 先撤权再异步清理，无权读取立即生效 |
| K02 `media_upload_slots` · MED-01/02/06 | 建议内部 `active → completed/replaced/expired/revoked`，均为终态。换槽后的旧签名写入只能影响待清理的暂存键 | `created_at`、`expires_at`，建议 `ended_at?` 在终态非空 | 同账号素材外键，`staging_key` 唯一，按 `state='active'` 对 `(account_id,media_id)` 建部分唯一索引。索引谓词不读时间 | MED-06 锁素材后锁原槽，按版本退役原槽再生成新键。MED-02 重复提交已消费槽按原已验对象状态回读，旧槽、不同对象版本或超期拒绝提交。任何外部存储成功不能单独将素材置为可读 |
| K02 `person_draft_media` · PER-03/04/07 | 建议以 `detached_at` 区分有效关联与已解绑。上传校验状态读取 `media_objects` | `attached_at`，`detached_at?` | 草稿和素材双同账号外键。活动 `(account_id,draft_id,media_id)` 唯一。展示排序保存在关联表 | 修改持有草稿锁和版本前置条件。新旧关联和预览失效一起提交。确认时只有处于 `ready` 且用途有效的素材才进入人物。共享素材不可由草稿清理误删 |
| K02 `person_media_links` · PER-07/10/11 | 建议内部 `active → revoked`，同一素材以后可用新关联重新挂载。字段只表示资料关联状态 | `created_at`，建议 `revoked_at?` 仅在已撤销时非空 | 人物和素材双同账号外键。活动 `(account_id,person_id,media_id,purpose)` 唯一。主图使用人物与关联的复合引用，事务检查关联是否有效 | 绑定的 HTTP 原键加活动唯一键，重复回读原关联。锁人物及素材后解绑，同事务清主图、撤本目标用途和登记失效事件，其他合法引用继续有效 |
| K02 `media_use_grants` · `Media.bindUse/revokeUse` | 建议内部 `active → revoked`。如启用用途有效期，另有 `active → expired`，到期即时拒绝后续使用 | `granted_at`、`revoked_at?`，仅有时限的用途用 `expires_at?` | 精确到账号、素材、单个有类型外键的目标、用途及授权版本。每目标用途只允许一个有效授权。展示用途与 `ai_context` 分开，绑定和读取分别验证 | 目标的变更事务内持有关联资源和素材锁，授权变化递增授权版本并写事件。工作者提交时使用相同访问资源锁检查有效授权、版本及当前用途。已签发的直读 URL 在到期前仍可能使用，需要即时撤权的用途走授权代理 |
| K05 `data_requests` · PRV-04/05/06 | `accepted → processing → completed/failed`。系统允许在可恢复失败后继续原申请。注销受理即限制访问，清理失败也不恢复账号 | `requested_at`、`updated_at`，建议 `started_at?`、`finished_at?`。导出成功可有 `result_expires_at?` | 账号外键，`kind` 和 `scope` 有合法组合。建议每账号一个注销申请，重复恢复原单。结果引用仅为成功导出保留 | 请求按原幂等键，注销同时用收据 ID 绑定。账号锁下创建申请、增加访问版本、记录撤权与清理任务。账号级失效由访问版本立即保障，不反向锁会话槽。清理按持久化步骤去重并复核全部必需阶段后结束 |
| K05 `data_request_receipts` · PRV-04/10 | 建议单独持久化注销收据。有效性由期限及摘要校验，申请进度读取原单 | 建议 `created_at`、`expires_at`，按策略撤销时有 `revoked_at?` | `receipt_id` 主键、`request_id` 唯一，只绑定注销申请，保存高熵证明摘要。读接口只允许返回单笔进度 | 原申请事务内绑定并落库。重复收据必须指向同一请求与证明摘要。冲突拒绝，受理响应丢失后也可查，原会话失效不影响收据规则 |
| K05 `import_batches` · PRV-07/08/09 | `reviewing → ready → running → completed`，可进入 `failed`。仅可恢复失败复用原批次和已确认进度，重新运行不得覆盖用户后续修改 | 建议 `created_at`、`updated_at`、`reviewed_at?`、`confirmed_at?`、`finished_at?` 分别记录审核、确认和结果 | `UNIQUE(account_id,source_namespace,source_digest)`，摘要以服务端核验对象为准，导入文件及来源须属同账号。未确认批次不能写正式数据 | 确认锁账号及批次，以 `If-Match`、文件摘要及授权版本为前置条件。每个分块只提交自己的事实与映射，失败回读已完成分块。同源旧键不会分配新的正式 ID |
| K05 `import_item_map` · 导入 Worker | 只保存已成功映射事实，失败或待确认信息记批次处理结果，无独立工作流状态 | 建议 `mapped_at` 为第一次成功映射时间 | `UNIQUE(account_id,source_namespace,object_type,legacy_scope,legacy_id)`，根级使用明确范围值。正式目标按类型核对同账号归属 | 每项正式数据和来源映射同事务，重复走自然键。旧数据包的 `owner`、旧 ID、余额和模拟订单均不能当正式身份或账务事实 |

**需先定稿的时序。** 注销受理后的会话清理由访问版本判定先行保障，后台再逐批持久化撤销与清除。第三方身份删除与对象存储清理允许重试，账号完成注销须有各项必要结果和访问墓碑。保留期限、恢复后墓碑回放以及已注销主体能否重新注册由隐私及产品规则定稿。安全证明、签名 URL、身份凭据与原始媒体不得作为幂等响应长期缓存。

**原型反例。** 回调等锁越过到期边界、相同主体两槽同时首次登录、换号取消后才收到成功回调、撤回后旧授权异步到达、换上传槽后旧版本回写、注销受理响应丢失、分块导入提交后中断。分别观察账号、正式人物、有效上传槽、用途版本、注销单与映射条数，同时确认响应状态、事件与副作用来自同一提交。

### 会话、生成、回忆与动态

接口沿用会话与回忆规范。下表中 `?` 表示可空，其余时间字段为服务端写入的非空 `timestamptz`。`created_at` 是数据库记录时间，`*_at` 业务时间由完成对应动作的服务写入。变更与删除的 `updated_at`、`version` 同事务递增。客户端时间只作为有明确用途的来源信息。锁取得后再取一次 `clock_timestamp()` 检查截止时间，避免长等待导致已过期写入。展示排序用明确的序号或 `(业务时间, id)`，同毫秒可有多条记录。表结构及新增的内部字段是迁移设计提案。 [会话、回忆与空间接口](./backend-api/conversations-memories.md) · [PostgreSQL 行锁](https://www.postgresql.org/docs/current/explicit-locking.html) · [时间函数](https://www.postgresql.org/docs/current/functions-datetime.html)

| 表与权威写入方 | 状态、合法迁移及业务时间 | 数据库约束与并发责任 |
| --- | --- | --- |
| K03 `conversations` · 会话服务 | `created_at`、`updated_at`、`last_activity_at?`。`last_activity_at` 是可重建列表摘要。无独立会话状态，`canSend` 根据人物、当前世界成员资格和用途授权计算。迁居沿用原直聊 | `CHECK` 强制直聊只有 `person_id`，小聚只有 `world_id`。现有 `(account_id,person_id)` 唯一约束保留；围坐增加 `(account_id,world_id) WHERE kind='gather'` 部分唯一索引。已存在的世界会话即使零居民仍保留，当前资格只控制新发送。人物和世界 ID 属于 People 服务的外部引用，经内部接口核对同账号及当前访问，不建立跨库 FK。CHAT-02 并发创建时由唯一键选定同一会话。会话锁内 `last_sequence + 1` 后与消息提交 |
| K03 `messages` · 会话服务 | `created_at` 是正式受理或回复写回时间，导入可保留独立 `original_created_at?`。`removed_at?` 标记删除，`restricted_at?` 标记运营限制，均增 `version`。已入库即受理，发送中留端侧，AI 是否完成由任务决定 | `UNIQUE(account_id,conversation_id,sequence)`。用户发送用 `UNIQUE(account_id,conversation_id,client_message_id) WHERE client_message_id IS NOT NULL`，保留 `request_hash`。`FK(account_id,conversation_id,reply_to_message_id)` 指向同会话普通唯一键 `(account_id,conversation_id,id)`。现实现不用 `reply_slot` 列：直聊 `generation_job_id` 对 persona 回复唯一；围坐用 `gather_reply_job_id` 与 `speaker_person_id` 唯一。`conversation_kind` 通过同账号／会话／类型复合 FK 核对，围坐只接受文字且不能绑定直聊任务；slot 的回复复合 FK 同时核对父任务和发言人。角色标识不可空的生成结果保留最小引用，删除正文不释放唯一回复身份。礼物卡按会话、引用类型及业务 ID 唯一，只回读原领域状态 |
| R01 `messages.media_id`、`posts.mediaIds` 绑定 · 会话／动态服务及素材域 | 现有 CHAT-06 单图用 `messages.media_id?` 记录引用，动态从 `post_media` 按位置读出 `mediaIds`。绑定时间随提交写 `attached_at` 或沿用同事务 `created_at`。图片可用性以当前素材状态及授权推导，删除消息不删除独立素材 | 图片消息必须有媒体 ID。复合 FK 校验素材、消息或动态同账号。上传槽、已校验版本及授权以素材域记录为准。动态图 `UNIQUE(account_id,post_id,position)`，`CHECK(position BETWEEN 1 AND 9)`。绑定与内容提交同事务，删除一个引用后只释放该引用，撤会话用途前查有无其他合法引用。读取先查内容未撤回和用途授权，再发短签名或受控读取凭据 |
| K03–K04 `generation_jobs` · Worker 与任务服务 | `created_at`、`updated_at`、`queued_at`、`run_after`、`attempt_started_at?`、`attempt_expires_at?`、`finished_at?`。`queued → running → succeeded/failed/blocked/canceled`。排队可取消或因来源不可用被阻断。可重试失败或租约过期按策略重新排队。`succeeded/blocked/canceled` 终态，`failed` 仅在 `retryable=true` 且资格有效时允许 GEN-03。重试清本轮结束与执行字段，保留业务 ID | `CHECK` 要求 `running` 有当前 `attempt_id` 与有序执行时间，结束状态才有 `finished_at`。源用户消息在回复任务类型中唯一。派发与任务状态同事务，重新入队换 `dispatch_id` 并增 `dispatch_generation`，入队未受理则回滚。领取须比较预期派发代次、`state='queued'` 及 `run_after <= 判定时点`。完成须比较 `state='running'`、`attempt_id`、当前派发代次、租约及输入版本。调度器只负责投递，Worker 的业务事务写正式结果和事件 |
| R01 `gather_reply_jobs` · 会话服务 | 每条用户源消息一个父任务，保存账号访问、story／gather 及可选旧 AI 授权版本；父状态从全部槽聚合，部分成功始终保留已提交回复 | 源消息唯一；同账号／世界会话复合归属。受理事务同时保存原消息、永久命令、名单、槽、`GatherAccepted.v1` 和队列；已受理重放优先回读原事实，不换人 |
| R01 `gather_reply_participants` · 会话服务 | 固定受理名单和每人的最小人物／访问／世界版本；按客户端消息 ID 与人物 ID 的 SHA-256 排序，取最多三位 | `(account_id,job_id,person_id)` 主键、每轮 position 唯一，延迟约束保证准确 2–3 人与槽数量；名单不可更新，只有账号擦除围栏下可删除 |
| R01 `gather_reply_slots` · Worker | 每人 queued／running／succeeded／failed／blocked／canceled；45 秒租约，领取与中断计入最多三次实际 attempt，短暂错误后台有限退避，成功槽不重跑 | 当前 attempt／lease、全部实际消息及各自／共享继承记忆引用在提交前复核；来源 owner 不改变，跨人物记忆只作 Boolean 验证。原回复、槽成功、`GatherReplyCommitted.v1` 与父聚合事件同事务。取消／删源清除未完成 attempt；恢复保留成功来源，隔离未完成槽和父任务 |
| K04 `memory_account_cursors` · 回忆服务 | `account_id` 主键，`last_confirmed_seq` 初始 0 且非负；`created_at`、`updated_at` 必填。此行只负责本账号回忆提交顺序，不复制 Identity 账号状态 | 先验证外部账号，再在本库 `INSERT ... ON CONFLICT` 保证门闩存在并取行锁。新确认在同一事务递增一次，回忆、命令结果或事件任一步失败时一起回滚。账号级确认顺序以本库此列为唯一分配权威；Identity 的旧 `accounts.memory_confirmation_seq` 仅兼容保留。并发同账号确认不会获得重复序号，失败或同参重放不消耗新序号 |
| K04 `memories` · 回忆服务 | `id,account_id,person_id,client_memory_id,request_hash,title,body,origin,confirmed_seq,version`。`created_at`、`confirmed_at`、`updated_at` 必填，`original_created_at?`、`removed_at?` 只在对应事实存在时非空。原文没有草稿或生成中状态，可见性由 `removed_at` 和当前权限判定。`confirmed_at`、`origin`、`confirmed_seq` 首次确认后稳定；版本正整数，正文 1–10000 字符、标题 1–120 字符 | `UNIQUE(account_id,person_id,id)`、`UNIQUE(account_id,person_id,client_memory_id)` 和 `UNIQUE(account_id,confirmed_seq)`；客户端 ID 与创建指纹长期保留，删除不释放唯一键。账号和人物仅为经内部 HTTP 核验的外部 ID。可选 `source_message_id/source_message_version` 成对保存已核验的消息来源，版本为正整数；用户编辑确认的消息摘录仍是 `origin=manual`。不建立跨库消息外键。候选确认使用 `origin=ai_candidate` 与同账号同人物的本地 `candidate_id` 外键，候选非空唯一；手写及直接摘录仍为 manual。`original_created_at` 随 K05 导入添加，当前迁移未含。创建在本库游标锁内分配序号，与原文、命令结果、`MemoryConfirmed.v1` 同事务；修改、删除用 `If-Match`，同事务递增版本、更新时间并写事件。时间约束保证创建/确认不晚于更新，移除时间不早于确认。来源移除后省略失效引用，已确认原文仍按自身访问规则读取；人物移除则所有入口返回 404 |
| K04 `memory_commands` · 回忆服务，通用幂等记录的本域实现 | 完成的命令在业务事务内落行，无额外 `pending` 状态。`created_at`、`expires_at` 必填，普通响应缓存默认至少 7 天；`completed_at` 与落行时间同义，无需重复列 | 主键 `(account_id,operation,target,idempotency_key)`，范围列非空，保留规范化请求指纹。`response` 只存资源 ID、结果引用和版本，不缓存私人正文。重放重新检查当前账号、人物和资源可见性，再回读权威资源；已删除的旧创建结果不可返回旧正文。缓存过期不解除 `client_memory_id/request_hash` 的长期业务唯一性，不能使已删除原文复活。命令、原文、游标与 Outbox 同事务提交 |
| K04 `memory_generation_jobs` · 记忆 Worker | 类型固定 `memory_suggestion`，状态 `queued/running/succeeded/failed/blocked/canceled`。`created_at,updated_at,queued_at,run_after` 必填；`started_at,lease_until,finished_at` 随执行事实非空。当前 `started_at/lease_until` 对应通用任务的开始/截止时间；重试清执行和结束字段 | 来源保存 `source_version,context_refs` 及账号、人物、授权版本；派发身份与代次、尝试身份、有效租约保护领取和提交。同源申请在账号门闩下串行，当前来源快照改变时先阻断旧活跃任务；每次重试新物理派发，业务 ID 稳定。真实 pg-boss 入队和任务、事件同事务；外部模型在事务外。成功才建候选，资料不足进入 `blocked/NO_MEMORY_FACTS`，物理投递耗尽有限归并失败 |
| K04 `memory_candidates` · 回忆服务 | `created_at,expires_at,state_changed_at` 必填，`consumed_at` 仅在 consumed 非空。生成成功后建 `ready`，有效 24 小时，仅允许 `ready → consumed/expired/withdrawn`。只有仍有效 ready 返回正文 | 候选与本库任务使用同账号同人物复合 FK；外部消息与其本人父消息均经内部 HTTP 核对，记录所有实际 ID/版本。有效 ready 同源版本部分唯一；本库 `(account_id,person_id,candidate_id)` 外键及唯一约束保证一次消费。消费、正式原文、确认序号、命令及事件同事务；来源失效撤回未消费候选，503 不永久撤回。已确认原文独立存在 |
| K04 `candidate_commands` · 生成操作幂等 | 完成受理事实在同业务事务落行，`created_at` 必填，无正文、无过期重生成语义 | 主键 `(account_id,operation,target,idempotency_key)`，保存请求指纹和任务结果引用。旧键只回原操作；同快照失败/资料不足不自动付费重试，用户显式 GEN retry 复用业务任务。完整快照变化后的新键可重整；已消费结果保留消费元数据 |
| K04/R01 `search_projection` · 可选可重建投影 | 维护 `indexed_at`、`source_version`、`removed_at?`。无用户生命周期状态，索引状态按真实原文和权限回读。K04 数据量允许时可直接查权威表，待实测再建投影 | 主键 `(account_id,resource_kind,resource_id)`。消费者按源版本条件写，撤回时清片段并保留版本界限。FIND-01 返回前再核对当前源版本、访问和归属，先前写入的搜索片段无法绕过删除。重建仍按权威原文，结果链接保留同一业务 ID |
| R01 `letters` · 书信服务 | `created_at`、`updated_at`、`reply_at?`、`removed_at?`。`reply_mode=none` 时 `reply_at`、`reply_job_id` 皆空，其余模式需二者存在。`next_morning` 按选定 IANA 时区把目标时点解析成 UTC 后固定，离线和换时区不改变。原信是否有回信从任务与结果读出 | `UNIQUE(account_id,person_id,client_letter_id)` 加请求指纹。信、任务、预约入队同事务。`If-Match` 删除时更新权威可见性与版本。Worker 确认原信未移除且授权有效才写回。已受理信和排程随当前账号访问状态处理 |
| R01 `letter_replies`、`letter_read_cursors` · 书信服务 | 回信 `created_at` 是写回时间。已读游标保存 `read_at`，只在序号提高时写。回信可见性继承原信与授权，无重复的回信状态 | 回信 `FK(account_id,person_id,letter_id)`，原信最多一个回信。锁同账号人物分配回信序号，`UNIQUE(account_id,person_id,sequence)`。已读游标主键 `(account_id,person_id)`，以同人物回信序号做 FK，`UPDATE ... WHERE last_read_sequence < 新序号`，两次不按到达顺序的已读动作不会回拨。回信、序号和回信事件同事务 |
| R01 `posts` · 动态服务 | `created_at` 是正式发布时间，`updated_at` 记录互动计数及修订，`removed_at?`／`restricted_at?` 独立处理。用户发布要么全部提交，要么草稿留在端侧。AI 回响的源状态由回忆回读 | 用户发布以 `Idempotency-Key` 保证同操作只写一次。`UNIQUE(account_id,source_memory_id) WHERE kind='memory_echo'`，源使用同账号 FK 及 `source_version`。写回要求未被源撤权且源版本相符。正文、媒体绑定与事件同事务。私有动态 `account_id` 非空，全球世界公告走受限系统来源读取，避免通过空归属绕开隔离 |
| R01 `post_comments` · 动态服务 | `created_at`、`updated_at`、`removed_at?`。删除父评论隐藏其正文，已允许的子评论继续按规则呈现。无待发布状态 | 同账号同动态父评论 FK。人类提交用 `Idempotency-Key` 加请求指纹。自动互动以来源动作、角色、互动类型唯一。锁动态后锁评论并校验仍可见，评论变更、计数、事件同事务。AI 产物不触发递归生成 |
| R01 `post_reactions` · 动态服务 | `created_at`、`updated_at`、`removed_at?`。`active` 从 `removed_at IS NULL` 推导，`false` 撤掉，之后同一人允许显式再次点赞。重复当前状态不更新时间与计数 | `UNIQUE(account_id,post_id,actor_type,actor_id)`，`actor_id NOT NULL`，本人用已验证账号 ID，角色用同账号人物 ID。FEED-05 设置目标态，锁动态再改点赞行，计数差值和事件同事务。原幂等键重放只读原结果，不会重做已被新动作覆盖的旧意图。不同键的跨设备冲突采用服务端提交顺序 |

#### 写入顺序与三种校验

1. CHAT-06 从可信会话取得账号，先按共用顺序锁账号及相关人物，再锁会话。核对消息业务唯一键和请求指纹，在分配序号前决定重放还是受理。新受理在同事务内写消息、递增序号、任务、入队、事件与幂等结果。重放同参读原 ID，改参返回 `409 IDEMPOTENCY_CONFLICT`。读回仍校验现时权限。部分唯一索引使用静态谓词，`now()` 与截止判断留在持锁事务中。 [PostgreSQL 唯一与外键约束](https://www.postgresql.org/docs/current/ddl-constraints.html) · [部分索引](https://www.postgresql.org/docs/current/indexes-partial.html)
2. Worker 先领取并记尝试，持锁校验当前账号、源内容及用途版本，再在事务外调模型。写回仍按账号 → 人物 → 会话或其他来源 → 任务顺序取锁，并在取得锁后重新读取必要状态。输入绑定至少包括实际发送的消息、回忆、素材及其读取用途版本，以及人物和账号的访问版本。源版本比较判断本次输出是否仍有效，执行代次判断是否仍拥有写入资格。删除、撤权和同源写回应竞争相同的前置行，不能分别在不同事务中只查一次版本。新领取发现撤权即停止，已在途请求按提供方能力取消，迟到结果无法写回或展示。
3. 本轮 MEM-03 先从已验证会话取得账号，事务外核验 Identity 的当前账号与存储授权、People 的人物归属和可选消息来源，再锁本库 `memory_account_cursors`，检查命令及永久客户端业务键。相同键和输入回读同一仍可见原文，改参返回 409；新确认才分配一次序号，并提交原文、命令和事件。用户编辑确认的摘录保持 `origin=manual`，不冒充 AI 候选。候选确认在本地锁内复核候选状态、版本和截止时间，竞争消费只有一份原文。来源消息移除仅阻断新来源使用并隐藏旧来源链接，已确认原文独立存在；人物移除后旧详情、列表、搜索及幂等重放均不能读出内容。修订与删除使用资源版本，删除撤掉原文检索可见性，后续回响与奖励按所属批次处理。

#### 并发反例与通过条件

| 反例 | 期望断言 |
| --- | --- |
| 两台设备同 ID 发同一条消息，第一次提交后丢失响应，再用同键改正文 | 同参回同一消息与任务 ID，只增长一次序号和一条事件。异参返回 409，消息与原请求指纹保持一致 |
| Worker A 超时后重派给 B。B 提交后 A 才回，或撤权提交后 B 才回 | 同一源、同一回复槽至多一条正式结果。旧派发／旧尝试更新零行。撤权先提交时无正式结果，生成先提交时撤权后不再公开可见 |
| 候选 A 过期后调度未执行，两个请求同时确认或要求生成替代候选 | 到期旧候选确认失败，最多一个当前 `ready` 替代候选。同一候选消费只产生一份原文和一次事件 |
| 回忆删掉后，旧 `MemoryUpdated.v1` 才到。旧已读请求到达时已有更新回复 | 搜索无法返回已删原文，旧事件不复活。已读位置和 `read_at` 不回拨，新来信仍未读 |
| 两个不同客户端确认同时提交，或 Outbox 写入失败后用原键重试 | 同账号序号唯一且按提交串行分配；失败事务不留下原文、命令或新序号。重放同一客户端 ID 不新增原文或事件，改参返回 409 |
| 记忆创建成功后丢失响应，另一端删除，再重放原创建；命令缓存到期后再次提交 | 重新鉴权及查可见性，不返回已删除正文，也不复活旧原文；永久客户端 ID 与指纹仍防重复 |
| 来源消息删除后读已确认原文，随后人物删除，再访问旧搜索或详情 | 来源删除后原文仍可读但无失效来源引用；人物删除后所有入口与旧成功命令重放均不可读出原文 |

## 礼物、资产、支付、邀请与共创

本节是 R02、M01–M03 的实现评审稿。表名、存储状态与业务时点先在迁移前评审冻结。`?` 表示可空，其余列为所述业务所必需。创建、更新、入账、验签、确认和撤回时间均由可信服务端记录，渠道发生时间另存并保留来源。时间点使用 `timestamptz`。状态由写入模块推进，所有 GET 仅读取或按当前时间派生可用性。金额按币种的最小单位，邮资、礼品库存和券按权益单位分别计量。 [交易域接口与现有状态](./backend-api/assets-commerce.md)

### R02 · 资产、投递和通知

| 表 | 状态与关键时间 | 完整性、唯一性和幂等 | 并发与同事务边界 |
| --- | --- | --- | --- |
| `gift_catalog_items` | 当前目录 `available` 为上／下架开关。`created_at`、`updated_at`、`version`。历史展示来自已接受投递中的版本快照 | `id` 主键，版本正数，单价非负。投递锁定 `gift_id` 和 `catalog_version`。目录内容变更用预期版本，重复读目录无副作用 | 目录运营写入按 `version` CAS。寄件读取已发布版本并保存快照，提交时复核请求中的版本。已有投递历史不因上下架、改名或改价改变 |
| `asset_lots` | 无独立余额状态。`issued_at`、`expires_at?`、`updated_at`。有效期由数据库时钟和快照规则判定，耗尽由可用量计算。到期批次的可用量即时为零。到期处理先处置未预留部分，剩余在占用释放或核销时结算 | `(account_id,id)` 为同账号引用键。`CHECK balance_units >= 0 AND reserved_units >= 0 AND reserved_units <= balance_units`。`available_units = balance_units - reserved_units` 为派生值。到期时间晚于发放时间，平台内购等渠道如规定无有效期则保留空值 | 赠礼、发券、退款都走账本入口。先锁账号，随后按业务选批次，取锁按稳定批次 ID 排序。锁后再核有效期、资产种类、来源和可用量。记账余额由分录重建，预留量由活动预留行重建，二者都在写事务同步校验 |
| `ledger_transactions` | 追加型已提交账务事实，无处理状态。`created_at` 为入账事实时间，记录业务 `reason`、`source_id`、策略版本和指纹 | `UNIQUE(account_id,reason,source_id)`。同键同业务输入回读原交易，同键异输入冲突。指纹比较业务指令的规范化意图，避免把变化的扣减批次作为重试输入。冲正有独立原因和稳定来源，不改历史交易 | 锁定来源对象和账号后写交易、分录、受影响批次及事件。同事务全部提交或全部回滚。需要按原分录冲正时保存原交易引用，防止其他业务用同一事实重复冲正 |
| `ledger_entries` | 追加型明细，无状态。发生时间继承父交易 `created_at`，分录按 `line_no` 排序 | `UNIQUE(transaction_id,line_no)`。`units > 0` 且方向只允许 `credit / debit`。`(account_id,transaction_id)`、`(account_id,lot_id)` 分别做同账号外键，使用 `lot_id` 所属资产种类。不能仅靠分录 `CHECK` 保证汇总余额 | 禁止单独增改删分录。批次快照更新、分录写入与账务事件在同一事务。重建时按事务语义核对原分录和预留行，发现差额进入对账 |
| `gift_deliveries` | `status in_transit → arrived / delivery_failed`。`accepted_at`、`scheduled_arrival_at`、`arrived_at?`、`failed_at?`、`updated_at`。终态与对应时间一一匹配，禁止同时有到达与失败时间 | 以已鉴权账号和 `Idempotency-Key` 写持久 `UNIQUE(account_id,acceptance_key)` 及请求指纹，覆盖 HTTP 幂等缓存清理后的原操作回读。新键不能模拟一次相同意图重试。快照、数量、原扣减引用保持稳定。会话、人物与账号必须指向同一条私聊，免费赠礼的扣减引用可空 | 同事务锁账号、人物、会话和批次，校验归属、目录、到期与余额后写扣减、回执、原操作记录和投递任务。Worker CAS 只更新 `in_transit`。失败终态和 `gift_reversal:<deliveryId>` 冲正一起提交。到达与失败竞争时只产生一个终态和对应事件 |
| `received_gifts` | 业务状态 `unopened / opened` 由 `opened_at?` 派生。`received_at`、`created_at`、`updated_at`，`placement record / space` 独立。摆放到空间须已拆开 | `UNIQUE(source_delivery_id)` 防止同一次到达多份剧情回礼。来源、归属、人物和会话一致，源发件须已到达且适用剧情策略。拆开幂等读取第一次 `opened_at` | 锁源投递检查 `arrived` 与许可，收件和通知事件同事务提交。拆开只设置一次 `opened_at`。摆放使用 `If-Match` 与版本 CAS，失败保留原摆放 |
| `notifications` | 无独立 `unread` 布尔列。`created_at`、`read_at?`、`version`。未读由 `read_at IS NULL` 派生 | `UNIQUE(account_id,type,source_event_id)`。通知只保存当前账号可见的资源引用。目标后续撤权时按权限回读安全摘要。投影重建保留原已读时间 | 消费与建通知同事务去重。首次已读条件更新 `read_at IS NULL`，重试回读原时间，禁止刷新已读时间。通知不推进支付、奖励或投递状态 |

### M01 · 订单、支付、售后与对账

订单只有支付事实和权益进度两条持久状态线。页面 `status` 和退款汇总从订单、尝试、退款与差异单推导。收银台取消、回调超时或应用关闭只改变查询动作。可信渠道证据与已核验的正式发放各有记录。以下局部存储枚举与多商户命名空间须随选定渠道确认。 [订单状态与渠道证据](./backend-api/assets-commerce.md#商品付款和售后-http)

| 表 | 状态与关键时间 | 完整性、唯一性和幂等 | 并发与同事务边界 |
| --- | --- | --- | --- |
| `products` | 商品当前 `enabled` 或版本化发布开关。`created_at`、`updated_at`、版本号，停用只影响后续报价 | `id` 主键，同一发行范围下渠道 SKU 映射唯一。报价保存商品、权益和规则版本快照。货币列和金额成对有值，店内官方价格未知时允许空值 | 目录写用版本 CAS。创建报价复核已发布版本，已存在的报价与订单保存其历史语义 |
| `quotes` | 不可变报价。`created_at`、`expires_at`。可用、过期和已消费分别由到期时间及 `orders.quote_id` 反查，不另写一份状态 | `CHECK expires_at > created_at`。保存账号、商品与渠道版本。商户报价须金额和币种齐备。商店型报价可空并保留官方商品标识 | 创建订单锁报价并复核归属、数据库时间及渠道资格。相同已消费报价读原订单。锁只用于本地事实，无渠道调用 |
| `orders` | `payment_status awaiting_payment → confirming → paid / closed`。无外部尝试可直接 `awaiting_payment → closed`。可信结果确认尝试终结且仍可付时允许 `confirming → awaiting_payment`。`fulfillment_status not_eligible → pending → fulfilled / blocked`。`created_at`、`updated_at`、`close_requested_at?`、`closed_at?`、`paid_at?`、`fulfilled_at?` | `UNIQUE(quote_id)` 与同账号报价外键。保存只写一次的 `winning_channel_transaction_id?`。组合外键要求胜出交易属于此订单。为发放的胜出交易引用提供普通唯一键 `(id,winning_channel_transaction_id)`，`paid` 要有胜出交易及支付时间。`fulfilled` 要有唯一发放事实。`closed` 的迟到成功先进对账。受控处置才可接纳迟到款，保留原关闭时间和审计 | 发放、验单、关单、退款都争同一订单锁。按 `账号 → 订单 → 渠道交易 → 批次` 顺序，锁后复核状态。发起关单写意图，不再开新尝试。正式关闭需已证实无扣款。未知时查同一尝试。发放成功时更新订单、追加账本和事件 |
| `payment_attempts` | `preparing → awaiting_action / pending / succeeded / failed / closed`，`awaiting_action` 与 `pending` 可按渠道确认推进。`created_at`、`updated_at`、`expires_at?`、`terminal_at?`。唤起参数到期与外部付款结束独立 | 对 `(order_id)` 在 `preparing / awaiting_action / pending` 状态建部分唯一索引。渠道请求号在可信渠道命名空间内唯一。保存 `channel`、`environment`、订单关联和版本，终态时间条件检查 | 先锁订单写尝试与待执行任务，然后在事务外用固定渠道请求号发起。回写检查原尝试与版本。仅凭本地过期或客户端返回不关单。结果未知继续查旧请求，不更换请求号 |
| `channel_transactions` | 仅存已验渠道事实与匹配结果。`provider_occurred_at?`、`verified_at`、`first_seen_at`、`matched_at?`。支付证据、金额和商户来源与本地匹配时点分开保存 | `UNIQUE(channel,environment,external_transaction_id)` 适用于已确认的单商户范围。多商户接入前必须验证并加入可信商户或应用命名空间。`order_id?` 只可绑定一个订单。绑定时核查账号、商品、币种、金额、数量及环境 | 先定位可信原单，按相同锁序复核并绑定，首次有效支付才写胜出交易。第二笔真实扣款保留独立交易并建差异单。证据无法安全归属时保留交易或验证凭证并进对账，不占权益发放名额 |
| `fulfillments` | 仅存在已提交的发放回执，无第二份处理状态。`fulfilled_at`，记录发放时的订单、已验胜出交易和账本引用 | `UNIQUE(order_id)`、`UNIQUE(channel_transaction_id)`。`(order_id,channel_transaction_id)` 要对应订单选定的胜出交易，账本交易同账号。发放以原 `order_id` 作为账本业务来源 | 使用订单锁与退款共享串行入口。未决的可信退款证据或全额已退时，按政策阻断发放或进对账。成功时写发放、分录、订单状态和出站事件同事务。商店确认另走已提交后的渠道任务 |
| `refunds` | 渠道进度 `requested → pending → verified / failed`。权威结果早到时可从 `requested` 直接推进到相应终态，外部直接发起的已核验退款可首次写成 `verified`。未知结果维持 `pending`。权益处置另记 `pending / applied / not_required / needs_review`。`created_at`、`submitted_at?`、`verified_at?`、`applied_at?`、`updated_at` | 退款请求号和已核验渠道退款 ID 在其可信作用域各自唯一。退款引用原渠道交易，已知币种须一致，金额大于零。M01 自处理全额退款只允许同一交易一个未决本地申请。外部实际退款可多笔，核验事实与权益处置分别保存 | 按账号、订单、原渠道交易、批次取锁。申请占用可退金额及权益，写请求和任务，再在事务外调用渠道。持锁核对同交易已退和未决申请总额，不能用单行 `CHECK` 代替。外部实际退款要留证。累计超出已验证实付、金额未知、已消费或缺少确定权益换算时走差异单。已验证成功不被迟到失败覆盖，冲正按 `refund_id` 至多一次 |
| `refund_lot_holds` | `held → consumed / released`。`held_at`、`consumed_at?`、`released_at?`。终态只能有一个对应时点。渠道结果未明继续预留 | `UNIQUE(refund_id,lot_id)`。退款、权益批次同账号，`units > 0`。保留原权益来源。该表为待逆转权益占用明细，持久 `reserved_units` 通过活动预留核对 | 申请退款时在同一事务锁原批次并增加预留，可用量立即下降。核实退款后同事务写冲正、减少账面量与预留量，再将该预留置 `consumed`。只有确认外部未受理或最终失败才 `released`。锁后不足返回业务冲突，余额不可负 |
| `payment_callback_inbox` | `received → processing → processed / needs_review`。可重试处理失败记录 `next_retry_at?`。`received_at`、`verified_at`、`processed_at?`、`lease_until?`。保留最少加密证据引用 | `UNIQUE(channel,environment,provider_scope,verified_event_key)`。可信事件 ID 缺失时采用协议允许的已验内容指纹。重复回调和两个真实交易分别依赖收件键与交易键 | 先按渠道验真，再提交收件与待处理任务，提交后才 ACK。领取用条件更新及租期，处理事务写真实状态与消费结果。运营重放沿用原证据键 |
| `payment_reconciliation_cases` | `open → processing → resolved`，查证仍不足可回 `open`。`opened_at`、`updated_at`、`resolved_at?`、`version`。记录原因、原证据、操作者与结果 | `order_id?`、`channel_transaction_id?`、`refund_id?` 允许未知，至少有可信证据或业务引用。相同未决异常用稳定 `case_key` 合并，已解决后遇到独立异常可新建。证据不可被运营编辑覆盖 | 重查可并行排队但写差异单使用版本。正式处理调用原发放或退款命令并复用业务锁，提交事实后才关闭。运营不能直接改钱、权益或渠道原始事实 |
| `payment_restorations` 与 `payment_restoration_items` | 批次 `pending → completed / needs_review / failed`。明细 `pending → already_fulfilled / restored / not_eligible / needs_review / invalid`。`created_at`、`updated_at`、`finished_at?` | 批次归属账号。明细同账号引用批次，同批次同证据指纹唯一。恢复不能转移别人的交易。即使更换批次或重新安装，发放仍按原订单和渠道交易去重 | 每项先查外部证据，再走同一交易匹配和发放入口。已入账直接返回结果。批次汇总按项推进，不会为重装用户增发消耗品 |

同一真实退款先于付款通知时，先记可信证据并查原交易。已验退款事实和发放必须争同一订单锁。若退款先获得锁并确认全额，权益保持未发放。若发放先提交，退款流程按原批次冲正。外部实际退款与本地预留不足或数据矛盾时保留证据，进入对账。支付有效性、退款金额与本地入账分别留痕。 [退款时序](./backend-api/assets-commerce.md#支付事务和故障处理)

### M02 · 邀请资格与双方奖励

| 表 | 状态与关键时间 | 完整性、唯一性和幂等 | 并发与同事务边界 |
| --- | --- | --- | --- |
| `referral_links` | `active → revoked / expired`。`created_at`、`expires_at`、`revoked_at?`、`updated_at`。公开读取始终检查当前有效期和撤回状态 | `token_hash` 唯一，令牌恢复用独立加密副本。每位邀请者、每个活动只有一条当前活动链接。部分唯一索引按显式 `active` 状态建，避免以随时间变动的条件做索引。保存活动规则版本 | 锁邀请者或链接归属后把已到期链接转终态再签新链接。撤回与意图注册消费争同一链接锁。撤回先提交时未绑定的意图失效，既有归因按原政策处理 |
| `invitation_intents` | `created_at`、`expires_at`、`consumed_at?`。是否未消费由 `consumed_at` 判断，是否可用同时检查有效期、会话绑定和父链接 | 保存 `link_id` 与浏览器或 App 发起证明摘要。每个意图最多绑定一次新注册，消费字段与 `consumed_at` 成对。只支持可信服务端创建，匿名输入不得变成正式账号关联 | 认证回调核对可信主体，按固定账号及对象锁序复核链接和意图。仅在首次注册事务内消费。过期、撤回或自邀时，正常登录可成功但没有邀请归因 |
| `referral_attributions` | `awaiting_memory → rewarded / ineligible`。`registered_at`、`qualified_at?`、`rewarded_at?`、`decided_at?`。奖励后保留资格证据及活动版本 | `UNIQUE(invitee_account_id)`、`UNIQUE(invitation_intent_id)`，`CHECK inviter_account_id <> invitee_account_id`。`(invitee_account_id,registration_id)` 匹配首次注册。合格回忆与被邀账号同属，记录其 `confirmed_seq`、确认时间和规则版本 | 消费事件只唤醒核对。回忆确认时在同账号锁下分配单调不可变 `confirmed_seq`，按它选最早满足原活动规则且仍合格的正式原文。奖励事务按账号 UUID 顺序锁双方，再锁归因，重验权威事实。同事务提交双方各自唯一奖励分录、归因状态及事件，任何一方失败全部回滚 |

建议首版资格口径为发放前已移除的回忆不计入，发放成功后按原政策保留证据和账务，争议走审计。样例、游客、导入和默认共创来源均不合格。只处理触发事件中的回忆 ID 会被事件乱序误导。改用权威确认序号后，确认顺序、资格与发放能分别核对。该口径及资格窗口需在启用 M02 前定稿。

### M03 · 共创、席位、采纳与领取

| 表 | 状态与关键时间 | 完整性、唯一性和幂等 | 并发与同事务边界 |
| --- | --- | --- | --- |
| `shared_goals` | `open → completed / revoked / expired`，完成后可撤回公开可见。另有 `publication_status pending / published / rejected`。`created_at`、`updated_at`、`expires_at`、`published_at?`、`completed_at?`、`revoked_at?`、`reward_frozen_at?`。公开有效须发布成功、未撤回且未过期 | 目标人物与 `owner_id` 同属。公开快照独立并固定批准范围。`CHECK target_units > 0 AND current_units >= 0`，上限及贡献单位按配置版本检验。当前进度和贡献分配互为核对 | 审核通过、分席、完成、撤回及受限领取先锁目标，复核版本、到期和开关。最后一席分配、更新累计值、完成时间、事件一起提交。撤回关闭公开投影与新申请，同时保留既有权利所需的历史 |
| `goal_contributions` | `pending_review → accepted / rejected`，授权撤回可转 `withdrawn`。`submitted_at`、`reviewed_at?`、`accepted_at?`、`withdrawn_at?`、`claim_expires_at?`、`source_authorization_version` | `UNIQUE(goal_id,participant_key)`。部分唯一 `(goal_id,seat) WHERE seat IS NOT NULL`。已接受须有席位和接受时间，待审或拒绝不得占席。首版建议撤回保留已占席位。若以后允许释放，显式记录释放时间和原席位审计，再在目标锁下释放分配 | 所有审核、撤回、领取和采纳采用目标优先、贡献在后。审核时重查剩余容量和参与资格。撤回使正文投影、未完成领取和采纳权限失效，已占席位及完成事实按冻结策略保留。采用只对 `accepted` 做唯一索引会在撤回时意外复用仍占用的席位 |
| `goal_reward_claims` | 已提交的领取回执，无独立中间状态。`granted_at`。原贡献的可领状态由审核、期限、授权及目标策略计算 | `UNIQUE(contribution_id)`、`UNIQUE(goal_id,account_id)`。组合外键确认贡献归该目标，入账与受益账号同属。匿名贡献必须在原访客会话内完成认证并核对证明，公开令牌无法充当领取凭证 | 先按固定顺序锁相关正式账号，再锁目标、贡献与批次，重查资格、权限版本和期限。领取、发券和通知事件同事务。旧请求回读原回执。同一贡献采纳为回忆由 `(account_id,person_id,goal_id,contribution_id)` 的业务唯一键保证并复核来源授权 |

### 后续批次必须做的竞争反例

| 竞争与重放输入 | 必须得到的结果 |
| --- | --- |
| 两个不同操作抢最后一张券，同一次扣减应答丢失后用原操作键重放。到达和确定失败并行处理 | 只扣一次，原键返回原投递。投递只出现一个终态，失败冲正至多一笔 |
| 同一回调重放，两笔不同渠道交易同时匹配同一订单，发放与全额退款相撞 | 重复收件去重。两笔真实交易保留，只有一笔胜出。退款先确认则停止发放，发放先提交则原批次最多冲正一次 |
| 两个退款请求竞争同一实付，送礼与退款预留同时抢同一批次，渠道先退款后通知付款 | 本地未决金额占用加已核验金额受原交易上限约束。权益可用量不为负。提前到达的退款证据可查回，渠道事实与账本分别对账 |
| 同账号两条合格回忆事件乱序，首条在资格提交前被撤回，双边奖写第二方失败 | 依据锁后权威资格和 `confirmed_seq`。首次发奖只有两笔都提交或两笔都回滚。重复事件不会产生新奖励 |
| 两个访客争最后一席，撤回后另一人申请原席位。两个访客身份绑定同一账号并领取 | 撤回保留席位的策略下原席位继续占用，正文和资格失效。同账号同目标只领一次 |

上述反例是实施验收口径。本轮实际完成的试验及范围见下节。

### 运营状态与按需入口

| 表 | 状态与业务时间 | 归属、并发与幂等 |
| --- | --- | --- |
| `content_reports` · SYS-04/05、OPS-01/02 | `open → reviewing → resolved`。`created_at`、`updated_at`、`resolved_at?`。结案才写 `resolved_at` 及决议。 | 本人报告和被报告对象分别验证可见性。证据引用限制权限。提交按请求键去重，运营按工单版本 CAS。隐藏对象与工单决议能同库提交时原子写，跨边界时等限制动作的权威结果后再结案。 |
| `reminders` · 可选跨端提醒 | `enabled` 和 `next_at?` 决定是否安排。`created_at`、`updated_at`、`last_fired_at?`。保存本地日期及 IANA 时区，调度使用已算出的 UTC。 | 提醒引用同账号人物，修改按版本，计划按 `(reminder_id,scheduled_for)` 去重。投递前复核当前版本、有效状态和目标权限。 |
| `call_sessions`、`transcriptions` · X01 按需 | 通话 `created → connected → ended/failed/expired`，连接前也可失败或到期。`created_at`、`expires_at`、`started_at?`、`ended_at?`。转写结果只保存已提交正文及 `created_at`、`expires_at`，进度由任务给出。 | 会话、人物和账号归属一致，外部房间和事件按提供方键去重。锁通话行处理结束与迟到连接。转写按任务结果唯一，撤权或超期后即时拒绝读回。平台选定后再冻结适配字段和迁移。 |

## K02 人物照片已实施生命周期（2026-11-13）

当前人物照片实现以 [K02 实施契约](./backend-api/identity-people.md#k02-人物照片实施基线2026-11-13) 和 People008／Media002 为准，不采用上文总体提案中的跨库 FK／锁。People `person_draft_media` 拥有账号内草稿、照片 ID、1–6 连续位置、成品版本及元数据；只对本库草稿建立复合 FK。同源确认人物后保持引用，首张为头像；资料替换在本库事务增人物版本，清空列表无需重新允许照片。

Media `person_photo` 使用独立 `person_draft_id`，与 `post_attachment/client_post_id` 互斥，`media_person_grants` 只接受同账号／同目标／同媒体的本库 FK。预绑定是候选而非读取许可，包含 `last_bound_at` 与 60 秒提交期限；People 等锁后按数据库时间拒绝过期绑定。最多六张的有序替换在 People 本库提交，网络验证在 SQL 锁外。已成功命令重试不重绑被移除图片，回读当前引用，不恢复旧照片。

源有效条件为未过期未确认草稿或同源 active 人物；已确认人物不随草稿旧期限过期。撤回照片许可阻止上传／读取但不删除；替换、移除或人物移除即时使旧证明失效。Media 扫描对无有效引用的成品保留 15 分钟预提交宽限，并在本库锁内复核绑定时间，避免扫描旧结果清除新绑定；已绑定图片不能通过 Media DELETE 绕过 People。确认后仍有效的图片不可清理。账号注销独立清除关系、暂存与成品，并保留围栏拒绝迟到写入。

Identity010 新增独立人物照片授权，空间照片 v1、文字和 AI 授权原样保留。People 导出有序 `photoRefs`，Media 导出实际 WebP 字节／摘要及 `personBindings`，均计入预算与 revision；撤回照片／AI 不阻断数据权利。恢复增加来源、顺序、绑定、版本、尺寸、对象路径归属、MIME 与实际字节关联核验；七库和对象缺一不可。具体原 UI、数据权利和恢复证据统一记在交付优先级文档当前接续。

## 验证证据与迁移门槛

本轮另启隔离的 PostgreSQL **16.14**，通过本机已有镜像运行，不开放端口，使用合成数据和最小 DDL。实际执行 **14 项断言**，其中 12 项由两个独立数据库连接产生竞争，并通过 `pg_stat_activity` 确认第二个事务确实在等锁。试验结束后关闭并移除临时容器。

| 验证输入 | 实际结果 |
| --- | --- |
| 两个请求争同一幂等键，分别试首事务提交和回滚 | 提交后后续请求读原回执，改参判冲突。首事务回滚后后续请求获得执行资格，旧副作用消失。 |
| 登录尝试在等锁时越过截止，旧授权请求与撤回竞争 | 锁后的数据库时间拒绝超期动作。旧授权版本的写入影响零行，撤回保留。 |
| 任务写回等待撤权，旧执行尝试等待新代次提交 | 当前授权失效或执行代次已变，旧写回影响零行。 |
| 两条回忆并发分配确认序号 | 第二条等待账号序号锁，最终序号不同且最先确认的仍排在前面。 |
| 两笔赠礼争最后一个可用单位，两次审批争最后一个席位 | 分别只产生一笔扣减和一个有效分配。撤回保留席位时，部分唯一索引继续拒绝抢占。 |
| 退款先确认与发放竞争，两笔退款争原实付额度，两笔真实扣款争同一订单发放 | 全退先提交时发放停止。两笔未决金额不超上限。两笔支付事实保留，发放只提交一次。 |
| 使用 B 账号引用 A 人物写消息 | 复合外键拒绝。 |

本轮证据覆盖原生 PostgreSQL 的代表性 DDL、条件更新、行锁竞争与回滚。完整迁移、实际接口和 Worker、对象存储、真实支付渠道、备份恢复与权限策略仍需分批联调。第一次正式迁移以本稿的状态、外键、唯一键、时间字段及锁顺序为核对项。对外状态语义或数据约束需要调整时，先列出受影响表和接口，再以可回读的增量迁移演练。 [迁移顺序](./backend-api-contract.md#534-迁移与首批数据库验收)
