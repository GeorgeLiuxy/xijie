# 礼物、公开互动与交易接口

适用 R02、M01、M02、M03 与按需扩展，覆盖 E01–E05、F01–F06、G01–G05。本文使用[主接口契约](../backend-api-contract.md)的账号上下文、HTTP 响应、分页、版本、幂等、任务与事件信封。表内响应列表示 `data`。可空字段显式返回 `null`，查询不会推进交易状态。除另注明，写入使用 `Idempotency-Key`，条件更新同时使用 `If-Match: "v<N>"`。业务资源的 UUID 由服务端生成，支付平台标识和公开令牌另作外部标识处理。

**当前实现以文末 2026-11-15 的 M01–M03 实施契约及“自建多渠道收银台”增量为准。** 前面的通用购买和 `shared-goals` 接口保留作后续设计，不能当作已部署接口；本轮正式共创入口是 `shared-albums`。跨服务调用在本库事务外执行，不存在跨库同事务采纳或发券。现已实现可配置的自建支付适配，当前没有支付商户，真实付款能力保持关闭。

当前客户端的试用邮资、120 字留言、最多 99 件、基础券可抵指定纪念品或道具和单件 1–8 邮资等来自演示规则。下文把这些条件作为首版可实现的赠礼校验，初始赠送量、活动面额、有效期、售卖 SKU、价格及各区域能力由审核过的版本配置决定。演示中的 120 初始邮资、40 邮资商品、报价与客户端模拟付款状态留在预览环境。 [礼物存储](../../frontend/src/gifts/store.ts) · [演示报价](../../frontend/src/commerce/checkout.ts) · [交付优先级](../backend-delivery-priorities.md)

## 数据责任和业务状态

### R02 旅途留影实施基线（2026-11-13，本机合成账号闭环已验收）

批准 UI 的留影来源是“观看这次旅途”完整 44 秒 Three.js 动画结束的真实 canvas JPEG；没有相册选图、保存确认或删除图片入口。重看完成替换同一寄件的一张图，提前结束／返回不生成图。沿用原入口和回执主图，GiftHub 未挂载、聊天卡不显示图片，不据未挂载原型新增页面。本片不改变旅途视觉、文案、素材、时钟或寄件状态：服务模式从原按钮先核对当前真实状态；仍在途、失败或不可读取时沿用轻提示并保留回执，真实 arrived 后才进入观看和绑定留影。预览模式及共享 PostalFlight 时钟保持原样；动画完成不得写 arrived 或触发 AI 回礼。服务回执仅展示已提交且当前授权可读的留影。

Identity013 新增独立 `gift_delivery_photo_storage` v1，context `giftPhotoStorage:{allowed,authorizationVersion}`，授权“主动观看旅途后生成的虚拟场景留影”上传、保存、展示、替换及独立导出／注销。需要当前 `giftStorage`，不要求 AI 回礼或普通 AI 授权，图片和引用不进模型。既有政策和 grant 保持；撤回停止新上传／绑定／读取，重新允许可读当前仍有效的成品，旧在途上传任务及已就绪但尚未保存的旧意图不得借新授权版本恢复。图片不证明真实世界投递。

Gifts003 使用独立 `gift_delivery_photos` 和永久 `gift_photo_commands`，照片版本与 `gift_deliveries.version` 完全分离；寄件 DTO、生命周期、金额、抵达时间、回礼 captured source version、通知和聊天 sequence 不因留影改变。`GET /v1/gift-deliveries/:id/photo` → `{deliveryId,version,photo:MediaMetadata|null,updatedAt,origin:'journey_capture'}`，无图初始版本1（GET不写库）；`GET /v1/gift-delivery-photos?cursor&limit` 返回已保存且当前有效照片状态。`PUT /v1/gift-deliveries/:id/photo {mediaId}` 带永久 `Idempotency-Key` 与照片资源 `If-Match:"v<N>"`，返回同一照片状态；首次提交变为v2，替换推进照片版本，未知结果重放只回读当前照片状态，不重新绑定旧图。无公开移除控件；人物失效／账号注销和替换驱动现有清理。

Media003 新增 purpose `gift_delivery_photo`、target `{kind:'gift_delivery',id:deliveryId}`，独立 `gift_delivery_id` 和 `media_gift_grants`，复用实际上传槽、Sharp校正／缩放／去元数据WebP成品、私有S3、短期授权流和GC。`POST /internal/v1/gifts/deliveries/:id/media-bindings`（Gifts凭据、`X-Xijie-Account-Id`、`{mediaId,photoVersion}`）返回 `{deliveryId,photoVersion,media:MediaMetadata,expiresAt}`；预绑定60秒，只在本库锁外调用。Gifts账号锁后检查目标仍arrived、照片CAS及数据库时间未超过expiresAt。Media绑定不能把其他purpose/target对象转用。

