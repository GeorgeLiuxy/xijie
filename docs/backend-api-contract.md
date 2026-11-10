# 西界后端接口与实现规范 v1 草案

本规范把交互清单 A01–G05 与优先级批次落到接口、数据归属和服务调用。用于实现、接口联调和验收。当前项目仍运行前端原型及 Vite 预览中间件，以下 `/v1` 是正式服务的设计路径。首期按一个地区、一个主客户端和一个真实认证渠道安排。付费渠道、外部提供方参数及公开扩展需在相应批次核验。 [前端交互清单](./backend-interaction-inventory.md) · [总体架构](./backend-architecture.md) · [交付优先级](./backend-delivery-priorities.md)

## 1. 规范分工与阅读入口

| 文档 | 权威范围 |
| --- | --- |
| 本文 | 请求与响应、身份与权限、事件和任务规则、跨域事务、公共接口、联调验收 |
| [身份、人物与媒体](./backend-api/identity-people.md) | A01–A08、B01–B07。认证接入、账号与权利、人物草稿、世界、素材及提醒 |
| [会话、回忆与空间](./backend-api/conversations-memories.md) | C01–C07、D01–D05。消息、生成、书信、记忆、检索、动态和按需通话 |
| [礼物、邀请与交易](./backend-api/assets-commerce.md) | E01–E05、F01–F06、G01–G05。礼物、资产、公开贡献、邀请、订单、退款和回调 |

