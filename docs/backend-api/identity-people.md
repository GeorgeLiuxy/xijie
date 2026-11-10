# 账号、人物与私有素材接口

覆盖 A01–A08 和 B01–B07。登录核心由身份提供方承接，西界负责业务账号、应用会话、资料归属和权限。身份链路上线前先验一个已选渠道。首批人物支持文本，照片独立上传，素材处理失败时保留文本草稿。提醒远程化、第三方账号换绑和多媒体提取按开关分批开放。

通用鉴权、幂等、错误和事件信封使用主契约。 [总契约](../backend-api-contract.md)

以下 `UUID` 是西界资源标识，`Instant` 是 UTC RFC3339 时间。`T?` 表示可省略，`T / null` 表示可清空。列中的结果类型置于通用 `data` 内。列表采用 `data: T[]` 和 `meta.nextCursor`。写接口按主契约处理 `Idempotency-Key`，更新及破坏性操作注明 `If-Match: "v<N>"`。除明确标注的引导入口，其余接口均从已验证的上下文取得 `accountId`。

## 1. 身份引导和会话

### 实体与不变量

| 对象 | 关键字段及约束 |
| --- | --- |
| `Account` | `id UUID`，`registrationId UUID`，`status active/restricted/deletion_pending/deleted`，`displayName string`，`locale string`，`version int`，`accessVersion int`，`registeredAt Instant`，`updatedAt Instant`。注册标识唯一，账号 ID 保持稳定。限制或注销时增加访问版本 |
| `AuthIdentity` | `id UUID`，`accountId UUID`，`issuer string`，`subject string`，`status active/disabled`，`verifiedAt Instant`。唯一约束 `(issuer, subject)`。主体由批准的身份提供方证明，手机号、昵称、邮箱与客户端本机标识均不充当合并依据 |
| `AuthAttempt` | `id UUID`，`client web/native`，`clientRegistrationKey string`，`purpose sign_in/switch/reauth`，`initiatingSessionId UUID?`，`invitationIntentId UUID?`，`returnRouteKey string?`，`proofHash string`，`expiresAt Instant`，`state pending/completed/cancelled/expired`。流标识一次使用，归因凭据只在真正注册时消费 |
| `Session` | `id UUID`，`accountId UUID`，`authIdentityId UUID`，`client web/native`，`clientRegistrationKey string`，`status active/revoked/expired`，`authenticatedAt Instant`，`expiresAt Instant`，`revokedAt Instant?`。创建、替换和撤销互斥处理，切换只替换发起设备的应用会话 |
| `IdentityOperation` | `id UUID`，`accountId UUID`，`kind link/unlink/replace_phone`，`targetIdentityId UUID?`，`state awaiting_proof/processing/succeeded/failed/expired`，`providerOperationRef string?`。绑定及换号以身份提供方的确认结果为准 |
| `AccountDTO` | `{id, displayName, locale, status, version, createdAt, onboardingState, capabilities}`。`onboardingState` 由已确认数据推导，取 `empty/has_person/has_memory`。`capabilities` 只包含能解释可用范围的布尔开关，前端仍逐个处理服务器拒绝 |
| `SessionDTO` | `{id, accountId, client, authenticatedAt, expiresAt}`。包含应用会话关联 ID，浏览器的实际会话凭据由安全 Cookie 承载。原生 SDK 的 OAuth 凭据存入安全存储 |

### A01、A02、A03、A06、A07、A08

