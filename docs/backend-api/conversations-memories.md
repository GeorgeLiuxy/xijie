# 会话、回忆与空间接口

C01–C07、D01–D05 的目标实现。HTTPS、账号上下文、错误、幂等、分页、SSE 与 Worker 规则以 [共用契约](../backend-api-contract.md) 为准。以下路径用于正式 `/v1`，当前前端仍使用本机状态。表内正文限长均按修剪后 Unicode 字符计数。K03 先交付文字私聊，K04 完成珍藏与星图原文回读，R01 再接图片、小聚、书信和私人动态。X01 的通话与服务端转写须分别通过能力、授权和真机验收。 [交付顺序](../backend-delivery-priorities.md) · [会话列表](../../frontend/src/conversationList.ts) · [人物会话](../../frontend/src/person.tsx) · [回忆检索](../../frontend/src/atlas/memorySearch.ts) · [空间动态](../../frontend/src/moments.tsx)

## 数据模型与权限

| 权威资源 | 最少字段与不变量 |
| --- | --- |
| 会话 | `id, accountId, kind, personId?, worldId?, createdAt, version`。类型为 `direct` 或 `gather`，仅绑定相应目标。分别以 `(accountId, personId)`、`(accountId, worldId)` 唯一。人物迁居保留直聊及原世界小聚历史。 |
| 消息及时间线 | `id, accountId, conversationId, sequence, kind, author, createdAt, version`。按会话提交顺序分配 `sequence`，传十进制字符串。消息内容由会话域维护。礼物或通话行只保存受权威域控制的引用。对用户发送增加 `clientMessageId`，对 AI 回复增加 `replyToMessageId, generationJobId, speakerPersonId`。 |
| 生成任务 | `id, accountId, kind, targetId, state, version, attemptId?, replyIds?, resultRef?, failure?, createdAt, updatedAt`。写业务任务和 pg-boss 入队同事务。任务消息只带引用。任务类型 `chat_reply`、`gather_reply`、`letter_reply`、`memory_suggestion`、`memory_echo`、`feed_reaction`、`transcription`。 |
| 书信 | `id, accountId, personId, body, createdAt, replyMode, timeZone?, replyAt?, replyJobId?, reply?, version`。每封信最多有一个已提交回信。回信携带服务端 `createdAt, sequence, aiGenerated:true`。已读位置在账号与人物范围内单调递增。 |
| 回忆候选 | `id, accountId, personId, sourceMessageId, title, body, state, expiresAt, version`。来源是有权限的已完成 AI 回复与关联对话。候选与已确认回忆分表或分资源。确认后记录 `consumedByMemoryId`。 |
| 回忆原文 | `id, accountId, personId, title, body, origin, source?, confirmedAt, originalCreatedAt?, version, removedAt?`。来源为 `manual`、`ai_candidate`、`shared_contribution`、`import`、`demo`。手写和从候选确认使用 `(accountId,personId,clientMemoryId)` 唯一。来源可空用于无来源旧资料。修订保留同一 ID 和最初确认时间。用户确认文本由回忆域写入。 |
| 动态与互动 | `post(id,accountId,author,kind,body,mediaIds,sourceMemoryId?,worldId?,createdAt,version)`，`comment(id,accountId,postId,author,body,replyToCommentId?,createdAt,version)`。点赞按 `(accountId,postId,actorType,actorId)` 唯一，AI 回响按 `(accountId,sourceMemoryId)` 唯一。动态和回忆分别可读写。 |
| 通话 | `id, accountId, conversationId, personId, mode, state, version, roomRef, startedAt?, endedAt?, durationSeconds?`。RTC 房间和事件归属于同一通话 ID。默认保留通话时间、结果和时长。录音、转录和肖像另行授权。 |

每次私有读写先以真实 `accountId` 缩小范围，再验证人物、消息、回忆及素材的当前访问。AI 人物是账号内虚拟角色，署名含 `personId`、允许保留的发送时显示名快照及明确的 AI 标识。人物已被删除或限制时，历史的可见内容依保留规则回读，返回缺失姓名的通用署名并关闭人物链接。所有跨账号访问统一返回 `404 NOT_FOUND`。用户主体只能提交自己的作者身份。角色回应、系统行、运营世界条目和礼物投影由相应域生成。

## 会话及消息

列表行 `ConversationSummary` 为 `{kind,conversationId:UUID|null,personId:UUID|null,worldId:UUID|null,title,lastMessage:{id,kind,preview,createdAt}|null,lastActivityAt:string|null}`。没有会话的人物可用 `personId` 进入初次对话，时间和消息摘要为空。会话列表采用 `lastActivityAt DESC NULLS LAST` 加稳定 ID 排序。问候和 AI 说明是 UI 内容，按现有体验单独显示。