同一业务事实只由所属模块写入。模块间用带类型的同进程调用，HTTP 负责客户端、平台回调及确需独立部署的边界。API 与 Worker 是同一代码库的两个运行角色。PostgreSQL 保存业务事实、事件与任务，私有对象存储承载媒体字节。实现时从接口 DTO 与运行时校验生成 OpenAPI，按本规范核对方法、路径、字段、错误和兼容性。 [NestJS OpenAPI](https://docs.nestjs.com/openapi/introduction) · [pg-boss 事务入队](https://github.com/timgit/pg-boss/blob/master/docs/api/jobs.md)

## 2. HTTP 共用契约

### 2.1 请求、结果与分页

| 项目 | 统一规则 |
| --- | --- |
| 版本与传输 | 正式 API 使用 HTTPS `/v1`。默认请求和响应为 UTF-8 JSON。OAuth 跳转、对象上传下载、SSE 和第三方回调按各自协议。`/api/gifts`、`/api/invites`、`/api/relay` 属于现有预览路径 |
| 标识 | 业务资源、客户端生成的操作 ID、事件和任务 ID 使用 UUID 字符串。第三方 `issuer`、`subject`、交易号、token 与旧数据 ID 均按不透明外部值处理，与业务 ID 独立 |
| 时间 | 时间点为 UTC 的 RFC 3339 字符串，例如 `2026-11-10T08:00:00.000Z`。生日等不含时间的字段按域定义日期格式。提醒和定时信另带 IANA 时区，服务端保存已解析的执行时间 |
| 金额与资产 | 货币最小单位整数，加三位 ISO 4217 `currency`，数值在 JSON 安全整数范围内。邮资、库存和券为独立整数单位。资产变动由受信的操作或账本分录计算 |
| 请求校验 | 运行时验证类型、长度、数量、枚举、状态与资源关系。部分更新省略字段表示保留，只有注明可清除的字段接受 `null`。当前版本拒绝未知输入字段。响应的新增可选字段应可被旧客户端忽略 |
| 成功结构 | 单项 `{data: T}`。列表 `{data: T[], meta: {nextCursor: string \| null}}`。已完成命令返回 `200` 或 `201`，需等待的命令返回 `202` 和可查询的资源或任务 ID。空列表返回 `200` 和 `[]`。无体 `204` 仅在该接口明确声明时使用 |
| 分页 | `limit` 默认 20、最大 100。`cursor` 是绑定主体、查询条件与排序的不可伪造游标。缺省取首页。固定次排序键为资源 ID 或事件序号。改筛选重开分页。无效或跨账号游标拒绝 |
| 追踪与缓存 | 返回 `X-Request-Id`。私域、订单、授权和签名链接响应使用 `Cache-Control: no-store`。服务端与客户端只记录必要 ID、状态及耗时 |
| 客户端提示 | 可选 `X-Client-Platform` 采用 1–32 位小写 ASCII 标识，首位为字母，其余可含数字、`_` 或 `-`，例如 `web`、`android`、`ios`、`harmonyos`。平台值可扩展，缺省、不合格式或未注册值按未知平台处理。`X-Client-Version` 与平台仅用于筛选展示和诊断。涉及发布资格、支付和权限的请求由服务端复核可信应用、账号与渠道证据 |
| 稳定字段 | `id` 表示当前资源，引用用 `personId`、`conversationId` 等。资源更新使用 `version` 正整数递增。状态码和枚举值由所属域定义，界面文案由前端本地化 |

~~~json
{
  "data": [{ "id": "86e1e290-6354-40f6-88c4-e036950296b3", "version": 1 }],
  "meta": { "nextCursor": null }
}
~~~

示例为列表响应，单对象直接放在 `data` 中。

### 2.2 身份与权限

~~~ts
type RequestContext = {
  requestId: string
  actor:
    | { kind: 'account'; accountId: string; sessionId: string }
    | { kind: 'anonymous'; visitorId?: string }
    | { kind: 'provider'; provider: string; environment: string }
    | { kind: 'worker'; workerId: string }
    | { kind: 'ops'; operatorId: string; permissions: string[] }
  channel: string
  locale: string
}
~~~

- Web 优先同源 BFF 会话与安全 Cookie，写请求校验 CSRF 和来源。原生授权使用身份服务 SDK 和系统安全存储。API 校验受信会话，或同时校验目标受众的 access token 和匹配的 `X-Session-Id`。核对签名、签发方、有效期、权限和当前会话状态。外部身份验证后映射到稳定 `accountId`。普通客户端体、头或旧存储中的 `owner` 不能作为授权来源。 [Logto Capacitor 接入](https://docs.logto.io/quick-starts/capacitor-js)
- 客户端平台与已验证应用身份独立。认证尝试按服务端登记的应用配置绑定授权客户端、回跳和校验规则。会话以已核验主体及应用绑定建立。每次查询、签发媒体链接和命令执行均校验对象归属与当下授权。跨账号私有资源统一 `404 NOT_FOUND`。身份已知但功能、资格或角色不足使用 `403`。SQL 先按账号约束再筛选对象。若采用 RLS 作为第二层，运行角色不得绕过策略，租户上下文限制在当前事务。 [PostgreSQL 行级权限](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- 匿名仅能访问明确公开的入口和投影。Webhook 用渠道验签等专用机制识别，运营端用独立权限与审计。Worker 从业务记录重建归属及授权，任务载荷中的身份只用于定位与追踪。
- 客户端按账号和本次会话代次隔离缓存、媒体签名、草稿与流。切换失败或取消保留旧会话，切换成功后停止旧 SSE 并丢弃迟到响应。后台已受理的业务仍由原对象及当前授权推进。账号注销或权限撤回才按规则阻断原账号的后续执行。

### 2.3 重试、幂等与并发

1. 有业务副作用的命令发送 `Idempotency-Key`，推荐 UUID。幂等范围为已验证主体、操作及目标资源。用唯一键原子取得命令执行资格，指纹包含规范化后的输入与原版本条件。业务提交与幂等结果在同一事务内保存。相同请求重放返回该操作原结果，异参返回 `409 IDEMPOTENCY_CONFLICT`。同键仍在处理时返回 `409 REQUEST_IN_PROGRESS`，可给 `Retry-After`。
2. 前端超时保留原操作 ID 和输入，查资源或用同一键重试。使用带有效期的上传签名、访问令牌等响应时，重放已完成命令只返回仍授权且有效的字段，需要新签名走各自的签发接口。普通幂等记录保留至少 7 天作为首期配置，创建消息、支付发放、奖励和扣减还需各域长期唯一键与可查询记录。
3. 对支持并发编辑的资源返回强 `ETag: "v<N>"`，写入时要求 `If-Match`，缺失返回 `428 PRECONDITION_REQUIRED`，版本不符返回 `412 VERSION_CONFLICT`。重放时在认证和权限检查后先按已保存的请求指纹处理，再对新操作校验版本。状态动作按域条件和事务竞争控制。 [HTTP If-Match](https://www.rfc-editor.org/rfc/rfc9110#section-13.1.1)
4. 先验证权限、功能开关及业务状态，再决定是否进入事务。涉及外部网络的请求放在短事务外，先保存可恢复的尝试记录。外部成功而本地超时按外部幂等标识或查询原交易恢复。退款、支付和任务都各自保留可核对的状态。

### 2.4 错误与客户端动作

~~~json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "资料已更新，请先重新读取。",
    "requestId": "e92e062b-9c55-43bd-b25d-01d9d6260d7c",
    "details": { "currentVersion": 3 }
  }
}
~~~

| HTTP | 共有错误码 | 调用方动作 |
| --- | --- | --- |
| 400 | `INVALID_ARGUMENT` | `details.fields` 可附字段路径与稳定原因。校验改正后再提交 |
| 401 | `UNAUTHENTICATED`、`REAUTH_REQUIRED` | 恢复会话或重新验证，保留经过允许的返回入口 |
| 403 | `FORBIDDEN`、`FEATURE_DISABLED` | 结束当前操作。服务端能力或权限更新后再试 |
| 404 | `NOT_FOUND` | 刷新列表或回退，私有越权与不存在同形 |
| 409 | `CONFLICT`、`IDEMPOTENCY_CONFLICT`、`REQUEST_IN_PROGRESS`、`EVENT_CURSOR_EXPIRED` | 按错误区分状态冲突、原请求查询和增量事件重建 |
| 412 / 428 | `VERSION_CONFLICT` / `PRECONDITION_REQUIRED` | 重读服务端版本后呈现冲突，保留用户输入 |
| 429 | `RATE_LIMITED` | 根据 `Retry-After` 等待后重试 |
| 503 | `DEPENDENCY_UNAVAILABLE` | 保留输入或订单号。已受理动作先查询结果 |

域文档列出业务错误的触发条件和恢复方式。客户端按 `code` 分支，`message` 用于安全的兜底展示。`details` 只包含公开所需字段。

## 3. 共用数据接口

| 编号与接口 | 请求与返回 | 权限、执行与失败 |
| --- | --- | --- |
| SYS-01 `GET /v1/capabilities` | 可提供 `X-Client-Platform`、`X-Client-Version` 和 `Accept-Language`，平台值遵循共用客户端提示契约。返回 `{features: { [key]: {state:'enabled'\|'disabled', reason?:string} }, revision:string}`。首期键 `person.text`、`media.photo`、`chat.text`、`memory.keep`、`gift.send`、`referral.invite`、`commerce.pay` | 登录与公开客户端均可读自身范围。服务端以发行配置、账号资格和授权判定。平台未知时仍可返回通用能力，依赖特定平台接入的能力默认关闭。实际路由独立复核。同一规则保护旧深链，账号态失效按 `401` 处理 |
| SYS-02 `GET /v1/events` | `after` 为该账号的事件序号字符串，`limit` 遵循分页。返回 `{data: ClientEvent[], meta:{nextCursor, highWatermark}}`，`highWatermark` 为读取时已提交的最高序号 | 已登录。只返回当前账号且超过 `after` 的轻量事件。已撤权且曾可见的对象只允许给原账号发送 ID、版本与移除提示，清除其客户端缓存。无 `after` 获取当前水位，返回 `data: []` 用于首屏快照。超出保留窗口返回 `409 EVENT_CURSOR_EXPIRED`，超过当前水位返回 `400 INVALID_ARGUMENT`。返回下一游标时，即使某段全部被权限过滤也推进至已扫描位置。客户端先取得水位，再重读业务快照，最后从该水位接续，按资源版本去重 |
| SYS-03 `GET /v1/events/stream` | `Accept: text/event-stream`，用 `Last-Event-ID` 或 `after` 续传，两者均提供时以 `Last-Event-ID` 为准。帧为 `id: <seq>`、`event: resource.changed`、`data: <ClientEvent JSON>`，定期注释心跳 | 已登录，按会话、账号及可见范围发送。无起点从当前水位开始。原生客户端使用支持认证头的流式请求。流打开前的错误按 HTTP 返回，运行中会话过期或撤销则关闭。断线改查 SYS-02 或业务详情，前台进度可丢，最终结果以域查询为准。 [SSE 规范](https://html.spec.whatwg.org/multipage/server-sent-events.html) |
| SYS-04 `POST /v1/content-reports` | `{subjectType:'message'\|'post'\|'contribution', subjectId, reason:'harmful'\|'privacy'\|'impersonation'\|'spam'\|'other', note?}`，`note` 最长 500 字符。返回 `201 {id,status:'open',createdAt}` | 已登录，校验提交者能读取被举报内容。保存受控的必要证据引用和处理记录，正常日志中不复制内容。频率受限。重复提交复用同键，已失效对象安全拒绝 |
| SYS-05 `GET /v1/content-reports/{reportId}` | 返回本人的 `{id,status:'open'\|'reviewing'\|'resolved',createdAt,resolvedAt?,resolution?}` | 只对原提交者返回可公开进度，隐去处理人员与第三方资料。证据和售后留存按发布政策 |
| OPS-01 `GET /v1/ops/content-reports` | `status?`、`cursor?`、`limit?`。返回举报对象引用、分类、状态及版本 | `reports:read`，按业务授权和数据范围查。默认不展开原文。访问敏感证据需独立权限和审计 |
| OPS-02 `POST /v1/ops/content-reports/{reportId}/resolve` | `{decision:'dismiss'\|'restrict_visibility', reasonCode, publicResolution?}`，`If-Match`、幂等键，返回已更新工单 | `reports:resolve`，检查允许的状态。隐藏内容时调用原内容模块 `ConversationService.restrictMessage`、`FeedService.restrictPost` 或 `SharedGoals.restrictContribution`，记录限制与工单决议，事件触发索引和缓存失效。若实际需要异步跨边界，先维持 `reviewing` 并记录任务，完成后才置 `resolved` |

`ClientEvent` 为 `{seq: string, kind: string, resourceType: string, resourceId: UUID, version?: number, occurredAt: string}`。`kind` 用已公布的客户端通知类型。只带资源变化或状态提示，读取内容走域接口。服务端保留窗口按运行配置，生产前验证游标重放与超窗。每账号投影游标在同一事务中串行分配，按可见提交顺序推进。多账号事件按接收者独立写投影，避免出现较小序号晚提交被跳过。

## 4. 模块和服务间接口

### 4.1 调用方式与权威数据

| 关系 | 接口形式 | 结果和约束 |
| --- | --- | --- |
| Android／iOS／鸿蒙等原生端及 Web → API | 域文档 REST + 公共 SSE，统一 DTO 和错误 | 用户状态以查询回读。调用真实能力时从现有演示适配层切换，客户端不推进正式账本或 AI 生成 |
| 账号／人物／素材 → 其他域 | 同进程 TypeScript 调用 `People.requirePerson(txOrDb, actor, personId)`、`Media.authorizeMediaUse(txOrDb, actor, {mediaId,purpose,target,expectedAuthorizationVersion?})`。初次绑定使用 `Media.bindUse(tx, actor, {mediaId,purpose,target})` | 返回同账号且当前可访问的对象快照与授权版本。公开投影及 Worker 仍执行相同业务授权规则 |
| 会话／回忆 → 邀请及动态 | 确认操作写原文与 `MemoryConfirmed.v1`。共创采纳调用 `Memories.confirmFromContribution(tx, ctx, {personId,goalId,contributionId,text,sourceAuthorizationVersion})` | 资格与回响各消费原事件，创建正式回忆及来源记录由回忆域负责。回响失败可以重试，原文仍可读 |
| 礼物／支付／邀请 → 资产 | 同进程账本命令。会话通过投递对象引用和回执投影显示 | 单一流水写入口。赠礼扣减与回执、奖励资格与发券、订单发放与入账分别在各自业务事务内完成 |
| API → Worker | `Jobs.enqueue(tx, {jobType, dedupeKey, payload, runAt?}) → jobId` | 受理记录和入队同事务。负载包含 ID、期望版本与关联号，正文由 Worker 按授权查询。长调用不持有数据库事务 |
| Worker → 域模块 | 带 `attemptId`、预期状态／授权版本和已验证结果的内部完成命令 | 启动时与写回前核对当前授权及任务代次。迟到、取消或已完成结果只做去重确认，不覆盖权威状态 |
| 域模块 → 客户端事件 | 写业务事件，投影为账户级 `ClientEvent` | 允许重复和短时延迟。更新依据版本和权威查询。公开链接的访客读取使用有限投影 |
| 运营 → 数据域 | 带独立角色和可审计理由的受限接口 | 通过领域命令处理审核、查单和删除状态，查询范围由运营权限控制 |

同进程调用使用最小数据输入，传入已验证的 `RequestContext` 或明确的 Worker actor 与目标对象。调用方不能通过改 `accountId` 代替授权。各模块禁止直接写对方表。只读投影也需标明数据来源与版本。涉及多账号的写入先按 UUID 排序取得账号锁，再进入对象和账本。需要同时持有多个对象锁的事务，按域约定统一顺序。赠礼在锁定账号、人物与会话后才锁资产批次。禁止在持锁事务中调用外部网络。可重试的数据库冲突沿用原操作键。认证槽的独立锁顺序、到期判定、按表状态与幂等边界见数据生命周期。 [数据生命周期与一致性](./backend-data-lifecycle.md)

### 4.2 外部适配接口

以下名字描述实现端口。字段由各域的实际接口定义，外部原生回调和网关协议保留平台要求。

| 端口 | 输入与输出 | 实现边界 |
| --- | --- | --- |
| `IdentityProvider.exchangeAuthorization`、`verifyAccessToken` | 受信 access token 或经校验的授权回调 → `VerifiedPrincipal {issuer,subject,authTime}` 及授权上下文 | 使用 Logto 支持的 OIDC 与 SDK。刷新、回调和撤销走身份服务。西界负责账号 ID 映射，登录页取消或切号未完成时维持原会话 |
| `ObjectStorage.createUploadSlot`、`inspectObjectVersion`、`promoteVerifiedObject`、`signRead`、`deleteIfRetained` | 服务端选定的对象键、校验约束、有效期或删除范围 → 短签名、校验结果或删除回执 | 上传到私有暂存键，确认时核验实际文件大小、类型和校验值。下载签发前重验授权。签名仍可能在到期前有效，即时撤权使用可控制的授权代理。 [S3 签名 URL](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html) |
| `GenerationProvider.generate`、`cancel` | 带 `jobId`、`attemptId`、任务类型、受控上下文、配额及输出约束 → 结构化结果或明确失败 | Worker 从授权对象提取所需文本，按已批准地区和提供方发送。区分取消、超时、限流和拒绝。外部结果只作为候选，提交前做内容、来源和授权验证 |
| `PaymentProvider.createAttempt`、`verifyCallback`、`queryTransaction`、`requestRefund`、`closeAttempt`、`queryRefund`、`querySettlement`、`finalizePurchase` | 已绑定订单与报价的尝试、原始回调或原渠道交易标识 → 规范化支付事实与查询状态 | 使用首发渠道官方 SDK／服务端 API。保留原始请求字节并按渠道协议检查签名或验证可信投递。确认并持久化受信通知后才按渠道协议确认接收。对账和发放按渠道事实及账本状态推进。必要的 Go 适配只处理通道协议 |
| `PushProvider.send` | `{deviceToken,eventId,templateId}` → `{providerMessageId?}` 或可重试／失效标识 | 系统推送是提示。仅传必要事件引用，点击后经鉴权读站内消息。失效设备令牌清理并记录 |
| `RtcProvider.createGrant`、`closeSession` | 已授权房间、参与者与短时权限 → LiveKit 入房令牌或关闭结果 | X01 按需。业务服务负责房间归属、授权和结束状态，实时媒体由原生 SDK 与 RTC 服务传输 |

#### 4.2.1 开源项目、接口和西界的实现边界

当前仓库的实际运行依赖包括 React 19、Tailwind CSS 4、Vite 8、Three.js、Phosphor Icons 和随 Android 宿主维护的 Capacitor 8.5.2。登录和购买仍由原型适配层驱动，`frontend/preview-server/` 的礼物、邀请、接力接在 Vite 预览中。下表属于后端选型及接口核对，状态均为候选或待接入。 [依赖锁定](../pnpm-lock.yaml) · [Android 宿主来源](../mobile/sources.json) · [预览服务](../vite.config.ts)

| 批次与项目 | 直接复用的能力和接口 | 西界实现与验收 |
| --- | --- | --- |
| K01 · **NestJS**（MIT） | `@nestjs/common` 的模块、控制器、Guard、`ValidationPipe({whitelist:true,forbidNonWhitelisted:true})`、异常过滤器。`@nestjs/swagger` 的 `SwaggerModule.createDocument` 从路由及 DTO 生成 OpenAPI。 [许可证](https://github.com/nestjs/nest/blob/master/LICENSE) · [DTO 校验](https://docs.nestjs.com/techniques/validation) · [OpenAPI](https://docs.nestjs.com/openapi/introduction) | 控制器统一暴露 `/v1`。Guard 验证会话，域方法再检查资源归属。西界定义业务 DTO、错误、幂等与版本条件。构建时核对生成的契约，验收未知字段和账号越权会被拒绝 |
| K01 · **Logto OSS**（MPL-2.0） | 复用托管登录页、OIDC 授权码与 PKCE、短信验证码和连接器。Web BFF 可用 `openid-client` 的 `discovery`、`buildAuthorizationUrl`、`authorizationCodeGrant` 和 `refreshTokenGrant` 对接授权、换码和刷新。原生优先验证 `@logto/capacitor` 的 `signIn`、`getAccessToken(apiResource)`、`signOut`。API 从 discovery 取 `jwks_uri` 并验证 JWT 的签名、签发方、受众、期限和 scope。 [OSS 能力](https://docs.logto.io/logto-oss) · [OIDC SDK 接口](https://github.com/panva/openid-client/blob/main/docs/README.md) · [原生接入](https://docs.logto.io/quick-starts/capacitor-js) · [验令牌](https://docs.logto.io/authorization/validate-access-tokens) | `IAM-01–06` 映射西界 UUID 与设备会话。首次接入一个实际短信服务商，Logto 负责验证码流程，服务商负责投递。切号和重新验证用受信 `auth_time` 与当前尝试校验，刷新令牌的 `iat` 不作重新验证凭据。Web Cookie 仅持西界会话凭据。原生适配先验证安全存储、当前 Capacitor 版本和取消回跳。 [短信连接器](https://docs.logto.io/connectors/sms-connectors) · [认证上下文](https://docs.logto.io/end-user-flows/step-up-authentication) |
| K01–K05 · **PostgreSQL**（PostgreSQL License） | 用事务、唯一约束、`INSERT … ON CONFLICT`、`SELECT … FOR UPDATE` 承载账号、原文、消息、幂等和账本。`CREATE POLICY` 可加租户防护，普通运行角色及事务内租户上下文分别验证。K04 可用 `pg_trgm` 的 `gin_trgm_ops`、`similarity` 或 `ILIKE` 做候选索引。K05 用 WAL 归档及恢复机制。 [许可证](https://www.postgresql.org/about/licence/) · [唯一约束](https://www.postgresql.org/docs/current/ddl-constraints.html) · [行级策略](https://www.postgresql.org/docs/current/ddl-rowsecurity.html) · [pg_trgm](https://www.postgresql.org/docs/current/pgtrgm.html) · [备份恢复](https://www.postgresql.org/docs/current/continuous-archiving.html) | 西界定义数据模型、跨对象授权和状态机。`FIND-01` 先裁剪账号和权限再匹配，检索结果必须能打开权威原文。用短中文姓名、繁简、英文和撤权样本验证实际召回，再决定索引。恢复备份后复核删除及撤权记录 |
| K02 起 · **pg-boss**（MIT） | `start`、`createQueue`、`send`、`work`、`stop`。使用 `send(queue, payload, {id, db, startAfter})` 将 `db.executeSql` 绑定到业务 `BEGIN/COMMIT` 的同一连接，`startAfter` 仅在延迟任务设置。队列配置重试、过期和死信。 [运行要求与许可证](https://github.com/timgit/pg-boss) · [事务入队](https://github.com/timgit/pg-boss/blob/master/docs/api/jobs.md) · [Worker](https://github.com/timgit/pg-boss/blob/master/docs/api/workers.md) | `Jobs.enqueue` 是唯一内部入口。`CHAT-06`、素材校验、回信、补单复用。检查队列返回结果，并以业务操作键和结果唯一键防重。异常中断时回读权威状态。验证事务回滚后没有任务、Worker 崩溃后结果只落一次。锁定版本前核对 Node、数据库兼容和重试间隔 |
| K02 · **AWS SDK for JavaScript v3**（Apache-2.0）与 S3 兼容存储 | `@aws-sdk/client-s3`、`@aws-sdk/s3-request-presigner`。上传槽用 `getSignedUrl` + `PutObjectCommand`，验收用 `HeadObjectCommand` 取大小和版本，扫描读取固定版本。发布保留不可变版本或用 `CopyObjectCommand` 复制已核验版本到服务端专用键。下载按用途用签名 `GetObjectCommand` 或授权流，删除在保留检查后按版本用 `DeleteObjectCommand`。 [SDK 与许可证](https://github.com/aws/aws-sdk-js-v3) · [签名 SDK](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-s3-request-presigner/) · [复制对象](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/s3/command/CopyObjectCommand/) | `MED-01/02/04/06/07` 归媒体域。**SeaweedFS**（Apache-2.0）作为自托管候选，与同区托管 S3 服务复用同一适配。先用选定版本测匿名读写拒绝、签名、CORS、覆盖竞争、按版本清理及撤权。旧上传 URL 即使仍有效，也不能替换已校验成品。要求即时撤权的场景经西界授权代理。 [SeaweedFS 许可证](https://github.com/seaweedfs/seaweedfs/blob/master/LICENSE) · [S3 兼容表](https://github.com/seaweedfs/seaweedfs/wiki/Amazon-S3-API) |
| K03 · **AI SDK Core**（Apache-2.0） | `generateText` 生成文本，`generateText` + `Output.object({schema})` 产出回忆候选或结构化字段，按需用 `streamText` 展示进度，`abortSignal` 传中断。显式传所选提供方的模型实例。 [许可证](https://github.com/vercel/ai/blob/main/LICENSE) · [结构化生成](https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data) · [取消与超时](https://ai-sdk.dev/docs/ai-sdk-core/settings) | `GenerationProvider` 只负责模型调用。真实模型及其服务条款、成本和区域待验证。西界负责授权上下文、来源、用户确认与去重落库。模型流和 `/v1/events/stream` 的持久业务事件各自处理。验证格式错误、超时、取消和授权撤回后迟到结果无法写回 |
| V01／K05 · **Caddy**、**Docker Compose**、**OpenTelemetry**（Apache-2.0） | Caddy 用自动 HTTPS 和 `reverse_proxy`，代理 `/v1`、SSE 及渠道回调。Compose 用 `compose.yaml` 配置 API、Worker、身份服务及健康检查。OpenTelemetry Node SDK 初始化后通过 OTLP 端点输出受控追踪和指标。 [Caddy 许可证](https://github.com/caddyserver/caddy/blob/master/LICENSE) · [SSE 反代](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy) · [Compose 许可证](https://github.com/docker/compose/blob/main/LICENSE) · [OTel JS 许可证](https://github.com/open-telemetry/opentelemetry-js/blob/main/LICENSE) · [OTLP 配置](https://opentelemetry.io/docs/languages/sdk-configuration/otlp-exporter/) | 首发可以用同等托管入口或观测接收端。验 SSE 断线续传、回调原始请求体、重启后任务恢复及敏感字段脱敏。开发与生产环境分别隔离密钥。Compose 只负责部署编排，告警、留存与备份由西界配置 |

对象存储的 `ETag` 只用于相应的版本或条件检查，素材摘要由服务端按约定校验。存储版本与业务资源 ID 分开保存。队列以稳定业务任务 ID 关联，SDK 只在各自适配层调用。当前阶段以实际候选版本的说明和验证记录为准。 [S3 对象完整性](https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity-upload.html)

#### 4.2.2 身份、实时通信及外部服务的启用条件

- **Logto 的原生与自定义页面**。官方 Capacitor 示例基于 5.0.6。当前上游 SDK 默认通过 `@capacitor/preferences` 持久化凭据，须验证替换为 Android Keystore／iOS Keychain 支持的存储，或改用受支持的原生 SDK、服务端 OIDC 回程。Logto 1.46.0 的发布记录列出 `max_age` 和签名 `auth_time` 等能力。切换账号验证 `prompt=login` 的行为。敏感操作重新验证使用 `acr_values` 与 `max_age` 并要求同一 `sub`。签名 `auth_time` 用于核对新鲜度，本次授权尝试还须用受信 `state`／`nonce` 或一次性设备绑定凭据防重放。SDK 的 `signIn` 默认会清除旧凭据。切换尝试应使用独立的安全存储命名空间，等 IAM-03 成功后再激活，取消时保留原会话。西界退出撤销当前设备应用会话，身份提供方 `signOut()` 的 SSO 退出按明确意图使用。默认采用 Logto 托管认证页，保留西界自己的登录入口、切号、取消和返回页。完整替换 Logto 托管 UI 的 Bring your UI 需对应许可，维护体验页源码分支也有升级成本。若必须完全自定义且 Logto 方案不适配，再验证 Better Auth 的 `phoneNumber` 插件及 `sendOTP` 投递回调，同时独立验证原生会话和回跳。 [Better Auth 短信插件](https://better-auth.com/docs/plugins/phone-number) [Capacitor 示例](https://docs.logto.io/quick-starts/capacitor-js) · [Capacitor SDK 源码](https://github.com/logto-io/js/blob/master/packages/capacitor/src/index.ts) · [近期认证](https://docs.logto.io/end-user-flows/step-up-authentication) · [v1.46.0 发布记录](https://github.com/logto-io/logto/releases/tag/v1.46.0) · [Logto OSS 功能限制](https://docs.logto.io/logto-oss)
- **账号设置与注销**。已启用的换绑路径优先验证 Logto Account Center 或用户态 Account API。`GET /api/my-account` 获取可见账号资料，`/api/my-account/primary-phone` 和 `/api/my-account/identities` 的写操作需要对应权限和证明。服务端删除身份用受限的机器账号访问 Management API `DELETE /api/users/{userId}`，在西界应用会话及访问已撤销后由后台执行。微信 Native 官方示例依赖原生 Logto SDK、腾讯 OpenSDK 与原生回跳，应按签名包另行验证。 [Account API](https://docs.logto.io/end-user-flows/account-settings/by-account-api) · [Management API](https://docs.logto.io/end-user-flows/account-settings/by-management-api) · [微信 Native](https://docs.logto.io/integrations/wechat-native)
- **LiveKit Server 与 Agents Node**（Apache-2.0，X01）。`RtcProvider.createGrant` 用 `AccessToken` → `addGrant({roomJoin:true,room,…})` → `toJwt`，仅授指定房间和媒体权限。房间由 `RoomServiceClient` 创建、删除或移除参与者。Node Agent 用 `defineAgent`、`ctx.connect()`、`AgentSession.start(...)`，需要时用 `AgentDispatchClient.createDispatch` 定向派发。服务端 Webhook 用 `WebhookReceiver.receive` 校验原始请求与签名。用 `participant_joined`、`participant_left`、`room_finished` 辅助校准通话状态，事件按幂等规则处理。端侧用目标端 SDK 或经真机验证的宿主桥。自托管旧令牌在移除参与者后可能仍可用。发短时令牌、停止补签、结束房间并停止 Agent。重开使用新房间 ID，Agent 派发和加入时检查通话仍有效。在目标端测试旧 JWT 重连是否仍能接触媒体或启动 Agent。STT、TTS、模型和数字人视频能力各自验证。 [Server 源码](https://github.com/livekit/livekit) · [Agents Node 源码](https://github.com/livekit/agents-js) · [服务端 SDK](https://docs.livekit.io/reference/server-sdk-js/) · [Agent 派发](https://docs.livekit.io/agents/server/agent-dispatch/) · [媒体事件](https://docs.livekit.io/intro/basics/rooms-participants-tracks/webhooks-events/) · [自托管令牌限制](https://docs.livekit.io/frontends/reference/tokens-grants/#self-hosted-deployments)
- **聊天、消息和系统推送**。首期私聊、小聚与书信用 PostgreSQL、pg-boss 和西界会话接口。跨账号真人 IM 到 X01 再选型。系统推送通过 `PushProvider.send` 按发行端对接 APNs `POST /3/device/{deviceToken}`、FCM `POST /v1/projects/{projectId}/messages:send` 或目标发行端启用的官方服务。设备令牌按提供方、应用与环境标识并绑定到西界账号，退出或切号时解除旧绑定。推送只携带可鉴权回读的事件引用，客户端也可经 SYS-02／SYS-03 和业务详情读取同一条消息。 [APNs](https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns) · [FCM HTTP v1](https://firebase.google.com/docs/cloud-messaging/send/v1-api)
- **支付**。开源 SDK 或移动端桥负责协议、签名与唤起，收单、商店验单和退款由实际渠道服务提供。正式支付只接已验证的一个发行渠道和商品。每个渠道的 SDK、查询、回调和退款映射见交易文档。 [支付渠道接口映射](./backend-api/assets-commerce.md#渠道官方接口映射)

#### 4.2.3 接入确认顺序

V01 用目标 Android 宿主和 Web 分别验证登录回跳、A 切 B、取消、旧凭据及过期会话。并行用合成照片验证签名上传、同一暂存键被重传或覆盖时仍读取已校验版本、跨账号读不到、即时撤权后授权流失效。随后做一条真实模型调用，验证内容回读、取消、结构化输出和授权检查。数据库与队列先注入事务回滚和 Worker 中断。V02 仅用候选渠道沙箱验证下单、待付款、重复回调、主动查询、发放后确认及退款。组件选定后在实际依赖与部署配置锁版本，记录接口证据及未通过项。本文基于项目代码、上游源码和官方文档，实际端、部署和沙箱结果另按验收记录确认。

### 4.3 事件、任务与事务

~~~ts
type DomainEvent<T> = {
  eventId: UUID
  type: string
  accountId: UUID | null
  aggregateType: string
  aggregateId: UUID
  aggregateVersion: number
  occurredAt: string
  requestId: string
  payload: T
}
~~~

- 业务写入与需要对外消费的事件写入同一数据库事务。账号安全事件的高版本覆盖低版本，禁止用事件重放复活已撤权对象。直接执行的后台命令用同事务 pg-boss 入队。领域事件由 outbox 调度到各消费者，调度键为 `eventId + consumer`。同一副作用只选择一条触发路径。
- 消费者按 `eventId + consumer` 记录处理结果，并结合业务唯一键做幂等。用事实查询和状态转换处理乱序。数据库副作用与消费记录同事务提交。外部调用用稳定的尝试标识、主动查询和重试补偿。
- 负载保留最少的引用和状态。敏感原文、验证码、交易凭证和签名 URL 不放进普通事件、推送、日志或错误体。失败重试可查，死信进入受控重放。旧任务执行前须校验对象、版本、权限和执行窗口。

| 关键事件 | 生产方和负载 | 消费及作用 |
| --- | --- | --- |
| `AccountRegistered.v1` | 账号域。`{accountId, registeredAt, referralAttributionId?: UUID}`，仅正式新账号 | 邀请核对新注册归因。邀请凭据先在账号验证链路消耗，事件只带归因引用 |
| `AccountAccessRevoked.v1` | 账号域。`{accountId, accessVersion, reason:'account_deletion'\|'account_restricted', revokedAt}` | Worker、签名访问和会话失效，按版本停止新任务。普通设备退出只撤对应会话 |
| `PersonConfirmed.v1`、`PersonWorldChanged.v1`、`PersonAccessRevoked.v1` | 人物域。以领域文档为权威，保留同一 `personId` | 会话和搜索投影更新，迁居保留旧消息及寄件快照，移除后拒绝新访问及生成写回 |
| `MediaReady.v1`、`MediaUseRevoked.v1` | 媒体域。以领域文档为权威，负载用媒体 ID、状态和授权版本 | 更新资料、任务依赖与索引。启动和写回重新鉴权 |
| `MessageAccepted.v1`、`ReplyCommitted.v1` | 会话域。分别为 `{conversationId,messageId,acceptedAt}` 和 `{conversationId,messageId,replyToMessageId,jobId,committedAt}` | 会话列表、检索和前台增量。生成执行由已受理任务驱动 |
| `MemoryConfirmed.v1` | 回忆域。`{memoryId, personId, confirmedAt, origin, qualifiesForReferral}` | 回响、检索和邀请资格分别消费。邀请复核权威记录。导入、样例和不合格来源不发奖 |
| `MemoryRemoved.v1` | 回忆域。`{memoryId,personId,removedAt}`，版本在事件信封 | 撤回索引与派生视图，并停止后续使用被移除原文 |
| 赠礼、邀请、交易和权益事件 | 交易域文档定义事件名和字段 | 站内消息、投递与资产视图、支付对账。展示层只读投影 |

### 4.4 四条跨域实现顺序

1. **新账号与切换**　验证真实身份 → 查唯一 `issuer + subject` → 新账号在业务库创建 `accountId` 和归因记录并发布注册事件 → 按已验证会话返回账号 → 客户端切换命名空间、重新读取。已有账号恢复与身份绑定复用原 `accountId`。
2. **消息、生成与原文**　校验人物及会话 → 同事务保存用户消息与生成任务 → Worker 重新加载授权素材 → 模型候选完成后检查尝试版本和授权，再写正式消息 → 用户确认后保存回忆和来源 → 搜索与动态各自读回。若回响或索引暂不可用，用户仍可通过回忆详情读原文。
3. **正式付款与权益**　订单保存报价及原账号 → 服务端发起渠道尝试 → 接收和验证回调或主动查单 → 以渠道唯一交易确认已付款并入队 → 账本事务写唯一权益分录、发放状态与通知。不同外部交易命中同一订单时只给一份权益，其他付款走对账与退款。
4. **首次回忆与邀请**　确认新注册归因 → 保存首条满足活动规则的真实原文 → 消费事实核对两个条件 → 同事务给双方分别写唯一奖励 → 通知从已入账事件派生。异步到达顺序不会改变资格，导入或示例不能自动计入。

## 5. 持久化、兼容与交付验收

| 领域 | 一致性和迁移约束 |
| --- | --- |
| 权威表与派生表 | 账号、人物、用户原文、消息、寄件、订单和权益各自有权威记录。检索、会话摘要、回响与通知内容可重建。通知的用户已读时间单独保留。允许必要的历史快照，引用标明来源及版本 |
| 主键和约束 | 业务外键或查询同时约束 `account_id`。外部身份、客户端消息键、单笔权益、奖励、贡献位置等用符合业务范围的唯一约束。列表索引包含归属与排序字段 |
| 旧数据 | 预览保留独立运行边界。正式导入仅由验证账号和显式确认触发，映射来源、旧 ID 与目标账号。预览手机号、匿名标识、试用余额、模拟订单和奖励与生产权威数据分开 |
| 权限撤回与备份 | 删除或撤权先阻断新访问与迟到写入，再按数据类型清理原件和投影。备份恢复后重放注销与授权撤销记录，再启用访问。历史账务在受控范围按留存与售后规则处理 |
| 客户端兼容 | `/v1` 路径和既有字段语义保持稳定。新增可选字段优先，新的互斥状态先做能力协商。变更时同步域规范、OpenAPI、客户端适配和回归验证 |

### 5.1 现有前端切换点

| 当前前端位置 | 联调时替换成 | 回归重点 |
| --- | --- | --- |
| `frontend/src/auth/preview.ts`、`frontend/src/shell.tsx` | 身份域的登录尝试、OIDC、会话和账号接口 | 真实授权结果驱动过渡。取消返回当前账号，过期回原入口，旧回调不可抢回活动会话 |
| `frontend/src/App.tsx`、`frontend/src/model.ts` 与人物流程 | 账号归属的远程人物、媒体、会话与回忆接口，本机只保存明确允许的草稿与缓存 | 逐域迁移而非一次覆盖。旧本机资料待用户确认，换设备可以从权威记录恢复 |
| `frontend/src/person.tsx`、星图和空间 | 消息命令、任务状态、公共事件流、真实回忆与检索查询 | 消息受理和 AI 回复分开。链接用权威 ID，搜索命中须能读回实际原文。生成和推荐保留来源区分 |
| `frontend/src/gifts/client.ts`、`frontend/src/gifts/store.ts`、公开路径 | 礼物、资产、公开贡献及邀请接口，旧预览路由保持独立 | 相同投递在资产与会话使用同一 ID。邀请资格以注册与合格记忆事件判断 |
| `frontend/src/commerce/preview.ts`、购买页面 | 渠道报价、订单、支付尝试、查询及退款接口 | 支付回跳后查同一订单。前端刷新只读权威状态，取消或切号不改变订单所属账号 |

每个新接入的页面按「本地演示」「已接服务但能力关闭」「正式启用」区分配置，后台开关和前端入口同步验收。

### 5.2 联调验收与变更

**第一张端到端联调工单**。用合成资料按 IAM-01 → IAM-02／IAM-03 → PER-01／PER-05–07 → CHAT-02／CHAT-06 → GEN-01／CHAT-04 → MEM-03 → FIND-01／MEM-05 串通。Web 与原生选择对应的授权回程。两台设备最终打开同一 (personId, memoryId)，读取同一用户确认原文。具体接口定义见 [账号与人物](./backend-api/identity-people.md) 和 [会话与回忆](./backend-api/conversations-memories.md)。

| 批次 | 输入或故障注入 | 可核对的通过条件 |
| --- | --- | --- |
| K01 | A 账号开启事件流后切换为 B，再回放 A 的迟到响应、游标和旧私有对象 ID | B 的界面和 API 都无 A 的数据。以 B 访问 A 的对象返回 404。取消切换保留 A |
| K02–K03 | 人物确认和消息提交成功后断开连接。两次并发重放原请求，生成时终止一次 Worker | 一个草稿只对应一个人物。同一客户端消息 ID 只对应一条用户消息和一个生成任务。恢复后同一回复槽只出现一条正式回复 |
| K04–K05 | 设备 1 确认回忆，设备 2 搜索并读回。随后撤回素材许可或移除原文，再使用旧链接或恢复旧任务 | 读回同一用户原文。撤权后停止使用相关素材，移除后的旧原文详情返回 404，迟到任务无法重新发布。备份恢复按撤权记录复核后才开流量 |
| R02 | 两台设备同时用最后一张基础券，成功提交后丢失应答 | 只有一笔扣减和一个对应回执。重放成功请求返回原回执，余额不为负 |
| M01 | 重复及乱序回调，已扣款时关 App，发放后退款。另模拟两个有效外部交易命中同一订单 | 原账号可查回权威状态。同一订单只有一份权益和一笔发放流水。第二笔交易进入对账，退款可追溯到原分录 |
| M02–M03 | 颠倒注册和回忆事件消费顺序，重放邀请事件，并发争抢最后一个公开席位，撤回链接后再读 | 合格邀请双方各发一次，旧用户和导入回忆零发放。席位只成功一次，撤回后公开投影失效 |

**变更交接**。新增接口先登记操作、所属域、优先级、主数据、调用者、失败恢复和相关契约。实现时用生成的 OpenAPI 对照域文档，以真实入口做授权、重放、并发、恢复和兼容性验证。验收至少检查实际请求与 DTO、状态迁移是否可达、数据库约束能否拒绝并发反例，以及所有消费者是否使用同一事件版本。当前交付为规范草案，正式路由、数据库迁移和外部渠道尚待实现与验证。

### 5.3 PostgreSQL 数据结构草案

本节规定首期可交给迁移开发的表、主键、关系及不变量。会话槽与物理表名为本次设计取舍。接口字段和状态值沿用[账号、人物与素材](./backend-api/identity-people.md)、[会话与回忆](./backend-api/conversations-memories.md)、[礼物与交易](./backend-api/assets-commerce.md)。表名是设计约定。下文省略各接口已列明的普通展示字段、默认值和部分审计列。扩展批次只先约定与现有表的连接及关键约束。项目当前原型依靠端侧存储和 Vite 中间件，以下草案仍需转成迁移并在数据库联调环境执行验证。 [前端存储](../frontend/src/model.ts) · [交付批次](./backend-delivery-priorities.md)

#### 5.3.1 数据库共用规则

- **归属与主键**。西界业务 ID 用 `uuid`，对外继续用字符串。私有表的 `account_id` 必填且引用 `accounts.id`。跨私有表的外键带上账号，例如 `(account_id, person_id) → persons(account_id, id)`。引用方列按需要设为非空，被引用方需具有同列顺序的普通唯一键。涉及双方账号的邀请显式使用 `inviter_account_id` 和 `invitee_account_id`。公共世界和已发布目录单独查可见性。外键守住数据关联，读写仍须核对会话及对象授权。 [PostgreSQL 外键](https://www.postgresql.org/docs/current/ddl-constraints.html#DDL-CONSTRAINTS-FK)
- **字段与版本**。时间点用 `timestamptz` 并在 API 转 UTC。金额为最小货币单位整数与币种，邮资和券为独立整数。消息及账号增量序号用 `bigint`，API 传十进制字符串。`version` 保护资源更新，`access_version` 和 `authorization_version` 分别保护访问与用途。核心关联和状态用类型列、外键、唯一键与检查约束，JSON 只存配置、不可变快照或无权威写入的结构化结果。
- **历史与撤权**。账号或人物先更新访问状态和版本，查询、签发链接和 Worker 写回即时按该状态校验。按数据分类清理正文、媒体及投影，账务和必要售后沿原订单保留受控引用。跨域表删除由所属模块显式处理。重放会话、回调或任务以当前授权、原操作 ID 和事务去重为准。

#### 5.3.2 首期表与关键约束

| 批次与表 | 关键列与关系 | 必须守住的约束 |
| --- | --- | --- |
| K01 `accounts`、`auth_identities` | 账号 `id, registration_id, status, registered_at, version, access_version, memory_confirmation_seq`。登录身份 `id, account_id, issuer, subject, status, verified_at` | `registration_id` 唯一。`(issuer, subject)` 全局唯一。首次建号、身份映射、会话与注册事件同事务。换绑和找回沿用 `account_id`。同一 Logto 主体可已有多个登录方式，西界按已验证主体映射。手机号、邮箱、昵称和本机 ID 不作为私域数据的主键或自动合并依据 |
| K01 `app_session_slots`、`auth_attempts`、`app_sessions` | 设备或浏览器会话槽使用服务端签发的绑定证明与 `generation`。尝试 `id, slot_id, client_registration_key, purpose, initiating_session_id?, invitation_intent_id?, proof_hash, expected_generation, state, expires_at`。会话 `id, slot_id, client_registration_key, account_id, auth_identity_id, auth_attempt_id, status, account_access_version, authenticated_at, expires_at` | 会话和身份使用同账号外键。每个尝试最多创建一个会话，每槽最多一条活动会话。新授权尝试推进该槽的尝试代次。完成时先锁槽，复核代次、发起会话与尝试，再撤旧启新。取消不替换会话，普通退出只影响本槽。服务端分别验证槽证明、应用会话和身份凭据 |
| K01 `policy_versions`、`consent_events`、`current_consents` | 政策版本保留 `id, kind, version, locale`。用途授权以 `(account_id,purpose)` 保存当前结论及 `authorization_version`，历史事件含当时政策、决定和版本 | 历史按 `(account_id,purpose,authorization_version)` 唯一。历史追加与当前授权更新同事务。授权与登录状态分别保存，撤回只使相关用途失效 |
| K02 `worlds`、`person_drafts`、`person_previews`、`persons` | 世界 `id,code,catalog_version,enabled`。草稿和预览保存 `account_id`、状态及版本。正式人物 `id,account_id,source_draft_id?,world_id,status,access_version,version` | `worlds.code` 唯一。预览归同账号同草稿，确认时比较草稿版本。`(account_id,source_draft_id)` 在有来源时唯一。正式人物持有草稿来源，草稿确认结果从关系读回。迁居只更新正式人物的 `world_id` |
| K02 `media_objects`、`media_upload_slots`、`person_draft_media`、`person_media_links`、`media_use_grants` | 媒体 `id,account_id,purpose,status,byte_size,sha256?,verified_storage_ref?,authorization_version`。上传槽 `id,account_id,media_id,staging_key,state,expires_at`。素材关联保存账号、媒体、所属目标及展示顺序。用途授权按媒体、目标、用途及版本保存 | 草稿、人物与素材分别使用同账号外键。暂存键唯一，每项素材至多一个当前上传槽。关联及用途授权各用自己的活动唯一键。资料关联表示素材归属，模型是否能使用须查 `ai_context` 授权。已绑定目标在首期以明确的草稿或人物外键表达，后续随用途启用新目标。`ready` 必须有已核验的不可变对象引用，旧上传槽不能改变该引用。前端列表里的 `mediaIds` 由关联读出 |
| K03 `conversations`、`messages` | 会话 `id,account_id,kind,person_id?,world_id?,last_sequence,version`。消息 `id,account_id,conversation_id,sequence,kind,client_message_id?,reply_to_message_id?,speaker_person_id?,version` | `direct` 只绑定人物，`gather` 到 R01 才启用且只绑定世界。分别对 `(account_id,person_id)` 和 `(account_id,world_id)` 做有条件唯一约束。消息序号按会话串行递增，`(account_id,conversation_id,sequence)` 唯一。回复引用必须指向同会话消息。每个会话内同一 `client_message_id` 只受理一次 |
| K03–K04 `generation_jobs` | `id,account_id,kind,state,dispatch_id,dispatch_generation,attempt_id?,version`，另存所属用例的来源引用、已接受授权版本及结果引用。首期聊天回复用 `source_message_id`，后续按任务类型扩展 | 同一原始用户消息仅一个聊天任务。业务重试复用任务 ID。入队未受理时按原事务失败处理。重新入队时生成新的队列 `dispatch_id` 并递增派发代次，Worker 每次领取更新 `attempt_id`。同一原消息在私聊最多一个正式回复，在小聚每个角色最多一个。锁任务并核对当前尝试、来源版本和授权后才可写回。队列记录只负责调度 |
| K04 `memory_candidates`、`memories` | 候选 `id,account_id,person_id,source_message_id,state,expires_at,version`。原文 `id,account_id,person_id,client_memory_id?,candidate_id?,origin,title,body,confirmed_at,original_created_at?,removed_at?,version` | 回忆与人物同账号。由候选确认时用同账号、同人物外键并校验源消息。源消息撤回使候选不可用，已确认原文仍按其自身授权，读取时隐藏失效来源。同一源消息版本只保留一个当前候选，过期在锁源记录后转状态并可再生成。一条候选只对应一条正式原文，`(account_id,person_id,client_memory_id)` 对有客户端 ID 的写入唯一。修订保留原 `id` 和首次确认时间。候选与回响均不改写原文 |
| K05 `data_requests`、`import_batches`、`import_item_map` | 权利申请保存 `id,account_id,kind,status`、期限及必要结果引用。导入保存已确认来源空间、批次与文件摘要。对象映射保存类型、旧父级范围及旧 ID、新 ID 和处理结果 | 同账号同来源同摘要复用批次，映射按 `(account_id,source_namespace,object_type,legacy_scope,legacy_id)` 唯一，根级也使用明确范围值。先确认来源归属，再依序导入人物、素材、会话及回忆。来自同源的新版文件沿用映射。预览凭据、余额、支付及奖励不导入 |
| 通用 `idempotency_records`、`outbox_events`、`event_consumptions`、`account_event_cursors`、`account_events` | 记录操作作用域、请求指纹、结果引用和到期时间。Outbox 保存事件信封及发布时间。账号投影用 `account_id,sequence,domain_event_id` 和资源版本 | 同一幂等作用域和键只占一次。域变更、结果与 outbox 同事务。消费去重键 `(event_id,consumer)`。按账号锁游标后分配事件序号，同事务写投影，防止小序号晚提交被跳过。同源事件对同接收者及同资源投影只生成一次。公告等全局来源在发布时明确收件范围 |

已确认关系决定 `onboardingState`，应用会话决定能否访问。游客首期只浏览样例，可按产品方案在设备上保留未提交草稿。游客、本机预览标识和登录尝试都不创建 `accounts` 或奖励资格。游客完成真实验证后，需保存的草稿以已验证账号显式确认并提交。登录方式由首发渠道验证决定，账号、身份、会话和业务资料的关联在各方式间共用。Logto 管理验证码、密码和通行密钥等凭证。换绑能力启用后，`identity_operations` 只保存操作、归属、状态、时限和提供方确认引用。验证成功后更新身份映射并沿用原账号，换绑或解除后保留至少一种可用登录方式。

有效上传槽、当前候选及活跃支付尝试可按明确状态建立部分唯一索引。到期时间由事务检查并推进状态，索引谓词使用稳定字段。 [PostgreSQL 部分索引](https://www.postgresql.org/docs/current/indexes-partial.html)

首期索引从实际入口出发。人物列表按 `(account_id,world_id,updated_at,id)`，会话列表按账号和最近活动时间加稳定 ID 排序，时间线按 `(account_id,conversation_id,sequence)`，人物下回忆按 `(account_id,person_id,confirmed_at,id)`，账号事件按 `(account_id,sequence)`，并为实际清理路径和常用外键加索引。列表和搜索先按账号、有效对象和用途过滤。星图检索回读 `memories` 原文。检索投影和中文文本索引按查询样本实测后启用。派生检索返回片段前重新核对原文可见性和来源版本，旧版本跳过或重算。

#### 5.3.3 扩展批次接续约束

| 批次 | 表组与权威来源 | 关键关系与约束 |
| --- | --- | --- |
| R01 复访与私人空间 | `letters`、`letter_replies`、`posts`、`post_comments`、`post_reactions`。通知和小聚使用现有账号、人物、世界和会话 | 同账号同封信只有一个回信。点赞按动态和实际主体唯一。回忆回响按 `(account_id,source_memory_id)` 唯一并携带源版本。动态到回忆原文使用外键，撤回后清除派生展示。图片消息保存明确媒体引用，删除单条消息只解绑该条引用，其他合法消息仍可访问自己的附件 |
| R02 礼物和资产 | `asset_lots`、`ledger_transactions`、`ledger_entries`、`gift_deliveries`、`received_gifts`、`notifications` | 账本 `(account_id,reason,source_id)` 唯一，分录数量为正、批次可用量非负。锁定批次后原子写扣减、发件及任务。礼物人物和会话须对应同一条私聊。礼物卡引用同一投递 ID，回礼按 `source_delivery_id` 去重。通知按账号、类型、源事件去重，保留用户 `read_at` |
| M01 支付 | `products`、`quotes`、`orders`、`payment_attempts`、`channel_transactions`、`fulfillments`、`refunds`、`payment_callback_inbox`、`payment_reconciliation_cases` | 报价只能生成一个同账号订单，每个订单至多一笔未终结尝试。渠道交易 `(channel,environment,external_transaction_id)` 唯一。同渠道单商户下用文档约定的交易键，商户命名空间以实际渠道验证为准。一个订单只有一个胜出交易和一条发放记录，无法定位订单的已验交易先保存事实并进入对账。额外真实扣款进入对账，退款单独关联原交易与冲正。原账号归属与商品快照在下单后固定 |
| M02 邀请 | `referral_links`、`invitation_intents`、`referral_attributions`、`ledger_transactions` | 邀请意图在验证回程绑定到唯一新 `registration_id`。`invitee_account_id` 唯一且与邀请人不同。`(invitee_account_id,registration_id)` 必须匹配正式注册。合格回忆必须属于受邀账号，保留资格证据引用与规则版本。发奖使用归因 ID 作为账本 `source_id`，按受益账号、奖励事由和来源唯一，两边在同事务提交。游客、导入和样例不触发发奖 |
| M03 共创 | `shared_goals`、`goal_contributions`、`goal_reward_claims`、公开投影 | 公共链接只映射有限投影。每个目标的参与主体唯一，席位非空时按 `(goal_id,seat)` 唯一。撤回后是否释放按活动版本决定，保留的席位仍占用唯一键。批准、占位、累计和授权同事务。采纳按 `(account_id,person_id,goal_id,contribution_id)` 去重写 `memories`，领取按贡献和真实账号去重 |

X01 及其它按需表在功能和外部能力确定后补列定义及迁移。逐表时间、状态、幂等键与锁序见数据生命周期。完整 DDL、索引执行计划、数据保留期限和备份恢复演练仍有各自验收项。 [逐表写入规则](./backend-data-lifecycle.md)渠道和活动参数保留版本化配置，沿用各领域的状态和字段语义。

#### 5.3.4 迁移与首批数据库验收

迁移按 K01 账号与授权 → K02 世界、人物与媒体 → K03 会话、消息与任务 → K04 回忆与检索 → K05 数据权利、导入与恢复推进。扩展批次先添加关系及约束，再启用业务写入。首期 `invitation_intent_id` 等后续引用随相应批次迁移，避免首个登录功能依赖活动模块已经上线。

| 数据库验收样例 | 可以观察的结果 |
| --- | --- |
| 用 A 的会话外键提交 B 的人物或素材。B 直接查询 A 的资源 | 同账号外键阻止错挂。API 查不到他人资料，索引也不返回私有内容 |
| 同一 `issuer + subject` 同时首次授权。取消切号后再投递旧回调 | 只创建一个账号、一个注册事实。尝试重复执行仍最多创建一个会话，取消的尝试无法替换会话 |
| 并发确认同一草稿、发送同一客户端消息、采纳同一候选 | 分别只有一个人物、一条用户消息及其任务、一份已确认原文。数据库回滚后相应任务和事件均不可见 |
| 生成执行中撤销素材或删除人物。旧签名重传已校验过的上传槽 | 迟到结果不能写回，已校验对象仍指向固定版本，需即时撤权的读取经授权代理拒绝 |
| 把旧本机导入包提交两次，并在另一设备查正式原文 | 来源映射复用同一组 ID，原文可找回。演示余额和奖励无入账记录 |
