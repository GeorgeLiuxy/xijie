# 私人动态本机联调

Social 独立运行于 `127.0.0.1:3105`，PostgreSQL 使用独立数据卷和回环端口 5437。API 保留原空间的文字／配图发布、点赞／评论和已提交迁居投影；配图字节及处理归独立 Media 服务，Social 只保存有序引用。珍藏回响与所属人物评论由独立 Node.js Worker 处理，pg-boss 与业务任务共用 Social 本域数据库。API 不加载模型密钥。

先启动 `identity-dev` 的 Logto 与数据库，保留其 `xijie-identity-dev_default` 网络。私密配置写入忽略目录 `.tmp/social-dev/compose.env` 和 `server.env`，字段参考 [服务模板](../../backend/services/social/.env.example)。`XIJIE_SOCIAL_DB_PASSWORD` 使用独立随机密码；`XIJIE_SOCIAL_SERVICE_TOKEN` 使用独立 256 位凭据，只登记到 Identity／People／Memories／Media 的 Social 对应角色。Media 使用另一个独立 `XIJIE_MEDIA_SERVICE_TOKEN` 调用 Identity 和 Social 的受控来源接口，不可用 Social token 代替。数据权利仍使用独立的 `XIJIE_DATA_RIGHTS_SERVICE_TOKEN`，不要互换，也不要复用 Conversations／自动记忆凭据。

```powershell
docker compose --project-name xijie-social-dev --env-file .tmp/social-dev/compose.env --file deploy/social-dev/compose.yaml up -d --wait
```

使用 Node.js 22 以上版本和 pnpm，分别安装、构建所涉及服务。新部署先完成原有迁移，再迁移以下增量；原有 001 与已应用迁移均不得改写校验和：

| 服务 | 本片要求 |
| --- | --- |
| Identity | 在008后追加 `009_private_photo_storage.sql`，新增独立照片用途 v1／`photoStorage`；保留告知 v4、文字保存 v2及 AI v3，旧许可不扩展 |
| Memories | `006_social_memory_sources.sql`，新增 Social 来源事件的独立 ack；使用包含新事件捕获逻辑、来源正文及有效性接口的 API |
| Social | 原001后依次应用 `002_memory_echo.sql`、`003_private_post_media.sql`；003追加有序 `post_media` 与文字或图片至少一项的约束，002不改 |
| People | 使用包含 Social 专用画像／虚拟世界上下文接口的当前 API；本片没有 People 新迁移 |
| Media | 新服务 `001_media.sql`，独立3106／5438及私有S3；先创建私有bucket并确认匿名拒绝，再启API和图片Worker |

先保持 `SOCIAL_AI_ENABLED=false`、停止 Social Worker，从仓库根按顺序运行各服务的原迁移器：

```powershell
node --env-file=.tmp/identity-dev/server.env backend/services/identity/dist/migrate.js
if ($LASTEXITCODE -ne 0) { throw 'Identity migration failed.' }
node --env-file=.tmp/memories-dev/server.env backend/services/memories/dist/migrate.js
if ($LASTEXITCODE -ne 0) { throw 'Memories migration failed.' }
node --env-file=.tmp/media-dev/server.env backend/services/media/dist/migrate.js
if ($LASTEXITCODE -ne 0) { throw 'Media migration failed.' }
node --env-file=.tmp/social-dev/server.env backend/services/social/dist/migrate.js
if ($LASTEXITCODE -ne 0) { throw 'Social migration failed.' }
```

Identity 配置 `XIJIE_SOCIAL_URL=http://127.0.0.1:3105` 后，导出／注销必须包括Social；再配置 `XIJIE_MEDIA_URL=http://127.0.0.1:3106` 后还必须包括Media，共六域，任一已配置域故障不得跳过。未配置新域的旧部署保持原有范围。Social 的 `XIJIE_MEDIA_URL` 指向Media，并登记Media自身来源凭据；Media反向配置Social URL以核对已提交帖子。重启 Identity API／数据权利 Worker、People API、Memories API 及相关现有 Worker，确认Media API／图片Worker就绪，然后在另一个终端启动 Social API：