消息 DTO `Message` 使用共同字段 `id,conversationId,sequence,kind,author,createdAt,version` 及可选 `clientMessageId,replyToMessageId,generationJobId,contextMemoryId`。作者为 `{kind:'self'}`、`{kind:'persona',personId?:UUID,displayName:string,aiGenerated:true}` 或 `{kind:'system'}`。类型与专属字段如下。

| `kind` | 对外内容 |
| --- | --- |
| `text` | `text`，可选 `inputMode:'typed' \| 'transcribed'`。AI 回复可带 `canSuggestMemory:boolean` |
| `photo` | `mediaId`、`availability:'ready' \| 'unavailable'`，图片读取走素材域。撤回后只保留允许显示的占位信息 |
| `gift` | `gift` 对象来自 `GiftService.getConversationProjection`，包含 `direction,giftRefId,giftId,name,quantity,displayStatus,occurredAt,version` |
| `call` | `callSessionId,mode,durationSeconds`，仅已完成且获准留存的记录 |

| 编号与接口 | 输入和结果 | 后端执行、权限、并发及恢复 |
| --- | --- | --- |
| CHAT-01 `GET /v1/conversations` | 可选 `kind=direct\|gather` 和通用分页。返回 `ConversationSummary[]` | 查本账号可见人物和会话。直聊合并可见人物，无记录时不创建会话。小聚已有可读历史时可显示。取最新有效消息，删除和礼物状态变化时更新可重建摘要。 |
| CHAT-02 `POST /v1/conversations` | `{kind:'direct',personId}` 或 `{kind:'gather',worldId}`。返回会话详情 `{id,kind,personId?,worldId?,createdAt,version,canSend}`。新建 `201`，已存在 `200` | 直聊校验当前人物。小聚校验账号内世界和功能开关，至少两位当前可参与居民才新建。用唯一约束和事务解决并发打开，重复打开返回原会话。老小聚可读但居民不足时 `canSend=false`。 |
| CHAT-03 `GET /v1/conversations/{conversationId}` | 返回 CHAT-02 同形详情 | 同账号当前可读。直聊按现有人物授权。小聚读历史按同账号和历史可见规则。写入前另验当前资格。 |
| CHAT-04 `GET /v1/conversations/{conversationId}/messages` | `cursor,limit`，`direction=older\|newer` 默认 `older`。返回 `Message[]` 和 `nextCursor` | 默认取最新一页并按序号降序返回。向新处的分页使用锚点提供的 `afterCursor` 并按序号升序返回。游标绑定账号、会话、方向和边界。查回每行的即时可见性，礼物和媒体状态按权威域读回。 |
| CHAT-05 `GET /v1/conversations/{conversationId}/messages/{messageId}/context` | `limit` 默认 20、最大 100。返回 `{anchorMessageId,items:Message[],beforeCursor,afterCursor}`。按序号升序，尽量均分锚点两侧，边界游标可空 | 从相见历史搜索结果跳转。先验证锚点仍属于本会话且可见，删除、归属变化或已失效时返回 `404`，前端可回退至当前会话。两个游标分别续读 CHAT-04 对应方向。 |
| CHAT-06 `POST /v1/conversations/{conversationId}/messages` | `{clientMessageId:UUID,kind:'text',text,inputMode?,contextMemoryId?}` 或 `{clientMessageId,kind:'photo',mediaId}`。文本去除首尾空白后 1–4000 字符。R01 图片最多一张。返回 `202 {message:Message,generationJobId:UUID}` | 校验账号、会话和资格，图片通过 `Media.bindUse` 在消息事务内绑定 `conversation_attachment`，目标为当前会话。小聚在事务中确定当前可用居民，少于两位返回 `409 GATHER_UNAVAILABLE`，其余情况按固定顺序选最多三位并写参与者快照。显式提供的 `contextMemoryId` 须属于当前直聊人物且有 AI 使用授权，授权失败则不提交。消息、序号、任务、入队及 `MessageAccepted.v1` 同事务。唯一键 `(accountId,conversationId,clientMessageId)`，同参重放回原消息与任务，异参 `409 IDEMPOTENCY_CONFLICT`。前端仅在已受理后清相应版本草稿。 |
| CHAT-07 `DELETE /v1/conversations/{conversationId}/messages/{messageId}` | `If-Match`、幂等键。返回 `200 {id,removedAt,version}` | 校验同会话可见的文字、AI 回复或照片。事务标记移除并写事件，后续授权查询立即隐藏消息，停止仍依赖该条源消息的生成和候选。清理检索、素材绑定和原文引用时保留应保留的业务关系。已由用户确认的独立回忆继续按其自身授权读取，失效来源不可再引用。礼物及通话引用交给来源域管理。 |

