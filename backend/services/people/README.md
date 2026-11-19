# 人物服务

独立 NestJS / PostgreSQL 服务维护「寻找 TA」文字草稿、预览、人物确认、资料修改和移除。账号与用途通过 Identity 内部接口核验，不跨库写入。原页面接入说明见仓库 `backend/README.md`，运行时使用 `.env.example` 对照本地配置；不要提交真实配置。

## K05 数据权利

新增迁移 `005_data_rights.sql` 保留 001–004。配置独立的 `XIJIE_DATA_RIGHTS_SERVICE_TOKEN` 后开启内部 `GET /internal/v1/accounts/{accountId}/data-export?requestId=UUID&scope=interaction_data|account_data` 与 `POST .../erase`；未配置时返回404。这些端点不得加入客户端代理。

每次先以本服务原有 Identity 凭据核对 `GET /internal/v1/data-requests/{requestId}/context`。导出只接受同账号有效 export/active，使用本库可重复读快照，包含当前人物原始资料、仍可读草稿及所引用世界目录；不含已移除人物、命令缓存或预览产物。稳定 SHA-256 `revision` 基于 `data`，不包含 `capturedAt`；20MiB 上限先估算再验证，超限明确413，不截断成功。

擦除只接受同账号 delete_account/deletion_pending 或 deleted，正文为 `{requestId}` 且幂等键等于 requestId。事务清除包括逻辑删除残留在内的草稿、人物、预览、命令与 Outbox。保留最小 `account_erasure_fences`（账号、申请和时间）；该行与全部私有表的 INSERT/UPDATE 触发器共用本地锁，拒绝取得旧远程权限的迟到写入，RR 旧快照冲突也不能复活数据。其他账号和全局世界目录不受影响。

构建：`npm run build`；迁移：`npm run migrate`；测试：`XIJIE_TEST_DATABASE_URL` 指向隔离集成数据库后运行 `npm test`。本片已经验证真实 PG、Nest HTTP、稳定导出、跨账号拒绝、幂等清理、超限失败、并发写入及 RR 旧快照。业务部署和原前端验收由主任务单独执行。

## R01 首片：人物迁居与正式世界事实

增量迁移 `007_world_movements.sql` 在 001–006 之后应用，保留已应用迁移及其校验和。`persons.world_version` 初始为 1，只在实际更换世界时增加；普通画像编辑不改变它。初次分配世界不伪造迁居历史。`person_world_movements` 是不可变的成功事实：带账号、人物、独立世界版本、人物提交版本、迁出／迁入世界快照、用户来源及发生／记录时间；`reality='virtual'`、`branch='main'` 固定由服务写入，不接受客户端或模型指定。本片不启动私人动态、自动世界剧情或平行分支服务。

- `POST /v1/persons/{id}/world`：原应用会话、Origin、UUID 幂等键、`If-Match: "vN"`，严格正文 `{worldId:UUID}`。返回 `200 PersonDTO` 和新 ETag，DTO 增加 `worldVersion`。账号擦除门闩先于人物资源锁；迁入目录按稳定 ID 顺序持共享锁并复核 enabled。实际移动同事务更新人物版本与世界版本、写迁居事实及 `PersonWorldChanged.v1`／`PersonUpdated.v1`，后者使已有画像来源消费者跟上人物版本。
- 同世界的新操作是 no-op，不增版本、不发布事件。不同请求竞争依人物版本产生一次成功与版本冲突；丢失结果重试沿用原键。已成功的迁居、确认及资料更新命令重放都权威回读当前 Person，不用旧缓存覆盖当前世界／资料，也不再执行原副作用。人物 ID、访问版本、直聊与回忆身份保持不变。
- `GET /v1/worlds/{id}`：有效会话可读最小目录卡片，已下架但被当前／历史状态引用的世界仍可展示，不能作为新迁入目标。
- `GET /v1/persons/{id}/world-movements`：账号内有效人物的不可变历史，按世界版本倒序；签名游标绑定账号、人物与分页参数。人物移除后不可读。
- `GET /internal/v1/persons/{id}/world-context`：仅 Conversations／Memories 凭据加账号请求头。另核对 Identity 当前 active 账号，在本库可重复读只读事务中核对擦除围栏、有效人物、当前目录和最近最多八次迁居。历史需连续、互相衔接且最新落点匹配当前状态；缺失／损坏拒绝，不补造生活事件。读取不要求 AI 或新存储授权；生成端仍必须校验自己的 AI 用途和版本。

世界上下文返回 `accountId,personId,personVersion,worldVersion,reality,branch,currentWorld,recentMovements,revision`。世界卡片统一 `{id,code,displayName,catalogVersion,enabled}`，迁居项为 `{id,worldVersion,personVersion,fromWorld,toWorld,occurredAt,recordedAt}`。`revision` 是除顶层 `personVersion` 外这些固定快照字段的递归对象 key 字典序 canonical JSON 的 UTF-8 SHA-256；数组保序，因此普通资料编辑不修改世界事实摘要，世界目录与已提交历史变化能被检测。

