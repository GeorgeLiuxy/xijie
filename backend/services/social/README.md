# Social 私人动态与文字回响

独立 NestJS / PostgreSQL 领域，复用当前服务依赖及锁文件版本，不连接其他服务数据库。API 默认 3105；本机专用 PostgreSQL 默认 5437。`.env.example` 仅给占位配置，实际凭据不得提交。`pnpm install --frozen-lockfile`、`pnpm build` 后，先应用 `node --env-file=<私密配置> dist/migrate.js`，再启动 `dist/main.js`。已应用的001／002不变，私人配图通过增量003增加；应用后不得改写校验和。

公开 `/v1/feed`、`/v1/posts`、评论和期望点赞状态沿[共享契约](../../../docs/backend-api/conversations-memories.md#r01-私人文字动态与迁居投影本轮实施基线)。主体来自 Identity Cookie 与预期会话，写请求要求登记 Origin、UUID 操作键；删帖／删评论再带 If-Match。`clientPostId/clientCommentId` 表达稳定意图，同参重放当前资源，异参冲突，已删不复活。点赞仅设置 active，旧成功键不会再次执行或返回过期点赞状态。发布正文最多500 Unicode字符；user可用1–9张图片代替空正文，评论仍1000字。图片引用只接受独立Media服务已校验的同账号成品；所有作者均来自服务端。

读取、发布、评论、点赞及迁居同步必须 `storyStorage.allowed && privateFeedAllowed===true`，仅旧 allowed 不够；需要 Identity 新隐私／保存用途的明确授权。删除、已有数据复制／注销不要求新授权或 AI。源人物已移除后其迁居帖与全部互动立即不可见；People 故障拒绝完整 feed，不用旧缓存当权限。用户自己帖子不依赖人物身份。

People 只读 Social 最小目录和按人物世界版本升序的正式迁居页；不读画像故事、聊天或记忆正文。Social 空间回读物化已有事实，按每人物固定 horizon、有界100页，游标和实际投影同事务；只生成系统迁居记录，没有世界行为或模型任务。初始世界版本1没有历史。唯一来源与版本键、canonical 摘要碰撞检测、不可改来源触发器保护 A→B→A 与长于八条历史。每次读取及互动另验当前权威可见性。RPC 和本库提交之间仍有竞态窗口，不承诺跨库原子撤权。

本库账号擦除门闩先于动态／同步锁，所有正文、互动、命令、来源表受数据库写围栏保护；正版本、时间与状态约束、复合账号外键及延迟计数约束同时保护直写。数据权利内部端点仅独立 rights 凭据，并由 Identity 的具体申请／账号／操作／scope 复核；20 MiB预算、稳定 revision、当前有效来源筛选、物理擦除与迟到同步拒绝均在领域内实现。

配图另需成对配置 `XIJIE_MEDIA_URL` 与独立 `XIJIE_MEDIA_SERVICE_TOKEN`。后者仅验证Media调用的来源元数据接口，不可与Social／数据权利凭据相同。Social用自身凭据在事务外请求Media全部绑定，核对当前 `photoStorage.allowed/authorizationVersion`；之后本库将帖子、1–9连续位置的不可改 `post_media`、命令和Outbox一起提交。UUID为固定命名域＋账号＋clientPostId的稳定哈希，授权不依赖其不可猜。旧文字帖ID及不含图片的请求摘要不变；已成功的相同意图重放不再次绑定或要求新的照片grant。

DTO返回 `mediaIds` 及同序 `media:[{id,version,mimeType,byteSize,width,height}]`，无图统一为空数组，无存储地址。Media以自身凭据和账号头调用 `POST /internal/v1/media/posts/validate {refs:[{postId,mediaId,version}]}`（最多100且不得重复）；只返回active用户帖的精确附件引用，不返回正文、不授予字节读取。该可信来源检查不要求用户重新同意文字／照片／AI保存；实际读图仍由Media当前会话和权限决定。删帖先本地失效，再以最多2秒的尽力请求释放Media绑定；Media Worker另行恢复清理，外部失败不回滚删除。post_media纳入Social导出摘要及账号擦除；图片字节由Media独立导出／擦除和备份，不由Social数据库代替。

设置 `XIJIE_TEST_DATABASE_URL` 后 `pnpm test`。测试只创建并清理 `social_test_<random>` schema，覆盖真实 PostgreSQL、实际 Nest HTTP、SDK无关的源HTTP解码、角色、幂等、并发、分页、来源断链／冲突、12次迁居、撤权、删除、导出及擦除围栏。它们不替代原 UI 或部署／六库恢复验收；实际交付证据由根任务汇总。

珍藏回响和所属人物评论只在 `SOCIAL_AI_ENABLED=true` 时接通。API 仅登记任务和 pg-boss 投递，模型密钥仅提供给独立 `dist/echo-worker.js`。Worker 另需 `MODEL_BASE_URL`、`MODEL_NAME`、`MODEL_API_KEY` 及非空 `MODEL_ALLOWED_ACCOUNT_IDS`（最多100 UUID）；默认不授权任何账号，生产环境禁止本阶段真实模型调用，运行白名单不能替代用户授权。模型 SDK 与 Conversations 版本一致，固定已授权 OpenAI endpoint、`store:false`、无动作工具、请求超时，SDK 不自动重试。

新用途必须 `aiTextProcessing.allowed && privateFeedProcessingAllowed===true`，同时保留原文保存用途。Worker 读取独立 Memories 来源事件，以原事件 ID 的 receipt 加独立 ack 重试，不使用时间高水位，不回扫历史正文。仅受理捕获准确正 AI 授权版本的新确认／编辑版本；撤权后仍消费失效元数据。原文每版本最多一个生成任务与回响，编辑／删除撤下旧来源、引用及互动。原文独立于被珍藏聊天的后续删除。来源正文、完整画像和虚拟当前位置只在生成前后精确校验；读取旧回响仅查当前来源有效元数据，新的 AI 授权不是阅读已有结果的条件。依赖故障拒绝返回旧引用，不用缓存放行。

仅回响内新保存的 self 评论可安排该回响所属人物回应；普通自发动态、迁居记录、旧评论、AI 评论不派生模型调用。上下文限当前评论、精确目标和继承来源引用（最多16），历史 AI 只作上下文，不是事实。真实来源评论删除会使依赖它的 AI 评论退出读取，禁止递归复活。无关点赞或其他评论导致的帖子聚合版本变化不废弃当前回复；实际引用版本、授权、人物和世界变化会阻断迟到结果。

`GET /v1/social-generation-jobs/:id` 返回 `id/kind/state/version/resultId?/failure?/updatedAt`；`POST .../:id/retry|cancel` body 为 `{}`，带写请求凭据和准确 `If-Match: "vN"`。最多三次领域尝试，旧成功操作键只回读当前任务，不再次投递。feed `meta.generationStatus` 给出当前授权的 pending/failed 和最多50个 retryableJobIds，无生成占位。取消后模型前核对 state/attempt/lease，并向进行中的 SDK 发 AbortSignal；租约接管、崩溃派发耗尽、撤权及擦除均不能恢复旧输出。跨服务撤权与本库提交仍存在有界竞态窗口，不宣称跨库原子性。

回响、人物评论、来源、任务及所有代 pg-boss 派发纳入账号擦除；导出会重新核对来源有效性。新增测试使用随机 `social_queue_test_<random>` schema，覆盖实际 SDK 假 wire、真实队列事务边界、两代显式重试后的全派发擦除、慢来源 I/O 取消／接管零模型调用、事务内零权限 RPC、源编辑／撤权／ABA、继承评论断链，以及旧交互回归。测试不调用真实模型，不使用真实账号；不将局部通过等同于原 UI 验收。


## M03 六段共创相册（服务实现，原 UI 验收另记）

`004_shared_albums.sql` 新增独立相册、投稿、永久操作回执、参与决定、采纳待办、领奖待办和来源清理。公开 `/v1/public/shared-albums/:token` 仅给标题、附言、容量和访客自己的投稿；匿名身份为服务签发的 HttpOnly Cookie，与公开令牌和真实账号分离。创建、采纳、关闭用真实会话；投稿必须明确 `allowAdoption:true`。资源级决定追加保存，不自动授予私人存储或 AI 权限。正常关闭停止公开、新投稿和新的领奖派发，已有采纳来源不因此失效。关闭页只允许原访客私读自己的投稿，标题和附言为空，status 为 closed；陌生访客 404，原作者仍可撤稿。已派发未知只查原奖励回执。

默认 `SHARED_ALBUMS_ENABLED=false`，当前首片拒绝 production 启用。启用需独立 `SHARED_ALBUMS_TOKEN_KEY`（64 hex）、来源调用方 `XIJIE_MEMORIES_SERVICE_TOKEN`、已有 `XIJIE_MEMORIES_URL` 和 `XIJIE_GIFTS_URL`；公开 URL 仍为应用源 `/gifts/:token`。运行 `worker:albums` 处理持久待办，不依赖 AI worker。实际运营者先审阅投稿，再执行 `node dist/albums-review.js <contributionId> approved <reviewerLabel>` 或 `... rejected <reviewerLabel> <not_suitable|unsafe|capacity>`；保存成功从不自动批准。审核锁相册分配五个投稿席位，连同发起人附言共六段。

采纳在锁外调用 Memories，以 album+contribution 永久身份恢复；领奖仅调用 Gifts 固定一张基础券 promotion API。回包丢失先查同账户同相册的原奖励回执，发出可入账请求前永久保存 dispatch 标记；撤稿后已派发未知只查原回执，不能把一次 404 当成未执行证明。撤回立即使普通来源读取失败，并用持久清理和 Memories tombstone 阻断迟到采纳。作者注销会清除共享身份和正文；Social 擦除须等跨域来源清理完成才返回成功。已到账资产由 Gifts 自身生命周期处理，不因正常撤稿追扣。独立 schema/Nest 双服务 HTTP 测试不代表生产发布或真实账号 UI 验收。

增量 `006_shared_goals.sql` 在同一来源、访客隔离和奖励闭包中增加 `kind:'album'|'home'|'flight'`。新创建显式填写 kind 时采用不可变规则 v2：相册／小屋初始 1、每个审核通过的投稿加 1、目标 6、最多 5 个当前投稿席位；机票初始 4、每个通过的投稿加 2、目标 20、最多 8 个当前席位。这些都是虚拟共建进度，不扣邮资、不代表真实房产或机票购买。省略 kind 的旧相册保持规则 v1 及原永久请求指纹；旧记录不被改写为新创建。数据库约束、相册行锁和唯一席位共同限制容量。

发起人通过 `POST /v1/shared-albums/:id/contributions/:cid/review {decision:'approve'|'reject'}` 明确审核，使用登记 Origin、ExpectedSession、UUID 操作键和投稿的 `If-Match: "vN"`。运营 CLI 仍可审核，同一 pending/approved/rejected/withdrawn 状态表达实际审核结果，没有额外的双重审批。审核追加真实发起人审计和永久回执，不自动采纳记忆或自动领取奖励。200 返回最新完整发起人 DTO；同一已受理键先核原意图再回读，不重新执行旧 CAS。`VERSION_CONFLICT`、`REVIEW_ALREADY_DECIDED`、`ALBUM_COMPLETE` 只在尚未提交的审核事务中拒绝；提交后的来源变化返回独立 `SOURCE_CHANGED` 等未知结果，客户端保留原键恢复。

公开内容仍仅来自明确填写的标题／附言及原访客自己的投稿，增加的 kind/rulesVersion/capacity 不公开人物资料或其他作者正文。审核通过才推进；撤稿或作者擦除使其退出当前进度，原席位可供新的真实投稿使用，同一账号不能因此重复投稿或重复领取目标回礼。三种目标都可另行明确采纳已通过投稿为记忆，保留原来源撤回和举报限制机制。导出携带实际目标类型／规则／容量；擦除沿原跨域清理完成条件。恢复校验保留这些业务规则、owner_review 原始操作摘要、审计和奖励账本，只隔离原有执行标志，不制造审批、进度、记忆或资产。

新增隔离验证覆盖三类创建指纹、发起人审核、最后席位并发、运营竞态、丢失提交回包、账号边界、撤回、导出／擦除，以及真实 Social→Gifts HTTP 的丢失回包恢复和每目标／账号单张基础券的实际 PostgreSQL 账本。恢复测试另外覆盖新规则／容量／审核回执篡改、部分迁移和作者擦除后的旧回执。原页面和最终源服务／原生恢复验证由根任务统一记录。
