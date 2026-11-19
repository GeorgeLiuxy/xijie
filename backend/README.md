# 西界后端

每个领域服务在 `services/<name>/` 下独立管理依赖、运行入口、数据迁移与部署。客户端通过共用的 `/v1` 接口访问，网关负责路由。一个业务事实由一个服务写入，跨服务通过版本化接口或事务 Outbox 事件交互。

## 已实现的服务

| 服务 | 职责 | 数据 |
| --- | --- | --- |
| [identity](services/identity/) | 原 App 内手机号验证码登录、账号与应用会话、隐私告知、文字保存、私人照片保存及独立 AI 文字处理授权／撤回、同账号近期重新验证，以及数据导出与账号注销编排。通过 BFF 接入独立部署的 Logto Experience API，复用 OIDC 校验。 | 身份服务数据库。Logto 在自己的数据库中管理登录凭据。 |
| [people](services/people/) | 「寻找 TA」文字草稿、预览、确认、人物资料编辑与移除，以及当前世界和不可改迁居事实。通过内部接口校验会话和写入授权。 | 专用的人物服务数据库。 |
| [conversations](services/conversations/) | 原聊天页文字发送、历史分页、删除、首页摘要，以及独立 Worker 的模型回复、任务取消与恢复。 | 专用会话数据库，pg-boss 与业务写入同事务。 |
| [memories](services/memories/) | 用户确认的原文、AI 整理候选、修订、移除、星图检索，以及不依赖珍藏的画像／获准聊天自动长期文字记忆。 | 专用记忆库；珍藏确认序号与原文保持独立，自动来源／收据／任务／条目单列，独立 Worker 消费 `memory.extract.v1`。 |
| [social](services/social/) | 原空间的私人文字／配图动态、手动点赞／评论、People 已提交迁居事实的读投影，以及新授权下珍藏回响与所属人物评论。 | 专用动态库；保存帖子的有序媒体引用，图片字节归 Media。独立 Node.js Worker 使用同库 pg-boss。来源 receipt、任务与投递同事务，经内部 HTTP 核验其他领域，不直接读取其数据库。 |
| [media](services/media/) | 私人空间、人物、旅途留影与聊天单图的上传／规范化、精确来源绑定、私有读取、临时输入清理、导出及擦除。仅聊天单图在独立看图授权下向当前视觉任务提供规范化字节；其余图片用途不授予模型处理。 | 专用 Media 数据库、独立处理／清理 Worker 与 S3 兼容私有对象存储；服务间只传受控元数据，不跨库写入。 |
| [gifts](services/gifts/) | 版本目录、试用账本、可靠投递、真实 AI 回礼、收件／陈列与站内通知；支持独立赠礼和回礼用途及数据权利。 | 专用 Gifts 数据库保存源寄件、生成任务、来礼和通知；扣减／回执／冲正仍同库事务；People 和 Conversations 只通过锁外受控 HTTP 协作。 |

人物照片、私人动态、旅途留影与聊天单图已分独立用途接入 Media；音视频、普通动态自动互动、自动世界剧情与正式交易按交付顺序逐步实现。属于同一事务的规则留在同一个服务内，例如赠礼与账本。各服务通过身份契约获取经验证的账号上下文。

R02 真实寄件首片新增独立 Gifts API／Worker（3107）与 PostgreSQL（5439），Identity `011_virtual_gift_storage.sql`、Conversations `006_gift_cards.sql`／`007_gift_card_integrity.sql` 与 Gifts `001_gifts.sql` 增量迁移。用户已确认普通账号不自动发放；仅显式合成名单经受信 CLI 记录测试权益，原预览资产不导入。礼物卡不会进入模型、自动记忆或珍藏。配置 Gifts 后导出覆盖七域，注销必须等待 Gifts，恢复范围扩为八库；此前六域／七库证据不替代新验收。用途撤回停止新写与正常读，独立权利仍可用；旧在途任务不借重授恢复。运行配置见[本机 Gifts](../deploy/gifts-dev/README.md)，原页面／恢复实际记录见[交付接续](../docs/backend-delivery-priorities.md)。