Media回读 Gifts `GET /internal/v1/media/gifts/deliveries/:id`（Media凭据、账号头）核对可用 arrived 目标，返回 `{deliveryId,accountId,status,photoVersion}`。`POST /internal/v1/media/gifts/validate {refs:[{deliveryId,photoVersion,mediaId,version}]}` 返回 `{valid:refs}`；当前真实来源校验独立于普通读取许可，用于GC和数据权利，不能把撤权误作删除。读取证明包含照片版本并在签发和实际流式取图时复核；替换／人物移除后旧证明立即失效，正常GC只清无有效引用且越过预绑定宽限的对象。未知上传或绑定保留原操作身份，浏览器仅保存必要意图元数据，不把字节、证明或签名URL写业务存储。

错误沿现权限／媒体契约：`GIFT_PHOTO_PERMISSION_REQUIRED`、`DELIVERY_NOT_ARRIVED`、`PHOTO_SELECTION_INVALID`、`VERSION_CONFLICT`；依赖失败不能返回空成功。Gifts导出照片状态、操作及事件，Media导出仍有效的实际WebP、SHA与来源；擦除受两域围栏和对象清理完成约束。恢复验证owner/purpose/不可变delivery target、photoVersion/mediaVersion、grant、元数据及实际字节，及从版本2起连续完整的永久命令／请求指纹，并保留旧无照片包边界。验收包括原动画完整／提前退出、重看替换、未知提交重试、刷新实际图回读、旧证明失效、零资产／不重复回礼、独立撤权／重授、七域导出、八库和对象恢复及新合成账号注销。后续统一接口提案与本节冲突时按本节实施。

### R02 真实 AI 回礼与收件实施基线（2026-11-13，本机合成账号闭环已验收）

用户已明确选择由真实 AI 决定是否回礼及附言。本文后续早期提案与本节冲突时以本节和批准 UI `53d5293` 为准：未拆时原页面已显示礼物名与附言；点击来礼进入详情即调用幂等拆开，首次设置服务器 `openedAt` 和 `placement=record`。通知已读不拆礼物；重复拆开不得把已陈列物件移回记录。回礼不发放邮资、券或可消费库存，普通账号仍不自动发资产。

Identity 新增独立 `person_gift_returns` v1，内部上下文为 `giftReturns:{allowed,authorizationVersion}`。既有 `virtual_gift_storage` v1、AI 文字及 notice 政策不改版、不扩大旧授权。新用途明确包含 OpenAI 对新寄件礼物/数量/赠言和最小人物文字上下文的处理、决定不回礼或生成一份回礼、结果及来源保存、拆开/陈列和私人站内通知。需要当前文字保存和赠礼保存授权；不使用照片、聊天、珍藏、自动记忆或迁居历史，不触发普通聊天生成或 OS 推送。模型处理限专用合成账号开发名单，默认关闭；来源授权撤回或版本改变即停止旧任务，重新授权不复活旧任务。

仅新寄件接受时捕获新用途与文字保存的精确授权版本；实际到达后才可排一项真实生成任务。没有新授权的寄件仍可正常发送，之后 grant 不补扫历史。模型输出严格为 `{decision:'none'}` 或 `{decision:'gift',giftId,note}`，从当前可用 `keepsake/prop` 且适用该人物的目录选择一件，数量恒为 1，附言最多 120 Unicode 字符。一份源寄件至多一个回礼；回礼不触发回礼。`none` 是真实终态，不生成收件或通知；失败不以模板兜底。独立 Worker 在 SQL 锁外调用模型，前后复核账号、用途、人物及世界版本，持久任务租约防重复提交；最多三次尝试，过期租约回收也消耗预算，耗尽后停止。

收件与通知权威属于 Gifts。本轮权威类型落在 `gifts/src/contracts.ts`：`ReceivedGift={id,personId,conversationId,sourceDeliveryId,personSnapshot,giftSnapshot,quantity:1,note,version,createdAt,openedAt:null|ISO,placement:null|'record'|'space',displayable,origin:{kind:'persona_return',contentOrigin:'ai_generated',policyVersion:'person-gift-returns-v1',generationJobId}}`。UUID 与 ISO 时间沿用现有契约。内部模型输入及提供方证据不进入公开 DTO。`Notification={id,version,type:'gift_arrived'|'gift_failed'|'gift_received',createdAt,readAt:null|ISO,sourceEventId,objectId,personId,target:{kind:'delivery'|'received_gift',id}}`；列表返回独立 `totalCount`、`unreadCount`。同一事件与类型只产生一条通知，源对象读取需重新授权，不依靠旧通知快照绕过权限。

公开接口为 `GET /v1/received-gifts`（personId/placement/cursor/limit）、`GET /v1/received-gifts/:id`、`POST /v1/received-gifts/:id/open`（空对象）、`PATCH /v1/received-gifts/:id`（`{placement:'record'|'space'}`）、`GET /v1/notifications`、`PATCH /v1/notifications/:id`（`{read:true}`）。写入带 `Idempotency-Key`；placement/read 带 `If-Match: "v<N>"`。原键与指纹永久关联，未知结果重试原请求；版本冲突回读，不自动覆盖新状态。来源不可用返回 `NOT_FOUND`、用途缺失 `GIFT_RETURN_PERMISSION_REQUIRED`、版本变更 `AUTHORIZATION_CHANGED`、未拆 `GIFT_NOT_OPENED`、不可陈列 `GIFT_NOT_DISPLAYABLE`，依赖未知用 `DEPENDENCY_UNAVAILABLE`，不伪装空成功。

