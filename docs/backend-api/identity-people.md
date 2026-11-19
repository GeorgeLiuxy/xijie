# 账号、人物与私有素材接口

## R01 明确虚拟行动独立授权（2026-11-14，本机验收完成）

Identity018 新增 `person_world_actions` v1，内部 session/account context 与 PRV-02 的 `meta.worldActionProcessing` 返回 `{allowed,authorizationVersion}`。新 grant 由服务端绑定当前已确认的精确 `privacy_notice` 授权版本；沿 PRV-01–03 的原政策查询、明确决定、期望版本及永久幂等规则，不自动允许，不扩大旧文字 AI、照片、书信、赠礼或围坐用途。撤回追加 `WorldActionProcessingRevoked.v1`，授权历史、当前投影与事件同事务保存。

新处理须同时具备 `storyStorage`、旧 `aiTextProcessing` 和 `worldActionProcessing`，由 Conversations 受理并捕获准确版本。范围为本轮明确要求单个人物在其当前世界／当前迁居阶段／`main` 主线中立即进行的一次有限、纯叙事行动，以及后续仍获准的事件记忆使用。正式事件、事件摘要记忆、真实回复与任务成功由 Conversations 同库提交；People 仍只维护人物资料、所在地和迁居，`worldVersion` 不因叙事事件增加。旧自动记忆的用户事实与珍藏不接收虚拟事件。具体上下文、来源失效与 API 沿[明确虚拟行动权威基线](./conversations-memories.md)。

受理后、意图分类完成前的 `pending` 来源不能被自动记忆或珍藏候选提前读取；只有成功的普通 `chat` 且没有事件谱系时才回到原来源链。撤回停止新的行动处理、事件记忆的模型使用和旧任务剩余处理，重授不复活旧任务；已保存聊天仍按文字保存权限读取。删除源消息或原事件回复会使事件及其继承上下文停止用于模型。独立导出／注销不要求重授本用途，覆盖有效事件、摘要、回复、必要任务及来源；逻辑删除后的任务事实与账号擦除按会话基线处理。

当前模型出处保留 `promptVersion:'person-world-actions-v1'`，新稿增加 `promptRevision:'recipient-v2'`，区分用户作为受众与当前 persona 作为唯一执行者。初稿四条真实回复保留，其中明确行动原请求被误判为 `chat`，没有正式事件，失败证据未覆盖；新稿四轮的首次实际调用已确认一次 `execute`、一次实际引用事件的回忆，以及否定／假设各零新增事件。未知受理任务被 Worker 实际领取一次（`attempt_count=1`），在模型调用前因权限阻断；重授没有恢复旧任务。

本机原UI闭环已完成，详细证据见[虚拟行动验收记录](./conversations-memories.md)。实际八库179表恢复、源库未变和副本清理通过，`releaseReady=false`；行动授权撤回后的七域导出含1份有效事件／9份任务，删除源后的第二次七域导出含0份有效事件／9份历史任务。原UI注销后，69张私有表、相关物理队列、账号对象前缀与实际 Logto 用户均无该账号残留，保留17份必要围栏／收据。15个源服务角色恢复基础配置，专用模型 scope 已移除，活跃工作为0。新测试账号均已擦除，不可复用；本结论不表示世界剧情整模块或生产发布完成。

## R01 聊天单图独立授权（2026-11-14，本机验收完成）

当前聊天单图与真实看图回应以[会话单图实施基线](./conversations-memories.md)为权威。Identity016 `private_chat_photo_storage` v1／`chatPhotoStorage` 管理聊天照片保存与读取，Identity017 `person_chat_image_replies` v1／`chatImageReplies` 管理本条图片的真实视觉处理；新发送还要求 `storyStorage`。旧人物、空间、赠礼照片及文字 AI 授权不扩义。Media 使用 `conversation_attachment` 和固定目标 `{kind:'conversation_message',id:clientMessageId,conversationId}`，Conversations 通过独立服务凭据取得60秒预绑定租约，再在本库事务内检查截止时间并保存消息与引用。

普通浏览器读取使用当前会话绑定的短期 `authorized_stream` 证明；视觉 Worker 使用独立、精确到运行任务 attempt 的内部字节接口，不复用浏览器证明或永久对象 URL。照片及视觉回复本片不进入后续文字 AI、珍藏、自动记忆或围坐上下文。撤回与重授、来源删除、数据权利和恢复规则沿上述基线；原UI单图／真实视觉回应、撤权、七域导出与注销、八库178表及对象恢复均已完成本机合成账号验收，详细边界与证据见该基线；未覆盖Android相机和生产发布。下方已注明日期的历史验收记录仍仅证明各自当时范围。

## R01 围坐独立授权（2026-11-14，本机验收完成）

Identity015新增`person_gather_replies` v1／`gatherReplies`，新grant绑定精确privacy_notice；旧文字、照片、书信与赠礼政策不扩义。围坐保存与读取沿storyStorage，真实回应单独要求gatherReplies；每位发言人自己的珍藏与私聊长期记忆还要求另行有效的aiTextProcessing及受理时捕获版本。没有旧AI许可时，仍可使用必要画像与本人实际参与过的围坐内容。撤回发布`GatherRepliesRevoked.v1`，不因重授恢复旧任务。People新增仅Conversations可访问的`worlds/:worldId/gather-context`，返回世界与同账号当前居民最小元数据，完整上限1000，不包含故事或记忆正文。Identity46、People46项隔离回归通过；新合成账号已完成原UI授权、撤回／重授不复活、迁居后零居民历史读取，以及三用途撤回后的七域导出／注销。真实AI质量边界与八库恢复证据见[围坐验收记录](./conversations-memories.md)。

## R01 书信独立授权（2026-11-14，本机验收完成）

Identity 014新增`private_letter_storage` v1与`person_letter_replies` v1，分别公开`letterStorage`／`letterReplies`的`allowed,authorizationVersion`。沿原PRV-01至03查询政策、绑定同账号告知、永久幂等和期望授权版本；新grant均绑定精确privacy_notice授权，旧政策／grant不扩义。撤回发布`LetterStorageRevoked.v1`／`LetterRepliesRevoked.v1`，决定与当前投影同事务。42项Identity隔离回归通过。新合成账号已沿原UI明确授权、撤回／重授并确认旧预约不复活；两项用途均撤回后仍完成原UI七域导出和注销，只读复核确认授权历史、会话与导出副本清理。实际AI、定时执行及原生恢复证据见[书信验收记录](./conversations-memories.md)。

保存原信不要求AI处理授权；Conversations请求真实回信另需letterReplies和storyStorage，后者允许读取人物必要文字，不把旧`ai_text_processing`冒充书信许可。回信用途明确OpenAI、本封原信、当前人物必要文字、当前虚拟世界／最近迁居、一次性预约与有界重试；排除照片、其他信件、聊天、珍藏、自动记忆、推送和循环来信。撤回回信用途停止未完成处理，已保存原信／回信仍按letterStorage读取；撤回保存用途停止普通读写。独立导出／注销仍可取回或清理历史事实，无需重授。详细执行与撤回重授边界见[书信实施基线](./conversations-memories.md)。

覆盖 A01–A08 和 B01–B07。登录核心由身份提供方承接，西界负责业务账号、应用会话、资料归属和权限。身份链路上线前先验一个已选渠道。首批人物支持文本，照片独立上传，素材处理失败时保留文本草稿。提醒远程化、第三方账号换绑和多媒体提取按开关分批开放。

通用鉴权、幂等、错误和事件信封使用主契约。 [总契约](../backend-api-contract.md)

以下 `UUID` 是西界资源标识，`Instant` 是 UTC RFC3339 时间。`T?` 表示可省略，`T / null` 表示可清空。列中的结果类型置于通用 `data` 内。列表采用 `data: T[]` 和 `meta.nextCursor`。写接口按主契约处理 `Idempotency-Key`，更新及破坏性操作注明 `If-Match: "v<N>"`。除明确标注的引导入口，其余接口均从已验证的上下文取得 `accountId`。

## 1. 身份引导和会话