| ID | HTTP 与调用方 | 输入与输出 | 服务端实现逻辑 |
| --- | --- | --- | --- |
| `IAM-01` | `POST /v1/auth/attempts`。未登录允许 `sign_in`，切换和重新验证需当前会话 | `{client, clientRegistrationKey?, purpose, invitationIntentId?, returnRouteKey?}` → `201 {attemptId, expiresAt, authorizationUrl?, attemptProof?}`。Web 返回受信任授权 URL，原生返回短时续办证明 | 按应用配置白名单解析客户端、允许回跳和用途。`clientRegistrationKey` 缺省时用该接入类别的服务端默认配置，无默认配置时返回 `400 INVALID_ARGUMENT`。记录选中的配置、发起会话和一次性状态。邀请意图由 Referral 已签发，绑定至本次尝试。Web Cookie 绑定浏览器及 PKCE 流，原生证明只保存摘要。新切换或验证尝试可替代同设备同用途的旧尝试 |
| `IAM-02` | `GET /v1/auth/callback`。身份提供方经浏览器重定向 | OIDC `code,state` 或允许的 `error,state` → `303` 至受信任页面 | 校验尝试、Cookie、状态、期限和一次性占用后，使用该尝试绑定的应用配置换取并验证令牌。发生取消或拒绝时只结算尝试。成功时按尝试用途调用账号解析及会话处理。重新验证只接受发起账号。设置 `Secure`、`HttpOnly`、同站一方 Cookie，轮换凭据。重放只跳转既定结果。浏览器返回地址不携带令牌、验证码或私有业务 ID |
| `IAM-03` | `POST /v1/sessions/bootstrap`。仅原生验证入口 | 验证候选 Bearer，`{attemptId, attemptProof}` → `201 {session: SessionDTO, account: AccountDTO, returnRouteKey?}` | 检查提供方、签名、受众、有效期、API scope、当前尝试绑定的应用及新交互授权证明。首发验证 SDK 能提供的交互证明能力，切换／重新验证用已验证的 `auth_time` 或一次性授权凭据约束。新令牌的 `iat` 不能单独证明重新登录。证明不可用时关闭对应入口并采用已批准的中介授权流程。事务内完成账号解析、会话替换、尝试消费。重新验证必须解析至发起账号，不能新建账号或把重新验证转为切号。临时错误时原尝试可安全重试 |
| `IAM-04` | `DELETE /v1/auth/attempts/{attemptId}`。当前会话、Web 尝试 Cookie 或原生尝试证明 | 原生以 `X-Auth-Attempt-Proof` 提交证明 → `204` | 校验尝试所有权后标记取消。并发回调和取消争同一状态行，取消先成功则迟到回调不能替换会话。已完成的尝试需按会话查询确认，不能把完成标成取消 |
| `IAM-05` | `GET /v1/sessions/current`。应用会话 | 无请求体 → `200 SessionDTO` | 按 Cookie 或已验证的 API Bearer 与应用会话关联查询。验证会话仍有效、账号可用及访问版本。原生正式请求带 `X-Session-Id`，与 Bearer 的可信身份匹配。只读，过期返回 `401 UNAUTHENTICATED`，不创建账号 |
| `IAM-06` | `DELETE /v1/sessions/current`。应用会话 | 无请求体 → `204` | 幂等撤销当前应用会话。浏览器清 Cookie，原生端清本地安全凭据与当前私域缓存。提供方登出与令牌撤销按平台流程执行，提供方短暂不可用时应用会话已不可访问。此命令不撤销其他设备会话 |
| `IAM-07` | `GET /v1/accounts/me`。应用会话 | 无 → `200 AccountDTO` | 读取已有账号与政策能力。账号不存在时要求完成可信授权引导，读取本身没有注册或发奖副作用。回访入口从 `onboardingState` 和已有私域资源查询派生 |
| `IAM-08` | `PATCH /v1/accounts/me`。应用会话 | `If-Match`，`{displayName?, locale?}` → `200 AccountDTO` | 限制为资料字段，按版本更新。昵称修剪长度上限和拒绝空白规则写入运行时校验。登录渠道、账本状态、年龄核验和权限不可由资料更新更改 |
| `IAM-09` | `GET /v1/accounts/me/identities`。应用会话 | 无 → `200 IdentitySummary[]`，项 `{id, provider, maskedIdentifier?, verifiedAt, canUnlink}` | 由可信提供方绑定信息产生脱敏投影，是否可解绑结合登录方式和产品策略判断。提供方状态不明时禁用操作并给出可重试提示 |
| `IAM-10` | `POST /v1/accounts/me/identity-operations`。已完成近期重新验证的应用会话，按需 | `{kind, targetIdentityId?, provider?}` → `202 {operationId, state, expiresAt, providerActionUrl?}` | 校验当前账号、可用身份与近期强认证，建立操作并返回批准的身份提供方流程。换号须验证新号码，解绑前须保留至少一种可用认证方式。重复创建回读同一操作。依赖能力未验收时不开入口 |
| `IAM-11` | `GET /v1/accounts/me/identity-operations/{operationId}`。应用会话，按需 | 无 → `200 {id,kind,state,expiresAt,failureCode?}` | 只读当前归属与已记录结果。绑定结果由可信回跳或后台查证同步推进。冲突身份归另一账号时保持原绑定，返回 `IDENTITY_ALREADY_BOUND`。提供方与本地不能共事务，结果未知时对账回读，禁止依据前端成功提示切换主体 |