Conversations 新增真实 incoming gift 投影（`kind:gift,direction:received,receivedGiftId`，人物作者），独立引用 `GET /internal/v1/gifts/received/:id?accountId=...`，投影写入口 `PUT /internal/v1/gifts/received/:id`。保留 outgoing DTO 与删除墓碑；不伪造聊天 generation job、不追加模板问候，所有 gift 继续排除普通模型历史、珍藏及自动记忆。源版本更新只更新同一卡片和原 sequence。

新表、操作、真实生成来源与任务纳入原 Gifts 导出/注销；恢复加入 sourceDelivery→received→incoming card 和 notification 引用核对，并隔离所有可执行回礼任务。验收以新专用合成账号原 UI 寄件→真实模型决定→来礼/通知→拆开→陈列/收回→刷新回读为主，并核对重复/未知结果、并发、撤权、数据权利及恢复。代码、模拟和构建不替代真实模型和 UI 验收。

### R02 真实寄件首片实施基线（2026-11-13）

本节覆盖下文早期提案中涉及同进程调用或跨人物／会话事务的示意。新增独立 `gifts` 服务及数据库，目录、试用批次、账本、扣减、投递与冲正属于同一个事务边界。Identity、People、Conversations、Memories、Social、Media 保持独立；Gifts 经锁外受控 HTTP 取得身份和最小人物元数据、确保直聊，可靠任务投影同一 `deliveryId` 的聊天卡。没有跨库外键、跨库 SQL 事务或锁内 HTTP。

用户已确认本轮普通账号不自动发放初始额度；钱包 GET 纯读取，不导入预览的120邮资与库存。开发合成账号通过受信 CLI、明确名单和版本化测试政策幂等发放。免费礼物有真实回执，无虚构零额流水。单次只扣确认的 trial／inventory／voucher 来源，服务端目录定价；最后一张券按账号门闩串行扣减。同键异参冲突；永久接受键与回执共存，短缓存过期不导致重扣。前端在未知结果期间冻结原键、礼物版本、数量、赠言与来源，不因余额刷新切换来源。事务已提交后的授权变化也可能返回错误，不能仅凭4xx清除原接受键；只在明确受理前校验错误时建立新意图。

`POST /v1/gift-deliveries` 本库接受后返回201与真实 `in_transit`；Worker 才能写入 `arrived` 或确定失败的 `delivery_failed`。网络未知结果仍等待／重试，不能推断失败或到达；失败 CAS 与按原分录唯一冲正在本库提交，已过期批次不延长有效期。卡片投影失败只重试投影，不重复扣减。人物迁居／改名不重写已接受快照。当前服务人物统一为 person，宠物／物件建档另片。

