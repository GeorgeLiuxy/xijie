# 西界数据结构评审

本页依据 PostgreSQL 设计草案，展示主键、归属、关联和关键约束。图内明确展示核心状态和业务时点。无独立状态的实体用事实字段表达，例如消息的移除时间、回忆的确认时间、发放回执的入账时间。逐表的可空条件、合法迁移、幂等键和取锁顺序见 [数据生命周期与一致性](./backend-data-lifecycle.md)。私域实体都以 `account_id` 约束归属，图中仅画关键路径。首期交付 K01–K05，礼物、支付与邀请按后续批次接入。 [数据结构草案](./backend-api-contract.md#53-postgresql-数据结构草案) · [交付顺序](./backend-delivery-priorities.md)

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
        bigint memory_confirmation_seq
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
        uuid account_id FK
        int version
        text status
        timestamptz updated_at
        timestamptz expires_at
    }
    persons["persons · 正式人物"] {
        uuid id PK
        uuid account_id FK
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
    accounts ||--o{ personDrafts : "保存"
    accounts ||--o{ persons : "拥有"
    personDrafts o|..o| persons : "确认产生"
    worlds ||--o{ persons : "当前世界"
~~~

- 同一个已验证的 `(issuer, subject)` 只映射一个西界账号。手机号、邮箱、昵称和设备标识用于各自的登录或展示场景。换绑与找回复用 `accountId`。游客浏览示例时没有正式账号或奖励资格。
- 会话槽只允许一条活动会话。切换的尝试代次、发起会话和有效期通过校验后，才在同一事务撤旧启新。取消或迟到回调不能替换当前会话。
- 正式人物的 `(account_id, source_draft_id)` 在来源存在时唯一。确认检查草稿和预览版本。迁居更新 `world_id`，保留同一个 `personId`。 [身份、人物与媒体规则](./backend-api/identity-people.md)

## 2. 会话、生成、回忆与素材

~~~mermaid
erDiagram
    direction TB
    persons["persons · 正式人物"] {
        uuid id PK
        uuid account_id FK
        text status
        timestamptz created_at
        timestamptz updated_at
        timestamptz removed_at
    }
    conversations["conversations · 会话"] {
        uuid id PK
        uuid account_id FK
        text kind
        uuid person_id FK
        uuid world_id FK
        bigint last_sequence
        timestamptz created_at
        timestamptz last_activity_at
    }
    messages["messages · 消息"] {
        uuid id PK
        uuid account_id FK
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
        uuid source_message_id FK
        uuid dispatch_id
        int dispatch_generation
        uuid attempt_id
        text state
        timestamptz queued_at
        timestamptz attempt_expires_at
        timestamptz finished_at
    }
    memoryCandidates["memory_candidates · 候选"] {
        uuid id PK
        uuid person_id FK
        uuid source_message_id FK
        int version
        timestamptz expires_at
        text state
        timestamptz created_at
        timestamptz consumed_at
    }
    memories["memories · 用户确认原文"] {
        uuid id PK
        uuid person_id FK
        uuid candidate_id FK
        text origin
        int version
        bigint confirmed_seq
        timestamptz confirmed_at
        timestamptz removed_at
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
    persons o|..o| conversations : "拥有唯一私聊"
    conversations ||--o{ messages : "按序提交"
    messages o|..o{ generationJobs : "作为生成来源"
    messages ||--o{ memoryCandidates : "供选取候选"
    persons ||--o{ memories : "关联回忆"
    memoryCandidates o|..o| memories : "用户确认"
    persons ||--o{ personMediaLinks : "挂接素材"
    mediaObjects ||--o{ personMediaLinks : "作为资料"
    mediaObjects ||--o{ mediaUploadSlots : "分配上传槽"
~~~

- 私聊绑定人物，小聚绑定世界。写消息时锁会话分配序号，保存用户消息、生成任务和事件。同一会话的同一 `clientMessageId` 只受理一次。回复只引用同会话消息。
- 同一个业务 `jobId` 可重试。明确重新入队时更新派发 ID 和代次，Worker 每次领取使用新的尝试 ID。写回同时核对当前尝试、源版本和用途授权，旧结果不能覆盖新结果。
- 候选经用户确认后保存独立的回忆原文。一份候选至多消费一次。删除来源消息使候选和来源链接失效，已确认原文按自身权限读回。搜索结果或回响携带来源版本，详情始终打开同一条 `memoryId`。
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
        uuid first_eligible_memory_id FK
        text state
        timestamptz registered_at
        timestamptz qualified_at
        timestamptz rewarded_at
    }
    memories["memories · 用户确认原文"] {
        uuid id PK
        uuid account_id FK
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
| 私域外键和数据库约束 | 表间外键带上账号。用 A 的人物或素材提交到 B 的会话应被拒绝。API 层单独核对会话和对象访问权限 |
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

实验范围是单进程、内存数据库和代表性 SQL，能支持上述外键、检查、唯一约束和事务回滚的结论。正式建表迁移、真实数据库多连接并发、队列重放、对象存储覆盖和备份恢复仍需在联调环境验证。现有前端仍由本机存储和 Vite 预览服务支撑。 [现有存储](../frontend/src/model.ts) · [迁移与首批数据库验收](./backend-api-contract.md#534-迁移与首批数据库验收)