同一人物的第一条消息可先调用 CHAT-02 取得会话 ID。只要消息与任务同事务保存，就表示已受理，AI 回复可能稍后到达。发消息时保留原 `clientMessageId`、请求指纹和幂等键，应答丢失时重放同一请求。C03 现阶段可用端侧转写，用户确认后以 `inputMode=transcribed` 提交文本。识别失败、空文本或上滑取消时保持草稿或退出语音模式。C07 草稿按账号和会话／人物在设备内存放，切号时隔离，跨设备草稿同步另行定义。复制、朗读和输入模式切换留端侧。

### 文字发送的最小请求与回读

~~~http
POST /v1/conversations/018e29ce-8f16-4d79-a0bf-0fd00a756f97/messages
Idempotency-Key: 47678a58-8321-4df3-a8ca-01652c8ed2fa
Content-Type: application/json

{"clientMessageId":"47678a58-8321-4df3-a8ca-01652c8ed2fa","kind":"text","text":"我今天想聊聊那次旅行。"}
~~~

~~~json
{
  "data": {
    "message": {
      "id": "669f0021-4d0d-4fe5-8b6d-a0423b21fa83",
      "conversationId": "018e29ce-8f16-4d79-a0bf-0fd00a756f97",
      "clientMessageId": "47678a58-8321-4df3-a8ca-01652c8ed2fa",
      "sequence": "34",
      "kind": "text",
      "author": {"kind":"self"},
      "text": "我今天想聊聊那次旅行。",
      "createdAt": "2026-11-10T08:00:00.000Z",
      "version": 1
    },
    "generationJobId": "ad877b84-bc9c-478a-8dc4-f68e37998cd9"
  }
}
~~~

HTTP `202` 表示消息已写入、回复任务已受理。任务未完成时查看 GEN-01。最终回复由 CHAT-04／CHAT-05 读取，并通过 `replyToMessageId` 关联用户消息。

## 生成任务与书信

任务状态为 `queued → running → succeeded|failed|blocked|canceled`。可重试的失败由调度器在退避后将任务重新排队，并保留同一任务 ID，`attemptId` 每次领取更新。用户触发的重试针对终态 `failed` 且 `failure.retryable=true`。用户明确取消、授权撤回、模型策略拦截和运行异常分别记录。小聚如果已有部分合法回复，`replyIds` 保留已提交结果，后续重试只处理仍合格且未生成的角色。

| 编号与接口 | 输入和结果 | 后端执行、权限、并发及恢复 |
| --- | --- | --- |
| GEN-01 `GET /v1/generation-jobs/{jobId}` | `{id,kind,targetId,state,version,replyIds?,resultRef?,failure?:{code,retryable},updatedAt}` | 校验当前账号和目标授权。回复和候选用权威详情读回。前台可通过 SYS-02／SYS-03 接收变化，掉线后查询本接口。 |
| GEN-02 `POST /v1/generation-jobs/{jobId}/cancel` | 无业务体，返回当前任务 `200` | 锁业务任务。排队、执行中可终止后续写入，更新版本和状态，再请求外部取消。已有提交结果保留。重复取消返回当前任务。已成功则返回成功状态。 |
| GEN-03 `POST /v1/generation-jobs/{jobId}/retry` | 无业务体，返回 `202` 同一任务 | 只允许业务校验通过的可重试失败，重新核对资格与预算并锁任务。新尝试只在状态由失败转回排队时入队。原任务已重试则复用现有执行，永久失败、取消或撤权以域错误返回。 |
| LETTER-01 `POST /v1/persons/{personId}/letters` | `{clientLetterId:UUID,body,replyMode:'none'\|'now'\|'next_morning',timeZone?}`，正文 1–10000 字符。次日模式须传 IANA 时区。返回 `201 Letter`，含 `replyAt?,replyJobId?` | 校验人物及 AI 回信资格。无回信模式只存原信。即时模式按当前 UTC 排队。次日模式取用户时区第一个严格晚于受理时间的早上 08:00，保存解析出的 UTC 时点与时区，后续旅行或设置变化不移动已排程任务。信、生成任务及入队同事务，`(accountId,personId,clientLetterId)` 唯一。 |
| LETTER-02 `GET /v1/persons/{personId}/letters` | 通用分页。返回 `Letter[]`，含 `replyJobState?` 与 `unread:boolean` | 按原信提交时间及 ID 降序，当前人员授权可见才返回。回复按权威已提交记录展示，失败和等待从任务读取。 |
| LETTER-03 `GET /v1/persons/{personId}/letters/{letterId}` | 返回一封 `Letter` | 校验人物、归属和信件关系。同一读路径服务个人页与来信通知点击。 |
| LETTER-04 `POST /v1/persons/{personId}/letters/read` | `{throughReplyId:UUID}`，返回 `{lastReadReplyId,readAt}` | 收件人查看已回读范围后确认。通过本账号同一人物真实回复的序号推进已读位置，使用原子最大值，较旧页面的请求不能回拨或覆盖尚未读取的新来信。 |
| LETTER-05 `DELETE /v1/persons/{personId}/letters/{letterId}` | `If-Match`，返回 `{id,removedAt,version}` | 用户权利接口。事务标记删除，后续读取不展示原信与回信，撤销排程或执行中任务，清理索引和通知入口。晚到的回信结果不能重建原信。 |