Identity 新增独立 `virtual_gift_storage` v1 与 `giftStorage:{allowed,authorizationVersion}`，保留已有告知、文字、AI及照片政策。旧grant不自动授权赠言／账本。礼物卡独立 `kind:gift`，不进入模型、自动记忆或珍藏提取。原界面布局及决定顺序保持；普通读取／新赠礼需新用途允许，导出注销独立可用。新域纳入数据权利与恢复，纯试用无付费留存例外。实际完成与验收以交付接续为准；本片不承诺真实付款、邀请奖励、共创、回礼、赠礼照片或通知已完成。

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
| `GET /v1/gift-deliveries/{deliveryId}` E02/E03 | 返回原 `GiftDeliveryView`，留影由独立资源读取 | 本人。按照持久化状态查询，超过计划抵达时间仍在投递时保留真实状态；留影变化不改变寄件版本或 DTO |
| `GET /v1/gift-deliveries/{deliveryId}/photo` E02 | `{deliveryId,version,photo,updatedAt,origin:'journey_capture'}`，无图 `version=1,photo=null` | 本人、已抵达、赠礼及留影保存授权。纯读，版本独立于寄件 |
| `GET /v1/gift-delivery-photos` E02 | `cursor/limit`，返回当前有效的已保存留影状态 | 同上，按不可变寄件创建时间及 ID 分页 |
| `PUT /v1/gift-deliveries/{deliveryId}/photo` E02 | `{mediaId}` → `200` 独立留影状态 | 本人、已抵达、两项授权、永久操作键与照片资源 `If-Match`。锁外请求 Media 60 秒预绑定，锁内检查照片 CAS 与数据库时间。旧操作重放只回当前状态，不绑定已替换旧图 |
| `GET /v1/received-gifts` E03/E04 | 查询 `personId?`、`placement?`、`cursor?`、`limit?`。返回 `ReceivedGift[]`，完整字段见本页实施基线 | 本人、当前精确回礼授权。按批准 UI 未拆也显示名称和附言；拆开保存时间及陈列资格。`placement=space` 用于我的空间 |
| `GET /v1/received-gifts/{receivedGiftId}` E03 | 返回 `ReceivedGiftView` | 本人。隐藏他人的来源信息。资源已失效按数据保留策略返回 `NOT_FOUND` 或受限的历史快照 |
| `POST /v1/received-gifts/{receivedGiftId}/open` E03 | `{}` → `200 ReceivedGiftView` | 本人。仅首次写 `openedAt` 并增版本，多次拆开返回原状态。拆开不记权益分录 |
| `PATCH /v1/received-gifts/{receivedGiftId}` E03 | `{placement: record / space}` → `200 ReceivedGiftView` | 本人、`If-Match`。先验已打开，`space` 只允许符合场景规则的物件。未打开返回 `GIFT_NOT_OPENED`，不支持摆放返回 `GIFT_NOT_DISPLAYABLE` |
| `GET /v1/notifications` E05 | 查询 `unread?`、`type?`、`cursor?`、`limit?`。返回 `{id,type,objectId,createdAt,readAt,version}` 列表。元数据分别提供 `meta.totalCount` 和 `meta.unreadCount` | 本人。数据来自真实通知事件，读取时过滤失去源权限的通知；打开目标再次通过业务读接口授权 |
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
| `GIFT_NOT_OPENED` · 409、`GIFT_NOT_DISPLAYABLE` · 422 | 尝试摆放未拆开或不支持摆放的收件 | 先拆开，或选择保留在记录 |
| `GOAL_FULL`、`ALREADY_CONTRIBUTED` · 409 | 目标已满或参与者已有贡献 | 重读目标或原参与记录 |
| `REWARD_NOT_ELIGIBLE` · 403 | 领取期限、活动策略或已核验资格不满足 | 保持原资产，返回稳定原因，跨账号仍为 `NOT_FOUND` |
| `QUOTE_EXPIRED`、`PAYMENT_ATTEMPT_UNRESOLVED` · 409 | 报价失效或旧尝试还在待确认 | 重新确认报价，或查询／重查原尝试 |
| `PAYMENT_REVIEW_REQUIRED`、`REFUND_POLICY_CONFLICT` · 409 | 付款已产生但证据矛盾，退款或已消费权益需核对 | 显示原订单和受限原因。进入运营对账，避免重新购买 |
| `FEATURE_DISABLED` · 403 | 发行、商户、资格、活动、公开内容或退款门槛未通过 | 按实际能力控制 UI、API 和旧版本深链。已成立订单的查单、渠道回调及售后继续 |

开启正式赠礼前确认试用分配、渠道用途和冲正规则。上线邀请前确认何为首条合格记忆、地域、期限及资格变更。上线共创前确认审核、采纳同意、撤权和领取期限。上线收费前确认首发商品、渠道、商户资格、恢复类别、售后及已消费退款处理。用双账号测试切换和越权，用重放验证不重复扣减、投递、奖励或发放，用并发测试最后一席，用乱序通知、回调丢失、杀进程、退款先到和真实重复付款验证可恢复。账户、权益或公开授权冲突仍待定时，门槛保持关闭。
# 已确认的接通基线（2026-11-15，正在实施）

用户已确认：目前无支付商户；邀请沿原页面规则，真实新注册账号保存首条正式记忆后双方各得一张最高抵 8 邮资的基础赠礼券，不计导入、样例或共创采纳，已到账后删除记忆不追扣；共创首片为六段相册，仅公开主动填写的标题和附言，投稿先审核、再由发起人采纳，每位参与者一次回礼。上文旧提案中的跨域同事务不是当前分库实现契约。

M02 本轮固定活动 `first-memory-v1`，不添加原页面未说明的券有效期或参与期限。Identity 拥有邀请链接、浏览器注册意图和首次真实注册归因；Memories 只提供首条合格确认事件的最小元数据；Gifts 拥有双方 promotion 券账和可靠兑现。注册与归因在 Identity 本地事务完成；双方奖励在 Gifts 同一事务中按账号 ID 排序加锁完成。HTTP 调用不得持有数据库事务或锁。公开创建和加入按钮记录活动规则版本及资源级参与决定，不等于开启 giftStorage、AI 或其他私有权限；奖励权益可入账，钱包读取和实际使用仍按原 giftStorage 流程授权。

具体共享接口（均采用现有 `{data}` / `{error:{code,message,requestId}}` 包装）：