K05 首片复用「我 → 设置 → 隐私与 AI 说明」现有浮层。先确认当前告知，再显式允许 AI 文字处理，关闭不代表授权。存储授权和本机模型名单均不能代替同意；新政策不会自动替用户接受。三个服务的增量迁移与启动说明见各自 README。当前仍限合成资料的开发联调，K05 第二片已接通四域文字导出与账号注销，第三片已完成[本机五库加密备份与隔离恢复演练](../deploy/recovery/README.md)。恢复副本保持限制，不启动 API／Worker，不自动应用备份配置或回放最新删除。完整媒体／交易数据权利、生产恢复切换与可信删除／撤权回放、按需旧资料导入及生产发布仍单独验收。

自动长期文字记忆首片已接入原聊天路径，保留原页面。须在原隐私浮层重新确认告知 v3、允许 AI 政策 v2，权威权限明确带 `automaticMemoryAllowed:true` 才能使用；旧许可和旧任务不会自动扩大用途，旧聊天不默认回扫。画像与新用途下的获准消息经可靠事件异步整理，模型调用前后核对来源及权限，后续回复保存实际引用 ID／版本。更正、来源删除、导出、注销与恢复隔离均覆盖新增数据。原页面真实模型验收及边界见[自动记忆契约](../docs/backend-api/conversations-memories.md#自动长期文字记忆首片2026-11-12)；自动世界剧情、分支记忆及主题级遗忘交互继续分片实现。

R01 首片已将原迁居入口接入 People。People `007_world_movements.sql` 增加独立世界版本与不可改成功历史，Conversations `005_virtual_world_context.sql` 保存实际回复的世界引用；不改变人物、私聊和珍藏身份。迁居同事务更新状态并发布 `PersonWorldChanged.v1`、`PersonUpdated.v1`，旧命令回放当前态。迁居免费、无需 AI 授权，聊天继续校验现有 AI 用途。独立新合成账号已通过原 UI 迁居／刷新／往返、真实 OpenAI 新旧住处接续、无副作用重放、画像来源重建及 OTP 四域导出；后端 People 32、Conversations 80、Identity 24 项回归通过。未开启自动剧情、私人动态或平行分支。契约与验收范围见[R01 聊天接续](../docs/backend-api/conversations-memories.md#r01-迁居与文字聊天接续首片2026-11-12)，五库原生恢复记录见[恢复工具](../deploy/recovery/README.md#本次验证记录2026-11-12)。

R01 私人动态首片已新增独立 Social，沿原空间页接线。Identity 007 增加告知 v4、文字保存用途 v2及明确的 `privateFeedAllowed`，原隐私浮层可分别管理文字保存和 AI；既有旧许可不会自动变成动态许可。原发布／评论等待真实确认后才清稿，重复未知结果沿用稳定意图；迁居标为系统「迁居记录」，保留历史世界快照。Social 配置后数据权利为五域，恢复范围为六库；未配置的旧部署维持四域／五库兼容，不补造缺失域。部署见[Social 本机说明](../deploy/social-dev/README.md)，实际验收记录以[交付接续](../docs/backend-delivery-priorities.md)为准。

R01 珍藏回响薄片在原空间结构内增加服务端生成能力。部署增量为 Identity `008_private_feed_processing.sql`、Memories `006_social_memory_sources.sql`、Social `002_memory_echo.sql`；People 使用包含 Social 专用画像／虚拟世界上下文的当前 API。先构建、迁移并重启源服务，最后启用 Social API 与独立 `echo-worker.js`，不改已应用迁移。沿用告知 v4、文字保存用途 v2，用户须在原隐私浮层明确允许 AI 政策 v3，当前权威许可同时带 `privateFeedProcessingAllowed:true`。旧许可、新配置和本机模型名单都不代替同意；旧原文／评论不默认回扫，旧失效任务不借新授权恢复。

只有新确认／主动修订的珍藏原文可以生成所属人物署名的 AI 回响，其下新 self 评论可以获得同一人物回应。普通用户帖、迁居记录、AI 评论、未确认候选和自动记忆条目不因此送模型，不自动点赞或触发业务动作。生成前后核对来源、授权、画像与虚拟世界；来源失效会撤下旧引用及其依赖回应。原文／用户评论不随模型失败回滚，已保存 AI 结果在 AI 撤回后仍依当前存储／来源权限读取、导出和删除。

Social API 只读取服务配置；`SOCIAL_AI_ENABLED` 默认关闭，启用时须提供 `XIJIE_MEMORIES_URL`，API／Worker 使用相同 `SOCIAL_QUEUE_SCHEMA`。Worker 通过 Social 专用凭据调用 Identity／People／Memories，另读取忽略的 `MODEL_*` 配置和明确合成账号白名单；本阶段仅接已授权 OpenAI endpoint，生产环境禁止实际模型调用。新 `/v1/social-generation-jobs` 供原空间轻提示查询／重试／取消，不增加任务页面。账号擦除清理全部历史派发；来源 ack、任务和队列纳入五域数据权利与六库隔离恢复，恢复副本不启动业务进程。配置、启动依赖及故障边界见[Social 运维说明](../deploy/social-dev/README.md#珍藏回响-worker)。

本片源码编译与29项隔离回归通过，涵盖实际 HTTP／PostgreSQL／pg-boss 与 SDK 假 wire，不能替代真实模型及原页面验收。实际联调结果由根任务补记在[交付接续](../docs/backend-delivery-priorities.md)；Android 安装版、其他客户端及生产发布仍须单独验收。

R01 私人空间配图使用独立 Media 服务和 S3 私有对象存储，沿原「空间 → 发动态 → 选图 → 发表 → 点击图片查看」接通1–9张图片及纯图片帖子。新增 Identity `009_private_photo_storage.sql` 和 Media `001_media.sql`；Social 按 `001_social.sql → 002_memory_echo.sql → 003_private_post_media.sql` 顺序追加迁移，不重写已应用的002。Social 拥有帖子／有序 `post_media`，Media 拥有实际成品及用途绑定；先预绑定、再在 Social 本库提交，读取时核对已提交来源，不能把跨服务调用当成一个 SQL 事务。准备各域凭据及 Media／S3 后，再重启涉及的 API／Worker 和原 Web 代理。配置、启动与处理边界见[Media 服务](services/media/README.md)及[本机部署](../deploy/media-dev/README.md)。

009只新增独立 `private_photo_storage` 政策 v1 与权威 `photoStorage:{allowed,authorizationVersion}`。保留告知 v4、文字存储 v2及 AI v3，原「我 → 隐私与 AI 说明 → 私人照片保存」明确允许后，才开放上传／配图发布／正常读图；文字空间授权也必须有效。旧文字／AI grant、选图和配置不能授予照片用途，照片撤回也不改变文字或 AI 授权。图片只用于私人展示，不送 AI；重新允许可读取仍有效的本人ready成品，旧槽／未完成任务不能借新版本授权自动恢复。已获准的数据导出／注销与正常照片读取分开，不要求重新授予照片用途。

配图的六域导出包含实际图片字节／SHA-256；配置 Media 后，注销必须等待 Media 及提供方全部完成，不能因对象存储故障跳过。恢复范围随之增加为七个数据库及独立对象字节／清单，不能从旧六库或纯数据库演练推导图片已恢复。原页面联调、数据权利、删除与恢复的实际完成状态统一见[交付接续](../docs/backend-delivery-priorities.md)，未完成的演练或擦除不在本说明中提前记为通过。

## K01 Web 本机联调

使用 Node.js 22 与 pnpm 10。先按 [身份服务联调环境](../deploy/identity-dev/README.md) 启动 PostgreSQL 与 Logto，登记传统 Web 应用的回跳 `http://127.0.0.1:5184/v1/auth/callback`，启用本机官方 mock SMS 及手机号验证码登录、注册。将 OIDC 配置和业务数据库连接写入本机忽略的 `.tmp/identity-dev/server.env`。所需环境项为 `DATABASE_URL`、`OIDC_ISSUER`、`OIDC_CLIENT_ID`、`OIDC_CLIENT_SECRET`、`OIDC_CALLBACK_URL`。

迁移命令按顺序应用 `001_identity.sql`、`002_consents.sql` 和 `003_embedded_auth.sql`。第三份迁移建立短时短信挑战、幂等约束及并发状态；Logto Cookie、交互上下文和可重放的会话结果在身份库中加密保存，验证码生成和校验仍由 Logto 负责。

```powershell
cd backend/services/identity
pnpm install --frozen-lockfile
pnpm build
node --env-file=../../../.tmp/identity-dev/server.env dist/migrate.js
node --env-file=../../../.tmp/identity-dev/server.env dist/main.js
```

另开一个 PowerShell，从仓库根目录启动前端。

```powershell
$env:VITE_XIJIE_AUTH_MODE = 'service'
$env:XIJIE_IDENTITY_URL = 'http://127.0.0.1:3101'
pnpm dev --host 127.0.0.1 --port 5184
```

打开 `http://127.0.0.1:5184`，在原西界登录页填写手机号、获取验证码，再在原验证码页完成登录。前端调用 `POST /v1/auth/sms-challenges` 和 `POST /v1/auth/sms-challenges/{id}/verify`，身份服务在后台完成 Logto 交互和 OIDC 换证，成功后写入应用会话 Cookie，进入「相见」。首次验证的手机号按已验证身份注册；已有用户沿用原 `issuer/sub` 账号映射。从「我 → 账号管理」验证切号、取消及退出，刷新时由服务端恢复会话。旧 `/v1/auth/attempts`、`/v1/auth/callback` 保留兼容及回归用途。

本机 mock 将随机验证码写入 Logto 容器内 `/tmp/logto/mock_sms_record.txt`，供本机测试读取；它不会向实际手机发送短信，也没有供浏览器读取验证码的接口。正式短信、原生端回跳与旧本机数据导入仍需按各自批次验收。

`OIDC_FIRST_PARTY_EXPERIENCE` 在非生产环境默认启用，可设 `false` 关闭。生产环境默认关闭，启用前必须确认配置应用的 `isThirdParty=false`，再显式设置 `true`。该开关只允许当前应用的最小 `openid` 技术授权；额外 scope、资源或组织授权会停止流程。登录页业务协议、隐私告知和文字保存授权分别处理。

账号存储回归测试通过 `pnpm test` 启动。先构建服务，将 `XIJIE_TEST_DATABASE_URL` 指向允许创建测试 schema 的 PostgreSQL 测试库。测试覆盖注册并发、短信挑战幂等与重放、切号取消、旧会话失效及事务回滚。发码重试复用原幂等键，验证码提交重试仅复用同一键和同一码；用户修改验证码时创建新的幂等键。已退出登录的会话不能被旧验证结果重放恢复。接口状态和错误处理见 [身份接口契约](../docs/backend-api/identity-people.md#1-身份引导和会话)。

## K02 文字人物本机联调

按 [人物服务联调说明](../deploy/people-dev/README.md) 配置独立数据库及服务凭据。身份服务校验登录会话和文字保存授权，人物服务校验每份草稿的归属。两个服务分别运行各自的迁移与进程。

人物资料页沿用原「关于 TA → 编辑」浮层保存七项资料，成功后按服务端版本更新。移除沿用原确认浮层；墓碑状态与访问撤权事件同事务提交，人物、源草稿、预览和旧命令重放均不能恢复已移除资料。该批次为逻辑移除，媒体与其他领域的清理消费者按后续服务接入验收。

- [后端架构](../docs/backend-architecture.md)
- [API 契约](../docs/backend-api-contract.md)
- [身份接口](../docs/backend-api/identity-people.md)
- [实施顺序](../docs/backend-delivery-priorities.md)


数据权利编排继续归 Identity，独立 Worker 通过受控 HTTP 调用各域，不能直连其他数据库。入口是原「隐私与 AI 说明 → 导出我的数据」与「账号管理 → 注销账号」。注销前专用 OTP 重验保留原 sessionId，受理即冻结旧会话；各域本地擦除围栏防迟到写入复活。配置 Social／Media 的当前部署必须完成 People、Conversations、Memories、Social、Media 五个数据域和自有租户 Logto 凭据清理；导出同时包含 Identity，共六域。未配置 Media 的旧部署仍保留其五域范围，不能补造或忽略已启用域。后台任务与配置见[Identity 数据权利](services/identity/README.md)。

R02回礼增量新增 Identity012 独立 `giftReturns`、Gifts002与独立 `return-worker`、Conversations008 incoming来源。原UI零余额免费寄件触发真实OpenAI回礼、通知／拆开／陈列和未知结果重试已验；七域撤权导出、八库165表恢复及合成账号注销通过。默认不启AI，测试名单与开关在清理后关闭；真实付款／Android与生产不在本片验收范围。当前完整接续及证据见上述交付接续。


R02旅途留影增量新增 Identity013 独立 `giftPhotoStorage`、Gifts003照片与永久命令、Media003用途与版本绑定。原44秒动画实际canvas生成留影，完整重看替换、提前结束保留、成功响应丢失后刷新原键恢复已验；留影不改寄件版本、账本或AI来源。新合成账号七域撤权导出实际WebP、八库168表与2对象隔离恢复，以及原UI注销／只读清理复核通过。当前15个本机角色运行，回礼AI测试开关关闭。完成范围及证据见交付接续。