当前 K01 Web 切片实现 IAM-12、13 的原 App 手机号、验证码逐屏登录及切号，身份服务作为 BFF 接入 Logto 1.46 Experience API。成功后通过原 OIDC 校验和账号映射生成应用会话，客户端继续原有入场流程。IAM-01、02、04 保留兼容及回归，IAM-05、06、07 用于会话查询、退出和账号回读。开发环境使用官方 mock SMS，真实手机投递、原生授权引导、资料修改等按后续验收启用。 [联调步骤](../../backend/README.md#k01-web-本机联调)

### 实体与不变量

| 对象 | 关键字段及约束 |
| --- | --- |
| `Account` | `id UUID`，`registrationId UUID`，`status active/restricted/deletion_pending/deleted`，`displayName string`，`locale string`，`version int`，`accessVersion int`，`registeredAt Instant`，`updatedAt Instant`。注册标识唯一，账号 ID 保持稳定。限制或注销时增加访问版本 |
| `AuthIdentity` | `id UUID`，`accountId UUID`，`issuer string`，`subject string`，`status active/disabled`，`verifiedAt Instant`。唯一约束 `(issuer, subject)`。主体由批准的身份提供方证明，手机号、昵称、邮箱与客户端本机标识均不充当合并依据 |
| `AuthAttempt` | `id UUID`，`client web/native`，`clientRegistrationKey string`，`purpose sign_in/switch/reauth`，`initiatingSessionId UUID?`，`invitationIntentId UUID?`，`returnRouteKey string?`，`proofHash string`，`expiresAt Instant`，`state pending/completed/cancelled/expired`。流标识一次使用，归因凭据只在真正注册时消费 |
| `AuthSmsChallenge`（K01 已实现） | `id UUID`，`browserHash`，`idempotencyKey UUID`，`phoneHash`，`purpose sign_in/switch`，`attemptId UUID?`，`phase preparing/ready/verifying/completed/failed/expired`，`contextCipher?`，`resultCipher?`，`operationKey UUID?`，`codeHash?`，`lastResult incorrect/expired?`，`leaseUntil Instant?`，`createdAt/updatedAt/resendAt/expiresAt Instant`。唯一 `(browserHash,idempotencyKey)`；关联原尝试并受会话代际约束。桥接 Cookie、手机号交互上下文及短时重放结果加密保存，验证码仅保存带密钥摘要用于幂等比对 |
| `Session` | `id UUID`，`accountId UUID`，`authIdentityId UUID`，`client web/native`，`clientRegistrationKey string`，`status active/revoked/expired`，`authenticatedAt Instant`，`expiresAt Instant`，`revokedAt Instant?`。创建、替换和撤销互斥处理，切换只替换发起设备的应用会话 |
| `IdentityOperation` | `id UUID`，`accountId UUID`，`kind link/unlink/replace_phone`，`targetIdentityId UUID?`，`state awaiting_proof/processing/succeeded/failed/expired`，`providerOperationRef string?`。绑定及换号以身份提供方的确认结果为准 |
| `AccountDTO` | `{id, displayName, locale, status, version, createdAt, onboardingState, capabilities}`。`onboardingState` 由已确认数据推导，取 `empty/has_person/has_memory`。`capabilities` 只包含能解释可用范围的布尔开关，前端仍逐个处理服务器拒绝 |
| `SessionDTO` | `{id, accountId, client, authenticatedAt, expiresAt}`。包含应用会话关联 ID，浏览器的实际会话凭据由安全 Cookie 承载。原生 SDK 的 OAuth 凭据存入安全存储 |

### A01、A02、A03、A06、A07、A08

 | ID | HTTP 与调用方 | 输入与输出 | 服务端实现逻辑 |
| --- | --- | --- | --- |
| `IAM-12` | `POST /v1/auth/sms-challenges`。K01 原 App 主入口，未登录允许 `sign_in`，`switch` 需当前应用会话 | `Idempotency-Key: UUID`，`{dial:string,phone:string,purpose:'sign_in'/'switch'}` → `201 {id,expiresAt,resendAt}` | 严格校验 Origin、字段、区号及号码格式；`dial` 如 `+86`，`phone` 为本地号码数字，合并后规范化。用 HttpOnly 浏览器 Cookie 绑定挑战。按浏览器和号码摘要串行限制发码，创建五分钟挑战和六十秒重发间隔，绑定原 `AuthAttempt`。BFF 创建 PKCE/OIDC 交互并调用 Logto 发码，将提供方 Cookie 和上下文加密持久化。相同键同参回读挑战，不再投递；同键异参返回 `409 IDEMPOTENCY_CONFLICT` |
| `IAM-13` | `POST /v1/auth/sms-challenges/{id}/verify`。K01 原验证码页 | `Idempotency-Key: UUID`，`{code:string}`（六位数字）→ `200 {status:'verified'/'incorrect'/'expired'}`。仅 `verified` 写应用会话 Cookie，不返回令牌或提供方 Cookie | 严格校验 Origin、挑战与浏览器绑定。加锁占用验证，保存操作键、验证码摘要及短时租约，外部认证调用在数据库事务之外进行。Logto 校验验证码、识别已有用户；无用户时以已验证的手机号注册。BFF 截获固定 OIDC 回跳并校验签名、issuer、state、nonce、PKCE，按 `issuer/sub` 原子解析账号、创建或替换应用会话。相同键同一码重放先验证结果会话仍有效；已退出或撤销的会话不能恢复 |
| `IAM-01` | `POST /v1/auth/attempts`。兼容授权 URL 入口；未登录允许 `sign_in`，切换和重新验证需当前会话 | `{client, clientRegistrationKey?, purpose, invitationIntentId?, returnRouteKey?}` → `201 {attemptId, expiresAt, authorizationUrl?, attemptProof?}`。Web 返回受信任授权 URL，原生返回短时续办证明 | 按应用配置白名单解析客户端、允许回跳和用途。`clientRegistrationKey` 缺省时用该接入类别的服务端默认配置，无默认配置时返回 `400 INVALID_ARGUMENT`。记录选中的配置、发起会话和一次性状态。邀请意图由 Referral 已签发，绑定至本次尝试。Web Cookie 绑定浏览器及 PKCE 流，原生证明只保存摘要。新切换或验证尝试可替代同设备同用途的旧尝试 |
| `IAM-02` | `GET /v1/auth/callback`。兼容身份提供方经浏览器重定向 | OIDC `code,state` 或允许的 `error,state` → `303` 至受信任页面 | 校验尝试、Cookie、状态、期限和一次性占用后，使用该尝试绑定的应用配置换取并验证令牌。发生取消或拒绝时只结算尝试。成功时按尝试用途调用账号解析及会话处理。重新验证只接受发起账号。设置 `Secure`、`HttpOnly`、同站一方 Cookie，轮换凭据。重放只跳转既定结果。浏览器返回地址不携带令牌、验证码或私有业务 ID。IAM-13 在服务端复用这些校验和存储规则，不请求该 HTTP 回跳或跳走原登录页 |
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

`IAM-04` 完成后的撤销尝试返回 `409 CONFLICT`，客户端改查 `IAM-05`。`IAM-01` 的 `returnRouteKey` 采用白名单逻辑名，例如 `home`、`account`、`invite_return`。邀请输入保存在服务端意图中。前端返回原始业务操作时重新查询目标对象及权限。K01 原页面通过 IAM-12、13 展示发码、错码、重试和成功；验证码生成、投递渠道及校验由 Logto 承担。其他提供方及原生授权仍按各平台验收接入。 [Logto Capacitor 指南](https://docs.logto.io/quick-starts/capacitor-js) · [Logto 账号中心](https://docs.logto.io/end-user-flows/account-settings/by-account-center-ui) · [原生 OAuth 指南](https://www.rfc-editor.org/rfc/rfc8252.html)

IAM-12、13 的请求采用同源浏览器 Cookie，不接受客户端自行声明可信手机号或账号。发码请求重试复用原键及参数；真正重发要等待 `resendAt` 并使用新键。验证码提交的网络重试只复用同一键、同一码；用户更正验证码时使用新键。同键异码返回 `409 IDEMPOTENCY_CONFLICT`，并发验证或已占用状态返回 `409 CONFLICT`，客户端应保留输入并等待在途结果。首次提供方明确判定过期时可返回 `200 {status:'expired'}`；挑战到期、失效或需要重新取码时返回 `410 AUTH_CHALLENGE_EXPIRED`。频率限制为 `429 AUTH_RATE_LIMITED`，同时提供 `Retry-After` 响应头及错误详情中的 `retryAfter` 秒数。无法确认提供方结果时返回 `503`，不自动发起第二次换证或创建另一会话。

迁移 `003_embedded_auth.sql` 定义挑战状态和时间约束，验证租约到期或挑战到期后清理加密上下文。`OIDC_FIRST_PARTY_EXPERIENCE` 在开发环境默认启用，设 `false` 关闭；生产默认关闭，只有确认登记应用的 `isThirdParty=false` 后才可显式设为 `true`。启用时仅允许当前应用精确 `openid` 的最小技术授权，且提供方同意数据须匹配应用 ID、固定回跳及零额外 scope、资源、组织。该授权独立于登录页业务协议、隐私告知及文字保存授权。没有开启或出现额外要求时流程停止，不代替用户同意其他权限。

本机 Compose 仅启用官方 mock SMS，验证码写在容器 `/tmp/logto/mock_sms_record.txt` 供本机合成资料测试，没有实际手机投递或浏览器读码 API。维护者应核对固定版本的 [Experience API](https://github.com/logto-io/logto/blob/v1.46.0/packages/core/src/routes/experience/index.ts)、[验证码接口](https://github.com/logto-io/logto/blob/v1.46.0/packages/core/src/routes/experience/verification-routes/verification-code.ts)、[已验证身份注册合流](https://github.com/logto-io/logto/blob/v1.46.0/packages/experience/src/apis/experience/index.ts) 和 [技术授权接口](https://github.com/logto-io/logto/blob/v1.46.0/packages/core/src/routes/interaction/consent/index.ts)。Logto 版本升级需重跑桥接契约与原 App 登录路径。上线前分别用正式包验证 Web Cookie 模式和原生系统授权流程。

切号成功先原子提交新会话及旧会话撤销，再更新客户端会话代际。Native 后续请求使用 API Bearer 加配套的 `X-Session-Id`，后端复核令牌身份、应用会话、账号与访问版本。此关联 ID 不承担独立身份认证。取消切号保留原会话，晚到的 HTTP、SSE 和深链按客户端会话代际丢弃。旧账号已受理的工作继续按原归属和当前授权处理，禁止迁到新账号。重新验证目标必须仍为发起账号。匿名游客只允许调用明确列为公开的端点。

## 2. 同意、数据权利和导入

K02 文字草稿联调使用独立的 `privacy_notice` 告知确认及 `private_story_storage` 保存授权。人物服务调用身份服务的 `GET /internal/v1/session-context`，用独立服务凭据和请求携带的会话 Cookie 核验账号及授权。内部路径由服务直接访问，前端网关只转发公开 `/v1`。草稿写入要求当前政策已确认且文字保存授权有效，撤回后本人仍可读取已有草稿。

浏览器联调请求可带 `X-Xijie-Expected-Session`。如果与已核验的会话 ID 不一致，返回 `401 UNAUTHENTICATED`。该头只用于阻止切号后的旧标签页继续提交。

### A04、A05、A08

#### K05 第二片实施基线：个人数据导出与账号注销

本片只接已经部署的 Identity、People、Conversations、Memories 文字数据。原人物／消息／珍藏的单项删除入口继续使用；账号注销负责清除本账号在这些服务中的全部私人文字（含逻辑删除残留），不导出或迁移原型余额、模拟礼物和订单。未接入的媒体、交易、自动长期记忆及世界剧情不虚构成已导出／已清理。

**同账号重新验证。** 复用 `POST /v1/auth/sms-challenges` 与 `.../{id}/verify`，新增 `purpose='reauthenticate'`。开始及验证必须带精确预期会话并核验当前账号；未知手机号不得触发 Register，错误主体不得注册、切号或改变原会话。OIDC 严格采用 `freshSince`，不以缺失 `auth_time` 时的兼容回填作为证据。成功保留原 Cookie 与 sessionId，只推进该会话的 `reauthenticated_at`，verify 返回 `{status:'reauthenticated',sessionId,reauthenticatedAt}`；原登录响应保持兼容。权利受理及下载要求该可信证据距服务器时间不超过 10 分钟，否则 `403 REAUTHENTICATION_REQUIRED`，用户原输入与选择保留。

**Identity 拥有申请与编排。** PRV-04–06/10 继续使用下表路径与 `export/delete_account`，导出显式选择 `interaction_data/account_data`。新增 `GET /v1/accounts/me/data-requests?limit=...` 回读当前账号最近申请，供浮层重开恢复；`POST /v1/accounts/me/data-requests/{id}/retry` 与 `POST /v1/data-request-receipts/{receiptId}/retry` 显式恢复同一失败申请，前者需会话及近期重验，后者仅持该注销证明且校验 Origin。所有写入使用 UUID 幂等键；同键同参回原申请，异参409，不用新键偷偷再建注销单。导出返回各服务自己的快照时间与版本摘要，不声称跨数据库全局时间点快照。

申请表需保存归属、kind/scope、请求指纹、状态、创建／更新／开始／结束时间、固定结果期限及派发／尝试／租约身份；`accepted → processing → completed/failed`，失败可沿同申请继续。事务写申请和真实 pg-boss 队列（`identity_rights_queue` / `data-rights.process.v1`），载荷只含 `{requestId,dispatchId,dispatchGeneration}`。Worker 是 Identity 的独立运行角色，不读写其他服务的数据库；有界重试、崩溃恢复和末尾提交均检查本次尝试，重放不复制清理副作用。

**内部服务契约。** 三个数据服务增加以下两个内部端点，使用独立 `XIJIE_DATA_RIGHTS_SERVICE_TOKEN`，不进入客户端代理。各数据服务通过自己的现有服务凭据回读 Identity `GET /internal/v1/data-requests/{requestId}/context`，确认申请、账号、范围和当前资格；该结果为 `{requestId,accountId,kind,scope,status,accountStatus,accountAccessVersion}`，不含私人正文或证明。导出只允许有效 export 申请且账号 active，擦除只允许同账号 delete_account 申请且账号 deletion_pending/deleted。接受的申请状态为 accepted/processing/failed/completed，最终可执行性另按 kind 与账号状态判定。

| 内部动作 | 输入与输出 | 约束 |
| --- | --- | --- |
| `GET /internal/v1/accounts/{accountId}/data-export?requestId=UUID&scope=interaction_data\|account_data` | `{schemaVersion:1,domain:'people'\|'conversations'\|'memories',accountId,capturedAt,revision,data}` | 单服务可重复读快照，稳定排序，仅含当前可读原始文字及关联 ID；`revision` 为导出内容的稳定 SHA-256，排除 capturedAt。不回 Cookie、验证码、密钥、内部命令或队列正文；超出有界大小须明确失败，禁止静默截断 |
| `POST /internal/v1/accounts/{accountId}/erase` | `{requestId}`，`Idempotency-Key` 必须等于 requestId。返回 `{accountId,requestId,erasedAt,alreadyErased}` | 所属服务本地事务建立账号擦除围栏，删除私有原文、候选、草稿、命令缓存和任务／队列关联；幂等回执只保留最小 ID/时间。围栏与所有私人表写入使用同一账号本地事务锁，已取得旧远程权限的迟到写入也不能复活数据 |

**导出件。** Identity 汇总四个服务已支持的文字数据，保存带固定期限的加密导出件（开发期本库 AES-256-GCM 派生文件，独立 `DATA_EXPORT_ENCRYPTION_KEY`，最长 24 小时），Outbox 与命令结果不缓存正文。导出下载先校验当前账号、用途与来源版本摘要；资料发生变化返回 `409 EXPORT_STALE`，要求重新申请。PRV-06 生成最长 60 秒、绑定本 session 的同源受控内容地址 `GET /v1/accounts/me/data-requests/{id}/content?grant=UUID`；此 GET 再校验会话、近期重验、有效期及当前来源摘要，流式返回 JSON 附件并禁止缓存。链接本身不能替代认证。过期、注销或删除申请清除旧导出件；已下载到用户设备的副本由用户管理。

**注销与收据。** 接受注销和写入任务、将账号置为 deletion_pending、递增 access_version、写撤权事件必须在 Identity 本库同事务，立即使全部旧会话和生成授权失效。客户端提交前暂存 receiptId 与 256 位随机 statusProof；Identity 只存证明摘要（固定 7 日期限），丢响应后用 PRV-10 找同一单，只返回进度，不授权读原文／下载。三个数据服务擦除、Identity 私有身份／会话／挑战缓存清理，以及已配置的本租户 Logto 凭据删除均成功后才标 completed/deleted；失败保持限制并保留可恢复进度。保留最小账号／主体禁用墓碑防止旧凭据重建原账号；不保留私人正文。Logto 管理删除只在明确配置为西界自有租户时开启，通过服务端 M2M 凭据调用官方管理 API；没有配置或供应方失败不能假报完成，不删除其他外部身份平台的全局账号。

**原 UI 接入。** 导出和查看申请在原「隐私与 AI 说明」浮层；注销入口在原账号管理浮层，先解释影响、验证当前账号，再由用户明确确认注销。验证码在原浮层内按原手机号／验证码交互呈现，不跳外部网页、不替用户选择注销。受理后会话即失效，界面以该单收据展示清理进度，关闭／重开与响应未知都不另建申请。后台验证只使用独立合成测试账号，不删除用户正在使用的账号或资料。

#### K05 首片实施基线：AI 文字处理授权

本片沿用 PRV-01–03，新增独立用途 `ai_text_processing`，决策仅 `grant/revoke`；文字保存与 AI 处理分别授权，禁止从已有存储授权或本机模型测试名单推导 AI 同意。发布新的隐私告知版本说明现有文字服务和独立 AI 授权，旧记录保留但不得自动确认新版本。AI 用途文档明确本片为 OpenAI 文本处理，素材范围为当前人物资料、相关聊天与珍藏，结果用于文字回复及珍藏候选；不包含仿声、照片、视频、公开分享或尚未接通的自动长期记忆。改变提供方或处理范围须更新政策并重新确认，不复用旧同意。

Identity 的内部 session/account context 增加必填 `aiTextProcessing:{allowed:boolean,authorizationVersion:number}`，PRV-02 的 `meta.aiTextProcessing` 返回同一权威结果。缺失、格式无效或依赖不可用均不能默认允许。`allowed` 要求当前隐私告知已确认、当前 AI 用途已 grant 且该 grant 仍绑定当前告知授权版本；新告知再次确认后仍需显式重新授予 AI，防止旧任务借同一 AI 版本恢复。未决定版本为 0，授予／撤回均追加记录并单调递增版本，撤回写 `AiTextProcessingRevoked.v1`，不篡改文字保存授权。公开授权变更继续使用当前政策版本、用途版本、原站、预期会话和同操作幂等身份。

Conversations 和 Memories 生成任务增加本库 `ai_authorization_version`，旧任务迁移值为 0，不因后来授权自动恢复。受理新的聊天回复／珍藏整理和显式重试前验证 AI 用途，保存该版本；Worker 调用模型前、调用后及提交前复核同一版本与既有来源／存储授权。撤回后再授予也不能让旧任务越过版本检查；返回 `AI_PERMISSION_REQUIRED`（新生成申请 403，已受理任务进入不可自动重试的 blocked）。实际模型适配器也验证该输入授权及 OpenAI 提供方范围，本机测试名单只能作为额外的运行限制，不能绕过同意。

这项撤回停止后续 AI 处理，不抹除既有聊天、已生成候选或珍藏。历史读取、手写保存、对既有候选的人工确认、删除与取消仍按各自现有权限工作；只有新调用或重试需要当前 AI 授权。跨库复核与本地提交之间仍存在已披露窗口，本片不宣称跨库原子撤权或能撤回已经发给提供方的请求。

前端复用「我 → 设置 → 隐私与 AI 说明」现有浮层，展示真实状态、政策正文和明确的允许／撤回操作，关闭不授权，授权前不默认勾选。需要确认新隐私告知时在该浮层完成；待确认输入与操作身份在网络结果未知时保留，冲突后回读重新确认，切号和关闭后的迟到结果不能污染新页面。原有寻找 TA 的文字保存授权保持其独立用途，不把新 AI 政策显示成存储政策。

| ID | HTTP 与调用方 | 输入与输出 | 服务端实现逻辑 |
| --- | --- | --- | --- |
| `PRV-01` | `GET /v1/policies/current`。允许匿名 | `locale?` 查询 → `200 PolicyDTO[]`，项 `{id,kind,version,locale,documentUrl,decisionRequired,privateFeedProcessingEnabled?:true}` | 按产品生效规则返回可公开文案，语言只影响展示。`privateFeedProcessingEnabled` 仅由数据库用途 marker 为 true 时附带，用于允许前展示新增范围，不代表账号已授权，也不按政策版本号推断。地区、年龄和使用范围从服务端资格策略判断。发布新版本保留历史记录 |
| `PRV-02` | `GET /v1/accounts/me/consents`。应用会话 | `cursor?`,`limit?` → `200 ConsentDTO[]`，项 `{id,policyId,version,purpose,decision,recordedAt,authorizationVersion}`，`meta.currentAuthorizationVersions` 按用途返回当前版本，独立于分页；已部署 Identity018 时另含 `meta.worldActionProcessing:{allowed,authorizationVersion}` | 读取本账号的同意与告知。未建立当前记录的用途版本按 `0` 处理。隐私告知的确认与数据处理授权分别记录；独立行动状态不替代 `storyStorage` 或 `aiTextProcessing` |
| `PRV-03` | `POST /v1/accounts/me/consents`。应用会话 | `{policyId,version,purpose,decision,expectedAuthorizationVersion}` → `201 ConsentDTO`。`decision acknowledge/accept/grant/revoke` 由政策允许组合限定；`person_world_actions` v1 仅 `grant/revoke` | 校验政策版本及用途。对新的操作先锁账号与用途，再比较 `expectedAuthorizationVersion`，没有当前行时使用 `0`。不匹配返回 `412 VERSION_CONFLICT` 及 `details.currentAuthorizationVersion`。新行动 grant 绑定当前隐私告知授权；追加历史、推进授权投影和撤权事件同事务。同键重放按总规范处理，冲突后重读并重新确认用途。任务开始及写回均复核当前授权 |
| `PRV-04` | `POST /v1/accounts/me/data-requests`。近期重新验证的应用会话 | `{kind, scope?, deletionReceiptId?, statusProof?}`，`kind export/delete_account`，导出 `scope interaction_data/account_data`，注销按 `account_data` → `202 {id,kind,status,requestedAt}` | 核验申请范围，写受理记录并入队。注销受理后将账号置为 `deletion_pending`，增加访问版本，使全部会话和分享立即失去访问资格，再异步清理会话及凭据。仅保留查询此注销单的短期证明摘要。注销时客户端必须在提交前生成并安全暂存随机 `deletionReceiptId UUID` 和至少 256 位随机 `statusProof`，即使受理响应丢失也能查原单。两值只用于注销，服务端在请求事务绑定到生成的 `id`，拒绝冲突。删除期间以墓碑阻断读写及任务，保留依法或按售后策略需要的受限交易资料 |
| `PRV-05` | `GET /v1/accounts/me/data-requests/{requestId}`。应用会话 | 无 → `200 {id,kind,status,requestedAt,updatedAt,resultExpiresAt?,failureCode?}` | 查当前账号归属。状态 `accepted/processing/completed/failed`。结果不含可直接下载的通用公开链接 |
| `PRV-10` | `GET /v1/data-request-receipts/{deletionReceiptId}`。显式允许注销单凭证访问 | `X-Data-Request-Proof` → `200 {id,kind,status,requestedAt,updatedAt}` | 校验收据、证明摘要、期限和状态用途，限流。只回单笔注销进度，旧会话已清也能查。证明过期走受控身份复核恢复，禁止列出账号、素材或交易 |
| `PRV-06` | `POST /v1/accounts/me/data-requests/{requestId}/download`。近期重新验证的应用会话 | 空请求 → `200 {downloadUrl,expiresAt}` | 确认导出成功、范围和归属，生成短时读取凭证并记录审计。导出件默认私有，期限由发布策略配置。注销凭据不授权下载 |
| `PRV-07` | `POST /v1/accounts/me/imports`。应用会话，旧数据需要迁移时 | `{sourceKind, archiveMediaId, sourceDigest}` → `202 {id,state,sourceDigest}`，`sourceKind preview_archive` | 在事务内建批次后调用 `Media.bindUse` 把已校验的 `legacy_import` 文件绑定到本批次，异步校验清单和来源。无法核实的记录留待确认。依据账号、源批次与旧对象 ID 去重，拒绝把导入包里的 `owner` 当身份。正式钱包、订单、奖励和认证都不从演示资料导入 |
| `PRV-08` | `GET /v1/accounts/me/imports/{id}`。应用会话 | 无 → `200 {id,state,version,summary,warnings,confirmedAt?}` | 读取本账号解析或执行进度。`state reviewing/ready/running/completed/failed`，摘要按人物、资料、消息、回忆、媒体计数 |
| `PRV-09` | `POST /v1/accounts/me/imports/{id}/confirm`。应用会话 | `If-Match`，`{sourceDigest}` → `202 {id,state}` | 用户先核对计划和归属，再锁定已审核批次提交。按导入映射和重试标识分块入库，旧 ID 重试指向相同正式 ID。标记导入来源，保留旧资料，完成后可对照原文、媒体及历史引用 |

`Consent` 保存 `policyId`、不可变政策 `version` 和 `recordedAt`。当前授权投影以 `(accountId,purpose)` 为键，事务内递增 `authorizationVersion`。历史同意按 `(accountId,purpose,authorizationVersion)` 唯一。拒绝晚到的旧授权变更时返回当前用途的版本，撤权事件使用已提交版本。`DataRequest` 和 `ImportBatch` 有账号归属和审计。权利申请、材料授权与账号访问限制是独立维度。外观、语言设备展示、字号、朗读、动效、触感与音效默认留在客户端。`Account.locale` 用于服务端生成、提示和政策展示时的语言偏好。首发按目标渠道核对应用内注销及所需网页入口。 [Apple 账号删除](https://developer.apple.com/support/offering-account-deletion-in-your-app/) · [Google Play 账号删除](https://support.google.com/googleplay/android-developer/answer/13327111)

**自动长期文字记忆的新用途（2026-11-12）。** Identity `006_automatic_memory_permission.sql` 保持旧政策和历史决定不可变，新增隐私告知 v3、AI 文字政策 v2。旧 AI v1 明确不含自动记忆，不能凭 `allowed:true` 或白名单扩大用途。`policy_versions.ai_automatic_memory_enabled` 默认 false，且只可用于 AI 文字政策；仅当前政策明确启用、当前告知已确认、AI grant 与该告知绑定时，权威 `aiTextProcessing` 才附带 `automaticMemoryAllowed:true`。缺失／false 均拒绝自动整理及使用；未来更大版本号也不会自行获得能力。原浮层以原按钮重新确认和允许，布局不变；旧任务和旧聊天不因新授权自动回填。既有聊天与珍藏候选仍按原用途门禁，自动管道另加能力标记和同一授权版本校验。复制已存资料与重新调用模型分别鉴权。

**R01 珍藏回响的 AI v3 升级。** Identity `008_private_feed_processing.sql` 仅追加 AI 文字政策 v3 与 `policy_versions.private_feed_processing_enabled boolean NOT NULL DEFAULT false`，约束仅 AI 政策可置 true；保留当前告知 v4、存储 v2 及历史决定，不默认授予或要求仍有效的存储许可重授。AI v3 保留自动长期文字记忆，新增范围仅为明确允许后新确认／主动修订的珍藏生成私人回响，以及该回响下新手动评论触发来源人物的一次回应；普通私人帖、迁居帖、未确认候选、自动记忆条目及无关评论不由此送模，不自动点赞、递归回应或执行世界副作用。旧 AI v2 grant 不能升级为新范围，用户须在原「隐私与 AI 说明」浮层明确允许当前 AI 政策；独立告知绑定和用途版本继续校验。

内部 session/account context 与 PRV-02 的 `meta.aiTextProcessing` 共用权威结果：基础 `{allowed,authorizationVersion}` 仅在当前合法 grant 对应新 marker 时附 `privateFeedProcessingAllowed:true`，自动记忆能力仍另附 `automaticMemoryAllowed:true`。生成消费者要求 `allowed:true`、对应能力 `===true` 及受理时保存的精确授权版本；缺失／false 或依赖失败不得放行。公开 Policy DTO 的 `privateFeedProcessingEnabled` 只描述可申请的政策范围，不能替代此账号状态。撤回 AI 不变更存储授权，已有结果仍按存储与来源权限读取／导出／删除；源原文修订、删除或人物失效使旧回响及派生回应失效，撤下不依赖 AI 仍被允许。

每一可生成回响的原文版本须在正式 upsert 事件捕获正数 `echoAiAuthorizationVersion`；旧事件缺失／0 不补扫。合法来源版本曾获 grant A 后，用户在原回响下的新评论可以当前 grant B 发起新的模型意图，但旧任务 A 不得借 B 自动恢复。原自动记忆任务和新聊天记忆选取继续严格匹配当前 AI 授权版本；历史可按独立数据权利与来源权限导出，不因 v3 升级／重新授予而默认带入新聊天或重扫旧聊天。

## 3. 私有素材与用途

MED-01～07 下表描述当前 Media 的实际接口。空间使用 `post_attachment`，人物照片使用 `person_photo`，赠礼旅途留影使用 `gift_delivery_photo`，本轮聊天单图使用 `conversation_attachment`；各自用途、来源和验收范围分别见下方历史基线、[赠礼留影基线](./assets-commerce.md)及[聊天单图基线](./conversations-memories.md)。音视频、通用素材导入、公开分享和其他图片模型用途仍是后续提案。各域使用独立数据库及受控 HTTP，不建立跨库外键或跨库事务。

### B01、B03、B05、B06

`MediaDTO` 返回 `{id,purpose,status,mimeType,byteSize,width?,height?,version,authorizationVersion,createdAt,updatedAt,failureCode?}`。业务状态为 `awaiting_upload/verifying/ready/rejected/revoked/deleted`。Media 持久化服务端生成的私有对象键、不可变成品及校验结果；公开 DTO 不暴露对象键或存储凭据。本库按用途保存账号、素材、固定目标、状态及授权依据，业务域独立保存权威来源引用。当前四个 purpose 不得互换。`person_source/profile_photo/memory_attachment/ai_context/personal_export/legacy_import` 及语音 `transcription_input` 保留为后续用途设计，不是当前可提交的枚举；人物照片实际使用 `person_photo`，本轮视觉处理使用专用 `chatImageReplies` 和运行任务来源校验，不使用通用 `ai_context`。

创建目标必填：空间 `{kind:'post_intent',id:clientPostId}`，人物 `{kind:'person_draft',id:draftId}`，留影 `{kind:'gift_delivery',id:deliveryId}`，聊天 `{kind:'conversation_message',id:clientMessageId,conversationId}`。空间读取改用已保存的 `{kind:'post',id:postId}`，其余读取沿固定目标。聊天必须已有同账号 direct 会话；预分配 clientMessageId 只标识待受理消息，预绑定本身不能读图。

| ID | HTTP | 输入与输出 | 服务端实现逻辑 |
| --- | --- | --- | --- |
| `MED-01` | `POST /v1/media` | `{mimeType,byteSize,sha256,purpose,target:{kind,id,conversationId?}}` → `201 {media:MediaDTO,upload:{id,method,url,requiredHeaders,expiresAt}}` | 精确 SHA-256 与用途目标必填；聊天 target 必须含 conversationId。校验归属、当前用途授权、类型、大小和配额，保存固定目标及短期槽。浏览器通过同源 `PUT /v1/media/{id}/uploads/{slotId}` 上传，使用原会话、Expected-Session、Origin 和固定幂等键；不直连 S3、不接收对象存储凭据 |
| `MED-02` | `POST /v1/media/{mediaId}/complete` | `{uploadSlotId}` → `202 MediaDTO` | 复核账号、当前槽和捕获授权，在锁外检查实际暂存对象；本库短事务复核后转 `verifying` 并入队。Worker 实际解码、校验摘要并生成私有 WebP 成品。空上传返回 `MEDIA_UPLOAD_NOT_COMPLETE`，过期槽返回 `UPLOAD_SLOT_EXPIRED`；原键处理未知结果，旧授权上传不得借重授完成 |
| `MED-03` | `GET /v1/media/{mediaId}` | 无 → `200 MediaDTO` | 检查归属和可见范围，返回状态、版本及可解释失败原因。首次上传者可看到本人素材的 `rejected/revoked` 状态，但不能读取原文件 |
| `MED-04` | `POST /v1/media/{mediaId}/read-url` | `{purpose,target:{kind,id,conversationId?}}` → `200 {mode:'authorized_stream',url,expiresAt,authorizationVersion,readProof}` | 校验当前用途授权、同账号固定目标、ready 成品、有效绑定及当前权威来源，签发60秒会话绑定证明。目标不可省；预绑定不能代替已保存来源。聊天 proof 绑定 conversationId、clientMessageId 和 sourceMessageVersion。当前不返回 signed_url |
| `MED-05` | `DELETE /v1/media/{mediaId}` | `If-Match` → `204` | 存在活动绑定时返回 `409 MEDIA_IN_USE`，从原业务资源删除或移除引用，由来源核对驱动清理。无活动绑定时先撤销读写资格，再安排实际对象删除；对象存储失败保留清理任务重试。撤回保存授权本身不等于删除 |
| `MED-06` | `POST /v1/media/{mediaId}/upload-slots` | `If-Match`、固定幂等键，无请求体或 `{}` → `201 {media:MediaDTO,upload:{id,method,url,requiredHeaders,expiresAt}}` | 仅 awaiting_upload 且仍有资格时创建新槽，本库停用旧槽并更换随机暂存键。已在校验或完成时回读状态。聊天旧捕获授权失效返回 `AUTHORIZATION_CHANGED`，不能借重授续传；明确槽过期可在原媒体与消息意图下按当前版本申请新槽，未知结果重放同键 |
| `MED-07` | `GET /v1/media/{mediaId}/content` | 当前会话、Expected-Session、`X-Media-Read-Proof` → 受控二进制流 `200` | 取实际字节前后复核账号、证明、授权、固定目标、版本及当前来源。当前拒绝 Range，不提供206；不暴露对象键或永久 URL，不使用公共缓存。内部视觉任务字节端点独立于此浏览器接口 |

上传需要验证所选 S3 兼容产品支持的限时签名、版本号和条件写入。验收须防止暂存对象校验后被旧 URL 覆写。采用固定对象版本或带前置条件复制到服务端可写的不可变读取键，再做扫描和格式检查。`ready` 由 Worker 依据校验结果推进。上传失败或格式不合格可新建素材；过期草稿或槽由清理任务删除。提供方支持差异先做 V01 验证。 [S3 条件写入参考](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html) · [S3 预签名 URL](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)

## 4. 寻找 TA、人物、世界和提醒

### K02 人物照片实施基线（2026-11-13）

本片沿原「寻找TA」照片格、草稿保存、预览与关系确认、人物资料入口实现可选照片，不改文字流程，不接模型图片处理。原寻找TA上限六张；草稿和已确认人物统一保留有序最多六张，第一张为头像，选择主图通过调整顺序表达。资料照片格补齐必要的选择主图／移除动作。失败保留文字及选图，未知结果重试原上传／保存身份。

Identity 009 的 `private_photo_storage` v1 明文排除人物照片，不能复用。增量 010 新增独立 `private_person_photo_storage` v1 与 `personPhotoStorage:{allowed,authorizationVersion}`，绑定当前告知，初始拒绝，在原隐私浮层单独允许／撤回。告知 v4、文字 v2、AI v3、空间照片 v1 和既有决定均保持。人物照片仅私人保存、显示及数据导出，禁止送模型、仿生重建、识别、音视频和聊天附件。

Media 新增用途 `person_photo`，唯一 target `{kind:'person_draft',id:draftId}`。先保存原文字草稿取得稳定 ID；确认人物后沿用这一来源，不转移或复制对象。PersonDTO 提供 `photoTarget` 指向源草稿。People 拥有 `person_draft_media` 有序引用；DraftDTO/PersonDTO 增加 `mediaIds` 和同顺序 `media:[{id,version,mimeType,byteSize,width,height}]`，不返回永久 URL。草稿／人物 PATCH 可选 `mediaIds`，省略保留、空数组清除；沿用 If-Match 和幂等键。只读文字与普通文字保存不依赖 Media 可用性。

People 在事务外以自身服务凭据调用 `POST /internal/v1/people/drafts/{draftId}/media-bindings {mediaIds}`，返回 `{draftId,expiresAt,media}`，提交期限60秒并在 People 锁后复核，验证同账号、用途、目标、ready 状态和独立人物照片授权。Media 预绑定只增加候选，不因并发失败或新列表而撤销仍被 People 引用的照片；People 本库事务复核版本、写有序引用与命令。Media 通过独立凭据访问 People `GET /internal/v1/media/people/drafts/{draftId}` 校验有效目标，`POST /internal/v1/media/people/validate {refs:[{draftId,mediaId,version}]}` 返回 `{valid}`。源有效条件是未过期未确认草稿，或同源已确认且 active 人物；确认后不受旧草稿期限影响。替换、移除照片或移除人物后源立即失效；后台只有在无有效引用时才清理对象。

沿用 JPEG/PNG/WebP 输入、精确 SHA、同源上传、Sharp 去元数据／缩放、私有 S3 和会话绑定短证明。用途、当前授权、来源及版本在交付字节前重验；照片撤权不阻断独立数据权利，导出包含实际成品及顺序，超限显式 413。People/Media 的新增引用、实际对象清理及恢复关联均须纳入本片验证；原页面、真实服务／对象、数据权利及隔离恢复已验收，范围与证据见交付优先级文档当前接续；未验真机或生产。

### R01 私人空间配图实施基线（2026-11-13）

本片沿原「空间 → 发动态 → 选图 → 发表」接通1–9张私有图片，含纯图片帖子、原页查看和本人删帖。图片不交模型，不扩大 AI v3，不改变现有文字存储版本。新增独立 Media 服务／数据库（3106／5438），使用 S3 兼容私有存储和现成图像解码器；Social 仍拥有帖子及有序 `post_media`，只通过内部 HTTP 操作媒体，不跨库写 SQL。

授权新增独立 `private_photo_storage` 政策 v1，作为现文字告知的明确补充，原隐私浮层提供「私人照片保存」的允许／撤回。保留告知 v4、文字存储 v2 和 AI v3，旧照片授权不存在时为拒绝，不改授旧文字／AI grant。Identity 权威上下文新增 `photoStorage:{allowed,authorizationVersion}`，仅当前照片政策的合法 grant 与当前告知绑定时允许；配置、选图、旧文字许可不能替代。照片授权撤回停止新上传／发布／读取，不代表删除，独立数据导出和注销仍可办理。

公开 MED-01 仅开放 `purpose:'post_attachment'`，必填 `target:{kind:'post_intent',id:clientPostId}`，输入额外要求待上传字节的精确 SHA-256（客户端图片预处理后）。输入限 JPEG／PNG／WebP、10MiB／张、32M像素。MediaDTO 增加 `width?/height?`；状态沿既定枚举。首片上传采用同源授权代理：MED-01 的 `upload.method='PUT'`、`url='/v1/media/{id}/uploads/{slotId}'`，带原应用会话、Expected-Session、Origin 与固定上传意图；不向浏览器暴露 S3 密钥或对象键。槽以随机暂存键隔离，实际摘要／大小必须与声明相符，旧槽不能完成新槽。MED-02 返回202校验状态，独立 Media Worker 实际解码、校正方向、移除元数据、生成最长边2048且不超过1MiB的WebP成品；成品采用服务端独有随机不可变键。保留的是实际发布成品，临时输入在校验完成／拒绝／过期后清除。

Social 使用稳定 `clientPostId`、发帖幂等键与有序 `mediaIds`，允许 user 的空正文＋1–9张图；echo／world 仍无媒体。Media 内部 `POST /internal/v1/social/posts/{postId}/media-bindings` 接 `{clientPostId,mediaIds}` 和账号头，以 Social 独立凭据校验同账号、初始用途、当前照片授权、ready状态及原投稿意图，一次绑定全部图片；同帖同列表可重试，不同帖不得盗用。Social 的新配图帖使用账号＋clientPostId确定的稳定UUID，先在事务外绑定，再将帖子、关联、幂等和事件在本库提交。这不是跨库事务。未提交的预绑定不能读；未知结果重试复用同意图。删帖先在Social本库失效，Media释放调用可重试，Worker还会核对孤立／已删目标并清理，外部失败不能恢复已删帖子。

Social DTO 保留 `mediaIds`，附同顺序 `media:[{id,version,mimeType,byteSize,width,height}]`，不附私有存储地址。Media 经其独立凭据调用 `POST /internal/v1/media/posts/validate {refs:[{postId,mediaId,version}]}`（每账号≤100）核对当前 active 帖子与精确关联。正常读图同时复核当前会话、文字空间／照片授权、媒体状态／版本／绑定和该目标，不用旧证明绕过删帖。MED-04 仅提供 `authorized_stream`、短期会话绑定证明；客户端通过 MED-07 的头读取Blob，按当前账号／页面管理临时URL，不把证明或Blob写入持久业务数据。查源调用全部在SQL锁外。可信内部源验证仅返回关联元数据，不授予用户读图权限，也不因用户撤回保存许可而把已有照片当作删除。

Media 接入数据权利独立快照及擦除：导出包含可用成品的字节／SHA-256和关联，不能只导出元数据；继续现有20MiB有界JSON，超过明确失败，不截断或假称完整。单图成品≤1MiB使一次九图发布可落在本片单域限额内。来源失效不导出旧正文／图片；撤回图片许可仍可按数据权利导出。注销须先写围栏，再清理全部对象、上传槽、绑定、任务／命令，存储删除未完成不得记完成。备份另覆盖Media PG及私有对象字节、清单和hash；只有七库和成品对象的隔离恢复均实际通过才报告图片恢复通过，旧五／六库包保留原范围。

验收以原UI单图／九图／纯图、刷新回读、有序查看、部分上传失败／丢发表响应重试、跨账号及切号门禁、撤权、删帖旧证明拒绝、六域导出／实际擦除及对象恢复为准。不存在用dataURL或本地演示记录冒充已上传的成功路径。

### 实体与字段

| 对象 | 关键字段及约束 |
| --- | --- |
| `PersonDraft` | `{id,accountId,status,version,displayName?,relationship?,story?,realName?,calledMe?,birthMonthDay?,yearsText?,place?,mediaIds[],sourcePersonId?,confirmedPersonId?,createdAt,updatedAt,expiresAt}`，`status draft/confirmed/discarded/expired`。保存草稿可暂缺字段。文字预览至少校验称呼和故事，关系沿原相认步骤选择，在确认时校验并保存 |
| `PersonPreview` | `{id,accountId,draftId,draftVersion,status,renderMode,summary?,suggestedWorldId?,unknownFields[],sourceRefs[],expiresAt,createdAt,failureCode?}`，`status queued/running/succeeded/failed/cancelled/stale`。建议内容与草稿、资料及授权版本绑定，仅作候选 |
| `Person` | `{id,accountId,sourceDraftId?,displayName,relationship,realName?,calledMe?,story?,birthMonthDay?,yearsText?,place?,worldId,worldVersion,avatarMediaLinkId?,status,version,accessVersion,createdAt,updatedAt}`，`status active/removed`。`birthMonthDay` 为 `MM-DD`。`worldVersion` 初始为 1，实际迁居时与人物版本同时递增，普通资料编辑不改变世界版本；始终 `0 < worldVersion <= version`。移除和权限变化增加访问版本。`(accountId,sourceDraftId)` 唯一，保证一个草稿只确认一个人物 |
| `PersonMediaLink` | `{id,accountId,personId,mediaId,purpose,status,createdAt}`，用途 `person_source/profile_photo`，活动关联唯一。人物、草稿和媒体外键保持同账号 |
| `World` | `{id UUID,code,displayName,enabled,sceneKey?,catalogVersion}`。初始稳定 `code` 为 `courtyard/tide/isles`。人物归属用 `worldId`，页面素材与主题可继续读取端侧配置。迁居不能重建人物 ID |
| `PersonWorldMovement` | 不可改写的成功迁居事实：账号、人物、`worldVersion`、提交时的 `personVersion`、迁出／迁入目录 ID 与快照、用户提交来源、发生／记录时间。同人物世界版本唯一，迁出与迁入不同；固定 `reality='virtual'`、`branch='main'`，不接收客户端指定分支、现实性质或执行者。初次分配不编造迁居历史；失败、排队和意愿不写此表 |
| `Reminder` | `{id,accountId,personId,kind,label?,monthDay?,localTime,timeZone,enabled,version,nextAt?}`。仅在需要跨端同步或后台送达时持久化。`kind birthday/anniversary`，`timeZone` 是 IANA 时区 |

`PersonDTO` 返回当前可见的人物字段、资料引用、`version` 和当前世界。AI 提取和人物预览保留 `sourceRefs` 与来源性质。人物资料与已确认回忆各有独立资源，人物查询通过关联定位原文。照片只以 `mediaId` 或资料关联 ID 引用。

首发接口校验采用以下范围，缩减或扩大范围时须更新 OpenAPI 和前端错误映射。`displayName` 和 `relationship` 修剪后分别为 1–80 与 1–40 个 Unicode 字符。创建草稿时可省略，存在时按同一范围校验。`realName`、`calledMe`、`yearsText` 与 `place` 各最多 120 字符，`story` 最多 20,000 字符。`birthMonthDay` 允许有效的 `02-29`，年份未知时使用 `yearsText` 或留空。单人活动资料关联的首发上限建议 12 项。媒体类型、字节上限和期限由发布配置按用途确定，向客户端返回可纠正的校验结果。

| 返回类型 | 结构 |
| --- | --- |
| `PersonDraftDTO` | `{id,status,version,displayName?,relationship?,story?,realName?,calledMe?,birthMonthDay?,yearsText?,place?,mediaIds[],confirmedPersonId?,activePreviewId?,updatedAt,expiresAt}` |
| `PersonPreviewDTO` | `{id,draftId,draftVersion,status,renderMode,summary?,suggestedWorldId?,suggestedPersonality?,suggestedCatchphrase?,unknownFields[],sourceRefs[],expiresAt,failureCode?,retryable?}`。`sourceRefs` 只提供当前可见的 `{kind:'draft_story'/'media',id,version}` |
| `PersonDTO` | `{id,displayName,relationship,realName?,calledMe?,story?,birthMonthDay?,yearsText?,place?,worldId,worldVersion,avatarMediaLinkId?,mediaLinks[],status,version,createdAt,updatedAt}`。`mediaLinks` 为有效的 `PersonMediaLinkDTO` |
| `PersonMediaLinkDTO` | `{id,personId,mediaId,purpose,createdAt}`。媒体访问仍需单独授权 |
| `WorldDTO` | `{id,code,displayName,enabled,sceneKey?,catalogVersion}` |
| `ReminderDTO` | `{id,personId,kind,label?,monthDay?,localTime,timeZone,enabled,version,nextAt?}`。`localTime` 用 `HH:mm`，绝对发生时间用 `Instant` |

文字人物已接入 PER-01、02、22、03、05、06、07、08、09、13、17、23；R01 首片补齐 PER-12、24 及世界事实读取，已接原迁居入口，正式 live UI／模型验收正在进行。PATCH 传 `null` 可清空可选字段，省略字段时保留；已确认人物的称呼、关系与故事不可清空。人物资料支持原编辑表单中的称呼、关系、名字、TA 对你的称呼、生日、年份和地点，生日为合法 `MM-DD`（允许 `02-29`）。`004_original_seek_fields.sql` 为草稿补齐原坐标编辑器的文字字段；原「很像 TA → 关系选择」流程在最后确认时提交关系和对用户的称呼，后端不要求把这些决定前移。当前 `user_input` 预览同步整理用户输入，返回 `202` 和 `succeeded`，读取时再校验草稿与授权版本。私有素材等能力按后续批次接入；前端保留原入口，通过已有反馈说明未接通，真实账号不产生演示上传、回复或交易。

PER-09、13 要求同源、有效会话、`If-Match: "v<N>"` 与 UUID `Idempotency-Key`。编辑需要文字保存授权，移除在撤回该授权后仍可执行。成功后增加人物版本；版本竞争返回 `412 VERSION_CONFLICT`，他人、未知或已移除对象统一 `404 NOT_FOUND`。网络结果未知时复用原键与原参数；编辑成功后使用服务端 DTO 回读。移除返回 `204`，同键重放仍为 `204` 且不重复事件；异参同键冲突。移除后人物、源草稿、预览及旧创建、更新、确认命令缓存均不能再返回该人物的资料。当前只交付逻辑移除、访问版本递增及事务 Outbox；物理清理和后续领域消费者单独验收。

### R01 迁居首片（2026-11-12）

增量迁移 `007_world_movements.sql` 在 001–006 后应用，增加 `persons.world_version` 和 `person_world_movements`，不改旧迁移。迁居沿原人物设置入口免费执行，不扣邮票或券、不要求 AI 授权；仍核对账号、文字保存授权、人物归属和版本。同账号擦除门闩先于资源锁，目标世界持共享锁并复核可选。实际迁居在一个事务内更新人物与世界版本、写不可改迁居事实及 `PersonWorldChanged.v1`、`PersonUpdated.v1`；后者让既有自动画像来源消费者跟上人物版本，事件不复制私人正文。同世界的新操作不增版本、不发事件。成功的迁居、确认及人物更新命令重放均回读当前 Person，不重新执行原副作用，也不以缓存旧世界覆盖当前状态。人物 ID、访问版本、私聊和回忆身份保持不变。

`GET /v1/persons/{personId}/world-movements?cursor&limit` 只读本账号有效人物历史，按世界版本倒序，签名游标绑定账号、人物和分页参数。`GET /internal/v1/persons/{personId}/world-context` 仅接受 Conversations／Memories 服务凭据与 `X-Xijie-Account-Id`，复核 Identity active 账号、本地擦除围栏及有效人物，在同一可重复读快照内返回 `{accountId,personId,personVersion,worldVersion,reality:'virtual',branch:'main',currentWorld,recentMovements,revision}`。世界卡片统一 `{id,code,displayName,catalogVersion,enabled}`；迁居项为 `{id,worldVersion,personVersion,fromWorld,toWorld,occurredAt,recordedAt}`。最近最多八次，须按版本连续、迁入迁出衔接且最新落点匹配当前世界；不一致时拒绝读取。`revision` 输入固定为 `{accountId,personId,worldVersion,reality,branch,currentWorld,recentMovements}`，作递归对象键字典序、数组保序的 canonical JSON UTF-8 SHA-256，不包含顶层 `personVersion` 或 `revision`。普通画像编辑不改变世界事实摘要；目录下架不影响当前世界及历史可读，但禁止新迁入。

人物导出增加 `worldVersion` 与 `worldMovements`，迁居快照纳入预算和数据 revision；人物移除后不返回其历史，账号擦除一并清除迁居事实并阻止迟到写入。世界上下文读取不调用 AI；聊天使用它仍受现有 AI 权限和版本复核控制。Identity 只读账号上下文须允许独立 People 服务凭据，不能用其他服务的 token 代替；无效凭据和禁用账号均拒绝。本片只交付用户已提交的虚拟主线迁居，不启用私人动态、平行分支或自动世界剧情。独立新合成账号已通过原入口未授权 AI 迁居、刷新、往返、旧键重放、同人物／直聊／珍藏保持；后续原聊天真实模型及 OTP 导出均通过，范围见[聊天接续实测](./conversations-memories.md#r01-迁居与文字聊天接续首片2026-11-12)。

**历史阶段解析接缝（2026-11-15，服务实现及隔离测试已完成，连续记忆端到端另验）。** `POST /internal/v1/persons/{personId}/world-stages/resolve` 仅接受 Conversations 服务凭据与 `X-Xijie-Account-Id`，不接受 Memories、Social 或浏览器凭据。请求严格为 `{expectedPersonVersion,expectedWorldVersion,stages:[{worldId,worldVersion}]}`，版本为正整数，阶段数量 1–32、`worldVersion` 唯一；同一世界可出现在多次不同迁居阶段。响应为 `{accountId,personId,personVersion,currentWorldVersion,stages:[{worldVersion,world,basis}]}`，保留请求顺序，`world` 沿既有 World 五字段，不含故事、照片或其他私人正文。

同一 `REPEATABLE READ READ ONLY` 快照内核对同账号有效人物、擦除围栏及两个期望版本。当前阶段返回当前目录卡片，`basis:'current_catalog'`；过去阶段 2 及以后返回该阶段迁入事实的不可变 `to_world`，`basis:'arrival_snapshot'`；过去阶段 1 返回第一次迁出事实的 `from_world`，`basis:'departure_snapshot'`，不虚构初次迁入事件。这些是目录或迁居快照，不声称是每条剧情事件发生瞬间的目录快照。读取不依赖最近八次窗口，并检查请求阶段的相邻迁入／迁出边界及当前落点；过去世界停用仍可解析，缺失、错接或人物版本越界的迁居事实返回 `503 DEPENDENCY_UNAVAILABLE`。当前人物／迁居版本过期、未来阶段或请求世界与阶段不符返回 `409 SOURCE_CHANGED`；他人、已移除或已擦除人物返回 `404 NOT_FOUND`，格式错误返回 `400 INVALID_ARGUMENT`。

Identity active 账号前后复核均在本地事务之外，之后再回读同一请求以拒绝期间的迁居、人物或目录变化。接口不要求模型授权，也不构成模型使用许可；调用方仍须按用途核验当前授权与来源。它只解析已有事实，不写迁居、剧情事件、队列或新表，不改变既有 `world-context` 的当前场景及最近八次语义。

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
| `PER-07` | `POST /v1/person-drafts/{draftId}/confirm` | `If-Match`，`{previewId,worldId,relationship?,calledMe?}` → `201 PersonDTO` | 事务内锁定草稿、候选、当前授权与目标世界。候选须成功、未过期且对应当前草稿版本。原关系步骤提交最终关系与称呼；兼容旧草稿已保存关系的请求，最终仍须有有效关系。将坐标文字与最终字段建为人物，消费草稿并记录 `PersonConfirmed.v1`。一个草稿唯一对应一个人物，不自动建会话、回忆或礼物。同一已完成请求重放回读原人物，异参冲突 |
| `PER-08` | `GET /v1/persons` | `worldId?`,`cursor?`,`limit?` → `200 PersonDTO[]` | 只读本账号有效人物。按世界筛成员，游标绑定世界筛选 |
| `PER-23` | `GET /v1/persons/{personId}` | 无 → `200 PersonDTO` | 以 `People.requirePerson` 验证有效归属，返回可见资料和当前世界。找不到、已移除和他人对象同为 `404 NOT_FOUND`。私聊与回忆仍由相应域独立鉴权 |
| `PER-09` | `PATCH /v1/persons/{personId}` | `If-Match`，`{displayName?,relationship?,realName?,calledMe?,story?,birthMonthDay?,yearsText?,place?,avatarMediaLinkId?}` → `200 PersonDTO` | 在事务中校验归属、版本及主图关联。编辑字段只改人物资料。生日取消或变更时更新该人物的生日提醒下一次时间。涉及生成事实的修改在任务写回时检查人物数据版本 |
| `PER-10` | `POST /v1/persons/{personId}/media-links` | `If-Match`，`{mediaId,purpose}` → `201 PersonMediaLinkDTO` | 校验图片或已开放的素材类型和用途，建立账号内有效关联。已有同一活动关联可幂等返回。模型处理另查 `ai_context` 授权 |
| `PER-11` | `DELETE /v1/persons/{personId}/media-links/{linkId}` | 人物 `If-Match` → `204` | 同事务撤销关联和目标用途、增加素材授权版本，清除指向该关联的主图，写撤销事件。其他合法目标的素材记录可继续引用，复核后重新签发。最后一个关联消失时按保留策略入队清理 |
| `PER-12` | `POST /v1/persons/{personId}/world` | `If-Match`、UUID `Idempotency-Key`，严格 `{worldId:UUID}` → `200 PersonDTO` 与 ETag | 已接原入口，验收状态见 R01 首片。有效目标实际迁居同事务增人物／世界版本、写不可改事实及双 Outbox；同世界不变更。成功重放回读当前人物。免费、无需 AI 授权；不创建小聚、寄件或剧情 |
| `PER-13` | `DELETE /v1/persons/{personId}` | `If-Match` → `204` | 事务内置 `removed`，提高访问版本，阻止新会话、生成、送礼、媒体访问及旧结果写回。同事务发布撤权事件并调度索引、素材、提醒与业务引用清理。公开投影随各自授权策略更新。账本与历史回执按留存规则保留必要快照 |
| `PER-14` | `POST /v1/persons/{personId}/extractions`。按需 | `If-Match`，`{mediaIds[],kind}`，`kind photo/audio/video/chat_archive` → `202 {id,status,personVersion}` | 验证所有已准备的素材及 AI 用途，绑定素材授权版本与人物版本，入队提取候选。开放的素材和内容类型由能力配置限制。样例素材走原型 |
| `PER-15` | `GET /v1/persons/{personId}/extractions/{id}`。按需 | 无 → `200 {id,status,personVersion,items?,failureCode?}`，候选项 `{id,kind,value,sourceRefs}` | 校验归属及素材有效性。过期、撤权或人物版本已失配时标记结果失效，隐藏候选原文 |
| `PER-16` | `POST /v1/persons/{personId}/extractions/{id}/confirm`。按需 | `If-Match`，`{selectedItemIds[]}` → `200 {person:PersonDTO,appliedItemIds,createdMemoryCandidateIds}` | 校验候选集、来源权限和当前人物版本后，对选择项执行一次应用。更新资料字段，记忆条目进入候选域，用户仍需从记忆接口确认原文。唯一 `(extractionId,itemId)` 防止重放 |
| `PER-17` | `GET /v1/worlds` | `cursor?`,`limit?` → `200 WorldDTO[]` | 有效会话读取完整版本化目录，以 `enabled` 判断可选性；下架条目仍可解析既有人物的世界。私人世界成员由 `PER-08` 提供 |
| `PER-24` | `GET /v1/worlds/{worldId}` | 无 → `200 WorldDTO` | 已实现，有效会话读取指定目录项，含已下架条目；未知 ID 为 404。下架世界可回读，不能作为新迁居目标 |
| `PER-18` | `GET /v1/persons/{personId}/reminders`。按需 | `cursor?`,`limit?` → `200 ReminderDTO[]` | 只读拥有且有效的人物下的提醒。只用本机调度时无需此接口 |
| `PER-19` | `POST /v1/persons/{personId}/reminders`。按需 | `{kind,label?,monthDay?,localTime,timeZone,enabled}` → `201 ReminderDTO` | 校验日期、时间、时区与本人资格。生日使用人物资料的 `birthMonthDay`，纪念日输入月日。闰日遇非闰年跳过。夏令时重复本地时间选择第一次出现，缺失时顺延至首个有效本地时刻。保存 `nextAt` 并按版本入队 |
| `PER-20` | `PATCH /v1/persons/{personId}/reminders/{reminderId}`。按需 | `If-Match`，`{label?,monthDay?,localTime?,timeZone?,enabled?}` → `200 ReminderDTO` | 更新当前版本、重新计算下一次，旧任务启动时检查提醒有效性及版本。关闭或删除原生通知也须同步端侧订阅 |
| `PER-21` | `DELETE /v1/persons/{personId}/reminders/{reminderId}`。按需 | `If-Match` → `204` | 撤销提醒并使在途任务失效。发送按 `(reminderId,occurrenceAt)` 去重，通知文案不包含未经允许的敏感资料 |

## 5. 进程内调用、外部边界与事件

`AccountActor` 表示已经验证的业务主体，具体字段使用主契约。Worker 从已持久化的任务和业务对象重建受限委托，并校验账号访问版本、用途和目标版本。客户端会话退出不会自动撤销已受理任务的业务归属。`tx` 仅表示所属服务本库的业务事务；下表保留的进程内抽象名不是已部署的跨服务调用方式。Identity、People、Media 与业务服务各自拥有数据库，跨域使用独立凭据的内部 HTTP，全部网络调用在本库事务和行锁外；外部资源 ID 不建立跨库 SQL 外键。

| 接口 | 入参 → 出参 | 实现及调用顺序 |
| --- | --- | --- |
| `Accounts.getOrProvisionAccount` | `(tx, verifiedPrincipal:{issuer,subject,authTime}, invitationIntentId?:UUID)` → `{accountId,isNew,registrationId?}` | 仅由 `IAM-02/03/13` 用已验证主体调用。按主体唯一约束查询或首次建档。启用邀请功能且本次有归因意图时，首次注册同事务调用 `Referrals.bindRegistration(tx,{accountId,registrationId,verifiedAt,invitationIntentId?})`。无效、过期或自邀不阻断合法登录，依赖事务故障整体回滚。写出事件后由成功会话回读。既有账号登录不重绑邀请 |
| `Accounts.requireActive` | `(txOrDb, actor)` → `{id,accessVersion,status:'active'}` | 入口与 Worker 使用统一规则。账号不允许当前操作时拒绝，注销或受限账号仅可走已授权的权利或售后入口 |
| 人物当前来源（`People.requirePerson` 为域内抽象名） | 调用方独立凭据及账号头 → 人物归属、状态和必要版本 | 跨服务通过 People 内部 HTTP 在锁外取最小上下文；生成前后复核当前来源与捕获版本。People 内部事务只锁本库人物，其他服务不持人物跨库锁，不宣称跨服务原子撤权 |
| 当前媒体读取（`Media.authorizeMediaUse` 为后续通用抽象名） | 浏览器使用 MED-04/07；视觉 Worker 使用 `POST /internal/v1/photo-reply-jobs/{jobId}/attempts/{attemptId}/media-content` | 当前用途和目标沿第3节。普通读图必须有有效已提交来源；内部模型读取以 Conversations 当前运行 attempt、原消息及捕获权限为依据，前后验证同一精确来源后交付规范化字节，不使用浏览器 proof 或对象 URL |
| 当前媒体预绑定（`Media.bindUse` 为后续通用抽象名） | 聊天 `POST /internal/v1/conversations/{conversationId}/messages/{clientMessageId}/media-bindings {mediaId,version}` → `{conversationId,clientMessageId,media,expiresAt}` | Conversations 独立凭据与账号头；Media 校验 ready、初始用途、固定目标及当前／捕获授权，返回60秒提交租约。调用在本库事务外；Conversations 随后锁本库会话，按数据库时钟复核租约，消息、引用、任务与回执同事务。Media 候选与业务来源不构成跨库原子提交；其他用途分别沿其已公布的内部绑定接口 |
| 当前媒体失效（`Media.revokeUse` 为后续通用抽象名） | 业务域先失效自己的权威来源，Media 通过来源校验／清理任务收敛 | 来源校验独立于普通照片许可；撤权不能被当作删除。聊天绑定宽限15分钟且清理锁后重验最后预绑定时间；有效来源保护实际字节，外部依赖故障不作为删除证据 |
| `IdentityProvider` | `beginAuthorization`、`exchangeAuthorization`、`verifyAccessToken`、`getIdentitySummary`、`reconcileIdentityOperation` | OIDC SDK 负责授权、换取和验证。近期验证、原生回跳、账号中心及解绑能力依据目标平台实测，失败时保持最后一次已验证关系。外部调用与本地事务分开，保存可查的外部操作标识 |
| `ObjectStorage` | `createUploadSlot`、`inspectObjectVersion`、`promoteVerifiedObject`、`signRead`、`deleteIfRetained` | 适配私有对象存储。签名、对象版本和权限策略独立于业务 API。校验任务提交前确认目标对象不可变。删除任务需要复核当前是否有其他允许的引用 |
| `PeoplePreviewWorker` 与 `MediaVerifyWorker` | 任务引用 `{accountId,objectId,expectedVersion,authorizationVersion?}`，完成后更新对应资源 | 按对象版本和任务 ID 去重，运行及写回前复核授权。远程计算在短数据库事务之外。处理结果与任务状态持久化，前端断线后按 ID 重读 |

### 领域事件载荷

| 事件 | 业务载荷 | 产出与订阅 |
| --- | --- | --- |
| `AccountRegistered.v1` | `{accountId,registeredAt,referralAttributionId?:UUID}` | 首次建档事务产生。邀请域可按归因 ID 验证资格，旧用户登录和资料导入不产生此事件 |
| `AccountAccessRevoked.v1` | `{accountId,accessVersion,reason:'account_deletion'/'account_restricted',revokedAt}` | 全账号失效事务产生。各域阻断读取、分享、推送和生成。单设备退出与切号只撤销对应会话 |
| `PersonConfirmed.v1` | `{accountId,personId,worldId,personVersion}` | 草稿确认事务产生。索引可异步投影，私聊在首条消息时由会话域按幂等规则建立 |
| `PersonUpdated.v1` | `{accountId,personId,worldId,personVersion,accessVersion}` | 资料更新或实际迁居事务产生。后续生成与自动画像消费者按人物版本复核，事件不携带私人故事正文；迁居不把虚拟世界当作原始画像事实 |
| `PersonWorldChanged.v1` | `{accountId,personId,movementId,fromWorldId,toWorldId,personVersion,worldVersion,reality:'virtual',branch:'main'}` | 实际迁居事务产生，与不可改成功事实及 `PersonUpdated.v1` 原子提交；重复消费按事件／事实 ID 去重。不自动派发剧情；既有历史快照保持原世界语义 |
| `PersonAccessRevoked.v1` | `{accountId,personId,accessVersion,reason:'person_removed'}` | 人物移除事务产生。会话、检索、回忆、提醒和公开投影复核失效。账本保留有权读的必要快照 |
| `MediaReady.v1` | `{accountId,mediaId,authorizationVersion}` | 校验完成事务产生。已授权用途可使用不可变对象 |
| `MediaUseRevoked.v1` | `{accountId,mediaId,authorizationVersion,targetKind?:string,targetId?:UUID}` | 素材或单用途撤权事务产生。授权和结果失效以数据库版本为准，消费者可重跑。载荷不包含对象 URL 或私有内容 |

### 领域错误和验收

| 错误码 | HTTP | 处理 |
| --- | --- | --- |
| `AUTH_ATTEMPT_EXPIRED` | `410` | 返回登录或切换流程，原已登录账号仍有效 |
| `AUTH_CHALLENGE_EXPIRED` | `410` | 重新获取验证码；切号中的原应用会话不因挑战到期而退出 |
| `AUTH_RATE_LIMITED` | `429` | 按 `Retry-After` 和错误详情 `retryAfter` 等待，保留用户输入，停止自动重复发码 |
| `IDEMPOTENCY_CONFLICT` / `CONFLICT` | `409` | 同键异参需修正客户端键使用；在途并发等待原结果，不并行重放验证 |
| `AUTH_PROVIDER_UNAVAILABLE` / `AUTH_RESTART_REQUIRED` | `503` | 展示可重试结果；认证消费结果不明时重新取码，不凭前端状态创建或恢复会话 |
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

### 已落地补充：结构化人物资料、账号昵称与纪念提醒

举报与运营处置已另接真实服务：`POST /v1/content-reports {subjectType:'message'|'post'|'contribution',subjectId,reason,note?}` 要求当前会话、Origin、Expected-Session及UUID幂等键。只能举报当前可读的本人私聊／私人动态，或本人相册下及自己已绑定账号的投稿；不从公开链接猜测其他投稿。每账号每小时最多20条，永久回执阻止重复受理。`GET /v1/content-reports?limit,cursor` 和 `GET /v1/content-reports/:id` 只返回本人进度（open/reviewing/resolved）、版本和公开处理说明；不泄露原正文、其他账号、运营身份或内部证据。

`CONTENT_REPORTS_ENABLED` 默认关闭；开启时配置独立 `XIJIE_CONTENT_REVIEW_SERVICE_TOKEN` 和绝对私有路径 `CONTENT_REVIEW_OPERATORS_FILE`。运营文件仅存 `{id,tokenHash:sha256(token),scopes}` 数组，权限分为 `reports:read`、`reports:evidence`、`reports:resolve`。`GET /v1/ops/content-reports` 仅列最小案件元信息；单独 `GET /v1/ops/content-reports/:id/evidence` 才在留痕后读取当前文本及版本／摘要，不返回私有对象链接。当前证据接口提供文本和素材类型元信息，不代理图片二进制。`POST /v1/ops/content-reports/:id/resolve` 要求独立运营Bearer、UUID键、If-Match及 `{decision:'dismiss'|'restrict_visibility',reasonCode,publicResolution?}`。原内容改变时，必须重新查看证据并显式提交 `reviewedSourceVersion/reviewedSourceHash`；不会拿旧证据自动处置新版本。

限制动作先进入reviewing，按原actionKey调用Conversations/Social来源域；只有真实墓碑／来源撤回落地后才resolved。丢失回包仍查询／重放原命令，后台 `worker:reports` 每轮最多20条并公平轮转，不能用本地状态宣布成功。消息处置阻断待生成与世界行动依赖，动态处置清理其评论／反应并阻断待回响，相册处置撤销陈列及采纳来源，保留独立moderate决策，不伪装成访客自行撤回。已发放的回礼不擅自追回。报告、本人说明和运营审计纳入账号数据导出／擦除；恢复副本的reviewing案件保持blocked。运营CLI `node scripts/content-reports.mjs list|evidence <UUID>|resolve <绝对私有请求文件>` 只从 `REPORTS_OPERATOR_TOKEN_FILE` 读凭据，resolve文件固定原reportId/key/version/decision以便未知结果重试。网关只公开普通 `/v1/content-reports`，不得公开 `/v1/ops` 或 `/internal`。

- People `009_structured_profile.sql` 给正式人物增加 `personality:string[]`（最多30项，每项200字符）、`life:string[]`（100项，每项1000字符）、`unknowns:string[]`（30项，每项500字符）和 `catchphrase:string|null`（非空时最多500字符）。前三项默认空数组，口头禅默认null。既有 `story` 保留独立原文，不能自动当作结构化生活事实；`unknowns` 仅代表待了解内容。原 `PATCH /v1/persons/:id` 支持这些字段的替换/清空，沿用人物CAS版本、会话归属和永久命令键；人物及受授权内部上下文、导出同步携带字段。
- 「寻找 TA」的有效预览可从当前版本的故事原文提取明确写出的性格、说话方式和口头禅。线索随同一版本的人物确认写入，原故事保留，显式选择的 `conversationTone` 优先用于聊天。缺少对应描述时，预览会省略这些字段。
- Identity `022_account_profile.sql` 支持 `PATCH /v1/accounts/me {displayName}`。昵称trim后1–12个Unicode字符，不含控制字符；必须当前会话、匹配Expected-Session、注册Origin、UUID Idempotency-Key和 `If-Match: "vN"`。GET当前账号返回ETag。昵称修改使用accounts.version，并不撤销其他正常会话；同键同请求返回当前权威资料，同键异参409，旧版本412，缺版本428。浏览器在写前保存原命令，未知结果/401/刷新保留同键；旧回包不覆盖已切换账号。
- People `010_person_reminders.sql` 支持 `GET /v1/persons/:id/reminder`，返回 `{personId,enabled,timeZone,version}`；缺设置时默认为 `{enabled:false,timeZone:null,version:1}`。`PUT /v1/persons/:id/reminder {enabled:boolean,timeZone?:string}` 沿用写入四种会话/Origin/UUID/CAS防护，首次开启须提供有效IANA时区并冻结，之后关闭再开也保持原时区。设置拥有独立版本，不改变人物资料版本。故事保存授权撤回或换版本后旧设置不自动恢复。
- 主People服务启动立即处理持久 `next_check_at`，之后每分钟检查到期项，按冻结时区在当日08:00后记录生日或相见周年站内通知；相见周年从确认后的下一年开始。每个人物、种类、当地年份有数据库唯一约束，双worker/重启重跑不会重复。未处理的旧日期不补造事件，02-29只在真实闰日提醒。不开AI、不消费资产、不代用户发送消息。停机不会丢失设置和已产生通知；同一天恢复后可补当天到期项。
- `GET /v1/person-reminders?limit=20&cursor=...` 为本人实际站内提醒签名分页，返回 `{data:[{id,personId,personName,kind:'birthday'|'meeting_anniversary',localDate,createdAt,readAt,version}],meta:{nextCursor}}`。`POST /v1/person-reminders/:id/read {}` 需要相同写入防护和该通知版本，按原键重试已读操作。原资料卡时光开关和系统通知页已接这些路由，GET不触发调度或改变已读。
- 关闭提醒停止新记录；移除人物或故事授权失效后不展示旧通知，旧授权重授不复活通知。People导出含 `reminderSettings`/`reminderNotifications`，账号擦除删除设置、通知与永久命令，既有擦除fence拒绝迟到任务写回。没有把People通知伪造为Gifts通知。

### 已落地补充：人物声音样本来源与交流偏好

- People `011_voice_samples_and_preferences.sql` 给草稿和正式人物增加 `conversationTone:'gentle'|'witty'|'quiet'|'stern'|null`、`voiceTimbre:'warm'|'bright'|'deep'|null`，默认null。沿现有草稿创建、草稿PATCH、人物PATCH及确认继承保存；是用户选择的交流偏好，独立于 `story` 原文，不代表对样本变声或声音克隆。
- DraftDTO／PersonDTO 增加只读 `voiceId:UUID|null`、`readyVoice:null|{id:UUID,version:positiveInt,durationMs:1..30000,mimeType:'audio/wav',byteSize:46..1440044（PCM16偶数长度）,sha256:64hex}`、`hasVoice:boolean` 和 `voiceTarget:{kind:'person_draft',id:UUID}`。声音和照片目标使用同一个稳定草稿ID；正式人物继续引用其来源草稿。`hasVoice` 只来自当前真实绑定的ready元数据，旧原型布尔值不能构成已保存声音。
- `PATCH /v1/person-drafts/:id` 和 `PATCH /v1/persons/:id` 可独立提交 `{voiceId:UUID|null}`，复用原CAS及永久幂等命令；声音字段另要求实际 `X-Xijie-Expected-Session`。创建草稿不接受voiceId，须先真正保存草稿再上传／绑定。非null绑定同时要求当前故事保存和独立 `personVoiceStorage` 许可；在Media调用前后重新核对相同账号、会话、用途版本及来源，最后在本库锁内复核CAS和60秒租约。只解绑 `{voiceId:null}` 无需重新同意声音或故事保存，不提高已撤回的旧故事授权版本。
- People使用独立People服务凭据和账号头，向Media `POST /internal/v1/people/drafts/:draftId/voice-bindings {voiceId}` 取得 `{data:{draftId,voice:readyMetadata,expiresAt,bindingVersion}}`。bindingVersion为预绑定时的来源epoch（未绑定过为0），People在取得同一draft写锁后与当前epoch精确比较；过期时间沿Media原值，不重新延长。不得下发声音字节、读proof或私有对象URL到人物DTO；错误目标／声音ID／metadata、过期租约、授权改变或并发资料变更均不覆盖原绑定。
- Media独立角色调用 `POST /internal/v1/media/people/voices/validate {refs:[{draftId,voiceId,version,bindingVersion?}]}`；只返回当前同账号、有效草稿或未移除人物的精确来源 `{data:{valid:[{draftId,voiceId,version,bindingVersion}]}}`。此来源校验不因声音用途撤回而伪造“已删除”，供权利及清理核查。`person_draft_voice_epochs` 在替换／解绑／重新绑定时严格单调递增且解绑后保留，阻断 old→new→old 使旧播放proof复活；该epoch不进入公开readyVoice。人物移除、草稿失效和账号擦除立即使来源无效。
- People导出含偏好与 `voiceRefs` 的最小绑定元数据／bindingVersion，擦除按绑定→epoch顺序清除并服从账号fence。所有文字AI人物上下文明确剔除 `voiceId`、`readyVoice`、`voiceTarget`、`hasVoice`，偏好仅作为显式文字偏好；原始声音不会因此进入模型。
- 前端原草稿hook的 `ensureVoiceTarget()` 只在真实授权保存后给出目标，`bindVoice()` 完成PATCH后GET权威读回才标为ready；原管理hook仅为当前真实account/session与有效稳定目标提供声音上下文。切号迟到回包不更新新账号。声音意图／删除journal纳入已验证注销后的本机私有草稿清理，金融恢复journal继续保留。
- Media角色另可 `GET /internal/v1/media/people/drafts/:id/voice-binding-state` 读取 `{data:{draftId,accountId,bindingVersion:nonnegativeInt,voiceId:UUID|null,version:assetVersion|null}}`，无声音／故事用途要求，仍验证当前有效账号及有效目标。此GET先在本地事务取得draft `FOR SHARE`，再用新READ COMMITTED快照一次读取epoch及绑定；与所有声音写者的draft `FOR UPDATE`互斥，等待已开始的绑定真正提交后才回状态。锁内不调用外部服务、不写业务数据，Identity前后核对均在锁外。Media由该状态判断解绑是否真正提交，并拒绝仍绑定或仍有有效预绑定租约的删除，避免迟到绑定落到已删资产。
- 原Seek声音Sheet的“完成”执行真实保存及绑定后才关闭，Gear原声音行下可保存／管理原声；录音只有真实MediaRecorder输出，样例分支仍独立。未知分配、绑定、删除保留原metadata命令，恢复清理先GET当前People来源再排除仍绑定ID；换号、目标变化、撤权、隐藏及卸载停止相应采音／播放并释放Blob URL。原Refine语气与音色Chip沿原Apply保存偏好，不修改故事或原始音频。

### 登录能力补充（2026-11-17）

保留原手机号短信首屏和一次声明；“其他登录方式”新增手机号密码、Google，原 Apple／微信继续走自建 Logto。所有正式第三方开关默认 false，配置方法见 [登录渠道配置](../../deploy/logto-auth/README.md)。029 扩展 Google 白名单，030 增加密码操作收据和凭据 fence，031 增加微信 SDK 私有事务，不改旧迁移。

| 路由 | 当前契约 |
| --- | --- |
| GET `/v1/auth/password-policy` | 实读 Logto 公共配置，返回 `enabled/resetEnabled/policy`，规则含长度、字符种类和上游拒绝条件 |
| GET `/v1/accounts/me/authentication` | 当前会话与 ExpectedSession；仅返回密码可管理状态、是否绑号、脱敏号及 SMS／同主体第三方再认证方法 |
| POST `/v1/auth/password-attempts` | `{dial,phone,password,purpose:sign_in或switch}`；真实校验后才 verified 并设 HttpOnly 会话，错误账号/密码统一 401；switch 绑定原会话 |
| POST `/v1/auth/password-challenges` | manage 只传 `{purpose:'manage'}`，后端读取原主体实时绑定号；reset 传 `{purpose:'reset',dial,phone}`，不注册、不自动登录 |
| POST `/v1/auth/password-challenges/:id/verify` | `{code}`，只回 verified／incorrect／expired，不建立新会话 |
| PUT `/v1/auth/password-challenges/:id/password` | `{password}`；上游政策通过后 fence／撤销旧会话，再真实提交；已完成回 `{status:'completed',requiresSignIn:true}` |
| GET／DELETE `/v1/auth/password-challenges/:id` | GET 只回本次操作状态和到期时间；DELETE 仅取消未提交步骤，不假撤回未知的上游写入 |

写入均沿用原 Origin、UUID Idempotency-Key、发起会话和浏览器归属校验。密码确认仅客户端比较，OTP/密码不写浏览器存储、URL或日志。服务端只保留 HMAC 操作指纹和加密提供方上下文；西界不实现自己的密码校验库。上游回包丢失保持 unknown；明确重输同一新密码并在原 Logto 主体验证后才收口，不根据交互消失猜测成功。密码变更使旧会话和旧在途认证失效，账号切换及迟到结果不能覆盖新账号。

固定自建 Logto 的 Management API 实际只有 all，手机号读取使用独立数据库只读视图 `xijie_auth_reader.bound_phones(subject,phone)`，视图限定本租户，角色无原 users 表和写入权限。原 openid scope 不扩大，不缓存旧手机号；reader 不可用如实回 503。只有真实支持 read:users 的其他部署才可配置独立 M2M reader，不能复用注销权限。

原 OIDC 与 native handoff 的 provider 白名单均为 apple／google／wechat。`purpose:'reauthenticate'` 必须绑定原 session/account 和完全相同 issuer/sub，更新原会话再认证时间，不创建或切换账号；微信／Google 无手机号账号因此仍可按原第三方完成导出或注销验证。native reauth redeem 返回 `{status:'reauthenticated',sessionId,reauthenticatedAt}`，普通登录保持 verified 及原会话 cookie。

微信 SDK transport 为 `wechat_sdk`，先 `POST /v1/auth/native-attempts`，再由原生私有 HTTP 请求 `/v1/auth/native-wechat/:id/launch {launchProof}` 和 `/complete {code,state,verifier}`；固定 launchKey／completeKey，ExpectedSession、browser cookie、AppID／state 双重核验。仅官方连接器验证且真实 OIDC 签名、nonce、state、S256通过后发布 ticket，原 WebView 用既有 redeem 建立会话。code/state 保存在原生加密私有上下文，BFF 不持久化明文 code；未知结果不得再次直接消费一次性 code。Android 默认空 AppID 不初始化 SDK，保留正式签名和回调信任校验，无新增权限。

账号擦除清理本轮认证上下文、收据及手机号 reader 映射来源；恢复隔离清空密码/SDK瞬态并保守重建凭据 fence，不能恢复旧会话、OTP、授权票据或把密码写入未知状态当作成功。

[交互清单](../backend-interaction-inventory.md) · [交付优先级](../backend-delivery-priorities.md) · [现有人物模型](../../frontend/src/model.ts) · [寻找 TA 界面](../../frontend/src/seek.tsx) · [本机账号与资料](../../frontend/src/App.tsx)