- Identity `POST /v1/referrals/links {publicName}`，真实会话、Origin、Expected-Session 和 UUID Idempotency-Key；返回 `{id,publicName,url,status:'active'|'revoked',version,createdAt}`。`GET /v1/referrals` 返回 `{link:null|同前,records:[{id,joinedAt,firstMemoryAt:null|string,rewardedAt:null|string}],receivedRewardCount}`，仅本人进度，不含另一方账号、手机号、正文或记忆 ID。`POST /v1/referrals/links/:id/revoke {}` 还要求 `If-Match: "vN"`，阻止新的加入，不撤销已有归因；返回当前 `status:'revoked',url:null`，旧创建键重放也可能返回该当前状态。
- Identity `GET /v1/public/referrals/:token` 只返回 `{publicName,campaign:'first-memory-v1'}`；`POST /v1/public/referrals/:token/join {}` 要求同源及 UUID Idempotency-Key，登录时要求匹配 Expected-Session，匿名时不能携带该头。创建或复用认证浏览器 Cookie 并持久记录 24 小时注册意图，返回 `{invitationIntentId,expiresAt}`；已登录账号两项均为 null。意图在认证 begin 时冻结，再由对应的首次注册消费；已有账号、本人、失效链接不产生归因，普通登录绝不修改既有归因。
- Gifts 专用服务凭据访问 Identity `GET /internal/v1/referrals/pending?limit=20&after=<UUID>`，after 可省略，返回 `{data:[{id,campaign:'first-memory-v1',inviterAccountId,inviteeAccountId,registeredAt}],meta:{nextCursor}}`；`POST /internal/v1/referrals/:id/rewarded {receiptId,qualifiedAt}` 幂等记录兑现，返回 `{id,state:'rewarded',qualifiedAt,rewardedAt,receiptId}`。候选仅为双方账号 active 的有效归因，消费者必须按 nextCursor 接续。
- Gifts 专用服务凭据访问 Memories `GET /internal/v1/referrals/accounts/:accountId/qualification` → `{accountId,qualification:null|{eventId,confirmedAt,confirmedSeq,origin:'manual'|'ai_candidate'}}`。资格是实际确认里程碑，来源为持久 outbox，不能由浏览器传入或通过请求伪造；没有正文、人物或记忆 ID。注销移除该资格；删除原文不生成反向奖励事件。
- Gifts 定时在锁外读取归因和资格，校验 `confirmedAt >= registeredAt`，使用永久键 `referral:<id>:host|guest` 发放来源 `promotion`、资产 `voucher/return-stamp`，每方数量 1。一个归因一份双方原子回执，未知回包先查原回执；失败重试不能增加余额。兑现不调用 trial 发放，不给普通新账号自动余额。自己的券到账后通过原进度与钱包可查。

M01 暂不配置正式 SKU、价格或支付渠道；没有服务端已核验的支付证据就不能创建 paid 批次。订单查询不能推进付款。M03 复用正式 promotion 账本，但采用独立业务键和 `shared_contribution` 记忆来源，后者明确没有邀请资格；不得跨库直写或把采纳伪装成 manual。

M03 的共创相册由现有 Social 服务拥有独立 aggregate，不把投稿混入私人朋友圈。原创建页保留公开名称（作为标题）与附言；服务模式的公开范围说明改为用户刚确认的仅标题、附言，目的地、人物资料及投稿正文不公开。容量为发起人附言加五条通过审核的投稿。匿名访客可投稿，服务签发的 HttpOnly Cookie 为访客身份；正文仅投稿人和发起人可读。提交动作明确说明审核、发起人采纳为人物珍藏及后续获授权 AI 使用。每个访客每个相册仅一份投稿；登录绑定领取时，同一真实账号每个相册仅一次回礼，发起人不能领取自己的回礼。审核是实际运营者明确通过/拒绝的受控命令，不自动把成功保存当作审核通过。

- `POST /v1/shared-albums {personId,title,message}`，标题保留原控件的 1–40 字符，附言 1–500 字符；session+Origin+Expected-Session+UUID key；`GET /v1/shared-albums` 仅本人清单；`GET /v1/shared-albums/:id` 返回本人 `{id,personId,title,message,url,status,version,createdAt,current:1..6,target:6,contributions:[{id,seat:null|1..5,text,status:'pending'|'approved'|'rejected'|'withdrawn',version,adoption:null|{memoryId?,status}}]}`。`POST /:id/close {}` 停止公开、新投稿和新的领奖派发，不撤回已经采纳的独立授权。关闭后，公共 GET 仅对持有原投稿访客 Cookie 的请求返回本人投稿，`title/message` 均为空串、`status:'closed'`，保留 `current/target` 容量字段；陌生访客仍为 404。本人仍可通过原撤稿入口操作，不能新投稿或发起新的领奖。关闭前已派发但结果未知的领奖，只查询同业务身份的 Gifts 永久回执，不能重新派发；确有入账才补为 fulfilled。
- `GET /v1/public/shared-albums/:token` 只返回标题、附言、人数/容量、完成状态和当前访客自己的投稿；不返回人物、世界、账号 ID 或他人投稿正文。`POST /:token/contributions {text,allowAdoption:true}` 同源、UUID key；pending 保存成功不占正式席位、不发奖励。独立审核 CLI 将 pending 变为 approved/rejected，在本地事务锁相册分配最后一席，approved 方可领奖/被采纳。拒绝后保留可读原因类别，不制造“已完成”。作者 `POST /:token/contributions/:id/withdraw {}` 可撤回正文和后续来源使用；已兑券不自动追扣。
- `POST /v1/shared-albums/:id/contributions/:contributionId/adopt {}` 仅发起人，使用公开 UUID 幂等键并捕获来源版本，返回 `{albumId,contributionId,status,memoryId?}`。Social 向 Memories 的受控 HTTP 请求仅传 `{sourceVersion}`，后者核对权威来源，创建 `origin:'shared_contribution'`；永久回执按 `(account_id,contribution_id)` 唯一并核对 album/sourceVersion，未知结果先查原回执。pending 尚无 memoryId，详情的 `adoption.memoryId` 同样可省略；仅成功存入才显示“已收进记忆”。禁止客户端传入采纳正文。来源撤回必须使已采纳记忆不可进入后续 AI、普通读取或导出，清理队列可重试；来源服务不明时 fail closed。
- `POST /v1/public/shared-albums/:token/reward {}` 访客凭据加真实会话（允许先投稿再登录）绑定一次领取，返回 pending/fulfilled 正式状态。Social 留存资格并以专用 Social 凭据调用 Gifts promotion 发放，业务键 `album:<albumId>:participant:<accountId>`；Gifts 只接该固定类型、每次一张基础券。其他共寄类型仍保留原界面与未接通反馈，不伪造资产或世界结果。