`Letter` 对外字段为 `id,personId,body,replyMode,timeZone?,replyAt?,replyJobId?,replyJobState?,reply?:{id,body,createdAt,aiGenerated:true},createdAt,version,unread`。已提交的原信与尚未到达的 AI 回信分别呈现。C05 排程依据服务器时间。角色回信和站内通知在同一提交点建立可靠来源，推送仅为提示。

## 回忆、星图与动态

`Memory` 详情为 `{id,personId,title,body,origin,source?,confirmedAt,originalCreatedAt?,version}`。`source` 的返回范围经权限筛选，可为 `{kind:'message',messageId}`、`{kind:'contribution',contributionId}` 或空。被移除或当前不可访问的来源引用从读 DTO 省略，已确认原文仍按其自身权利规则处理。原文始终保存用户确认过的文字。

| 编号与接口 | 输入和结果 | 后端执行、权限、并发及恢复 |
| --- | --- | --- |
| MEM-01 `POST /v1/persons/{personId}/memory-candidates` | `{sourceMessageId:UUID}`，返回 `202 {generationJobId}` | 只接受同账号当前人物的有效 AI 回复和同一会话的可授权对话。按来源消息及版本复用已有有效任务，入队生成候选。候选过期、失败或源授权变化时重新验证后再申请。 |
| MEM-02 `GET /v1/persons/{personId}/memory-candidates/{candidateId}` | `{id,personId,sourceMessageId?,title?,body?,state,expiresAt,version,consumedByMemoryId?}` | 校验候选归属和人物访问。状态 `ready`、`consumed`、`expired`、`withdrawn`。只有可读的 `ready` 候选返回原文和源消息。其他状态可返回可见元数据，以便前端保留用户已编辑的端侧输入。 |
| MEM-03 `POST /v1/persons/{personId}/memories` | `{clientMemoryId:UUID,title,body,candidateId?,candidateVersion?}`，标题 1–120 字符，正文 1–10000 字符。有候选时须传版本。返回 `201 Memory` | 仅本账号用户确认。若提交候选，锁候选并验证源消息、人物、授权、有效期与版本，原子消费。纯手写默认 `manual`。锁账号分配不可变 `confirmed_seq`。创建回忆、来源、确认序号与 `MemoryConfirmed.v1` 同事务。确认序号用于邀请资格先后，API 仍返回原 `confirmedAt`。客户端 ID 唯一并保留请求指纹，同参重放回原回忆，异参 `409 IDEMPOTENCY_CONFLICT`。候选只对应一个已确认回忆。候选版本变化、失效或已被其他操作消费时提示重读，用户也可明确转为手写提交。回响和检索由事件派生，不影响保存结果。 |
| MEM-04 `GET /v1/persons/{personId}/memories` | 通用分页。返回 `{id,personId,title,excerpt,origin,confirmedAt,version}[]` | 验证人物与授权，按确认时间及 ID 降序。空列表真实返回，不填充示例。 |
| MEM-05 `GET /v1/persons/{personId}/memories/{memoryId}` | 返回 `Memory` 和 `ETag` | 星图、世界场景、人物页及聊天原文统一入口。验证两级 ID 的归属和关系。移除后的旧链接返回 `404`。 |
| MEM-06 `PATCH /v1/persons/{personId}/memories/{memoryId}` | `{title?,body?}`，至少一个字段，`If-Match`。返回 `Memory` | 检查版本与同账号访问。保留原 ID、最初确认时间及来源类型，更新文本和版本，记录最小审计和 `MemoryUpdated.v1`。来源与奖励资格不因修订重复产生。 |
| MEM-07 `DELETE /v1/persons/{personId}/memories/{memoryId}` | `If-Match`。返回 `{id,removedAt,version}` | 同事务阻断回忆和引用原文的回响可见性，写 `MemoryRemoved.v1`。异步清索引、撤销派生任务与引用。已有效发放的奖励按活动留存与撤销规则由邀请域处理。 |
| FIND-01 `GET /v1/search` | `scope=atlas\|conversations`，`q` 去空白后 1–160 字符，`cursor,limit`。返回带判别字段的 `SearchHit[]`，标点归一化为空时返回空列表 | K04 支持星图人物、世界和真实回忆。R01 接已授权历史消息。先按账号和实时可见性裁剪，再按 NFKC 规范化、确定性证据和排序分页。直接人名命中导资料，真实原文命中导回忆，文字证据来自实际可见源。忽略虚构引导、演示和生成的背景故事。保留否定谓词匹配，避免从单个关键词误推相反含义。 |
| FEED-01 `GET /v1/feed` | 可选 `author=self\|person\|world`、`personId,worldId,kind,cursor,limit`。返回 `Post[]` | 只读自己的私人动态投影以及允许展示的系统世界条目。过滤项关联校验，按 `createdAt DESC,id DESC` 分页。原文和人物授权失效后即时排除相应回响。 |
| FEED-02 `GET /v1/posts/{postId}` | 返回 `Post` 与 `ETag` | 同 FEED-01 访问规则。回响返回 `sourceMemoryId` 与经鉴权的 `sourceMemory` 投影，可进入原文路由。 |
| FEED-03 `POST /v1/posts` | `{body,mediaIds?}`，正文最多 500 字符，最多九张图。正文或图片至少一项。返回 `201 Post` | 作者为当前用户。创建动态后在同一事务逐张调用 `Media.bindUse` 绑定 `post_attachment`。验证成品状态，再写发布事件。有一项失败则整条保留端侧草稿。AI 角色互动由服务端开关与授权决定，任务异步且注明来源。 |
| FEED-04 `DELETE /v1/posts/{postId}` | `If-Match`。返回 `{id,removedAt,version}` | 用户删除自身动态并终止晚到互动。AI 回响通过回忆域控制原文，内容举报或隐藏使用主文档运营接口。保留需留存的受限证据，清除用户可见互动及派生索引。 |
| FEED-05 `PUT /v1/posts/{postId}/reactions/me` | `{active:boolean}`，返回 `{active,reactionCount,postVersion}` | 设定期望点赞状态，避免重放 toggle。锁活跃动态并按作者唯一键写入或撤销。根据实际变更更新计数和版本。重复目标状态不增加计数。 |
| FEED-06 `GET /v1/posts/{postId}/comments` | 通用分页。返回 `Comment[]` | 查同账号当前可见动态的评论，按 `createdAt,id` 升序。已撤回父评论不泄露正文。 |
| FEED-07 `POST /v1/posts/{postId}/comments` | `{body,replyToCommentId?}`，正文 1–1000 字符。返回 `201 Comment` | 用户作者由会话得出。回复目标须在同一动态且仍可访问。提交评论、聚合计数和事件同事务。评论目标是有效角色评论时选其作者，否则可选动态角色作者。自动回复受功能开关和当前授权控制。 |
| FEED-08 `DELETE /v1/posts/{postId}/comments/{commentId}` | `If-Match`。返回 `{id,removedAt,version}` | 用户删除自身评论，事务更新计数及状态，撤销未完成的自动回复。保留允许阅读的子评论，但父正文不可读取。 |

