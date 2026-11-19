# 西界数据结构评审

本页依据 PostgreSQL 设计草案，展示主键、归属、关联和关键约束。图内明确展示核心状态和业务时点。无独立状态的实体用事实字段表达，例如消息的移除时间、回忆的确认时间、发放回执的入账时间。逐表的可空条件、合法迁移、幂等键和取锁顺序见 [数据生命周期与一致性](./backend-data-lifecycle.md)。私域实体都以 `account_id` 约束归属，图中仅画关键路径。首期交付 K01–K05，礼物、支付与邀请按后续批次接入。 [数据结构草案](./backend-api-contract.md#53-postgresql-数据结构草案) · [交付顺序](./backend-delivery-priorities.md)

**物理关系与实施范围。** `FK` 仅表示同一服务数据库内可实施的外键；跨服务的账号、人物、消息和记忆 ID 是外部引用，通过受控内部 HTTP 校验当前归属、访问和版本，图中业务关联线不代表共享数据库或跨库事务。K04 已实现独立 `memories` 服务的 MEM-01–07、FIND-01 和候选 Worker；候选、任务与原文关系已落 `002_memory_candidates.sql`，`original_created_at` 仍属于 K05 导入目标字段。正式迁移及验证以实际服务为准。

**K05 首片补充。** AI grant 在 Identity 本库通过 `(account_id,notice_purpose,notice_authorization_version)` 引用同账号隐私告知事件；内部上下文与公开授权状态共用 `aiTextProcessing` 计算。两个生成服务只保存核验的外部 AI 版本，不建立跨库 FK；具体字段、状态及迁移见[数据生命周期](./backend-data-lifecycle.md)与[AI 授权基线](./backend-api/identity-people.md#k05-首片实施基线ai-文字处理授权)。本片不等于 K05 全部数据权利完成。

## 1. 账号、登录与人物

~~~mermaid
erDiagram
    direction TB
    accounts["accounts · 西界账号"] {
        uuid id PK
        uuid registration_id UK
        text status
        int access_version
        timestamptz registered_at
        timestamptz updated_at
        timestamptz deleted_at
        bigint memory_confirmation_seq "兼容保留"
    }
    authIdentities["auth_identities · 登录身份"] {
        uuid id PK
        uuid account_id FK
        text issuer
        text subject
        text status
        timestamptz verified_at
        timestamptz disabled_at
    }
    appSessionSlots["app_session_slots · 会话槽"] {
        uuid id PK
        int generation
        timestamptz created_at
        timestamptz updated_at
    }
    authAttempts["auth_attempts · 授权尝试"] {
        uuid id PK
        uuid slot_id FK
        text client_registration_key
        int expected_generation
        text state
        timestamptz created_at
        timestamptz expires_at
        timestamptz finished_at
    }
    appSessions["app_sessions · 应用会话"] {
        uuid id PK
        uuid account_id FK
        uuid auth_identity_id FK
        uuid auth_attempt_id FK, UK
        uuid slot_id FK
        text client_registration_key
        int account_access_version
        text status
        timestamptz authenticated_at
        timestamptz expires_at
        timestamptz revoked_at
    }
    personDrafts["person_drafts · 人物草稿"] {
        uuid id PK
        uuid account_id "Identity 外部 ID"
        int version
        text status
        timestamptz updated_at
        timestamptz expires_at
    }
    persons["persons · 正式人物"] {
        uuid id PK
        uuid account_id "Identity 外部 ID"
        uuid source_draft_id FK
        uuid world_id FK
        int access_version
        text status
        timestamptz created_at
        timestamptz updated_at
        timestamptz removed_at
    }
    worlds["worlds · 世界目录"] {
        uuid id PK
        text code UK
        bool enabled
        timestamptz updated_at
    }
    accounts ||--o{ authIdentities : "拥有登录身份"
    authIdentities ||--o{ appSessions : "验证后启用"
    appSessionSlots ||--o{ authAttempts : "保留尝试记录"
    appSessionSlots ||--o{ appSessions : "保留会话记录"
    authAttempts ||..o| appSessions : "成功时建立"
    accounts ||..o{ personDrafts : "内部接口核对归属"
    accounts ||..o{ persons : "内部接口核对归属"
    personDrafts o|..o| persons : "确认产生"
    worlds ||--o{ persons : "当前世界"
~~~

- 同一个已验证的 `(issuer, subject)` 只映射一个西界账号。手机号、邮箱、昵称和设备标识用于各自的登录或展示场景。换绑与找回复用 `accountId`。游客浏览示例时没有正式账号或奖励资格。
- 会话槽只允许一条活动会话。切换的尝试代次、发起会话和有效期通过校验后，才在同一事务撤旧启新。取消或迟到回调不能替换当前会话。
- 正式人物的 `(account_id, source_draft_id)` 在来源存在时唯一。确认检查草稿和预览版本。迁居更新 `world_id`，保留同一个 `personId`。 [身份、人物与媒体规则](./backend-api/identity-people.md)
- Identity 已有的 `accounts.memory_confirmation_seq` 仅为迁移兼容保留，K04 不更新它。回忆确认序号由回忆服务本库的 `memory_account_cursors` 单独分配，与原文和事件一起提交。

## 2. 会话、生成、回忆与素材

~~~mermaid
erDiagram
    direction TB
    persons["persons · 正式人物"] {
        uuid id PK
        uuid account_id "Identity 外部 ID"
        text status
        timestamptz created_at
        timestamptz updated_at
        timestamptz removed_at
    }
    conversations["conversations · 会话"] {
        uuid id PK
        uuid account_id "Identity 外部 ID"
        text kind
        uuid person_id "People 外部 ID"
        uuid world_id "People 外部 ID"
        bigint last_sequence
        timestamptz created_at
        timestamptz last_activity_at
    }
    messages["messages · 消息"] {
        uuid id PK
        uuid account_id "Identity 外部 ID"
        uuid conversation_id FK
        bigint sequence
        uuid client_message_id
        uuid reply_to_message_id FK
        timestamptz created_at
        timestamptz removed_at
        timestamptz restricted_at
    }
    generationJobs["generation_jobs · 业务任务"] {
        uuid id PK
        int ai_authorization_version "旧任务0 新任务绑定许可版本"
        uuid source_message_id FK
        uuid dispatch_id
        int dispatch_generation
        uuid attempt_id
        text state
        timestamptz queued_at
        timestamptz attempt_expires_at
        timestamptz finished_at
    }
    memoryAccountCursors["memory_account_cursors · 回忆序号权威"] {
        uuid account_id PK "Identity 外部 ID"
        bigint last_confirmed_seq
        timestamptz created_at
        timestamptz updated_at
    }
    memoryGenerationJobs["memory_generation_jobs · 记忆 Worker"] {
        uuid id PK
        int ai_authorization_version "独立于文字保存版本"
        uuid account_id "Identity 外部 ID"
        uuid person_id "People 外部 ID"
        uuid source_message_id "Conversations 外部 ID"
        jsonb context_refs "实际消息版本引用"
        text state
        uuid dispatch_id
        int dispatch_generation
        uuid attempt_id
        timestamptz created_at
        timestamptz updated_at
        timestamptz started_at
        timestamptz lease_until
        timestamptz finished_at
    }
    memoryCandidates["memory_candidates · AI 建议 待用户确认"] {
        uuid id PK
        uuid account_id "Identity 外部 ID"
        uuid person_id "People 外部 ID"
        uuid source_message_id "Conversations 外部 ID"
        int source_version
        int version
        timestamptz expires_at
        text state
        timestamptz created_at
        timestamptz state_changed_at
        timestamptz consumed_at
    }
    memories["memories · 用户确认原文"] {
        uuid id PK
        uuid account_id "Identity 外部 ID"
        uuid person_id "People 外部 ID"
        uuid client_memory_id
        text request_hash
        uuid source_message_id "可选外部来源"
        int source_message_version "与来源成对"
        uuid candidate_id "AI 候选同库 FK"
        text origin
        text title
        text body
        int version
        bigint confirmed_seq
        timestamptz created_at
        timestamptz confirmed_at
        timestamptz original_created_at
        timestamptz updated_at
        timestamptz removed_at
    }
    memoryCommands["memory_commands · 已提交命令"] {
        uuid account_id PK
        text operation PK
        text target PK
        uuid idempotency_key PK
        text request_hash
        jsonb response "资源引用 无私人正文"
        timestamptz created_at
        timestamptz expires_at
    }
    memoryOutbox["outbox_events · 回忆域事实"] {
        uuid event_id PK
        uuid account_id
        uuid aggregate_id
        int aggregate_version
        text type
        timestamptz occurred_at
        timestamptz created_at
        timestamptz dispatched_at
        timestamptz next_retry_at
    }
    mediaObjects["media_objects · 素材"] {
        uuid id PK
        uuid account_id FK
        text status
        int authorization_version
        timestamptz created_at
        timestamptz verified_at
        timestamptz revoked_at
    }
    mediaUploadSlots["media_upload_slots · 暂存上传槽"] {
        uuid id PK
        uuid media_id FK
        text staging_key UK
        text state
        timestamptz created_at
        timestamptz expires_at
        timestamptz ended_at
    }
    personMediaLinks["person_media_links · 人物素材关联"] {
        uuid id PK
        uuid account_id FK
        uuid person_id FK
        uuid media_id FK
        text status
        timestamptz created_at
        timestamptz revoked_at
    }
    persons o|..o| conversations : "外部人物核验"
    conversations ||--o{ messages : "按序提交"
    messages o|..o{ generationJobs : "作为生成来源"
    messages ||..o{ memoryCandidates : "后续内部接口核验来源"
    messages o|..o{ memories : "可选手写摘录来源"
    persons ||..o{ memories : "内部接口核对当前人物"
    memoryAccountCursors ||--o{ memories : "同库锁内分配确认序号"
    memoryGenerationJobs ||--o| memoryCandidates : "成功生成 尚未确认"
    memoryCandidates o|..o| memories : "后续同库消费唯一候选"
    memories ||..o{ memoryCommands : "命令回读当前资源"
    memories ||..o{ memoryOutbox : "与命令及序号同事务"
    persons ||--o{ personMediaLinks : "挂接素材"
    mediaObjects ||--o{ personMediaLinks : "作为资料"
    mediaObjects ||--o{ mediaUploadSlots : "分配上传槽"
~~~

- 私聊绑定人物，小聚绑定世界。写消息时锁会话分配序号，保存用户消息、生成任务和事件。同一会话的同一 `clientMessageId` 只受理一次。回复只引用同会话消息。
- 同一个业务 `jobId` 可重试。明确重新入队时更新派发 ID 和代次，Worker 每次领取使用新的尝试 ID。写回同时核对当前尝试、源版本和用途授权，旧结果不能覆盖新结果。
- 候选经用户确认后保存独立的回忆原文。一份候选至多消费一次。删除来源消息使候选和来源链接失效，已确认原文按自身权限读回。搜索结果或回响携带来源版本，详情始终打开同一条 `memoryId`。
- 手写与直接摘录保存用户确认的文字，`origin=manual`；实际确认 AI 候选为 `ai_candidate`；摘录可记录经核验的 `source_message_id/source_message_version`，二者同空或同非空。删除来源后不再返回失效链接，独立原文仍依当前账号、人物与存储授权读取。人物移除后详情、列表、搜索及旧命令重放均不可读出原文。
- 本库以 `(account_id,person_id,client_memory_id)` 与请求指纹长期去重，以 `(account_id,confirmed_seq)` 保证账号内确认顺序，以 `(account_id,person_id,id)` 约束本地父子引用。修改和删除使用版本条件；初次确认时间、来源类型和确认序号保持不变。原文不另设草稿或生成中状态，`removed_at` 记录移除事实。
- 本地锁顺序为 `memory_account_cursors → memory_commands → memories`；原文、确认序号、命令回执和 Outbox 同事务。`memory_commands` 仅保存完成结果引用，不缓存私人正文；`created_at` 记录提交，`expires_at` 默认至少七天，缓存到期不释放原文业务唯一键。Outbox 保留发生、创建、派发与重试时间，写事件不等于后续消费者已完成。
- 素材只读已校验的固定版本。补签时旧上传槽失效。人物的素材关联与模型使用授权分别管理，另有 `media_use_grants` 约束。草稿素材关联、同意历史、投影与导入映射见完整表说明。 [会话与回忆规则](./backend-api/conversations-memories.md) · [私有素材与用途](./backend-api/identity-people.md#3-私有素材与用途)

## 3. 交易与礼物

~~~mermaid
erDiagram
    direction TB
    quotes["quotes · 报价"] {
        uuid id PK
        uuid account_id FK
        timestamptz expires_at
        timestamptz created_at
    }
    orders["orders · 订单"] {
        uuid id PK
        uuid account_id FK
        uuid quote_id FK, UK
        text payment_status
        text fulfillment_status
        timestamptz created_at
        timestamptz paid_at
        timestamptz closed_at
    }
    paymentAttempts["payment_attempts · 支付尝试"] {
        uuid id PK
        uuid order_id FK
        text state
        timestamptz created_at
        timestamptz expires_at
        timestamptz terminal_at
    }
    channelTransactions["channel_transactions · 渠道交易"] {
        uuid id PK
        uuid order_id FK
        text channel
        text environment
        text external_transaction_id
        timestamptz provider_occurred_at
        timestamptz verified_at
        timestamptz matched_at
    }
    fulfillments["fulfillments · 权益发放"] {
        uuid id PK
        uuid order_id FK, UK
        uuid channel_transaction_id FK
        uuid ledger_transaction_id FK
        timestamptz fulfilled_at
    }
    ledgerTransactions["ledger_transactions · 资产交易"] {
        uuid id PK
        uuid account_id FK
        text reason
        uuid source_id
        timestamptz created_at
    }
    ledgerEntries["ledger_entries · 权益分录"] {
        uuid id PK
        uuid lot_id FK
        uuid transaction_id FK
        bigint units
    }
    assetLots["asset_lots · 资产批次"] {
        uuid id PK
        uuid account_id FK
        bigint available_units "派生"
        bigint balance_units
        bigint reserved_units
        timestamptz issued_at
        timestamptz expires_at
    }
    giftDeliveries["gift_deliveries · 礼物投递"] {
        uuid id PK
        uuid conversation_id FK
        uuid debit_transaction_id FK
        text status
        text acceptance_key
        timestamptz accepted_at
        timestamptz arrived_at
        timestamptz failed_at
    }
    refunds["refunds · 退款事实与权益处置"] {
        uuid id PK
        uuid channel_transaction_id FK
        text channel_state
        text benefit_state
        timestamptz created_at
        timestamptz verified_at
        timestamptz applied_at
    }
    refundHolds["refund_lot_holds · 退款预留"] {
        uuid refund_id FK
        uuid lot_id FK
        text state
        timestamptz held_at
        timestamptz consumed_at
        timestamptz released_at
    }
    channelTransactions ||--o{ refunds : "原交易退款"
    refunds ||--o{ refundHolds : "占用待逆转权益"
    assetLots ||--o{ refundHolds : "预留原批次"
    quotes ||--o| orders : "成单"
    orders ||--o{ paymentAttempts : "尝试付款"
    orders o|..o{ channelTransactions : "匹配已验交易"
    orders ||--o| fulfillments : "最多发放一次"
    channelTransactions ||--o| fulfillments : "胜出交易"
    ledgerTransactions ||--o| fulfillments : "记录入账"
    ledgerTransactions ||--|{ ledgerEntries : "包含分录"
    assetLots ||--o{ ledgerEntries : "关联批次"
    ledgerTransactions o|..o| giftDeliveries : "关联赠礼扣减"
~~~

- **R02 礼物和资产**。资产交易按 `(account_id, reason, source_id)` 唯一，分录数量为正，批次可用量非负。扣减、投递和出站任务同事务。礼物的收件人物要与会话对应，消息卡和礼物详情引用同一个投递 ID。免费礼物可以没有扣减分录。
- **M01 支付**。每个报价最多成一单，每订单最多一条未终结支付尝试。真实渠道交易按渠道、环境和外部交易号去重。允许一单出现多笔真实扣款，只有一笔胜出并发放一次权益。额外扣款和归属不明的交易进入对账。退款单独保存并关联原交易和逆向分录。
- **M02 邀请**。链接先生成短期邀请意图。首次验证注册后，以 `invitee_account_id` 的唯一约束绑定归因。该账号确认首条合格回忆后，归因 ID 作为账本来源，在同一事务分别写入双方奖励。退款、回忆删除和活动撤回按所属数据的保留规则处理。
- **M03 共创**。公开链接读取有限投影。席位、贡献身份和奖励领取分别去重。采纳时按贡献来源只写入一份已确认回忆。 [交易与活动规则](./backend-api/assets-commerce.md)

## 4. 邀请归因与奖励

~~~mermaid
erDiagram
    direction TB
    accounts["accounts · 新注册账号"] {
        uuid id PK
        uuid registration_id UK
        timestamptz registered_at
        timestamptz updated_at
        timestamptz deleted_at
        bigint memory_confirmation_seq
    }
    referralLinks["referral_links · 邀请链接"] {
        uuid id PK
        uuid inviter_account_id FK
        int policy_version
        text state
        timestamptz created_at
        timestamptz expires_at
        timestamptz revoked_at
    }
    invitationIntents["invitation_intents · 短期意图"] {
        uuid id PK
        uuid link_id FK
        timestamptz expires_at
        timestamptz created_at
        timestamptz consumed_at
    }
    referralAttributions["referral_attributions · 正式归因"] {
        uuid id PK
        uuid inviter_account_id FK
        uuid invitee_account_id FK, UK
        uuid registration_id FK
        uuid first_eligible_memory_id "Memories 外部 ID"
        text state
        timestamptz registered_at
        timestamptz qualified_at
        timestamptz rewarded_at
    }
    memories["memories · 用户确认原文"] {
        uuid id PK
        uuid account_id "Identity 外部 ID"
        text origin
        timestamptz confirmed_at
        bigint confirmed_seq
        timestamptz removed_at
    }
    ledgerTransactions["ledger_transactions · 双方入账"] {
        uuid id PK
        uuid account_id FK
        text reason
        uuid source_id
        timestamptz created_at
    }
    referralLinks ||--o{ invitationIntents : "生成意图"
    invitationIntents ||..o| referralAttributions : "首次验证时消费"
    accounts ||--o| referralAttributions : "登记受邀者"
    memories o|..o| referralAttributions : "核对首条合格回忆"
    referralAttributions ||..o{ ledgerTransactions : "作为奖励来源"
~~~

图中虚线包括业务触发关系。建号与归因消费同事务。合格回忆必须属于受邀账号，确认时间晚于注册时间，并满足记录下来的活动版本。奖励对双方分别使用同一归因 ID 和各自账号唯一入账。样例、游客和导入内容不触发奖励。 [邀请归因规则](./backend-api/assets-commerce.md)

## 5. 实施时优先固定的约定

| 优先固定 | 核对方式 |
| --- | --- |
| 对外 ID 和权威来源 | 账号、人物、消息、回忆、订单和礼物各有稳定 ID。切号、人物迁居和索引重建后读回同一业务对象 |
| 私域关联和数据库约束 | 同服务表间外键带上账号；跨服务 ID 通过内部接口核对归属与当前版本，不创建跨库 FK。用 A 的人物或素材提交到 B 的会话应被拒绝。API 层单独核对会话和对象访问权限 |
| 有副作用的事务 | 首次建号、消息受理、回忆确认、礼物扣减、订单发放和邀请奖励均有去重约束及原子提交要求。断连后按原操作 ID 回读 |
| 字段和索引细节 | 先用 K01–K05 联调样本检查列类型、非空、分页和查询计划。索引、归档期限及多商户交易号命名空间随数据量和渠道验证后定稿 |
| 数据迁移 | 本机资料只在归属确认后导入。用来源空间、旧父级范围和旧 ID 去重。备份恢复后复核当前撤权和删除记录 |

## 6. 数据库约束试验

使用临时目录中的 PGlite 0.4.1（PostgreSQL 17.5 WebAssembly）运行内存数据库。以草案中的代表性表和约束编写最小 SQL，运行 17 项断言。 [PGlite 内存数据库](https://pglite.dev/docs/)

| 实际断言 | 结果 |
| --- | --- |
| 已绑定的身份主体再关联其他账号，应用会话引用他人身份，B 会话挂接 A 人物 | PostgreSQL 拒绝重复主体和两处跨账号引用 |
| 同一会话槽再建活动会话，同一草稿再确认人物，同一人物再建私聊，私聊同时绑定世界 | PostgreSQL 拒绝全部冲突 |
| 同一客户端消息重复提交，回复跨会话关联，消息、任务与事件在同事务内回滚 | 重复提交和跨会话引用被拒绝，回滚后未留下该消息、任务或事件 |
| 素材缺少已校验对象引用、重复活动上传槽、候选被两份回忆引用 | PostgreSQL 拒绝全部非法写入 |
| 负资产余额、重复奖励来源、重复渠道交易、同一订单第二次发放 | PostgreSQL 拒绝全部非法写入 |

以上是早期单进程、内存数据库和代表性 SQL 的实验记录，只支持当时的外键、检查、唯一约束和事务回滚结论；不能据此认定跨服务 FK、K04 正式迁移或真实多连接并发已经通过。当前账号、人物、文字会话已分别接入独立服务，K04 本轮按上述物理边界实施；记忆迁移、跨端原文、删除失效及权限仍需用实际服务验收。对象存储与备份恢复按对应批次另验。 [现有存储](../frontend/src/model.ts) · [迁移与首批数据库验收](./backend-api-contract.md#534-迁移与首批数据库验收)


## 7. 已实施的数据权利关系（K05 第二片）

下面仅实线表示 Identity 本库 FK；各域围栏由内部 HTTP 触发，不是共享数据库。`data_rights_commands` 的操作目标和结果仅为 ID 引用，正文只存在有期限的加密导出件。

~~~mermaid
erDiagram
    accounts ||--o{ data_requests : owns
    app_sessions ||--o{ data_export_grants : authorizes
    data_requests ||--o| data_request_receipts : deletion_progress
    data_requests ||--o| data_exports : encrypted_result
    data_requests ||--o{ data_export_grants : permits_download
    data_requests ||--o{ data_rights_commands : idempotent_result
    data_requests {
        uuid id PK
        uuid account_id FK
        text kind
        text scope
        text status
        int version
        uuid dispatch_id
        int dispatch_generation
        uuid attempt_id
        int attempt_count
        jsonb progress
        timestamptz requested_at
        timestamptz updated_at
        timestamptz started_at
        timestamptz finished_at
        timestamptz lease_until
        timestamptz result_expires_at
    }
    data_request_receipts {
        uuid receipt_id PK
        uuid request_id FK
        text proof_hash
        timestamptz created_at
        timestamptz expires_at
    }
    data_exports {
        uuid request_id PK,FK
        bytea ciphertext
        text digest
        jsonb revisions
        timestamptz created_at
        timestamptz expires_at
    }
    data_export_grants {
        uuid id PK
        uuid request_id FK
        uuid session_id FK
        uuid idempotency_key
        timestamptz created_at
        timestamptz expires_at
    }
    data_rights_commands {
        uuid account_id FK
        text operation
        uuid target
        uuid idempotency_key
        uuid result_id FK
        text request_hash
        timestamptz created_at
    }
~~~

本地擦除围栏：People/Conversations 各自的 `account_erasure_fences`，Memories 的 `memory_account_write_gates` 与 `memory_erasure_receipts`。Active gate也存在，私有写与擦除取得同一账号行锁；擦除后迟到写被拒绝，旧可重复读快照遇更新冲突回滚。各表字段及时间／状态组合以 Identity 005、People 005、Conversations 003、Memories 004 实际 SQL 为准。