相册和投稿的公开令牌、访客令牌、真实账号会话和奖励永久键彼此独立。撤回/删除/注销需同时处理公开投影、原文来源、采纳、待兑现和账本；不保留他人的私人账号标识到已注销者的公开卡。对外发布与支付一样另有生产配置门槛，本轮仅合成账号本机验收。

恢复副本用 `shared_album_adoptions`、`shared_album_rewards`、`shared_album_source_cleanup` 的独立 `recovery_blocked` 标志隔离待执行副作用，保留原状态、来源版本、派发时间、回执与全部注销等待账号。隔离后 worker 不执行这些项；注销清理遇到隔离项返回不可用，不能假称已清理。账号仍由 Identity 的 restricted 状态阻断公开来源读取。恢复校验接受合法的跨服务待确认状态，同时核对人工参与决定、Memories 原始来源及 Gifts 固定一张基础券账本；发起人注销使相册消失，不抹去存活参与者自己已获得的资产。

## M01 无商户时的持久购买核心（2026-11-15 初始阶段）

本节保留仅核心阶段的边界；其中运行时无适配器、仅三次对账等描述已由文末自建多渠道收银台增量更新。没有实际商户与正式价格时，关闭购买、保护未知金融事实的行为仍适用。

本片在独立 Gifts 服务内建立报价、订单、尝试、退款预留、核验证据及对账待办。用户尚无商户，不确定正式 SKU、价格或支付渠道；当前生产构造始终 `provider=none`，不以原预览定价作为正式商品。`GET /v1/products` 返回 `{data:[],meta:{purchasingEnabled:false}}`。合法的购买创建请求返回 `503 PURCHASE_UNAVAILABLE`，读取订单始终纯读，不把刷新、客户端取消或进程退出当作付款事实。没有可在生产启用模拟成功的环境开关。

| 当前 HTTP 契约 | 请求/响应要点 |
| --- | --- |
| `POST /v1/purchase-quotes` | `{productId,quantity:1,channel}`；已配置渠道才可生成 `{quoteId,productSnapshot,quantity,channel,pricingSource:'server_quote',price:{amount,currency},createdAt,expiresAt}`。amount 为整数最小货币单位，价格及商品版本永久封存；当前无渠道，返回不可用 |
| `POST /v1/orders` | `{quoteId}`；按账号及永久 UUID key 受理一张报价一次，过期报价 `QUOTE_EXPIRED`，不同参数复用键 `IDEMPOTENCY_CONFLICT` |
| `GET /v1/orders`、`GET /v1/orders/{id}` | 本人完整订单；列表 `limit` 默认20/最大100、UUID cursor，返回 `{data:OrderView[],meta:{nextCursor}}`；详情返回 `{data:OrderView}`。仅查询不调用渠道或发放资产 |
| `POST /v1/orders/{id}/payment-attempts` | `{}`，返回 OrderView；一张订单最多一条尚未结束的尝试。未知结果查原 operation，不建立新扣款尝试；已有活动尝试 `PAYMENT_ATTEMPT_PENDING` |
| `POST /v1/orders/{id}/close` | `{}`，返回 `200 OrderView`；无未决尝试才可关闭。未知外部结果 `PAYMENT_OUTCOME_UNKNOWN`；已付款 `ORDER_ALREADY_PAID` |
| `POST /v1/orders/{id}/refunds` | `{}`，返回 OrderView；本片只预留整单原发行且仍完整可用的权益；已消费保存待审核事实并返回 `REFUND_REQUIRES_REVIEW`，不猜测部分退款比例 |

