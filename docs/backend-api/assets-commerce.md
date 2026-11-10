# 礼物、公开互动与交易接口

适用 R02、M01、M02、M03 与按需扩展，覆盖 E01–E05、F01–F06、G01–G05。本文使用[主接口契约](../backend-api-contract.md)的账号上下文、HTTP 响应、分页、版本、幂等、任务与事件信封。表内响应列表示 `data`。可空字段显式返回 `null`，查询不会推进交易状态。除另注明，写入使用 `Idempotency-Key`，条件更新同时使用 `If-Match: "v<N>"`。业务资源的 UUID 由服务端生成，支付平台标识和公开令牌另作外部标识处理。

当前客户端的试用邮资、120 字留言、最多 99 件、基础券可抵指定纪念品或道具和单件 1–8 邮资等来自演示规则。下文把这些条件作为首版可实现的赠礼校验，初始赠送量、活动面额、有效期、售卖 SKU、价格及各区域能力由审核过的版本配置决定。演示中的 120 初始邮资、40 邮资商品、报价与客户端模拟付款状态留在预览环境。 [礼物存储](../../frontend/src/gifts/store.ts) · [演示报价](../../frontend/src/commerce/checkout.ts) · [交付优先级](../backend-delivery-priorities.md)

## 数据责任和业务状态

| 对象 | 关键字段与约束 | 权威来源 |
| --- | --- | --- |
| `GiftCatalogItem` | `id`、`version`、`name`、`category`、`effect`、`audiences[]`、`unitPostage`、`stackable`、`acceptsVoucher`、`available`。历史名称、效果、世界及价格写入发件快照 | 礼物目录。`unitPostage` 是虚拟权益单位 |
| `AssetLot`、`LedgerTransaction`、`LedgerEntry` | `accountId`、资产类型 `postage / inventory / voucher`、`assetId`、来源 `trial / promotion / paid`、`availableUnits`、`issuedAt`、`expiresAt?`、`policyVersion`。交易 `reason`、`sourceId`、`createdAt`，分录 `direction: credit / debit`、`units > 0`、`lotId`。`(accountId,reason,sourceId)` 唯一。同一写事务记录分录和余额投影，余额可由分录重建 | 资产账本。按账号、资产和批次锁定，禁止负可用量。分录只追加，退款单独记逆向分录 |
| `GiftDelivery`、`ReceivedGift` | `id`、`accountId`、`personId`、`conversationId`、商品与人物快照、`quantity`、`note`、`debitTransactionId?`、`version`。发件 `in_transit → arrived / delivery_failed`。收件 `unopened → opened`，`placement: record / space` 与打开状态独立。剧情回礼以 `sourceDeliveryId` 唯一 | 礼物服务。历史按权限读取，人物迁居、改名或移除不会重写历史快照 |
| `Notification` | `id`、`accountId`、`type`、`sourceEventId`、`objectId`、`createdAt`、`readAt?`、`version`。`(accountId,type,sourceEventId)` 唯一 | 通知表。余额和订单继续从各自资源查 |
| `ReferralLink`、`InvitationIntent`、`ReferralAttribution` | 链接归属、活动版本、`tokenHash`、`expiresAt`、`revokedAt?`。意图短时有效并绑定浏览器或 App 发起会话。归因 `registrationId`、`inviterAccountId`、`inviteeAccountId`、`linkId`、`firstEligibleMemoryId?`、`state`。`inviteeAccountId` 唯一，双方不得相同 | 邀请服务。`awaiting_memory → rewarded / ineligible`。未注册的链接访问属于意图，无归因记录 |
| `SharedGoal`、`GoalContribution`、`GoalRewardClaim` | 目标 `ownerId`、`personId`、`kind`、`state`、`targetUnits`、`currentUnits`、`version`，发布快照与私有人物分开。贡献 `participantKey`、`state`、`seat?`、`text`、`sourceAuthorizationVersion`。`(goalId,participantKey)` 和席位非空时的 `(goalId,seat)` 分别唯一。若撤回按规则保留席位，仍继续占用唯一键。领取绑定贡献与真实账号，`contributionId`、`(goalId,accountId)` 分别唯一 | 共创服务。目标 `open → completed / revoked / expired`，已完成允许撤回公开可见。贡献 `pending_review → accepted / rejected`，有授权撤回需求时转 `withdrawn` 并使投影失效 |
| `Product`、`Quote`、`Order` | `productId`、`productVersion`、渠道商品映射、权益方案和 `policyVersion`。报价保存 `accountId`、渠道、商品快照、`pricingSource: merchant / store`、`price?`、`storeProductId?`、`expiresAt`。一个报价只创建一个订单，订单锚定原账号和快照 | 商城。货币 `Money = {amountMinor: 正整数, currency: ISO 4217}`。店内商品的成交价格以官方可验证数据为准，缺失时保持 `null` 并在对账补全 |
| `PaymentAttempt`、`ChannelTransaction`、`Fulfillment`、`Refund` | 支付尝试 `id`、`orderId`、`channel`、`environment`、渠道订单号或原生关联 ID、`state`。交易 `(channel,environment,externalTransactionId)` 唯一，绑定首个有效订单。发放 `orderId` 唯一，引用验证通过的 `channelTransactionId`、`ledgerTransactionId`。退款以渠道退款标识及本地操作 ID 分别去重，引用原交易与冲正分录 | 商城交易表保存支付和退款证据，账本保存最终发放和逆向权益。金额与邮资单位分开 |
| `PaymentCallbackInbox`、`PaymentReconciliationCase` | 回调 `channel`、`environment`、可信事件 ID 或已验证内容指纹、时间、处理状态、仅必要的证据引用。差异单 `orderId?`、`channelTransactionId?`、`reason`、`state`、`version`，记录处置人、时间和证据摘要 | 支付接入与运营。签名原文若渠道复核必需，限时加密保存，访问单独授权。常规日志留脱敏事件号和结果 |