`SearchHit` 共用 `{kind,id,title,excerpt?}`。人物结果带 `personId`，回忆结果带 `personId,memoryId`，世界结果带 `worldId`，会话结果带 `conversationId`，消息结果带 `conversationId,messageId`。同会话的历史搜索优先返回最近的可见命中。游标绑定规范化查询和作用域。命中行不含私有媒体 URL。原文、消息定位或人物打开时再次鉴权。

`Post` 对外字段为 `{id,kind:'user'|'memory_echo'|'persona_status'|'world_notice',author,body,mediaIds,sourceMemoryId?,worldId?,reactionCount,commentCount,reactedByMe,reactionPreview,commentPreview,sourceMemory?,createdAt,version}`。`sourceMemory` 为 `{personId,memoryId,excerpt}`，仅在回响来源当前可读时出现，展示原文需读 MEM-05。`reactionPreview` 为最先显示的至多 8 个可见作者，按互动创建时间及 ID 升序，超出的用计数提示。`commentPreview` 为至多 3 条最新可见 `Comment`，按时间升序展示。`Comment` 为 `{id,postId,author,body,replyToCommentId?,createdAt,version}`。动态和评论的作者使用消息同形类型，世界通知由 `system` 生成。C01、D02 走相同服务端归属校验，查询、滚动和返回位置留端侧。D05 的机位、静音、环境音、弹层和当前打包素材留端侧。远程世界内容启用后复用 [世界目录契约](./identity-people.md)，进入聊天仍调用 CHAT-02 或已有会话详情。

## 按需启用的媒体接口