当前 `OrderView` 为 `{orderId,productSnapshot,pricingSource:'server_quote',price,paidAmount:null|{amount,currency},channel,status,paymentState,fulfillmentStatus,refundStatus,attemptSummary:null|{attemptId,status},refund:null|{refundId,status,failureCode},createdAt,updatedAt,version}`。`status` 仅为 `awaiting_payment|confirming|fulfilled|closed|refunded`，`paymentState` 为 `awaiting_payment|confirming|paid|closed`，`fulfillmentStatus` 仅为 `not_eligible|fulfilled`。前文的 awaiting_action、外部支付唤起、部分退款、独立退款列表等属于后续渠道规划，不能据此构造当前客户端。

所有公开写接口要求真实会话、Expected-Session、Origin 和 UUID Idempotency-Key；未知响应保留原请求键。服务内私有 adapter 才能提供规范化核验证据，必须精确匹配 order/operation/provider event/transaction/amount/currency。浏览器与普通内部凭据均无“付款成功”写入接口。只有测试代码显式注入且 `NODE_ENV=test` 才能使用合成 adapter，无法通过生产环境变量打开。

退款预留与消费在同一账号门禁下竞争；可用余额为 `balance_units-reserved_units`。经核验成功才按原 lot 逆向分录 capture，一次成功不会重复扣减；经核验失败 release，未知持续保留预留及对账待办。支付与退款 HTTP 均不在 SQL 锁内运行。任务捕获原 operation，45秒租约、30秒传输边界、最多3次含过期租约的有界对账，耗尽仍未知则 blocked，不能伪报失败或成功。

正式财务留存规则尚未确定，因此存在未决付款尝试时擦除返回 `FINANCIAL_RECONCILIATION_REQUIRED`；存在已核实付款事实（包括已退款）返回 `FINANCIAL_RETENTION_POLICY_REQUIRED`，在写入擦除栅栏前阻止部分清除。无外部未决事实的未付款记录可与私人数据一并清理。不得据这组隔离数据库/合成 adapter 测试宣称渠道支付、退款或正式留存验收已完成。


## M01–M03 原页面与最终生命周期验收（2026-11-15，本机合成账号）

- M02 沿原邀请页完成服务端链接、访客主动加入、首次 OTP 注册、用户手写首条正式记忆与双方奖励。新专用账号的实际账本为双方各一张基础券；普通注册没有 trial 或 paid 批次。邀请读回只显示资格和到账进度。
- M03 沿原“共同心愿”完成共创相册、匿名投稿、实际人工审核、发起人采纳与登录领奖。采纳记忆为 `shared_contribution`，确认事件 `qualifiesForReferral=false`；同一参与者重复领取后，账本仍只有一份相册奖励。当前两账号合计三张 promotion 券，没有邮资或库存发行。
- 首次两份原隐私页七域导出已下载并独立核对 14 个域 revision、采纳来源及双方私人内容隔离。恢复演练之后，原 UI 关闭相册，主人分享按钮禁用、关闭按钮消失；持有本人访客凭据仍可读自己的投稿并撤回，关闭后的标题和附言不再公开，陌生访客为404。撤稿清空正文／席位，主人采纳记忆及其原确认事件实际清除，Social采纳和Memories永久来源回执均revoked，清理等待0，三券保持。随后第二组七域导出再次核对14个revision，已无撤回正文／采纳记忆，不泄露另一方私有内容、账号或分享凭据。
- M01 原资产页的“订单记录”已接服务端列表与详情，列表固定每页20条、实际滚动分页，详情/刷新只 GET。切号、取消、错误订单身份、坏游标及迟到响应均有客户端反例。无商户情况下两个账号均为真实空订单，商品列表为空且 `purchasingEnabled=false`；购买继续沿原未开放反馈，不生成演示订单。金额展示按币种最小单位换算，不假定所有币种两位小数。
- 前端171项通过，TypeScript、service-mode构建及22个私密值／50个客户端文件扫描通过；Identity74、Conversations223、Social56、Memories84项完整回归通过。Gifts55项完整回归后新增的实际SQL来源校验已专项通过，当前共56项。恢复127项通过；1项默认跳过的native测试由本次实际八库210表演练单独覆盖。此前并行Social全测有一次旧队列测试文件失败，单文件及随后完整56项复跑通过，未改代码掩盖。
- 原生备份 `20261115080612921-9d23e139`、run `67ba0e7be42440a2` 保存有效邀请／采纳／券账时点，全部raw/checkpoint/core内容和新增跨域来源验证通过；八个源库和对象存储未变，隔离副本清理完成。无商户，订单／渠道证据／退款为0；本次对象为0，不能据此声称非空支付或媒体字节验收。16个源角色逐个恢复，`releaseReady=false`，详情见[恢复报告](../../deploy/recovery/README.md)。
- 最后沿原UI先注销参与者：独立回读七域93张私有表、14项间接关联、相关队列／对象／实际Logto身份均清理；发起人自己的1张邀请券、1笔入账及私有回执保留，跨账号归因已清。再经原UI注销发起人：同样93张私有表及17项间接关联通过，原相册7表和Memories共享来源回执清空。两人共186个私有账号表实例、31项间接关联核对通过；每人保留16条必要Identity记录、删除围栏和回执，在线私人记录／队列／对象／身份提供方用户均为0。已注销fixture封存，不再用于调用API；加密历史备份及受保护验收档案不属于在线账号擦除结论。