数据导出增加 `worldMovements` 及当前世界版本，纳入预算和 revision；被移除人物的历史不导出。账号擦除先删迁居事实，再清人物和其余私有数据，迟到写不能复活。恢复副本必须保持这些已提交事实原样，相关核验由仓库恢复工具负责。本片不扣邮票或券，不发交易／邀请奖励，不把 AI 的一句迁居叙述视为已经执行。

本机随机 PostgreSQL schema 与 Nest HTTP 测试覆盖无历史初态、实际移动、no-op、旧命令重放、并发版本竞争、双事件回滚、目录并发下架、完整世界快照及连续主线、世界历史分页、人物撤权、导出／注销和账号门闩锁序，共 32 项通过。另用独立新合成账号通过原 UI 未授权 AI 迁居、刷新、往返、直聊／珍藏保持，再由原聊天真实 OpenAI 接续世界和原隐私 OTP 四域导出。Identity 必须使用包含 People 只读账号上下文许可的版本；该跨服务调用的角色反例已补，不能以共用测试凭据代替。

## R01 Social 专用来源接口

可选 `XIJIE_SOCIAL_SERVICE_TOKEN` 只开放 `GET /internal/v1/social/persons` 和 `GET /internal/v1/social/persons/{id}/world-movements`，配合 `X-Xijie-Account-Id`。不会因此向 Social 开放带故事正文的原人物 context、自动记忆或数据权利管理接口。前后复核 Identity active 账号及访问版本，本库在可重复读快照中复核擦除围栏和人物可见性；依赖失败拒绝，不能用旧投影冒充已鉴权来源。

目录返回 `{accountId,persons:[{id,displayName,worldId,version,accessVersion,worldVersion}]}`，仅当前可见人物，超过 1000 明确返回 413。迁居页必填 `afterVersion=N&throughVersion=T`，可选 `limit` 默认 100、最多 100，满足 `1≤N≤T≤当前worldVersion`。返回 `{accountId,person,items,nextAfterVersion,hasMore}`，items 沿既有 WorldMovement DTO 升序完整读取，不截最近八条，不以时间戳做永久水位；每页验证版本连续、上页边界、迁入迁出衔接及当前落点。固定 T 后新迁居不会把本次同步变成无界追新，缺失或断链返回依赖失败。初始 N=T=1 为空，未发生的初次分配不补造迁居。

新增目录边界、完整历史／固定 horizon、Social 角色隔离、读取期间账号禁用、来源故障及人物删除／擦除反例；本域全量 35 项通过。Social 读投影与实际原空间 UI 的联调由整体切片另行验收。

Social 模型来源另走 `GET /internal/v1/social/persons/{id}/ai-context?expectedAiVersion=A` 及同路径 `world-context`。仅 Social 独立凭据加账号请求头，必须有当前文字／私人空间存储和 `aiTextProcessing.privateFeedProcessingAllowed===true`，AI 版本须精确等于 A；缺失／false 的旗标不能退化为普通画像读取。画像仅返回 `id,accountId,displayName,relationship,calledMe?,story,version,accessVersion,worldId,worldVersion`，世界仍为规范虚拟主线 DTO。前后核验账号、存储授权及人物版本／世界，源变化拒绝；原 metadata 接口仍不要求 AI，原通用故事端点仍不向 Social 开放。此增量后本域全量 36 项通过，未以隔离测试代替真实模型联调。


## K02 人物照片（2026-11-13）

增量迁移 `008_person_photos.sql` 增加 People 自己拥有的有序 `person_draft_media`，最多六张。草稿与人物公共 DTO 返回 `mediaIds`、同顺序 `media` 及稳定 `photoTarget:{kind:'person_draft',id}`；确认后引用继续属于原草稿来源，首张为头像。人物资料修改通过原 `PATCH /v1/persons/{id}` 的可选 `mediaIds` 更新同一来源；省略字段保留照片，空数组移除全部。创建草稿只接受文字，先取得真实草稿 ID 再上传，不允许创建时借用外部照片。

非空选图先在 SQL 事务外，以独立 People 凭据调用 Media 的 `POST /internal/v1/people/drafts/{id}/media-bindings`；返回有序成品元数据与短期 `expiresAt`，本库锁定账号／草稿／人物后用数据库时间再核验期限，过期以 `409 MEDIA_BINDING_EXPIRED` 拒绝。提交前再次核对 Identity 会话、文字与独立 `personPhotoStorage` 授权版本。已接受的同键请求直接核对命令并回读当前照片引用，不重新绑定已被替换的旧照片；未确认结果保留原键和选图重试。纯文字更新不调用 Media，照片授权撤回后仍可提交 `mediaIds:[]`。确认人物时保留来源，不复制图片字节，也不把照片送入内部 AI 人物上下文。