| 编号与接口 | 输入和结果 | 后端执行、权限、并发及恢复 |
| --- | --- | --- |
| CALL-01 `POST /v1/conversations/{conversationId}/call-sessions` | `{mode:'voice'\|'video'}`，返回 `201 {id,conversationId,mode,state:'created',version,expiresAt}` | 只允许直聊，分别校验语音、视频功能及人物授权。每账号最多一个活跃会话，冲突时返回当前会话 ID。创建会话时分配私有房间引用，保存过期任务。 |
| CALL-02 `POST /v1/call-sessions/{callSessionId}/grants` | 返回 `200 {url,token,expiresAt}`，私有、短期、不可缓存 | 校验同一账号、人物、会话仍可进入。调用 RTC 签发最小房间权限。首期令牌有效期建议 60 秒，失效后重新申请并鉴权。重放可复用仍有效的签发结果。凭证不进事件或普通日志。 |
| CALL-03 `GET /v1/call-sessions/{callSessionId}` | 返回 `{id,conversationId,mode,state,startedAt?,endedAt?,durationSeconds?,version}` | 服务端状态权威。连接失败、切后台、超时可回读。状态 `created`、`connected`、`ended`、`failed`、`expired`。时长以可信会话连接与结束时间计算。 |
| CALL-04 `POST /v1/call-sessions/{callSessionId}/end` | 返回 `200` 终态会话 | 事务转终态、记录结束和关闭任务。接通过的会话按权利政策写唯一历史引用。关闭房间失败由 Worker 恢复。迟到 RTC 事件不重开会话。 |
| CALL-05 `POST /v1/webhooks/rtc/livekit` | 按提供方协议接收原始回调。验证、保存及去重后按渠道协议确认 | 用官方 SDK 验证回调。归一化 `providerEventId,roomRef,eventType,occurredAt`，检查已知会话、有效参与者及合法状态转换。重复、晚到或乱序事件以已保存终态为准。 |
| SPEECH-01 `POST /v1/conversations/{conversationId}/transcriptions` | `{mediaId,language?}`，返回 `202 {generationJobId}` | 云转写获准启用后，媒体域先扩展并发布 `transcription_input` 音频用途和保留约束，校验临时音频、授权及会话关系，再将绑定、任务和入队一并提交。通过 GEN-02 取消，原文件与结果按授权和保留时限清理。 |
| SPEECH-02 `GET /v1/transcriptions/{transcriptionId}` | `{id,conversationId,text,createdAt,expiresAt}`，结果 ID 来自 GEN-01 `resultRef` | 同账号当前授权。读取转写仅填入可编辑草稿，用户确认再调用 CHAT-06。取消或失效后清除临时资源。 |

## 模块调用、任务和事件

同进程服务接收可信 `RequestContext`。跨表事务内把同一事务对象传给资源所属域。Worker 从任务绑定的权威对象及账号状态建立受限的账号代理上下文，包含任务用途与当前授权版本。退出设备会话不等于停止已受理任务。跨网络调用在短事务外执行。输入文本通过最少读取构造，任务和事件载荷仅保留 ID、时间与版本。

| 调用方 → 目标 | 类型接口及用途 | 权限和故障处理 |
| --- | --- | --- |
| 会话、回忆、动态 → 人物和媒体 | `People.requirePerson(txOrDb, actor, personId)` 读取归属与 `accessVersion`。 `Media.authorizeMediaUse(txOrDb,actor,{mediaId,purpose,target,expectedAuthorizationVersion?})` 返回当前媒体授权版本和已验证元数据 | 读现有绑定调用 `authorizeMediaUse`。消息或动态创建时用 `Media.bindUse(tx,actor,{mediaId,purpose,target})` 校验暂存用途并原子绑定资源，返回同形授权版本。媒体目的包括 `conversation_attachment`、`post_attachment`、`ai_context`。按所属域登记的目标类型和用途使用。对象撤权后写回不可用，旧签名按共用规则处理。 |
| 礼物 → 会话 | `ConversationService.ensureDirect(tx,ctx,{personId}) → {conversationId}` | 赠礼前校验目标。可在赠礼同一事务为还未聊天的人物取得唯一会话。礼物事件消费后按 `(conversationId,giftRefId)` 唯一地追加或刷新时间线引用。 |
| 会话 → 礼物 | `GiftService.getConversationProjection(ctx,{deliveryId?;receivedGiftId?}) → GiftProjection` | 每次读校验原寄件或收件可见性，聚合时可批量调用同一查询语义。备注与留影由礼物详情接口返回。当前状态从权威寄件／收件读取。 |
| 共创 → 回忆 | `Memories.confirmFromContribution(tx,ctx,{personId,goalId,contributionId,text,sourceAuthorizationVersion}) → {memoryId,version}` | 共创域锁定目标、贡献和授权，使用可信原文调用。回忆域校验人物，按 `(accountId,personId,goalId,contributionId)` 唯一确认。当前 `origin='shared_contribution'`、`qualifiesForReferral=false`，登记原文与事件同事务。 |
| 数据权利 → 会话与回忆 | `ConversationService.importLegacy(tx,actor,{importId,legacyConversationId,target,messages}) → {conversationId,importedCount}`。`Memories.importLegacy(tx,actor,{importId,legacyMemoryId,personId,title,body,source?,originalCreatedAt?}) → {memoryId,version}` | 仅受信导入任务处理已确认批次，核对摘要、归属、每条旧 ID 和正式映射。`target` 使用已映射的人物或世界，`messages` 使用已确认原文、旧消息 ID 和原时间。正式 ID 由域分配。会话保留历史顺序，不安排新 AI 回复。回忆标记 `origin='import'`、`qualifiesForReferral=false`，可发事实事件用于索引。分块及映射规则按 PRV-07–09。 |
| 运营 → 原内容域 | `ConversationService.restrictMessage(tx,operator,{messageId,reportId,reasonCode})` 或 `FeedService.restrictPost(tx,operator,{postId,reportId,reasonCode})`，返回 `{id,version}` | 校验受信运营角色与工单关联。按内容当前可见性执行阻断及审计，并发布相关变更事件。公开工单状态按主文档处理。 |
| Worker → 模型适配层 | `GenerationProvider.generate({jobId,attemptId,kind,locale,context,outputSchema,timeoutMs}) → {output,providerRequestId?,usage?}`；`cancel({jobId,attemptId,providerRequestId?})` | `context` 只含该任务允许的人物、消息、回忆、媒体及已同意的用途。适配返回结构化文本、候选或已知失败。提供方支持时用稳定尝试 ID 去重或查回。原始报文及提示词排除在日常日志之外。 |
| Worker → 会话、回忆与动态写回 | `Generation.complete(tx,{jobId,attemptId,expectedVersion,output}) → {state,resultRef?,replyIds?}` | 在短事务内锁任务，并用当前版本及必要行锁复核尝试、状态、对象和授权。按类型提交回复、候选或动态派生资源，处理与撤权或取消并发时以事务提交顺序为准。重新验证生成内容、作者和输出限额。已取消、已提交或迟到的尝试返回原结果或丢弃。 |
| 通话 → RTC | `RtcProvider.createGrant({roomRef,participantId,permission,ttlSeconds}) → {url,token,expiresAt}`，`closeSession({roomRef,operationId})` | 参与者取经过验证的账号和会话，权限限于当前房间，原生客户端传媒体。房间关闭操作可重试并按会话归并结果。 |