资产批次用途及扣减顺序按策略版本固定。首版赠礼每次只消费一种来源。邮资批次在该来源内按到期时间、发放时间和 UUID 稳定扣减，`expiresAt=null` 排在有有效期批次之后。库存按所选礼物的资产 ID 扣，基础券只扣一张且不叠加邮资。免费礼物仍有唯一回执，扣减交易可空。内购产生的付费邮资有效期保持为空。未启用跨市场互通时，渠道或发行范围限制由账本批次策略校验。 [Apple 审核指南 3.1.1](https://developer.apple.com/app-store/review/guidelines/)

## 礼物和资产 HTTP

| 接口及覆盖 | 请求及成功响应 | 权限、处理顺序与恢复 |
| --- | --- | --- |
| `GET /v1/gift-catalog` E01 | 查询 `personId?`、`category?`、`cursor?`、`limit?`。返回 `GiftCatalogItem[]`，有目标时附 `availableSources[]` 与 `unavailableReason?` | 登录账号。对目标先做归属校验和人物状态检查。目录与可用来源是当前快照，确认寄出时重新校验。目标越权返回 `NOT_FOUND` |
| `GET /v1/wallet` E01/E04/G05 | 返回 `{version,asOf,balances:[{assetType,assetId,source,availableUnits,nearestExpiryAt?}]}` | 本人。读取已提交余额，按来源分组。过期批次在计算可用量时排除，批次到期留账本事件 |
| `GET /v1/wallet/ledger` E04 | 查询 `assetType?`、`reason?`、`cursor?`、`limit?`。返回 `{transactionId,reason,sourceId,createdAt,entries:[{assetType,assetId,source,direction,units}]}` 列表 | 本人。按 `createdAt,id` 倒序稳定翻页。保留可公开给本人的历史分录，渠道验签证据及他人信息剥离 |
| `POST /v1/gift-deliveries` E01/E02/E03 | `{personId,giftId,catalogVersion,quantity,source: trial / paid / inventory / voucher,note?}` → `201 GiftDeliveryView`，含 `id,personId,conversationId,giftSnapshot,quantity,note,status,scheduledArrivalAt,arrivedAt,version,debitTransactionId` | 本人。先查已完成幂等记录及回执的持久 `(account_id,acceptance_key)` 与请求指纹，再验目录版本、目标、数量、赠言和适用策略。短期请求缓存清理后仍可查回原扣减和投递。`note` 去首尾空白后最多 120 字，`quantity` 为 1–99 的整数，不可叠加礼物限 1。券仅限配置允许且单件 1–8 邮资的纪念品或道具。事务内按全域锁顺序校验并锁定有效人物及账号账本批次，用数据库时间复核有效期。扣减、建回执、登记幂等结果并入队。无聊天时复用 `ConversationService.ensureDirect`。`INSUFFICIENT_ASSET` 保留客户端草稿。目录变化返回 `CATALOG_VERSION_CHANGED`。未知结果重试原键 |
| `GET /v1/gift-deliveries` E02/E04 | 查询 `personId?`、`status?`、`displayable?`、`cursor?`、`limit?`。返回 `GiftDeliveryView[]` | 本人。历史列表按快照查询。`displayable=true` 按已抵达、可摆放和当前人物可见性过滤，供人物空间 |
| `GET /v1/gift-deliveries/{deliveryId}` E02/E03 | 返回 `GiftDeliveryView`，另有 `{photoMediaId?,placementHint?,reversalTransactionId?}` | 本人。按照持久化状态查询，超过计划抵达时间仍在投递时保留真实状态。签名图片链接走媒体接口 |
| `PUT /v1/gift-deliveries/{deliveryId}/photo` E02 | `{mediaId}` → `200 GiftDeliveryView` | 本人、已抵达、`If-Match`。要求照片已通过媒体校验且许可包含 `gift_delivery_photo`。事务中用 `Media.bindUse` 替换引用并记录版本，失败保留原图，清理任务检查引用后再处理旧图 |
| `GET /v1/received-gifts` E03/E04 | 查询 `personId?`、`placement?`、`opened?`、`cursor?`、`limit?`。返回 `ReceivedGiftView[]`，含 `{id,personId,sourceDeliveryId,giftSnapshot,quantity,note?,openedAt,placement,createdAt,version}` | 本人。未打开记录只提供卡片字段，正文明细等到拆开。`placement=space` 用于我的空间 |
| `GET /v1/received-gifts/{receivedGiftId}` E03 | 返回 `ReceivedGiftView` | 本人。隐藏他人的来源信息。资源已失效按数据保留策略返回 `NOT_FOUND` 或受限的历史快照 |
| `POST /v1/received-gifts/{receivedGiftId}/open` E03 | `{}` → `200 ReceivedGiftView` | 本人。仅首次写 `openedAt` 并增版本，多次拆开返回原状态。拆开不记权益分录 |
| `PATCH /v1/received-gifts/{receivedGiftId}` E03 | `{placement: record / space}` → `200 ReceivedGiftView` | 本人、`If-Match`。先验已打开，`space` 只允许符合场景规则的物件。未打开返回 `GIFT_NOT_OPENED`，不支持摆放返回 `GIFT_NOT_DISPLAYABLE` |
| `GET /v1/notifications` E05 | 查询 `unread?`、`type?`、`cursor?`、`limit?`。返回 `{id,type,objectId,createdAt,readAt,version}` 列表。未读数量由同一查询的 `meta.unreadCount` 提供 | 本人。数据来自真实通知记录。已授权的对象经业务读接口打开，访问撤回时保留无敏感内容的事件摘要 |
| `PATCH /v1/notifications/{notificationId}` E05 | `{read: true}` → `200` 原通知及 `readAt` | 本人、`If-Match`。首次写已读时间，已读保持原时间。通用消息中心按启用范围开放，通知可跨设备查回 |

投递 Worker 用计划时间和 `deliveryId` 查待处理记录。成功时在短事务内条件更新为已抵达，并发出 `GiftDeliveryArrived.v1`。可重试错误保留处理中并退避。只有确定无法投递、且仍未抵达时才能在同事务写 `delivery_failed`、`GiftDeliveryFailed.v1` 与一次原资产冲正，键为 `gift_reversal:deliveryId`。如原批次已到期，按版本化政策计算可用量，保留原来源。订单退款和投递冲正各自有自己的来源与审计记录。剧情回礼由服务端根据已抵达快照和当前许可决定，`sourceDeliveryId` 保证至多一份。收件人的回礼操作重新调用发件接口并进行同样的校验。

## 邀请与共创 HTTP

公开 SPA 路由 `/invite/:id`、`/gifts/:id`、`/relay/:id` 只承载页面和深链接。正式 API 使用下面的 `/v1/public/...` 路径。分享地址使用随机高熵令牌。查找和校验用 `tokenHash`。需要向本人重发同一分享地址时，额外保留独立加密的令牌副本，只在已授权查询时解密。日志、追踪和错误信息脱敏。客户端从分享页跳转或复制链接属于端侧行为。预览链接及浏览器奖励不迁为正式权益。

| 接口及覆盖 | 请求及成功响应 | 权限、处理顺序与恢复 |
| --- | --- | --- |
| `POST /v1/referrals/links` F01 | `{}` → `201 {linkId,shareUrl,expiresAt,version}`，已有可用链接时 `200` | 登录账号。活动策略已启用才生成，服务端从账号和活动获取公开别名和版本。在同一账号活动下并发生成返回唯一可用链接。口令不写常规日志 |
| `GET /v1/referrals/links` F01 | 查询 `cursor?`、`limit?` → `{linkId,status,shareUrl?,createdAt,expiresAt,version}[]` | 本人。仅有效链接返回分享地址。从独立加密副本读回分享地址，撤回后只返链接元数据 |
| `POST /v1/referrals/links/{linkId}/revoke` F01 | `{}` → `200 {linkId,status,version}` | 本人、`If-Match`。撤回后拒绝新意图和尚未绑定的注册，已提交的真实归因按原活动版本继续处理 |
| `GET /v1/public/referrals/{token}` F01 | `{inviterDisplayName?,campaignLabel,expiresAt,canStart}` | 允许匿名。校验链接与活动有效性，仅返批准公开的字段。无效、过期及撤回统一 `NOT_FOUND`。既有用户只能查看公开信息 |
| `POST /v1/public/referrals/{token}/intents` F01 | `{}` → `201 {invitationIntentId,expiresAt}` | 允许匿名。限流并绑定发起会话，创建短时、一次性注册意图。身份服务只接受与 `/v1/auth/attempts` 同一发起会话绑定的意图。只有首次真实注册事务才消费并写入归因 |
| `GET /v1/referrals` F02 | 查询 `cursor?`、`limit?` → `{attributionId,role,state,registeredAt,qualifiedAt?,rewardedAt?,rewardTransactionId?}[]` | 本人只读己方参与记录。不返回手机号、记忆 ID、正文或对方资产。账本成功后状态才到 `rewarded` |
| `POST /v1/shared-goals` F03 | `{personId,kind: album / flight / home,publicTitle,publicMessage?}` → `201 {goal,shareUrl}`。待审核时 `shareUrl=null` | 本人。校验人物、活动类型、发布字段和用途同意。发起人不参与访客贡献或领取。首个类型建议 `album`，其余按能力开关。容量、积分单位、席位和期限来自版本化配置。公开文本需通过审核才能发布。草稿或待审内容保持私人可见 |
| `GET /v1/shared-goals` F03 | 查询 `personId?`、`state?`、`cursor?`、`limit?` → `SharedGoalView[]` | 仅发起人。`SharedGoalView` 有 `id,personId,kind,publicTitle,state,currentUnits,targetUnits,expiresAt,version,shareUrl?`，待审核允许通过独立 `publicationStatus: pending / published / rejected` 表示 |
| `GET /v1/shared-goals/{goalId}` F03/F04 | `SharedGoalView` 加 `contributions:[{id,seat?,state,approvedText?,acceptedAt?}]`，列表按目标容量上限返回 | 仅发起人。贡献内容的使用许可复核后才返 `approvedText`，可采纳范围由服务端判断。待审不计进度 |
| `POST /v1/shared-goals/{goalId}/revoke` F03 | `{}` → `200 SharedGoalView` | 发起人、`If-Match`。事务中撤回公开投影，禁止新贡献。已接受贡献的资格、处理与历史可查范围按参与时的活动版本。支持运营冻结争议资格 |
| `GET /v1/public/shared-goals/{token}` F03 | `{kind,publicTitle,publicMessage?,currentUnits,targetUnits,state,expiresAt,canContribute,myContribution?}` | 允许匿名。显示批准公开的快照与合计进度。`myContribution` 仅凭该参与会话或账号可见，含 `{id,state,seat?,rewardEligible}`。公开响应不含人物 ID、贡献原文、他人身份及领取凭证 |
| `POST /v1/public/shared-goals/{token}/contributions` F03/F04 | `{text?,partId?}` → `202 {contributionId,state:pending_review}` 或 `201 {contributionId,state:accepted,seat,currentUnits,rewardEligible}` | 允许匿名。参与主体由登录账号或服务端签发的短时访客会话确定。校验来源、限流、用途同意及目标种类参数。审核通过时锁目标，检查有效期、席位、参与唯一性和部分组件唯一性。最后一席只接受一份。待审不占席，审批时满席则 `rejected`，记录原因。已接受贡献与进度、资格在一事务提交 |
| `POST /v1/shared-goal-rewards/claims` F04 | `{contributionId}` → `200 {contributionId,ledgerTransactionId,grantedAt}` | 登录账号。已登录贡献按原参与账号领取，匿名贡献首版在原访客会话内完成认证后领取。跨设备匿名转交待独立设计。校验同一参与主体、期限、授权、目标策略及一人一次，事务绑定贡献、发放权益和写通知事件。已领取本人重试返回原结果，其他账号返回 `NOT_FOUND`。同一账号多访客身份仅可领取一次 |
| `POST /v1/shared-goals/{goalId}/contributions/{contributionId}/adopt` F04 | `{}` → `201 {memoryId,version}`，已采纳 `200` | 发起人。锁目标与贡献并复核用途授权版本，读取已通过审核的原文，由 `Memories.confirmFromContribution` 在同事务创建原文及来源。`(accountId,personId,goalId,contributionId)` 唯一。共创来源默认不触发首条回忆奖励 |

邀请归因由 `Referrals.bindRegistration` 在账号创建事务中按链接有效性、真实新注册和不可自邀规则锁定。成功后 `AccountRegistered.v1` 携带 `referralAttributionId`。处理 `MemoryConfirmed.v1` 时从服务端检查记忆来源、确认状态、是否在注册后的有效窗口以及策略版本。按受邀账号的权威 `confirmed_seq` 选择首条仍合格的正式回忆，事件到达顺序只用于唤醒复核。任务使用归因行锁和受益账号固定锁顺序，在一笔事务内写双方权益、归因状态与各自通知事件。重复或乱序事件先比对归因与权益唯一键，找不到前置证据时安排重查。发放后，活动策略决定记忆后续移除对已得权益的影响。首版建议不自动回收已履约奖励，欺诈争议走运营审核及逆向分录。

共创的活动配置应明确有效期、允许的目标类型、贡献内容上限、参与资格和领取期限。已到期或撤回的链接返回 `NOT_FOUND`，已接收贡献的领取资格可按参与时的规则在原领取期限内继续，运营冻结时暂停。发起人撤回链接会收回公开投影。素材用途撤回会阻断新采纳，已采纳回忆按回忆域的来源撤权政策处理。首版撤回正文会清除内容投影及采纳权，已占席位与完成事实仍按批准的匿名进度规则处理。 [预览共创字段与席位](../../frontend/preview-server/gifts.ts) · [预览邀请标记](../../frontend/preview-server/invites.ts)

### 按需接力与运营推荐

F05 保持独立业务来源，首发默认关闭。若确认保留，再启用下列路径。预览里四个席位和兑换规则可作为活动配置起点。正式活动的资格、奖品范围、旧链接迁移和存续期先定。 [现有接力服务](../../frontend/preview-server/relay.ts)

| 接口 | 请求及响应 | 权限与逻辑 |
| --- | --- | --- |
| `POST /v1/relays` | `{worldId,parcelType,publicMessage?}` → `201 {relayId,shareUrl,state,expiresAt,version}` | 登录账号。校验活动、世界和内容后创建，发起人席位在同事务分配 |
| `GET /v1/relays` | 查询 `cursor?`、`limit?` → `{relayId,role,state,joinedAt,canRedeem}[]` | 本人，只查本人发起或已绑定参与 |
| `GET /v1/public/relays/{token}` | `{worldId,parcelType,publicMessage?,state,capacity,occupied,myParticipation?}` | 匿名可读的限字段投影，凭据无效返回 `NOT_FOUND` |
| `POST /v1/public/relays/{token}/contributions` | `{wish?}` → `201 {participationId,seat,state}` | 允许匿名但绑定访客会话。按活动规则分席、锁定末席、本人参与去重 |
| `POST /v1/relays/{relayId}/redemptions` | `{participationId,worldId,parcelType}` → `200 {redemptionId,recordedAt}` | 登录账号和原参与证明。每人一次，选项由规则校验。兑换存接力记录，正式账本互通另按活动配置启用 |

F06 固定版本推荐继续由客户端维护。若明确需要运营投放，才启用以下接口。

| 接口 | 请求及响应 | 权限与逻辑 |
| --- | --- | --- |
| `GET /v1/discovery/recommendations` | `cursor?`、`limit?` → `{campaignId,contentVersion,title,actionType,actionId?,endsAt,version}[]` | 登录账号。按产品版本、地区和有效期过滤，动作来自受控白名单。服务端执行频次及可见性规则 |
| `PUT /v1/discovery/recommendations/{campaignId}/state` | `{contentVersion,action: seen / dismissed}` → `200 {state,version}` | 登录账号。按账号和内容版本合并，关闭为该版本终态。重试不增加展示次数，旧内容版本不能覆盖新版本 |

## 商品、付款和售后 HTTP

已列入评估的支付渠道值为 `apple_iap / play_billing / wechat_pay / alipay / stripe`。`channel` 标识实际结算渠道，与操作系统分别配置。新增发行端通过配置选择已验证的渠道或接入对应 `PaymentProvider`，共用报价、订单、权益和账本契约。发行渠道和地区使用服务端发行配置及可信商店上下文。客户端的平台、语言、地区和方式选择只作为受校验的提示。首版 M01 选一个渠道和一个商品，其他组合返回 `FEATURE_DISABLED`。原生桥仅传官方唤起参数、订单关联标识和购买凭证。商户密钥、验签密钥和后台权限不下发。购买入口只展示本端已启用且可处理的渠道。旧客户端遇到未知渠道时仍可按稳定状态读同账号历史订单，并使用通用渠道名称。渠道专属唤起和售后动作由已支持的端处理。

`OrderView` 返回 `{orderId,productSnapshot,pricingSource,price,paidAmount,channel,status,attemptSummary?,fulfillmentStatus,refundStatus,createdAt,updatedAt,version}`。`price` 和 `paidAmount` 分别表示报价与已核对的实付金额，原生商店模式在对应金额尚未取得可核验证据时可为 `null`。`status` 是后端据支付和发放事实派生的 UI 状态。

| 对象 | 状态及合法推进 |
| --- | --- |
| 订单支付状态 | `awaiting_payment → confirming → paid`，或在渠道确认未支付且订单停止受理时进入 `closed`。无外部尝试时可从 `awaiting_payment` 直接关闭。App 返回取消、失败、超时或进程退出都先查询当前尝试。关闭后发现迟到成功则核实并建对账单 |
| 尝试状态 | `preparing → awaiting_action / pending / succeeded / failed / closed`。`awaiting_action → pending / succeeded / failed / closed`，`pending → succeeded / failed / closed`。以已核实渠道结果和内部无外部副作用的可证明失败为准。支付结果未知时维持未结束，继续查原尝试 |
| 权益状态 | `not_eligible → pending → fulfilled / blocked`。支付验证通过才到 `pending`。`blocked` 保留证据并进入运营处理。发放已产生时记录一次 `ledgerTransactionId`，退款另保留逆向记录 |
| 退款状态 | `none / requested / pending / partially_refunded / refunded / failed`。退款记录每次独立，退款经核验后才更新实退金额。支付与权益历史状态可查 |
| UI 订单状态 | 由以上状态产生 `awaiting_payment / confirming / paid_awaiting_fulfillment / fulfilled / closed / refund_pending / partially_refunded / refunded / under_review`。`payment_failed` 属于尝试，订单尚可换方式时显示 `awaiting_payment` 与失败原因 |

| 接口及覆盖 | 请求及成功响应 | 权限、处理顺序与恢复 |
| --- | --- | --- |
| `GET /v1/products` G01 | `cursor?`、`limit?` → `{productId,productVersion,title,grantPreview,allowedChannels[],pricingSource,price?,storeProductId?}[]` | 本人。按账号资格、商户、区域、发行平台与客户端能力筛选。对原生店内商品返 SKU，UI 从原生商店 SDK 查询当前本地化价格。有效组合之外不展示购买按钮 |
| `POST /v1/quotes` G01 | `{productId,channel,quantity:1}` → `201 {quoteId,productVersion,channel,grantPreview,pricingSource,price,storeProductId?,expiresAt}` | 本人。校验商品和渠道，保存不可变报价。商户价由服务端计算，商店价按当前官方结算展示。报价过期或配置失效时返回 `QUOTE_EXPIRED` 或 `FEATURE_DISABLED`，重新确认价格 |
| `POST /v1/orders` G02 | `{quoteId}` → `201 OrderView`，已消费的相同报价 `200` 返回原订单 | 本人。锁报价行，检查归属、有效期和渠道能力。报价快照、订单、幂等结果一次提交。唯一 `quoteId` 防止使用不同键重复成单。未完成订单在记录中有明确入口 |
| `GET /v1/orders` G03/G04 | `status?`、`cursor?`、`limit?` → `OrderView[]` | 本人。保留取消、失败尝试和退款订单的可查询状态。历史快照保持当时商品。列表读取不触发支付或重新发放 |
| `GET /v1/orders/{orderId}` G03/G04/G05 | `OrderView` 加当前有效尝试及退款摘要 | 本人。原生或网页回跳后查原订单，当前账号与订单账号不符统一 `NOT_FOUND`。需要主动查渠道结果时调用重查命令 |
| `POST /v1/orders/{orderId}/payment-attempts` G02 | `{channel}` → `202 PaymentAttemptView`，同一未结束尝试可 `200` 返回原记录。`PaymentAttemptView = {attemptId,orderId,channel,state,launch?,expiresAt?,version}`，`launch` 为 `{type:sdk / redirect,parameters}` | 本人。渠道须与有效报价及发行范围一致。锁订单，检查尚未付款、未申请关单且最多一个未结束尝试。先保存尝试及渠道可重试请求号，再入队调用外部 SDK。采用付款方式变更时，先查原订单及渠道，确认旧尝试终结，再生成该方式的新报价与订单。未知状态返回 `PAYMENT_ATTEMPT_UNRESOLVED` |
| `GET /v1/orders/{orderId}/payment-attempts/{attemptId}` G02/G03 | `PaymentAttemptView` | 本人。可查回外部唤起参数，过期参数不再返回。参数丢失时先主动查单，按渠道能力重新签发或关闭旧尝试。参数不得被记录到常规日志 |
| `POST /v1/orders/{orderId}/payment-attempts/{attemptId}/evidence` G02/G03 | 按渠道提交 `{type: storekit_transaction / play_purchase_token,proof}` → `202 {attemptId,state}` | 本人。限长、密存证据引用，按尝试与凭证指纹去重入队。所列类型为当前商店凭证。其他渠道启用时在同一入口按订单渠道匹配已注册凭证解析器。后台用官方 API／签名库核对应用、商品、环境、归属、数量和付款状态。客户端传来的成功结果不写支付事实 |
| `POST /v1/orders/{orderId}/rechecks` G03 | `{}` → `202 {orderId,state,requestedAt}` | 本人。未决或售后可重查。限速、相同待跑任务合并，按原尝试、渠道订单号或凭证查。服务器稍后以业务事件和订单详情通知结果 |
| `POST /v1/orders/{orderId}/close` G02 | `{reason: user_cancelled / switch_method}` → `202 {orderId,status}`。可安全关闭或已终结时 `200 OrderView` | 本人。锁订单，记录关单意图并阻止新尝试。无外部尝试时关闭。外部创建、扣款或关单未知时查回原尝试，支持的渠道先请求关单再核验终态。核验未扣款才关闭。已付款转到账或售后处理 |
| `POST /v1/payment-restorations` G05 | `{channel,proofs[]}` → `202 {restorationId,state}`。`proofs` 每次最多 20 项，每项 `{type,proof}` | 本人。仅为已启用、支持恢复的商店路径提供。证据经验证后按原交易归属补充已拥有权益。另一个账号的交易不会转移。归属待查进对账。消耗品剩余邮资以账号账本为准，不因重装重新发放 |
| `GET /v1/payment-restorations/{restorationId}` G05 | `{id,state: pending / completed / needs_review / failed,items:[{state,orderId?}],updatedAt}` | 本人。后台任务按项记录 `already_fulfilled / restored / not_eligible / needs_review / invalid`，不暴露他人订单或渠道原始证明 |
| `GET /v1/orders/{orderId}/refunds` G04 | 查询 `cursor?`、`limit?` → `{refundId,status,amount,createdAt,updatedAt}[]` | 本人。展示已核对退款金额及进度，部分或全额按渠道记录。可恢复购买与退款查询独立 |
| `POST /v1/orders/{orderId}/refunds` G04 | `{reasonCode}` → `202 {refundId,status}` 或 `200 {action: channel_handoff,channel}` | 本人，要求当前账号有退款资格。首版商户自处理渠道只开放全额退款申请，以原实付为上限。需要商店处理时给原生售后动作，不创建虚假退款。生成渠道请求号，在账本可用性策略内占用待逆转的权益，确认未受理的失败再解占用。服务端核对退款结果后才冲正 |
| `POST /v1/callbacks/payments/{channel}` G03/G04 | 保留渠道要求的原始 HTTP 方法、正文及签名头。响应按渠道 ACK 规范 | 渠道身份。限大小、校验来源和签名，核对商户、环境、有效期及防重放要求。可信证据以渠道事件 ID 去重，收件记录和任务持久化后 ACK。重复有效通知正常 ACK，解析／验签失败按渠道协议响应。应用 JSON 包装和客户端幂等键不用于渠道回调 |

Apple 和 Google 的原生首发方案通过各自 SDK 与正式服务端凭据验证。Apple 验证签名交易并核对 `appAccountToken`、商品、应用及环境。Google 使用官方购买查询，核对包名、商品、状态和账号关联，发放持久化后按商品类型确认或消耗。商户渠道验签并在需要时主动查单。验证结果以官方渠道能提供的字段为准，缺少关键归属证据进入对账。网页跳转成功页用于提示和查单。平台政策与地区例外按正式发行配置核查。 [Apple 服务端库](https://github.com/apple/app-store-server-library-node) · [Play 一次性购买](https://developer.android.com/google/play/billing/lifecycle/one-time) · [微信支付产品](https://pay.wechatpay.cn/doc/v3/merchant/4012068590) · [支付宝 SDK](https://github.com/alipay/alipay-sdk-nodejs-all) · [Stripe 履约](https://docs.stripe.com/checkout/fulfillment)

### 渠道官方接口映射

下表用于 V02 候选验证与 M01 单渠道接入。`PaymentProvider` 是西界内部契约。实际渠道的付款、退款、查询和回调各有能力范围，正式端按发行配置开放。首发单渠道使用官方 SDK。Hyperswitch（Apache-2.0）的多支付机构路由可在有多家收单需求时评估，应用商店内购仍按各自平台接入。 [Hyperswitch](https://github.com/juspay/hyperswitch#what-can-i-do-with-hyperswitch)

| 渠道与复用组件 | 对接的官方接口或能力 | 西界验收与状态映射 |
| --- | --- | --- |
| `apple_iap` · StoreKit 与 Apple Node 服务端库（MIT） | 端侧用 `Product.purchase(options:)` 带 `appAccountToken`，接收 `Transaction.updates` 并提交签名交易。服务端 `AppStoreServerAPIClient.getTransactionInfo` 主动查单，`SignedDataVerifier.verifyAndDecodeTransaction` 与 `verifyAndDecodeNotification` 核验 JWS，处理 App Store Server Notifications V2。发放后按选定渠道能力完成 `Transaction.finish()` 或服务端 `AppStoreServerAPIClient.finishTransaction`。 [StoreKit 交易](https://developer.apple.com/documentation/storekit/transaction) · [Node 库](https://github.com/apple/app-store-server-library-node) · [结束交易](https://developer.apple.com/documentation/appstoreserverapi/finish-transaction) | 对齐原账号、商品、应用和环境。用户申请退款时使用 StoreKit 售后入口，由 Apple 决定结果。以退款通知或官方退款历史更新西界退款和逆向账本。 [退款入口](https://developer.apple.com/documentation/storekit/transaction/beginrefundrequest%28for%3Ain%3A%29-65tph) · [Server Notifications](https://developer.apple.com/documentation/appstoreservernotifications/receiving-app-store-server-notifications) |
| `play_billing` · Play Billing Library 与 Android Publisher API | 端侧 `queryProductDetailsAsync`、`launchBillingFlow`、`queryPurchasesAsync`，通过 `setObfuscatedAccountId` 关联账号。服务端 `purchases.productsv2.getproductpurchasev2` 核验，发放成功再按商品用 `purchases.products.consume` 或 `acknowledge`。RTDN 走 Pub/Sub，用通知触发回查官方交易。 [客户端](https://developer.android.com/google/play/billing/integrate) · [一次性商品生命周期](https://developer.android.com/google/play/billing/lifecycle/one-time) · [RTDN](https://developer.android.com/google/play/billing/rtdn-reference) | `PENDING` 保持待确认，`PURCHASED` 才进发放。验包名、商品、账号关联、购买令牌唯一性和确认期限。售后按配置用 `orders.refund` 和 `purchases.voidedpurchases.list` 处理与查证。 [退款](https://developers.google.com/android-publisher/api-ref/rest/v3/orders/refund) · [作废交易](https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.voidedpurchases/list) |
| `wechat_pay` · 微信支付 OpenSDK 与官方 Go SDK（Apache-2.0） | App 走 `POST /v3/pay/transactions/app`（`AppApiService.Prepay`）与 OpenSDK 唤起。服务端 `QueryOrderByOutTradeNo`、`CloseOrder`，`notify.Handler.ParseNotifyRequest` 验签解密。退款用 `/v3/refund/domestic/refunds` 及退款结果查询。网页按批准场景选择微信官方下单接口。 [App 下单](https://pay.wechatpay.cn/doc/v3/merchant/4013070176) · [Go SDK](https://github.com/wechatpay-apiv3/wechatpay-go) · [SDK App 接口源码](https://github.com/wechatpay-apiv3/wechatpay-go/blob/main/services/payments/app/api_app.go) | 按渠道配置验证商户和 App 绑定、包名签名、唤起与回跳，校验商户订单号、金额、环境及回调签名。仅在确认需要时部署 Go 薄适配，订单状态和账本在 TypeScript 服务推进 |
| `alipay` · 官方 `alipay-sdk`（包元数据声明 MIT） | App 支付可用 `sdkExecute('alipay.trade.app.pay', …)` 生成唤起参数。独立网页选获准的 Page／WAP 能力。查单 `alipay.trade.query`，关单 `alipay.trade.close`，退款 `alipay.trade.refund`，查退款 `alipay.trade.fastpay.refund.query`。按所选协议用 `exec`（传统接口）或 `curl`（支持的 v3 接口），回调用与选定通知协议匹配的 `checkNotifySign` 或 `checkNotifySignV2`。 [官方 Node SDK](https://github.com/alipay/alipay-sdk-nodejs-all) · [官方 Easy SDK](https://github.com/alipay/alipay-easysdk) | 按渠道协议保留回调原文，再按要求解析表单并验证签名。核对商户、交易、原报价和状态，使用稳定商户请求号重试，不根据 App 回跳发放 |
| `stripe` · `stripe-node`（MIT）与托管 Checkout | `stripe.checkout.sessions.create/retrieve`，用 `stripe.webhooks.constructEvent` 验证原始字节与 `Stripe-Signature`。处理 `checkout.session.completed`、`checkout.session.async_payment_succeeded` 和 `checkout.session.async_payment_failed`，回查 Session 的 `payment_status`。退款 `stripe.refunds.create/retrieve`。 [Node SDK](https://github.com/stripe/stripe-node) · [Checkout 履约](https://docs.stripe.com/checkout/fulfillment.md?ui=full-page) · [回调验签](https://docs.stripe.com/webhooks/signature) · [退款 API](https://docs.stripe.com/api/refunds) | 仅用于已获准的发行和商户场景。对照订单、币种、金额与实际付款状态，已完成的页面回跳仍查询西界原订单。晚到、重复或不一致的交易进入既定去重及对账逻辑 |

Apple 的 `appAccountToken` 与 Google 的 `obfuscatedExternalAccountId` 用于识别账号。下单前保存尝试与商品，验单后按渠道证据匹配原订单。无法唯一匹配的交易交给对账。NestJS 通过 `rawBody: true` 保留回调原始字节。各渠道按协议分别验证原始字节与签名、规范化表单、JWS 或经认证的 Pub/Sub 投递。 [NestJS Raw Body](https://docs.nestjs.com/faq/raw-body)

原生内购桥仍是候选适配层。`cordova-plugin-purchase` 有 Capacitor 接入说明，上线前检查它能否取得所需凭证、设置账号关联字段，以及能否控制在西界完成权益入账后才确认或消耗。若候选插件无法满足其中一项，使用平台官方 SDK 的薄桥。应用凭据、签名私钥、商户密钥和环境由服务端管理。 [插件接入](https://github.com/j3k0/cordova-plugin-purchase/blob/master/capacitor/README.md)

### 支付事务和故障处理

1. 请求发起后先提交本地订单、尝试及待执行任务。Worker 使用固定的渠道请求号调用外部。外部成功而本地持久化失败时，按原请求号或渠道交易号查回。禁止在状态未知时换渠道重复扣款。
2. 接入层将 Webhook、客户端证明、恢复、主动查单和运营重查归一为证据。已关闭订单迟到的成功进入对账，核对已有新订单和扣款事实后再决定履约或退款。外部网络调用在数据库短事务之外，结果写回前检查最新尝试、版本和环境。经验证后锁订单和渠道交易，保存证据摘要并对业务键去重。金额、币种、商品、商户和绑定账号不一致时进入 `needs_review`，权益继续等待。
3. 同一渠道交易只能归属于一个订单。`Order` 只接受一个胜出的付款交易。若两笔真实成功交易误付同一订单，分别保留事实，第二笔建差异单，安排核实退款。验证成功与发放任务一起提交。发放 Worker 以 `orderId` 锁定，核查付款、退款与权限事实，写唯一发放记录、权益分录、订单投影和事件。发放重复或进程重启不会再加余额。
4. 退款与发放统一按账号、订单、原渠道交易、批次顺序取锁。按原渠道退款 ID 核对已退和未决占用金额，锁后检查累计上限并维护原批次预留。若全额退款先于发放且证据可确认，标记无需发放并停任务。已发放的同一订单以原批次追踪，冲正幂等且可用余额不为负。已消费、渠道强制退款、归属冲突、部分退款缺少确定的权益换算时进入人工核对。外部退款事实先保存，权益处置另按批准政策，不依赖当前登录账号。发生退款先于付款通知时保留证据并主动查原交易。
5. 账号切换、退出及注销处理中的回调继续关联原订单及其归属。注销状态下按已批准的留存、售后与退款政策处置。发放阻塞时保留真实支付事实并进入运营流程。交易争议、补单和退款的处置由权限和审计保护。
6. 采用配置的对账周期读取渠道事实，对比订单、有效交易、实际退款、发放和账本。线上发生故障时，允许暂停新报价和新支付，已有订单查回、有效通知、对账和退款继续。

### 运营对账

| 接口 | 请求及成功响应 | 权限、处理及恢复 |
| --- | --- | --- |
| `GET /v1/ops/payments/cases` | `state?`、`reason?`、`channel?`、`cursor?`、`limit?` → `{caseId,orderId,reason,state,version,updatedAt}[]` | `payments:read`，默认展示证据摘要和受限标识。记录查询范围 |
| `GET /v1/ops/payments/cases/{caseId}` | 返回差异单、已授权交易和退款关联、时间线及允许动作 | `payments:read`。原始证据另有权限及审计。没有公开内容或媒体原文 |
| `POST /v1/ops/payments/cases/{caseId}/rechecks` | `{reasonCode}` → `202 {caseId,requestedAt}` | `payments:recheck`。沿用原渠道查单逻辑，不接受手输的支付成功状态。记录操作者及旧状态 |
| `POST /v1/ops/payments/cases/{caseId}/resolutions` | `{action: retry_fulfillment / request_refund / close_no_change,reasonCode,evidenceRef}` → `202 {caseId,state}`，仅关闭无动作时 `200` | `payments:resolve`、`If-Match`。按差异类型核对证据和可执行动作，接入已有幂等发放或退款命令。完成后更新差异单，禁止任意改余额或覆盖原交易证据 |

## 模块内部与外部适配契约

所有模块写入走明确业务方法。调用方传递已鉴权上下文及当前数据库事务 `tx`，接收方依然校验归属与资源状态。同进程调用复用事务。Worker 可跨进程执行，但只通过数据库任务、模块命令及已登记的适配器产生副作用。外部请求在短事务之外执行。

| 调用 | 输入 → 返回 | 写入和失败语义 |
| --- | --- | --- |
| 礼物 → `People.requirePerson(txOrDb, actor, personId)` | 已鉴权账号和 `personId` → `{id,accountId,worldId,version,accessVersion}` | 验证有效的人物与归属。扣减事务对生命周期相关记录加必要的锁，防止删除、迁居与快照互相踩踏 |
| 礼物 → `ConversationService.ensureDirect(tx, ctx, {personId})` | 已校验送礼意图 → `{conversationId}` | 本账号、该人物的直聊至多一个。无历史也可建立与寄件卡绑定的会话 |
| 礼物 → `Media.bindUse`、`Media.authorizeMediaUse` | 绑定传 `(tx, actor, {mediaId,purpose:'gift_delivery_photo',target:{kind:'gift_delivery',id:deliveryId}})`。授权读取传 `(txOrDb, actor, {mediaId,purpose,target,expectedAuthorizationVersion?})` → 媒体引用和授权版本 | 复用身份与媒体域的权限及状态规则。绑定与寄件版本同事务。每次签发访问链接前复核当前权限 |
| 聊天 → `GiftService.getConversationProjection(ctx, {deliveryId?,receivedGiftId?})` | 两个引用恰选一个 → `{direction: sent / received,giftRefId,giftId,name,quantity,displayStatus,occurredAt,version}` | 只返回当前可读的授权摘要。发件 `displayStatus` 对应投递状态，收件为 `unopened / opened`。会话只保留稳定消息引用，投递更新复用原消息。私信与媒体在礼物详情授权读取 |
| 礼物／邀请／商城 → `Ledger.post(tx, ctx, input)` | `{accountId,reason,sourceId,credits?,debits?}` → `{transactionId,walletVersion}` | `accountId` 由模块已有权威资源或已验证会话确定。按稳定顺序锁账号和批次、校验可用量，记分录和余额投影，追加事件。业务键相同且内容相同返回原交易。只有事务提交后权益可见 |
| 认证 → `Referrals.bindRegistration(tx, input)` | `{accountId,registrationId,verifiedAt,invitationIntentId?}` → `{referralAttributionId?: UUID}` | 仅首次新账号创建事务执行，校验会话绑定、链接及活动资格。消费意图和建归因同时完成。无效、已过期或自邀时不设归因，不阻断正常注册 |
| 运营 → `SharedGoals.restrictContribution(tx,operator,input)` | 持 `reports:resolve` 权限的运营主体及 `{contributionId,reportId,reasonCode}` → `{contributionId,state,version}` | 锁定贡献和目标，同事务收回内容可见性、采纳与未完成领取资格并追加审计。席位、累计进度和已发权益按批准的活动版本处理。默认保留已完成事实，已入账的争议转审计处置。后续权益冲正走账本。禁止在公开响应暴露原文或处理证据 |
| 共创 → `Memories.confirmFromContribution(tx,ctx,input)` | `{personId,goalId,contributionId,text,sourceAuthorizationVersion}` → `{memoryId,version}` | `text` 来自服务端授权贡献。锁目标、贡献和人物，复核归属、用途许可与审核状态，原文和来源一起保存。`origin=shared_contribution` 默认 `qualifiesForReferral=false` |
| 商城 → `PaymentProvider.createAttempt(input)` | `{orderId,attemptId,channelRequestId,environment,productSnapshot,price?,accountBinding}` → `{externalOrderId?,launch?,state,expiresAt?}` | 按渠道使用官方 SDK 或已批准支付服务。固定请求号用于外部幂等和重试。前台只拿允许客户端使用的唤起参数 |
| 接入层 → `PaymentProvider.verifyCallback(input)` | `{channel,rawBody,headers,receivedAt}` → `{verifiedEventId,environment,evidenceRef}` | 验签、商户和环境校验、必要时解密。只把可信证据交给回调收件事务。回调不直接发放 |
| Worker → `PaymentProvider.queryTransaction(input)` | `{environment,externalOrderId?,evidenceRef?,channelRequestId}` → `{externalTransactionId?,state,merchantId,productId?,quantity?,paidAmount?,accountBinding?,verifiedAt,evidenceRef}` | 通过官方渠道查证。结果未知保持待查，硬性字段不匹配进对账。结果不能凭客户端回跳构造 |
| Worker → `PaymentProvider.closeAttempt(input)` | `{environment,externalOrderId,channelRequestId}` → `{state,evidenceRef?}` | 按渠道能力启用，未知按原尝试查询 |
| Worker → `PaymentProvider.requestRefund(input)`、`queryRefund(input)` | `{environment,externalTransactionId,externalRefundId?,channelRequestId,amount?}` → `{state,externalRefundId?,amount?,evidenceRef?}` | 仅请求退款时要求 `amount`。按原退款请求号或渠道退款 ID 查证。未知维持待确认 |
| Worker → `PaymentProvider.querySettlement(input)` | `{environment,windowStart,windowEnd,cursor?}` → `{transactions,refunds,nextCursor}` | 仅用渠道官方对账数据，按范围重试及续读，批次与差异单可追溯 |
| Worker → `PaymentProvider.finalizePurchase(input)` | `{environment,channelTransactionId,externalTransactionId,evidenceRef,mode}` → `{state}` | 只在业务权益已持久化之后执行商店确认／消耗等需要的外部动作。独立任务重试，并根据渠道失败时限报警。重复执行不重新发放 |

### 任务、事件与消费

使用主契约的 `DomainEvent` 信封。表内字段为 `payload`，事件归属以信封 `accountId` 为准。通知与客户端投影只传当前账号可读的资源引用。通知消费者根据真实 `sourceEventId` 去重，接收事件后查权威资源。后台重试以任务键和实际对象状态保证业务幂等。跨账号的邀请两笔发放都在一笔账本事务完成，向每个账号发独立事件。

| 事件或任务 | 载荷和触发 | 消费与落库 |
| --- | --- | --- |
| `GiftDeliveryAccepted.v1` | `{deliveryId,personId,conversationId,acceptedAt,scheduledArrivalAt}`，发件回执事务 | 会话投影按 `(conversationId,giftRefId)` 保持一条。任务 `deliverGift` 键 `deliveryId` 在计划时间运行 |
| `GiftDeliveryArrived.v1` | `{deliveryId,personId,conversationId,arrivedAt}`，投递完成事务 | 会话更新原卡片。可触发剧情回礼任务 `createPersonaGift` 键 `deliveryId` |
| `GiftDeliveryFailed.v1` | `{deliveryId,personId,conversationId,failedAt}`，确定投递失败和冲正事务 | 会话刷新原卡片。资产变化经同事务账本事件读回 |
| `PersonaGiftReceived.v1` | `{receivedGiftId,personId,conversationId,sourceDeliveryId,receivedAt}`，收件记录事务 | 更新收件卡片、本人通知和展示查询 |
| `AssetLedgerCommitted.v1` | `{transactionId,walletVersion,reason,sourceId}`，资产交易提交 | 资产缓存与本人余额投影刷新。通知由原业务域的到账事件单独生成 |
| `AccountRegistered.v1`、`MemoryConfirmed.v1` | 上游定义。邀请消费已绑定归因与服务端确认、可纳入活动的原文 | `qualifyReferral` 用归因 ID 去重，从数据库重新核对注册和首条合格确认。乱序可延后重查 |
| `ReferralRewardGranted.v1` | `{attributionId,ledgerTransactionId,recipientRole}`，一账号一事件 | `recipientRole=inviter / invitee`。各自的进度和通知可查 |
| `ContributionAccepted.v1` | `{goalId,contributionId,acceptedAt}`，审核通过且席位事务提交。信封绑定发起人 | 私人目标列表及通知更新。访客进度通过受限公开查询。采纳仍须显式命令 |
| `PaymentVerified.v1` | `{orderId,paymentAttemptId,channelTransactionId,verifiedAt}`，确定唯一有效付款时 | `fulfillOrder` 用 `orderId` 去重，以原账号发放并在事务内记录结果 |
| `OrderFulfilled.v1` | `{orderId,ledgerTransactionId,fulfilledAt}`，发放提交 | 更新订单、资产和到账通知。需要时生成商店确认任务，键为 `channelTransactionId` |
| `RefundVerified.v1` | `{orderId,refundId,verifiedAt}`，渠道真实退款确认 | `applyRefund` 以 `refundId` 去重，核对原批次。冲正或人工处置可独立恢复 |
| `OrderRefundApplied.v1` | `{orderId,refundId,ledgerTransactionId?,appliedAt}`，退款账本处置后提交 | 更新本人订单与售后通知。无需冲正时允许 `ledgerTransactionId=null` |

接入任务还包括 `preparePayment` 按 `attemptId`、`verifyPayment` 按渠道证据指纹、`recheckPayment` 按订单及未决尝试、`closePayment` 按尝试、`submitRefund` 按退款 ID、`reviewContribution` 按贡献 ID、`reconcileChannel` 按渠道和对账窗口。任务只携带标识，密码、原始证明、分享令牌、私信与原文保存在授权数据路径。错误保留尝试次数、原因和人工处理入口。

### 业务错误及默认门槛

| 码与状态 | 场景 | 恢复 |
| --- | --- | --- |
| `INSUFFICIENT_ASSET`、`CATALOG_VERSION_CHANGED` · 409 | 试用邮资、付费邮资、库存或基础券不足，或目录版本变化 | 保留礼物草稿，重读目录和资产，用户确认新的选择 |
| `GIFT_NOT_OPENED`、`GIFT_NOT_DISPLAYABLE` · 409 | 尝试摆放未拆开或不支持摆放的收件 | 先拆开，或选择保留在记录 |
| `GOAL_FULL`、`ALREADY_CONTRIBUTED` · 409 | 目标已满或参与者已有贡献 | 重读目标或原参与记录 |
| `REWARD_NOT_ELIGIBLE` · 403 | 领取期限、活动策略或已核验资格不满足 | 保持原资产，返回稳定原因，跨账号仍为 `NOT_FOUND` |
| `QUOTE_EXPIRED`、`PAYMENT_ATTEMPT_UNRESOLVED` · 409 | 报价失效或旧尝试还在待确认 | 重新确认报价，或查询／重查原尝试 |
| `PAYMENT_REVIEW_REQUIRED`、`REFUND_POLICY_CONFLICT` · 409 | 付款已产生但证据矛盾，退款或已消费权益需核对 | 显示原订单和受限原因。进入运营对账，避免重新购买 |
| `FEATURE_DISABLED` · 403 | 发行、商户、资格、活动、公开内容或退款门槛未通过 | 按实际能力控制 UI、API 和旧版本深链。已成立订单的查单、渠道回调及售后继续 |

开启正式赠礼前确认试用分配、渠道用途和冲正规则。上线邀请前确认何为首条合格记忆、地域、期限及资格变更。上线共创前确认审核、采纳同意、撤权和领取期限。上线收费前确认首发商品、渠道、商户资格、恢复类别、售后及已消费退款处理。用双账号测试切换和越权，用重放验证不重复扣减、投递、奖励或发放，用并发测试最后一席，用乱序通知、回调丢失、杀进程、退款先到和真实重复付款验证可恢复。账户、权益或公开授权冲突仍待定时，门槛保持关闭。