```powershell
Set-Location -LiteralPath 'D:/AI/xijie figma/backend/services/social'
node node_modules/typescript/bin/tsc -p tsconfig.json
node --env-file=../../../.tmp/social-dev/server.env dist/main.js
```

Web Vite 使用 `VITE_XIJIE_AUTH_MODE=service` 和六个领域 URL，其中 `XIJIE_SOCIAL_URL` 只代理公开 `/v1/feed`、`/v1/posts`、`/v1/social-generation-jobs`，`XIJIE_MEDIA_URL`只代理公开 `/v1/media`。内部来源或数据权利端点不暴露给客户端。

原「我 → 隐私与 AI 说明」管理文字保存、私人照片保存及 AI，用途互相独立。文字动态要求当前告知 v4、文字保存用途 v2的 `storyStorage.allowed && privateFeedAllowed===true`；配图另需用户明确允许 `photoStorage.allowed`。009不会更改文字／AI grant，照片不交模型。原空间的发布／点赞／评论接同一账号的真实服务，迁居只投影 People 已提交事实并标为「迁居记录」。原「空间 → 发动态」支持1–9张JPEG／PNG／WebP、纯图发布、点击图片前后查看；上传／处理失败保留原草稿，未知发表结果复用同一clientPostId／幂等键／媒体列表，不产生演示互动或重复帖子。