### 后台任务

| `jobType` | 入队来源、有效负载与幂等 |
| --- | --- |
| `conversation.reply.v1` | CHAT-06 直接入队，`{jobId,conversationId,sourceMessageId}`，按用户消息唯一。小聚每位角色以消息和人物唯一，读取原成员快照并在运行时验证当前资格 |
| `letter.reply.v1` | LETTER-01 按 `replyAt` 直接入队，`{jobId,letterId}`，每封信一个回信。回信及站内通知由同一已提交回信事件驱动 |
| `memory.suggest.v1` | MEM-01 直接入队，`{jobId,personId,sourceMessageId,sourceVersion}`。同一有效来源版本复用结果，候选超过 24 小时失效 |
| `memory.echo.v1` | R01 消费 `MemoryConfirmed.v1` 或 `MemoryUpdated.v1` 后入队，`{jobId,memoryId,sourceVersion}`。一个原文一个回响，原文变更后旧任务不能覆盖较新版本。导入和演示来源默认不自动生成回响 |
| `search.project.v1` | 消费消息、回忆、人物和媒体变化，`{eventId,resourceType,resourceId,sourceVersion}`。按事件与消费者去重，投影可重建，检索返回前仍读取当前授权 |
| `feed.react.v1` | R01 消费适用的用户发布或评论事件，`{jobId,postId,sourceCommentId?,speakerPersonId}`。同源动作、角色、互动类型唯一。用户动态发布可选择至多两位获准角色，用户评论最多触发一位角色。仅用户动作的已知事件触发互动，AI 产物不会递归触发生成 |
| `media.transcribe.v1` | SPEECH-01 直接入队，`{jobId,conversationId,mediaId,authorizationVersion}`。转写以任务去重，取消后清临时结果和用途绑定 |
| `call.expire.v1`、`call.close.v1` | CALL-01 或 CALL-04 入队，`{callSessionId,expectedVersion}`。过期只影响仍未连接且已达时限的会话。房间关闭以会话 ID 去重并补偿重试 |

队列领取时记录 `attemptId`、任务代次、租约截止、源对象及用途授权版本，读取素材后发起有限时的调用。临时网络错误按配置退避，超过尝试上限进入可查失败。政策拒绝、明确取消和权限撤回停止自动重试。模型供应商的请求成功与业务提交分别核验。正式内容只在当前尝试写回事务通过后可读。前台 SSE 只提示资源状态变化，正文走经授权的 GET。撤权或删原文后，缓存、历史查询和派生投影都受同一当前可见规则约束。

### 本域事件负载