UI验收保留两次工具时序失败：Vite配置热重启导致首次页面导航中断；第二次把创建预览标题误认作已受理成功。后者改为等待实际POST响应并从已保存的正式相册ID继续，两次均未重复建相册或补造资产。原UI成功路径、实际人工审核决定、浏览器异常／非预期写入为0及独立账本证据分别保存，不以工具最终退出码替代业务回读。

这些记录只对应本机合成数据。实际商户收款、渠道退款、正式财务留存、Android正式安装版和生产发布尚未验收，不由关闭状态的购买核心或合成adapter测试替代。

## M01 自建多渠道收银台增量（2026-11-15，可配置接线完成）

用户确认没有指定收银台，选择按现有架构选型，并明确需要微信／支付宝以及Apple Pay、Google Pay、PayPal等主流方式。现采用两个独立自建网关：国内JeePay QR_CASHIER与国际Hyperswitch v1 Payment Links，可按商品channel同时配置。支付页和其SDK／后端都由用户自己部署，不要求使用两个厂商的Cloud托管。网关支持哪些钱包与实际商户、connector、地区、币种、域验证和设备资格有关；本片不等同于App Store／Google Play数字内容内购。

原钱包购买、订单列表／详情、取消及退款接真实接口。正式商品由私有配置文件提供，无演示价格或成功付款回退。创建报价、订单、付款和退款的永久键及冻结请求保存在账号自己的恢复记录；响应丢失、刷新和切号不产生新扣款意图。服务端报价更新商品版本／金额时先展示新报价，经用户再次明确点击才建单。只在明确点击时打开服务端已验证的付款地址，回跳参数不作为支付证据；Hyperswitch已知返回secret／签名参数在应用初始化时移出URL，其余查询和hash保留。付费邮资与trial邮资汇总为可用邮资，账本仍区分来源。

`OrderView.attemptSummary`兼容新增可选 `launch:{type:'redirect',url,expiresAt}`；仅本人当前有效待付款链接可读。JeePay真实链接的 `#/hub/` 页面路由保留；Hyperswitch使用标准 `payment_link.link`，不将仅供受限iframe使用的secure_link用于顶层跳转。链接首次持久化后不可替换，不进入数据导出。Origin配置及允许的付款页源严格校验，正式环境只允许HTTPS。

Gifts007新增launch、商户绑定摘要及对账deadline/error元数据，没有新增业务表。原操作捕获提供方、网关及merchant/app/profile绑定；配置变化在发起前和提交前均阻断。退款必须联结原已核实付款与原邮资批次。普通GET仍纯读，JeePay签名表单与Hyperswitch原始JSON HMAC-SHA512通知均只唤醒同一操作的权威查询，不能直接入账；Hyperswitch单一profile webhook可处理付款及退款。每次查单核对完整归属、金额和币种；国际付款仅全额自动capture可发整单权益，授权／部分扣款不冒充到账。

正常pending不再消耗原三次错误预算：付款最多30分钟／64次实际尝试，退款最多24小时／1441次，累计异常仍最多3次。超期或预算耗尽保留未知结果和退款预留，不按失败释放；恢复隔离任务不会被通知复活。已发起而回包丢失时只查原操作，Hyperswitch可恢复原付款链接，JeePay查询本身不含链接，首包完全丢失时不能另建支付掩盖未知结果。商户财务留存门槛仍独立保留。

完整配置步骤、变量映射、明确商品文件及配置后真实验收见[支付配置](../../deploy/checkout-setup.md)；固定源码／许可及自建方式见[JeePay](../../deploy/jeepay/README.md)与[Hyperswitch](../../deploy/hyperswitch/README.md)。本机007已迁移，Gifts三个角色恢复，商户开关保持关闭，实际订单／尝试／退款／活跃对账均0。本段为2026-11-15适配增量的历史记录；2026-11-16已补完两套开发堆栈的实际构建、启动及停启持久性验证，当前停止并保留私有配置／卷／镜像，最新边界与证据见上述两份部署说明及[本地交付记录](../backend-local-completion.md)。钱包设备、真实扣款／退款、生产 vault／运维与正式上线仍待相应配置和真实验证，不能由本地协议或页面结果替代。

本增量前端187项、Gifts完整78项通过；最后真实协议修正涉及的18项PostgreSQL购买回归与16项提供方协议检查通过，官方未修改Java SDK独立签名向量一致。恢复130项通过、1项默认原生跳过，最终购买来源／隔离专项10项通过；本增量未重跑八库原生演练，上一片210表演练证据只对应当时快照。真实Edge中原组件的关闭购买、正常购买／退款、丢订单回包刷新、丢付款回包刷新4个受控HTTP场景通过，0页面异常；实际StrictMode旧读取锁问题已修，最初失败证据保留。TypeScript、service-mode构建和私密值扫描通过，不以这些局部检查声称实际商户交易已通过。