各领域只访问自己的数据库。Social 每个人物固定本次世界版本，分批读取连续迁居，在本库事务内保存唯一来源及同步水位；返回或互动时再核验所用事实及当前人物权限。配图在Media预绑定、Social本库提交有序引用；预绑定不能读，正常读图须在Media校验会话／用途／授权并向Social核对当前关联，删帖立即使旧证明失效。Media负责输入规范化、临时输入及成品清理，不把跨服务调用写成一个本库事务。契约见[私人文字动态与迁居投影](../../docs/backend-api/conversations-memories.md#r01-私人文字动态与迁居投影本轮实施基线)及[配图实施基线](../../docs/backend-api/identity-people.md#r01-私人空间配图实施基线2026-11-13)，部署见[Media说明](../media-dev/README.md)。

当前恢复范围是七库加私有对象字节／清单，旧五／六库包保留原边界。数据库恢复不能单独证明图片已恢复；隔离副本不启动API／Worker，不自动启用源配置。原页面、六域导出／擦除、数据库及对象恢复的实际完成证据统一记录在[交付接续](../../docs/backend-delivery-priorities.md)，未完成的收尾不得提前记通过。

## 珍藏回响 Worker

Social API／Worker 共用以下服务配置，只有 Worker 另外读取模型文件：

| 配置 | 用途与默认值 |
| --- | --- |
| `XIJIE_MEMORIES_URL` | Memories API，本机为 `http://127.0.0.1:3104`；启用回响时必须提供 |
| `SOCIAL_AI_ENABLED` | 默认 `false`；显式 `true` 后 API 才登记生成任务，Worker 才允许启动；它不代表用户同意 |
| `SOCIAL_QUEUE_SCHEMA` | 默认 `social_queue`；API、Worker、擦除与恢复策略必须使用同一个 schema |
| `MODEL_BASE_URL`／`MODEL_NAME`／`MODEL_API_KEY` | 仅 Worker 从忽略的模型文件读取；本阶段仅允许 `https://api.openai.com/v1`，禁止传给浏览器和 API |
| `MODEL_ALLOWED_ACCOUNT_IDS` | 仅 Worker，明确选定的合成账号 UUID，逗号分隔、最多100个；空名单拒绝启动，不授予业务用途 |

Identity、People、Memories API 以及 Social 数据库就绪后，审查指定合成账号的来源待处理量与任务状态，再显式开启 `SOCIAL_AI_ENABLED=true` 并重启 Social API。Worker 可复用已有忽略的 `.tmp/conversations-dev/model.env`；另用忽略的 `.tmp/social-dev/scope.env` 仅登记本轮明确选定的合成账号范围。下面路径是启动模板，不应把私密值写入仓库：

```powershell
Set-Location -LiteralPath 'D:/AI/xijie figma/backend/services/social'
node --env-file=../../../.tmp/social-dev/server.env --env-file=../../../.tmp/conversations-dev/model.env --env-file=../../../.tmp/social-dev/scope.env dist/echo-worker.js
```

网络依赖代理时，沿 [Conversations 的本机代理说明](../conversations-dev/README.md) 只配置 Worker，并在支持的 Node 版本加 `--use-env-proxy`；无需修改系统网络设置。API 继续只加载 `server.env`。本阶段 `NODE_ENV=production` 拒绝实际模型调用，合成账号白名单不能绕过这一限制。

用户需在原「我 → 设置 → 隐私与 AI 说明」浮层明确允许 AI 政策 v3，权威上下文同时满足当前文字保存／私人空间权限及 `aiTextProcessing.allowed && privateFeedProcessingAllowed===true`。旧 AI v2、缺失标记、配置开关和模型名单均不代替授权。只有当前授权下新确认／主动编辑原文的正式事件可以安排回响；旧事件标记0不会因后来授权被回扫。新回响内的 self 评论可以安排其所属人物回应，普通用户动态、迁居记录、AI 评论和无关历史不触发模型。

Worker 每5秒拉取受控来源元数据，业务 receipt 与任务投递提交后逐条 ack。AI 撤回后仍处理来源失效元数据，不能仅因无 AI 权限就停止消费删除事件。正文、完整画像与虚拟世界只经受控接口在生成边界读取，调用前后复核准确授权、来源、人物和世界版本；所有跨服务调用在本库事务外。未配置模型时任务可查为 `failed / MODEL_NOT_CONFIGURED`，原文和用户评论继续保存，不产生假回响。

`GET /v1/social-generation-jobs/:id` 查状态；`POST .../:id/retry|cancel` 使用 `{}`、原登录会话、登记 Origin、稳定 `Idempotency-Key` 和当前 `If-Match: "vN"`。最多三次领域尝试；原空间使用已有轻提示读取 `meta.generationStatus.retryableJobIds`，不新建任务页面。撤权、源编辑／删除、租约接管或取消后，旧任务不会借新授权恢复；重启 Worker 也不能恢复已失效内容。停止时向模型发取消信号并释放可恢复尝试；物理派发耗尽可查为 `DELIVERY_EXHAUSTED`，后续仍需显式合法重试。

账号擦除包括 Social 正文、互动、来源、任务及同业务 jobId 的全部历史 pg-boss 派发。新增表、队列 schema 和来源 ack 均须纳入现有六库备份／隔离恢复策略；恢复副本不得启动 API／Worker或调用模型。详见[珍藏回响实施契约](../../docs/backend-api/conversations-memories.md#r01-珍藏回响与所属人物评论本轮实施基线)及[恢复工具](../recovery/README.md)。

## 本机验证边界

源码基线编译与29项隔离回归通过，包含实际 Nest HTTP、真实 PostgreSQL／pg-boss、SDK 假 wire、旧许可不补扫、源变更、取消／租约接管零模型调用、ABA、继承评论断链、导出与全部历史派发擦除。测试只创建随机 schema，不使用真实账号或真实模型；启动提示不等于模型成功，隔离测试也不等于原页面端到端通过。

原页面真实模型、刷新回读、失败重试和来源撤回等实际结果由根任务补记在[交付接续](../../docs/backend-delivery-priorities.md)。Android 安装版、其他客户端、生产部署、普通动态自动互动、照片／声音／视频、自动世界剧情和交易不包含在本片验收中。