`client=web/native` 表示应用会话的接入类别。Android、iOS 与鸿蒙原生客户端各自登记应用配置、授权客户端和允许回跳。`clientRegistrationKey` 用于选择配置，归属以提供方或后端核验的回程证据为准。同一 API 受众仅证明令牌可用于此 API，应用归属还要校验与当前尝试绑定的回程证据。新端使用同一已验证主体时沿用原 `accountId`。若提供方对不同应用返回不同 `sub`，用原账号会话及新身份验证显式绑定。新增端验收应覆盖同账号跨端回读、跨应用凭据拒绝及伪造平台头无法提升权限。 [OIDC 主体标识](https://openid.net/specs/openid-connect-core-1_0.html#SubjectIDTypes)

`IAM-04` 完成后的撤销尝试返回 `409 CONFLICT`，客户端改查 `IAM-05`。`IAM-01` 的 `returnRouteKey` 采用白名单逻辑名，例如 `home`、`account`、`invite_return`。邀请输入保存在服务端意图中。前端返回原始业务操作时重新查询目标对象及权限。Logto 登录页负责发码、验证码、供应商授权、失败及原生回跳，西界不另设验证码发送或验证接口。上线前分别用正式包验证 Web Cookie 模式和原生系统授权流程。 [Logto Capacitor 指南](https://docs.logto.io/quick-starts/capacitor-js) · [Logto 账号中心](https://docs.logto.io/end-user-flows/account-settings/by-account-center-ui) · [原生 OAuth 指南](https://www.rfc-editor.org/rfc/rfc8252.html)

切号成功先原子提交新会话及旧会话撤销，再更新客户端会话代际。Native 后续请求使用 API Bearer 加配套的 `X-Session-Id`，后端复核令牌身份、应用会话、账号与访问版本。此关联 ID 不承担独立身份认证。取消切号保留原会话，晚到的 HTTP、SSE 和深链按客户端会话代际丢弃。旧账号已受理的工作继续按原归属和当前授权处理，禁止迁到新账号。重新验证目标必须仍为发起账号。匿名游客只允许调用明确列为公开的端点。

## 2. 同意、数据权利和导入

### A04、A05、A08

| ID | HTTP 与调用方 | 输入与输出 | 服务端实现逻辑 |
| --- | --- | --- | --- |
| `PRV-01` | `GET /v1/policies/current`。允许匿名 | `locale?` 查询 → `200 PolicyDTO[]`，项 `{id,kind,version,locale,documentUrl,decisionRequired}` | 按产品生效规则返回可公开文案，语言只影响展示。地区、年龄和使用范围从服务端资格策略判断。发布新版本保留历史记录 |
| `PRV-02` | `GET /v1/accounts/me/consents`。应用会话 | `cursor?`,`limit?` → `200 ConsentDTO[]`，项 `{id,policyId,version,purpose,decision,recordedAt,authorizationVersion}`，`meta.currentAuthorizationVersions` 按用途返回当前版本，独立于分页 | 读取本账号的同意与告知。未建立当前记录的用途版本按 `0` 处理。隐私告知的确认与数据处理授权分别记录 |
| `PRV-03` | `POST /v1/accounts/me/consents`。应用会话 | `{policyId,version,purpose,decision,expectedAuthorizationVersion}` → `201 ConsentDTO`。`decision acknowledge/accept/grant/revoke` 由政策允许组合限定 | 校验政策版本及用途。对新的操作先锁账号与用途，再比较 `expectedAuthorizationVersion`，没有当前行时使用 `0`。不匹配返回 `412 VERSION_CONFLICT` 及 `details.currentAuthorizationVersion`。追加历史、推进授权投影和撤权事件同事务。同键重放按总规范处理，冲突后重读并重新确认用途。任务开始及写回均复核当前授权 |
| `PRV-04` | `POST /v1/accounts/me/data-requests`。近期重新验证的应用会话 | `{kind, scope?, deletionReceiptId?, statusProof?}`，`kind export/delete_account`，导出 `scope interaction_data/account_data`，注销按 `account_data` → `202 {id,kind,status,requestedAt}` | 核验申请范围，写受理记录并入队。注销受理后将账号置为 `deletion_pending`，增加访问版本，使全部会话和分享立即失去访问资格，再异步清理会话及凭据。仅保留查询此注销单的短期证明摘要。注销时客户端必须在提交前生成并安全暂存随机 `deletionReceiptId UUID` 和至少 256 位随机 `statusProof`，即使受理响应丢失也能查原单。两值只用于注销，服务端在请求事务绑定到生成的 `id`，拒绝冲突。删除期间以墓碑阻断读写及任务，保留依法或按售后策略需要的受限交易资料 |
| `PRV-05` | `GET /v1/accounts/me/data-requests/{requestId}`。应用会话 | 无 → `200 {id,kind,status,requestedAt,updatedAt,resultExpiresAt?,failureCode?}` | 查当前账号归属。状态 `accepted/processing/completed/failed`。结果不含可直接下载的通用公开链接 |
| `PRV-10` | `GET /v1/data-request-receipts/{deletionReceiptId}`。显式允许注销单凭证访问 | `X-Data-Request-Proof` → `200 {id,kind,status,requestedAt,updatedAt}` | 校验收据、证明摘要、期限和状态用途，限流。只回单笔注销进度，旧会话已清也能查。证明过期走受控身份复核恢复，禁止列出账号、素材或交易 |
| `PRV-06` | `POST /v1/accounts/me/data-requests/{requestId}/download`。近期重新验证的应用会话 | 空请求 → `200 {downloadUrl,expiresAt}` | 确认导出成功、范围和归属，生成短时读取凭证并记录审计。导出件默认私有，期限由发布策略配置。注销凭据不授权下载 |
| `PRV-07` | `POST /v1/accounts/me/imports`。应用会话，旧数据需要迁移时 | `{sourceKind, archiveMediaId, sourceDigest}` → `202 {id,state,sourceDigest}`，`sourceKind preview_archive` | 在事务内建批次后调用 `Media.bindUse` 把已校验的 `legacy_import` 文件绑定到本批次，异步校验清单和来源。无法核实的记录留待确认。依据账号、源批次与旧对象 ID 去重，拒绝把导入包里的 `owner` 当身份。正式钱包、订单、奖励和认证都不从演示资料导入 |
| `PRV-08` | `GET /v1/accounts/me/imports/{id}`。应用会话 | 无 → `200 {id,state,version,summary,warnings,confirmedAt?}` | 读取本账号解析或执行进度。`state reviewing/ready/running/completed/failed`，摘要按人物、资料、消息、回忆、媒体计数 |
| `PRV-09` | `POST /v1/accounts/me/imports/{id}/confirm`。应用会话 | `If-Match`，`{sourceDigest}` → `202 {id,state}` | 用户先核对计划和归属，再锁定已审核批次提交。按导入映射和重试标识分块入库，旧 ID 重试指向相同正式 ID。标记导入来源，保留旧资料，完成后可对照原文、媒体及历史引用 |

`Consent` 保存 `policyId`、不可变政策 `version` 和 `recordedAt`。当前授权投影以 `(accountId,purpose)` 为键，事务内递增 `authorizationVersion`。历史同意按 `(accountId,purpose,authorizationVersion)` 唯一。拒绝晚到的旧授权变更时返回当前用途的版本，撤权事件使用已提交版本。`DataRequest` 和 `ImportBatch` 有账号归属和审计。权利申请、材料授权与账号访问限制是独立维度。外观、语言设备展示、字号、朗读、动效、触感与音效默认留在客户端。`Account.locale` 用于服务端生成、提示和政策展示时的语言偏好。首发按目标渠道核对应用内注销及所需网页入口。 [Apple 账号删除](https://developer.apple.com/support/offering-account-deletion-in-your-app/) · [Google Play 账号删除](https://support.google.com/googleplay/android-developer/answer/13327111)

## 3. 私有素材与用途

### B01、B03、B05、B06

`MediaDTO` 返回 `{id,purpose,status,mimeType,byteSize,version,authorizationVersion,createdAt,updatedAt,failureCode?}`。`Media` 的业务状态为 `awaiting_upload/verifying/ready/rejected/revoked/deleted`，包含 `{id,accountId,purpose,mimeType,byteSize,sha256?,createdAt,updatedAt,version,authorizationVersion,status}`。持久化服务端生成的私有对象键、不可变对象版本和校验结果。公开 DTO 隐藏存储键、上传证明和安全扫描细节。`MediaUseGrant` 记录账号、素材、用途、目标、有效状态和授权依据。用途包括 `person_source/profile_photo/conversation_attachment/memory_attachment/post_attachment/gift_delivery_photo/ai_context/personal_export/legacy_import`。X01 启用服务端语音转写后增加 `transcription_input`，目标为本人会话，校验音频格式及最短保留策略。原型首先接受人物与草稿图片。录音、视频、可供模型处理的用途在政策、渠道和能力通过后开放。

| ID | HTTP | 输入与输出 | 服务端实现逻辑 |
| --- | --- | --- | --- |
| `MED-01` | `POST /v1/media` | `{mimeType, byteSize, sha256?, purpose, target?:{kind,id}}` → `201 {media:MediaDTO, upload:{id,method,url,requiredHeaders,expiresAt}}` | 校验大小、媒体类型、用途资格与配额。有目标时验证归属并记目的范围。帖子、首条会话、回忆、导入等目标尚未创建时允许按账号暂存，后续仅能以初始用途绑定。存初始化记录与短期上传槽，签名限定方法、对象和必要头。客户端直接向私有对象存储上传 |
| `MED-02` | `POST /v1/media/{mediaId}/complete` | `{uploadSlotId,uploadETag?,sha256?}` → `202 MediaDTO` | 先检查当前账号和上传槽，在事务外向存储验证对象存在、字节数和可用版本。短事务再锁定素材并复核上传槽、授权和对象版本，记验证记录、转为 `verifying` 并入队。Worker 验实际类型、安全规则和摘要。重复完成返回已有校验状态 |
| `MED-03` | `GET /v1/media/{mediaId}` | 无 → `200 MediaDTO` | 检查归属和可见范围，返回状态、版本及可解释失败原因。首次上传者可看到本人素材的 `rejected/revoked` 状态，但不能读取原文件 |
| `MED-04` | `POST /v1/media/{mediaId}/read-url` | `{purpose,target?:{kind,id}}` → `200 {mode,url,expiresAt,authorizationVersion,readProof?}`，`mode signed_url/authorized_stream` | 验证目标当前归属、素材为 `ready`、素材和目标间的用途授权有效。签发限时访问。账号暂存只在策略明确允许本人预览时可省目标，采用不可转交的授权流。需即时撤回的内容走 `MED-07`。公开分享走公开投影 |
| `MED-05` | `DELETE /v1/media/{mediaId}` | `If-Match` → `204` | 撤销素材所有用途并增加授权版本，同事务写撤销事件及清理任务。先拒绝新读取与任务，后台按保留策略清除对象。已有任务写回前复核版本；陈列、预览和其他引用退回缺失状态 |
| `MED-06` | `POST /v1/media/{mediaId}/upload-slots` | `If-Match`，无请求体 → `201 {media:MediaDTO, upload:{id,method,url,requiredHeaders,expiresAt}}` | 上传未完成且仍有资格时补签新槽。事务内停用旧槽并换暂存键。旧 URL 即使仍可传输也不能完成当前素材。已在校验或完成时先回读状态 |
| `MED-07` | `GET /v1/media/{mediaId}/content` | `X-Media-Read-Proof` → 受控二进制流 `200` 或 `206` | 使用原应用会话与 `MED-04` 的限时证明，校验账号、版本、目标和用途后代理读取。复核范围请求，禁止把对象键或可转发私域凭证返回给客户端。受控响应避免公共缓存 |

上传需要验证所选 S3 兼容产品支持的限时签名、版本号和条件写入。验收须防止暂存对象校验后被旧 URL 覆写。采用固定对象版本或带前置条件复制到服务端可写的不可变读取键，再做扫描和格式检查。`ready` 由 Worker 依据校验结果推进。上传失败或格式不合格可新建素材；过期草稿或槽由清理任务删除。提供方支持差异先做 V01 验证。 [S3 条件写入参考](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html) · [S3 预签名 URL](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)

## 4. 寻找 TA、人物、世界和提醒

### 实体与字段

| 对象 | 关键字段及约束 |
| --- | --- |
| `PersonDraft` | `{id,accountId,status,version,displayName?,relationship?,story?,realName?,calledMe?,birthMonthDay?,yearsText?,place?,mediaIds[],sourcePersonId?,confirmedPersonId?,createdAt,updatedAt,expiresAt}`，`status draft/confirmed/discarded/expired`。保存草稿可暂缺字段。开始预览或确认时至少校验称呼、关系、故事 |
| `PersonPreview` | `{id,accountId,draftId,draftVersion,status,renderMode,summary?,suggestedWorldId?,unknownFields[],sourceRefs[],expiresAt,createdAt,failureCode?}`，`status queued/running/succeeded/failed/cancelled/stale`。建议内容与草稿、资料及授权版本绑定，仅作候选 |
| `Person` | `{id,accountId,sourceDraftId?,displayName,relationship,realName?,calledMe?,story?,birthMonthDay?,yearsText?,place?,worldId,avatarMediaLinkId?,status,version,accessVersion,createdAt,updatedAt}`，`status active/removed`。`birthMonthDay` 为 `MM-DD`。移除和权限变化增加访问版本。`(accountId,sourceDraftId)` 唯一，保证一个草稿只确认一个人物 |
| `PersonMediaLink` | `{id,accountId,personId,mediaId,purpose,status,createdAt}`，用途 `person_source/profile_photo`，活动关联唯一。人物、草稿和媒体外键保持同账号 |
| `World` | `{id UUID,code,displayName,enabled,sceneKey?,catalogVersion}`。初始稳定 `code` 为 `courtyard/tide/isles`。人物归属用 `worldId`，页面素材与主题可继续读取端侧配置。迁居不能重建人物 ID |
| `Reminder` | `{id,accountId,personId,kind,label?,monthDay?,localTime,timeZone,enabled,version,nextAt?}`。仅在需要跨端同步或后台送达时持久化。`kind birthday/anniversary`，`timeZone` 是 IANA 时区 |

`PersonDTO` 返回当前可见的人物字段、资料引用、`version` 和当前世界。AI 提取和人物预览保留 `sourceRefs` 与来源性质。人物资料与已确认回忆各有独立资源，人物查询通过关联定位原文。照片只以 `mediaId` 或资料关联 ID 引用。

首发接口校验采用以下范围，缩减或扩大范围时须更新 OpenAPI 和前端错误映射。`displayName` 和 `relationship` 修剪后分别为 1–80 与 1–40 个 Unicode 字符。创建草稿时可省略，存在时按同一范围校验。`realName`、`calledMe`、`yearsText` 与 `place` 各最多 120 字符，`story` 最多 20,000 字符。`birthMonthDay` 允许有效的 `02-29`，年份未知时使用 `yearsText` 或留空。单人活动资料关联的首发上限建议 12 项。媒体类型、字节上限和期限由发布配置按用途确定，向客户端返回可纠正的校验结果。

| 返回类型 | 结构 |
| --- | --- |
| `PersonDraftDTO` | `{id,status,version,displayName?,relationship?,story?,realName?,calledMe?,birthMonthDay?,yearsText?,place?,mediaIds[],confirmedPersonId?,activePreviewId?,updatedAt,expiresAt}` |
| `PersonPreviewDTO` | `{id,draftId,draftVersion,status,renderMode,summary?,suggestedWorldId?,unknownFields[],sourceRefs[],expiresAt,failureCode?,retryable?}`。`sourceRefs` 只提供当前可见的 `{kind:'draft_story'/'media',id,version}` |
| `PersonDTO` | `{id,displayName,relationship,realName?,calledMe?,story?,birthMonthDay?,yearsText?,place?,worldId,avatarMediaLinkId?,mediaLinks[],status,version,createdAt,updatedAt}`。`mediaLinks` 为有效的 `PersonMediaLinkDTO` |
| `PersonMediaLinkDTO` | `{id,personId,mediaId,purpose,createdAt}`。媒体访问仍需单独授权 |
| `WorldDTO` | `{id,code,displayName,enabled,sceneKey?,catalogVersion}` |
| `ReminderDTO` | `{id,personId,kind,label?,monthDay?,localTime,timeZone,enabled,version,nextAt?}`。`localTime` 用 `HH:mm`，绝对发生时间用 `Instant` |

### B01、B02、B03、B04、B05、B06、B07

| ID | HTTP | 输入与输出 | 服务端实现逻辑 |
| --- | --- | --- | --- |
| `PER-01` | `POST /v1/person-drafts` | `{displayName?,relationship?,story?,sourcePersonId?}` → `201 PersonDraftDTO` | 建立账号内草稿。回填时先查询同账号可见的旧人物，仅复制允许字段及仍有效的素材引用。空草稿可建。示例演示不作为正式资料或奖励来源 |
| `PER-02` | `GET /v1/person-drafts` | `cursor?`,`limit?`,`status?` → `200 PersonDraftDTO[]` | 以账号与状态过滤，游标绑定过滤条件。过期草稿进入可清理状态 |
| `PER-22` | `GET /v1/person-drafts/{draftId}` | 无 → `200 PersonDraftDTO` | 校验账号后返回版本及可续办预览标识。过期返回 `expired` 及可处理提示 |
| `PER-03` | `PATCH /v1/person-drafts/{draftId}` | `If-Match`，`{displayName?,relationship?,story?,realName?,calledMe?,birthMonthDay?,yearsText?,place?,mediaIds?}` → `200 PersonDraftDTO` | 仅允许 `draft` 更新，校验字段和媒体用途，增加草稿版本并使旧预览失效。更新对暂时仍在上传的照片只记录待校验选择，模型与确认只能使用已授权并可读的素材 |
| `PER-04` | `DELETE /v1/person-drafts/{draftId}` | `If-Match` → `204` | 把未确认草稿置为 `discarded`，失效预览并入队清理草稿独占素材。已确认时返回冲突，已建立的人物由人物接口处理 |
| `PER-05` | `POST /v1/person-drafts/{draftId}/previews` | `If-Match`，`{worldPreferenceId?,previousPreviewId?,renderMode?}` → `202 {id,draftId,draftVersion,status,renderMode}`，`renderMode user_input/ai_candidate` | 锁定可用草稿版本，检查最低字段及授权。记录资料和策略版本，入队一次候选计算。`user_input` 模式只展示用户资料和规则建议，无需调用生成模型。模型失败或用户不授权生成时可重新请求此模式。重找时校验旧候选归本草稿且当前有效。Worker 运行及写回前复核草稿和授权版本 |
| `PER-06` | `GET /v1/person-drafts/{draftId}/previews/{previewId}` | 无 → `200 PersonPreviewDTO` | 校验归属与父子关系。草稿变更后保留 `stale` 状态，不返回已撤权的候选正文。失败信息提供 `failureCode` 和是否适合重试 |
| `PER-07` | `POST /v1/person-drafts/{draftId}/confirm` | `If-Match`，`{previewId,worldId}` → `201 PersonDTO` | 事务内锁定草稿、候选、当前授权与目标世界。候选须成功、未过期且对应当前草稿版本，世界可选择。根据用户确认后的字段建人物和已授权素材关联，消费草稿并记录 `PersonConfirmed.v1`。一个草稿唯一对应一个人物，不自动建会话、回忆或礼物。同一已完成请求重放回读原人物，异参冲突 |
| `PER-08` | `GET /v1/persons` | `worldId?`,`cursor?`,`limit?` → `200 PersonDTO[]` | 只读本账号有效人物。按世界筛成员，游标绑定世界筛选 |
| `PER-23` | `GET /v1/persons/{personId}` | 无 → `200 PersonDTO` | 以 `People.requirePerson` 验证有效归属，返回可见资料和当前世界。找不到、已移除和他人对象同为 `404 NOT_FOUND`。私聊与回忆仍由相应域独立鉴权 |
| `PER-09` | `PATCH /v1/persons/{personId}` | `If-Match`，`{displayName?,relationship?,realName?,calledMe?,story?,birthMonthDay?,yearsText?,place?,avatarMediaLinkId?}` → `200 PersonDTO` | 在事务中校验归属、版本及主图关联。编辑字段只改人物资料。生日取消或变更时更新该人物的生日提醒下一次时间。涉及生成事实的修改在任务写回时检查人物数据版本 |
| `PER-10` | `POST /v1/persons/{personId}/media-links` | `If-Match`，`{mediaId,purpose}` → `201 PersonMediaLinkDTO` | 校验图片或已开放的素材类型和用途，建立账号内有效关联。已有同一活动关联可幂等返回。模型处理另查 `ai_context` 授权 |
| `PER-11` | `DELETE /v1/persons/{personId}/media-links/{linkId}` | 人物 `If-Match` → `204` | 同事务撤销关联和目标用途、增加素材授权版本，清除指向该关联的主图，写撤销事件。其他合法目标的素材记录可继续引用，复核后重新签发。最后一个关联消失时按保留策略入队清理 |
| `PER-12` | `POST /v1/persons/{personId}/world` | `If-Match`，`{worldId}` → `200 PersonDTO` | 校验世界有效与选择资格后变更当前世界，原子写迁居事件。按人物 ID 查私聊和回忆，按世界 ID 查当前小聚成员。旧消息与寄礼用事件保存时的世界快照 |
| `PER-13` | `DELETE /v1/persons/{personId}` | `If-Match` → `204` | 事务内置 `removed`，提高访问版本，阻止新会话、生成、送礼、媒体访问及旧结果写回。同事务发布撤权事件并调度索引、素材、提醒与业务引用清理。公开投影随各自授权策略更新。账本与历史回执按留存规则保留必要快照 |
| `PER-14` | `POST /v1/persons/{personId}/extractions`。按需 | `If-Match`，`{mediaIds[],kind}`，`kind photo/audio/video/chat_archive` → `202 {id,status,personVersion}` | 验证所有已准备的素材及 AI 用途，绑定素材授权版本与人物版本，入队提取候选。开放的素材和内容类型由能力配置限制。样例素材走原型 |
| `PER-15` | `GET /v1/persons/{personId}/extractions/{id}`。按需 | 无 → `200 {id,status,personVersion,items?,failureCode?}`，候选项 `{id,kind,value,sourceRefs}` | 校验归属及素材有效性。过期、撤权或人物版本已失配时标记结果失效，隐藏候选原文 |
| `PER-16` | `POST /v1/persons/{personId}/extractions/{id}/confirm`。按需 | `If-Match`，`{selectedItemIds[]}` → `200 {person:PersonDTO,appliedItemIds,createdMemoryCandidateIds}` | 校验候选集、来源权限和当前人物版本后，对选择项执行一次应用。更新资料字段，记忆条目进入候选域，用户仍需从记忆接口确认原文。唯一 `(extractionId,itemId)` 防止重放 |
| `PER-17` | `GET /v1/worlds` | `cursor?`,`limit?` → `200 WorldDTO[]` | 返回当前可选的最小版本化世界目录。私人世界成员由 `PER-08` 提供 |
| `PER-24` | `GET /v1/worlds/{worldId}` | 无 → `200 WorldDTO` | 返回指定版本化目录项和可选场景键。已下架世界在历史详情仍按允许范围显示，不能作为迁居目标 |
| `PER-18` | `GET /v1/persons/{personId}/reminders`。按需 | `cursor?`,`limit?` → `200 ReminderDTO[]` | 只读拥有且有效的人物下的提醒。只用本机调度时无需此接口 |
| `PER-19` | `POST /v1/persons/{personId}/reminders`。按需 | `{kind,label?,monthDay?,localTime,timeZone,enabled}` → `201 ReminderDTO` | 校验日期、时间、时区与本人资格。生日使用人物资料的 `birthMonthDay`，纪念日输入月日。闰日遇非闰年跳过。夏令时重复本地时间选择第一次出现，缺失时顺延至首个有效本地时刻。保存 `nextAt` 并按版本入队 |
| `PER-20` | `PATCH /v1/persons/{personId}/reminders/{reminderId}`。按需 | `If-Match`，`{label?,monthDay?,localTime?,timeZone?,enabled?}` → `200 ReminderDTO` | 更新当前版本、重新计算下一次，旧任务启动时检查提醒有效性及版本。关闭或删除原生通知也须同步端侧订阅 |
| `PER-21` | `DELETE /v1/persons/{personId}/reminders/{reminderId}`。按需 | `If-Match` → `204` | 撤销提醒并使在途任务失效。发送按 `(reminderId,occurrenceAt)` 去重，通知文案不包含未经允许的敏感资料 |

## 5. 进程内调用、外部边界与事件

`AccountActor` 表示已经验证的业务主体，具体字段使用主契约。Worker 从已持久化的任务和业务对象重建受限委托，并校验账号访问版本、用途和目标版本。客户端会话退出不会自动撤销已受理任务的业务归属。`tx` 表示与主命令相同的业务事务。模块读取对象前仍需校验用途与归属。

| 接口 | 入参 → 出参 | 实现及调用顺序 |
| --- | --- | --- |
| `Accounts.getOrProvisionAccount` | `(tx, verifiedPrincipal:{issuer,subject,authTime}, invitationIntentId?:UUID)` → `{accountId,isNew,registrationId?}` | 仅由 `IAM-02/03` 用已验证主体调用。按主体唯一约束查询或首次建档。启用邀请功能且本次有归因意图时，首次注册同事务调用 `Referrals.bindRegistration(tx,{accountId,registrationId,verifiedAt,invitationIntentId?})`。无效、过期或自邀不阻断合法登录，依赖事务故障整体回滚。写出事件后由成功会话回读。既有账号登录不重绑邀请 |
| `Accounts.requireActive` | `(txOrDb, actor)` → `{id,accessVersion,status:'active'}` | 入口与 Worker 使用统一规则。账号不允许当前操作时拒绝，注销或受限账号仅可走已授权的权利或售后入口 |
| `People.requirePerson` | `(txOrDb, actor:AccountActor, personId:UUID)` → `{id,accountId,worldId:UUID / null,version,accessVersion}` | 以当前账号与状态校验人物。送礼扣减、生成写回等有副作用时在同事务重新验证归属与访问版本。需要阻断并发删除时锁定人物行并遵守固定锁顺序 |
| `Media.authorizeMediaUse` | `(txOrDb, actor:AccountActor, {mediaId,purpose,target:{kind,id},expectedAuthorizationVersion?})` → `{mediaId,authorizationVersion,mimeType,byteSize}` | `target.kind` 允许 `person/person_draft/conversation/memory/post/import/gift_delivery`，按各域验证目标。仅返回 `ready`、属当前账号、用途有效的素材。使用权限版本用于排队及落库复核。此调用不把 URL 或对象键转交前端 |
| `Media.bindUse` | `(tx, actor:AccountActor, {mediaId,purpose,target:{kind,id}})` → `{mediaId,authorizationVersion,mimeType,byteSize}` | 对同账号已就绪素材，先验证初始用途、目标范围和当前授权，再为已经存在或本事务刚创建的目标写有效关联。暂存素材在目标建好后才可绑定。目标未创建时，用途资格和账号级配额提前检查。写入与目标业务资源同事务 |
| `Media.revokeUse` | `(tx, actor, {mediaId,targetKind?,targetId?})` → `{authorizationVersion}` | 在资料关联删除或全素材撤销时更新授权，持久化新版本和事件，派生引用清理在提交后执行 |
| `IdentityProvider` | `beginAuthorization`、`exchangeAuthorization`、`verifyAccessToken`、`getIdentitySummary`、`reconcileIdentityOperation` | OIDC SDK 负责授权、换取和验证。近期验证、原生回跳、账号中心及解绑能力依据目标平台实测，失败时保持最后一次已验证关系。外部调用与本地事务分开，保存可查的外部操作标识 |
| `ObjectStorage` | `createUploadSlot`、`inspectObjectVersion`、`promoteVerifiedObject`、`signRead`、`deleteIfRetained` | 适配私有对象存储。签名、对象版本和权限策略独立于业务 API。校验任务提交前确认目标对象不可变。删除任务需要复核当前是否有其他允许的引用 |
| `PeoplePreviewWorker` 与 `MediaVerifyWorker` | 任务引用 `{accountId,objectId,expectedVersion,authorizationVersion?}`，完成后更新对应资源 | 按对象版本和任务 ID 去重，运行及写回前复核授权。远程计算在短数据库事务之外。处理结果与任务状态持久化，前端断线后按 ID 重读 |

### 领域事件载荷

| 事件 | 业务载荷 | 产出与订阅 |
| --- | --- | --- |
| `AccountRegistered.v1` | `{accountId,registeredAt,referralAttributionId?:UUID}` | 首次建档事务产生。邀请域可按归因 ID 验证资格，旧用户登录和资料导入不产生此事件 |
| `AccountAccessRevoked.v1` | `{accountId,accessVersion,reason:'account_deletion'/'account_restricted',revokedAt}` | 全账号失效事务产生。各域阻断读取、分享、推送和生成。单设备退出与切号只撤销对应会话 |
| `PersonConfirmed.v1` | `{accountId,personId,worldId,personVersion}` | 草稿确认事务产生。索引可异步投影，私聊在首条消息时由会话域按幂等规则建立 |
| `PersonWorldChanged.v1` | `{accountId,personId,fromWorldId:UUID / null,toWorldId,personVersion}` | 迁居事务产生。刷新当前世界成员与索引。已经生成的历史快照仍用旧世界 |
| `PersonAccessRevoked.v1` | `{accountId,personId,accessVersion,reason:'person_removed'}` | 人物移除事务产生。会话、检索、回忆、提醒和公开投影复核失效。账本保留有权读的必要快照 |
| `MediaReady.v1` | `{accountId,mediaId,authorizationVersion}` | 校验完成事务产生。已授权用途可使用不可变对象 |
| `MediaUseRevoked.v1` | `{accountId,mediaId,authorizationVersion,targetKind?:string,targetId?:UUID}` | 素材或单用途撤权事务产生。授权和结果失效以数据库版本为准，消费者可重跑。载荷不包含对象 URL 或私有内容 |

### 领域错误和验收

| 错误码 | HTTP | 处理 |
| --- | --- | --- |
| `AUTH_ATTEMPT_EXPIRED` | `410` | 返回登录或切换流程，原已登录账号仍有效 |
| `IDENTITY_ALREADY_BOUND` | `409` | 展示绑定冲突并保留原身份。重新验证或经既定恢复流程解决 |
| `LAST_LOGIN_METHOD` | `409` | 先验证并添加另一种可用的登录方式 |
| `CONSENT_REQUIRED` | `403` | 按错误详情提示所需政策与用途，用户可重新确认或关闭动作 |
| `MEDIA_NOT_READY` | `409` | 前端回读素材状态，素材就绪后继续。被拒绝时要求换文件 |
| `MEDIA_PURPOSE_DENIED` | `403` | 停止当前用途，等待授权或改用其他素材 |
| `PREVIEW_STALE` | `409` | 保留草稿，按最新版本重新预览 |
| `IMPORT_SOURCE_UNVERIFIED` | `422` | 保留原资料，重新检查来源与包摘要后再确认 |

- 两账号切换、取消、过期和并发回调分别验证。刷新或杀进程后能通过业务状态恢复，已注销账号的迟到请求和任务写回被拒绝。验收须覆盖浏览器及所选正式安装包。
- 以合成资料完成文字人物确认。照片上传失败时仍能编辑纯文字。同一个草稿重复确认只产生一个人物。草稿或权限变更后的旧候选不能被确认。
- 移除人物与旧任务并发、素材撤权与签名并发、导入重试、旧世界历史、漏项生日提醒和取消提醒均需验证。跨账号的猜测 ID 不能读取人物、素材、任务或导出件。备份恢复后仍执行有效墓碑和权限版本。

[交互清单](../backend-interaction-inventory.md) · [交付优先级](../backend-delivery-priorities.md) · [现有人物模型](../../frontend/src/model.ts) · [寻找 TA 界面](../../frontend/src/seek.tsx) · [本机账号与资料](../../frontend/src/App.tsx)