Media 专用来源接口使用 `XIJIE_MEDIA_SERVICE_TOKEN` 与账号头：`GET /internal/v1/media/people/drafts/{id}` 验证当前来源；`POST /internal/v1/media/people/validate` 接受最多 100 个 `{draftId,mediaId,version}` 并返回精确有效关联。未确认来源须未过期；确认来源须人物 active。替换、移除人物、过期或账号擦除立即使旧关联验证失败，物理对象由 Media 复核后清理。来源接口不要求照片授权，用于可靠清理和独立数据权利，不能单独授权前端读取字节。

People 导出增加有序 `photoRefs` 并计入预算与 revision；图片实际字节由 Media 导出。账号擦除先清照片引用并保留既有迟到写门闩。全域 PostgreSQL／Nest 测试 39 项通过，覆盖有序回读、确认、头像、替换／移除、跨账号、旧会话、独立授权、绑定期限、结果重试、导出与擦除；原页面与真实对象联调由整体任务继续验收。

## R02 Gifts 人物来源与独立 AI 回礼上下文

`XIJIE_GIFTS_SERVICE_TOKEN` 是 Gifts 专用内部凭据，不向 Gifts 开放原 Conversations／Memories 通用故事接口。寄件使用 `GET /internal/v1/gifts/persons/{id}?accountId=UUID`，只返回 `{id,accountId,displayName,worldId,version,worldVersion,accessVersion,status,audience:'person'}`。读取前后检查 active 账号与人物版本，目标不存在、已移除或归属不符均拒绝；这个 metadata 接口不要求 AI 回礼授权，不包含故事或照片。

真实回礼另走 `GET /internal/v1/gifts/persons/{id}/return-context?accountId=UUID&expectedReturnAuthorizationVersion=R&expectedStoryAuthorizationVersion=S`。先应用 Identity `012_person_gift_returns.sql`；来源要求当前 `giftReturns`、`storyStorage` 和 `giftStorage` 允许，R/S 必须精确匹配当前版本。返回 `{person,accountAccessVersion,storyAuthorizationVersion,returnAuthorizationVersion}`；person 仅包含原文来源所需的 `id,accountId,displayName,relationship,calledMe,story,worldId,version,worldVersion,accessVersion,status,audience`。没有照片、聊天、珍藏、自动记忆和迁居历史，也不借普通 AI grant 推断新用途。

接口在读取前后复核账号访问、相关存储／回礼授权及人物、世界版本，失败不回退到旧 metadata 或缓存画像。Gifts 再以新寄件捕获的精确版本校验，并在模型前后及本库提交边界复核；模型由独立 Gifts return worker 调用，People 不运行回礼生成、不保存来礼或通知。跨域 HTTP 始终在 SQL 锁外，不承诺跨库原子撤权。

People 原数据权利与擦除围栏保持；Gifts 导出负责保存实际使用的生成来源和回礼记录，恢复检查 sourceDelivery→generation→received→conversation 的归属与版本。此接缝实现和隔离测试已经完成，真实 OpenAI、原 UI 与新切片恢复验收仍由主任务进行。

本片整体验收现已完成：原UI真实OpenAI回礼、收件与通知、撤权后的七域导出、八库165表恢复及合成账号注销清理均通过。测试开关与名单已关闭，仍仅为本机合成验证；详见[交付接续](../../../docs/backend-delivery-priorities.md)的2026-11-13回礼记录，替代上文进行中的状态说明。

## R01 围坐居民元数据接口

`GET /internal/v1/worlds/{worldId}/gather-context` 仅接受现有 `XIJIE_CONVERSATIONS_SERVICE_TOKEN` 与 `X-Xijie-Account-Id`，不接收查询参数。返回 `{accountId,world,residents,revision}`；world 沿现有 `{id,code,displayName,enabled,catalogVersion}`，每位居民只含 `{id,displayName,version,accessVersion,worldVersion,createdAt}`。同账号、当前世界的 active 居民按 `createdAt,id` 升序完整返回，0／1人仍正常返回，1001人起明确 `413 HISTORY_TOO_LARGE`，不静默截断。已下架世界仍可读取，是否允许新围坐及选择哪些发言人由 Conversations 决定。

世界与居民来自同一 `REPEATABLE READ READ ONLY` 快照，校验本地擦除围栏。Identity active 账号与访问版本在事务外前后复核，随后重读来源 revision；读取期间居民、资料版本或世界目录变化返回 `409 SOURCE_CHANGED`，账号失效或擦除返回404。revision 是核心 `{accountId,world,residents}` 的 canonical JSON SHA-256：对象键按字典序、数组保序；每个人的 `worldVersion` 仍是该人物自己的迁居计数，不新增世界全局版本。

接口不返回故事、私聊、珍藏、自动记忆或照片，也不授权模型处理。Conversations 必须另行组合本次围坐用途、文字保存与各个发言人的来源授权。本元数据接口无新表、迁移、资产或模型副作用。本轮专用合成账号已验证原 UI 迁居使居民由两位变为零位后，既有围坐历史仍可读取，已受理未知发送仍沿原键回放；新生成资格由 Conversations 拒绝。整体来源、模型质量与验收边界见[围坐记录](../../../docs/backend-api/conversations-memories.md)。