| 事件 | 权威生产者与负载 | 消费方 |
| --- | --- | --- |
| `MessageAccepted.v1` | 会话域 `{conversationId,messageId,acceptedAt}` | 会话摘要、检索和用户可见事件。回复工作由 CHAT-06 的事务内入队触发一次 |
| `ReplyCommitted.v1` | 会话域 `{conversationId,messageId,replyToMessageId,jobId,committedAt}` | 会话摘要、检索和前台。重复消费不重复增加回复 |
| `MessageRemoved.v1` | 会话域 `{conversationId,messageId,removedAt}` | 清除检索投影和旧候选，刷新列表 |
| `GenerationChanged.v1` | 生成域 `{jobId,kind,targetId,state}` | 用户可见任务刷新。正文与失败细节走 GEN-01 或结果详情 |
| `LetterReplyCommitted.v1` | 书信域 `{letterId,personId,replyId,committedAt}` | 已读列表、站内通知和前台状态。以回复 ID 去重 |
| `MemoryConfirmed.v1` | 回忆域 `{memoryId,personId,confirmedAt,origin,qualifiesForReferral}` | 检索、回响和邀请域。邀请核对权威记录，资格由服务端活动规则按真实用户确认与来源判定，当前仅 `manual` 或合规的 `ai_candidate` 可进入资格核对 |
| `MemoryUpdated.v1`、`MemoryRemoved.v1` | 回忆域分别为 `{memoryId,personId,updatedAt}`、`{memoryId,personId,removedAt}` | 按事件信封中的资源版本刷新或撤除检索、回响与前台 |
| `PostChanged.v1` | 动态域 `{postId,change:'published'\|'removed'\|'restricted'\|'reaction'\|'comment_added'\|'comment_removed',commentId?}` | 前台读回动态。仅活跃且由用户提交的发布或评论可进入自动互动任务 |
| `CallSessionChanged.v1` | 通话域 `{callSessionId,conversationId,state}` | X01 的通话状态及会话摘要读回 |

跨域消费 `AccountAccessRevoked.v1`、`PersonConfirmed.v1`、`PersonWorldChanged.v1`、`PersonAccessRevoked.v1`、`MediaUseRevoked.v1`，刷新访问与派生视图。人物撤权后阻断其直聊和新生成写回，并重算小聚参与资格，既有小聚记录按各条历史可见规则回读。礼物事件 `GiftDeliveryAccepted.v1`、`GiftDeliveryArrived.v1`、`GiftDeliveryFailed.v1`、`PersonaGiftReceived.v1` 按交易域约定的 `conversationId` 和礼物引用刷新原会话，投递失败也沿用原卡片。当前账号的用户可见事件采用主文档 `ClientEvent`。本域建议的 `resourceType` 为 `conversation,message,generation_job,letter,memory,post,call_session`，`kind` 为 `resource.changed`，用户回读目标的版本决定是否更新本机。

## 领域错误与验收

| 业务错误 | 含义和用户恢复 |
| --- | --- |
| `409 GATHER_UNAVAILABLE` | 当前小聚参与资格或人数不足。可继续读允许的旧历史，条件满足后再发送。 |
| `409 MEDIA_NOT_READY` | 上传成品尚未就绪。保留草稿，查询素材状态或重新选择。 |
| `409 MEMORY_CANDIDATE_UNAVAILABLE` | 候选到期、撤回或已消费。重读候选或使用用户自己确认的手写稿。 |
| `409 GENERATION_NOT_RETRYABLE` | 目标任务已结束或不可重试。查回权威状态，修复授权或输入后再执行新的合法动作。 |
| `409 CALL_ALREADY_ACTIVE` | 已有可见的活跃会话。可按返回的 `callSessionId` 继续或结束。 |
| 任务失败码 `CONTEXT_REVOKED`、`MODEL_OUTPUT_BLOCKED`、`GENERATION_UNAVAILABLE` | 分别表示源权限变化、输出策略拦截、供应商暂不可用或预算耗尽。仅后者在相应条件满足时可重试。HTTP 状态查询本身仍可返回 `200`。 |

- **K03 会话恢复**。关闭 App 或让请求丢失后重放同一客户端消息 ID，只出现一条用户消息和一次有效 AI 回复。切换账号不读到原账号的消息、礼物引用或旧事件。
- **K04 原文与撤权**。保存后在另一设备通过人物、星图和世界回到同一 `memoryId`。回响任务失败仍可读取原文。删除或撤销用途后，历史链接、索引、迟到回复和新的签名读取按当前权限失效。
- **R01 历史一致性**。迁居保留直聊 ID、可读小聚历史和寄件引用。预约回信在进程关闭后只提交一次，新来信未被较旧已读请求覆盖。重复点赞或发评论请求不增加重复行。
- **X01 媒体恢复**。拒绝权限、转写为空、通话未接通、网络切换、过期令牌和重复 RTC 回调均可恢复或安全结束。设备时长和客户端回调不作为历史权威。

原型路径与正式接口的覆盖关系为 C01 CHAT-01–05 与 FIND-01，C02 CHAT-06–07 与 GEN-01–03，C03 CHAT-06 和按需 SPEECH-01–02，C04 CHAT-02–06，C05 LETTER-01–05，C06 CALL-01–05，C07 设备内草稿。D01 MEM-01–07，D02 FIND-01、MEM-04–05 及 CHAT-02，D03 FEED-01–02，D04 FEED-03–08，D05 端侧操作及世界目录复用。
