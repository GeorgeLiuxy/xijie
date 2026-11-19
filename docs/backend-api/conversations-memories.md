# R01 平行故事线与有限离线生活（2026-11-15，本机验收完成）

用户已明确接受本片流程。原世界页增加「故事线与离线生活」入口，在既有 Sheet 中新建／切换故事线、明确开启／暂停离线生活；分支继续使用原人物聊天布局、输入、真实生成反馈及删除。聊天中的折叠回顾显示分开前的共同经历或主线离线近况。本节是这两项能力的当前契约，后文较早分片中“不包含分支／离线”的表述保留为当时的实施边界。

**真实结果。** 全新合成账号从原 OTP、原授权和手填人物开始，原聊天先完成一次正式行动，再从主线同一末端创建两条故事线；主线追加另一行动并迁居。分支 A 在冻结的旧场景中完成一次行动，分支 B 准确回忆分线前的动作和短句，没有读到主线后来的短句或分支 A 的短句。原折叠入口可回读共同经历，刷新后仍可定位和打开两条线，继承经历只读。当前资料共用、场景冻结、实际引用的原始事件身份和兄弟分支隔离均经权威数据核对。

离线计划经原 UI 明确开启，浏览器时区为 `UTC`，服务端自然排到 `2026-11-15T08:00:00.000Z`。到期前暂停 Conversations worker 并确认运行数为零；08:00 后恢复，正式排程生成一条独立来源的虚拟经历，实际模型尝试一次。内容是在当前日光庭院独自短暂散步、看云与日光，没有代用户参与或产生资产／迁居／公开动作；随后原主线真实回应准确回忆该经历及所在地，并保存实际事件引用。两次主线行动、两份分支回应、一次离线经历和一次主线回忆合计六次真实 OpenAI 成功结果；没有模板成功或伪造用户消息。

**未知结果和权限。** 原分支 POST 已真实受理后丢弃回包，前端随后从历史中找到相同 `clientMessageId` 的权威消息，自动恢复已受理状态、显示唯一源并清空输入。这是**一次 POST 后的历史读取恢复**，不是第二次相同 key 的 POST；最初 runner 强等手工重放而失败的记录保留，后续原 UI 回读证明没有重复源。相同 key/body 的接口及适配器重放另由专项测试覆盖。原 UI 撤回再重新授予故事分支用途后，这条旧排队任务在 worker 启动复核时被阻断，attempt 为 0、无模型 provenance、无回复；保存的分支历史仍可读。离线计划最终从原 UI 暂停，未改变时钟、排程日期或任务成功状态来完成验收。

**恢复、来源失效和清理。** 原 UI 第一份七域导出逐域 revision 通过，包含 2 条分支、5 条分支消息、3 个分支任务、1 个分支事件、1 个计划、1 个离线运行及 3 个有效主线事件。随后八库 210 表原生备份恢复通过，备份 `20261115080612921-9d23e139`、run `67ba0e7be42440a2`；本片完整 source／权限／分线／离线来源校验、保留成功事实、停止任务与计划、物理队列隔离、八库及对象 `sourceUnchanged`、副本 cleanup 均通过，`releaseReady=false`。恢复后从原聊天删除第一条主线行动源，3 个主线事件（含派生离线事件）与 1 个分支事件递归失效，已保存回复仍保留。第二份原 UI 导出含 0 个有效事件，历史任务和离线运行事实仍在，七域 revision 再次通过。原 UI 注销后，独立只读核对七域 93 张私有账号表、相关物理队列、对象前缀及实际 Logto 用户均为零；17 行必要围栏／回执保留，会话、授权、OTP和服务端导出副本清理。专用模型 scope 已删除，Conversations worker 恢复基础配置，16 个角色均为单实例。`.tmp/story-controls-dev` 仅留受保护证据，账号已注销，禁止重跑／复用；未来从所留加密备份恢复仍须应用最新删除／撤权检查点。

**验证范围。** Conversations 最新完整隔离回归 223/223，相关 TypeScript 编译通过；本片恢复适配及隔离反例 23/23，统一恢复回归 127 通过、1 个默认跳过由本次实际原生演练补足。冻结前端最终 171 项通过。真实验收覆盖上述有限叙事、自然一次到期、撤权、来源删除、导出、原生恢复和擦除，不证明任意自然语言理解、长期连续运行、Android 安装版或生产发布。验收工具曾在新增授权入口、迁居定位、撤回 API 枚举和未知结果断言上失败，原证据保留；核对已受理身份后只修工具，不改成功任务或重造模型结果。

## 权威、授权与上下文

- People 继续拥有当前人物资料、住处与迁居事实。Conversations013 新建 `story_branches`、`story_messages`、`story_jobs`、`story_events`、`offline_life_plans`、`offline_life_runs`。没有新增服务或数据库，也没有把分支写成 People 迁居或旧真实用户记忆。
- Identity021 新增独立 `person_story_branches` v1 → `storyBranches` 与 `person_offline_life` v1 → `offlineLife`，均精确绑定 `privacy_notice`，旧授权不自动扩大。新分支创建／回应需 `storyStorage + aiTextProcessing + storyBranches`；离线开启／运行还需 `offlineLife + worldActionProcessing`。已存文字与回顾按 `storyStorage` 读取；暂停、删除、导出和注销不以重新授予 AI 为前提。撤回或授权版本变化阻断旧任务，重授不复活。
- 只能从该人物主线的**当前末端**创建分支，受理时在本域事务中锁定主线，保存不可变 `fork_sequence`／`fork_event_revision` 和 People 世界快照。分支 `conversationId` 等于分支 ID，所有请求显式带目标；不存在账号全局 active branch。主线迁居不会改变分支场景。
- 新人物资料和用户主动珍藏是共同背景；聊天与后来虚拟事件按线隔离。分支只继承 fork 前主线正式事件的原始 refs，不复制成新的事实、不继承主线旧消息流，不读取兄弟线或 fork 后主线事件，也不合并结局。发生时世界／阶段与分支当前冻结场景分开说明。
- 模型上下文使用该线最近 20 条有效文字、最多 8 条当前获准珍藏及最多 8 条直接检索事件；传递来源闭包保留最多 256 个消息、64 个珍藏和 32 个事件引用。父回复的消息／记忆／事件依赖会传递到后续结果，即使原始正文已离开 20 条窗口也不能丢失删除或撤权关系。跨域验证在事务外完成，模型前、模型后和提交前复核授权、人物、世界及来源；SQL 锁后再次核对本地引用、叙事 revision、attempt 和数据库时钟租约。
- 分支消息独立入表，统一 `generationKind:'story_reply'`、`canSuggestMemory:false`、`sourceDomain:'virtual_context'`；从源头排除旧 automatic 用户事实提取及候选珍藏。主线既有聊天、搜索、照片、书信、小聚和礼物约束保留。
- 真实 provider 仅非生产、精确 OpenAI `/v1` 和明确 `MODEL_ALLOWED_ACCOUNT_IDS`，SDK `store:false`、`maxRetries:0`。独立 permission 与旧 AI 的准确授权版本由 provider 再校验；白名单序列化不发送内部 ID、凭据或额外字段。分支输出严格 `chat | clarify | execute`，execute 的逐字 requestQuote 必须来自本轮源；离线输出严格 `none | event`，none 不产生事件。分别保存 `person-story-branches-v1`／`person-offline-life-v1` 的真实 model、responseId 和 provenance；失败不回退成模板成功。

## 离线排程与事件来源

默认关闭，授权后仍需为人物显式开启。首次开启固定一个 IANA 时区，取该时区严格晚于当前时刻的合法 08:00；之后持续至用户暂停，不擅设七天期限。关闭再开不能改变已固定时区，时区冲突返回 `409 TIME_ZONE_LOCKED`。每人物 UTC 日期及本地日期均唯一，并有最近 24 小时／在途运行预算；至多一天一次，不因重开或时区操作多发，不补跑已错过的旧日期，不递归安排下一段剧情。

运行保存独立 `plan_snapshot`、`plan_version`、UTC/local day key 与实际 scheduledAt，当前场景在执行时取 People。成功事件复用 `person_world_events` 的正式 main 事件机制，`source_kind:'offline_life'`、`life_run_id` 指向真实运行，`job_id/source_message_id/reply_id/source_author` 均为空；不伪造用户发言。后续真实主线检索会使用仍有效的离线事件，并保留完整递归引用。删除其依赖源会使派生事件失效，历史运行事实保留。

`story.reply.v1` 与 `world.life.v1` 复用现有 Conversations worker／pg-boss；受理事实、永久命令、业务任务和队列在同库事务提交，成功回复／事件／任务完成／Outbox 同事务。每个任务最多三次业务尝试，租约失效及中断计入预算；暂停版本变化、删除源、撤权、账号擦除阻止迟到结果。没有公开离线“立即补跑”或绕过日预算的入口。

## 公开接口

所有写入沿现有 session fence、UUID `Idempotency-Key`、严格 body 和账号归属；外部 HTTP 不在 SQL 事务锁内。创建分支、发送和离线设置的永久回执重放返回当前权威状态，不重新分线或生成旧结果。分支列表和事件列表使用 `cursor/limit` 与 `meta.nextCursor`，游标绑定账号、目标、limit 和完整 revision；变化返回 `409 SOURCE_CHANGED`。分支消息使用 bigint sequence 的 `direction=older|newer`、cursor、limit，返回 `nextCursor/afterCursor`，沿现聊天分页语义。

| 方法与路径 | 请求与结果 |
| --- | --- |
| `GET /v1/persons/:personId/story-branches` | 当前人物分支列表；无分支返回空列表。 |
| `POST /v1/persons/:personId/story-branches` | `{name}`，非空、最多 80 Unicode 字符；201 Branch DTO。 |
| `GET /v1/story-branches/:id` | Branch DTO，并返回版本 ETag。 |
| `GET /v1/story-branches/:id/messages` | 本线文字历史；不会复制主线共同历史消息。 |
| `POST /v1/story-branches/:id/messages` | `{clientMessageId,kind:'text',text,inputMode:'typed'}`；202 `{message,generationJobId,generationKind:'story_reply'}`。 |
| `DELETE /v1/story-branches/:id/messages/:messageId` | `If-Match` + key，200 `{id,version,removedAt}`；同键返回当前 tombstone。删源停止未完成任务并使派生事件失效。 |
| `GET /v1/story-branches/:id/events` | 本线及继承主线事件，含 `origin:'inherited_main'|'branch'`、原 ID／版本／世界阶段、摘要、memory、发生时间和 `readOnly:true`。 |
| `GET /v1/story-generation-jobs/:id` | 既有任务 DTO，`kind:'story_reply'`；成功 replyIds 不因重试改写。 |
| `POST /v1/story-generation-jobs/:id/retry`、`.../cancel` | 空 body + key；沿任务状态与三次预算，不复活旧授权任务或成功结果。 |
| `GET /v1/persons/:personId/offline-life` | 初始纯读 `{personId,enabled:false,timeZone:null,version:1,nextRunAt:null,lastRunAt:null}`。 |
| `PUT /v1/persons/:personId/offline-life` | `If-Match` + key；开启 `{enabled:true,timeZone}`，以后可省略已固定 timeZone；暂停 `{enabled:false}`。返回当前设置及 ETag。 |
| `GET /v1/persons/:personId/offline-life/events` | 分页回顾有效离线事件：`{id,version,occurredAt,recordedAt,summary,memory,worldId,worldVersion,source:{kind:'offline_life',runId},aiGenerated:true}`。 |

Branch DTO 为 `{id,conversationId,personId,name,version,createdAt,scene:{world,worldVersion},fork:{conversationId,messageSequence,eventRevision},canSend}`。`worldVersion` 始终是该人物的阶段版本，不创造世界全局版本。普通历史超出受支持完整预算返回 `413 HISTORY_TOO_LARGE`，不静默截断。

导出新增 `storyBranches/storyMessages/storyJobs/storyEvents/offlineLifePlans/offlineLifeRuns` 六数组，保留当前有效正文和必要历史运行／引用，按完整 snapshot 计算 revision。账号擦除覆盖六表、源事件、永久命令、Outbox 与两类物理队列，并用本域擦除围栏拒绝迟到 worker。恢复资源种类分别为 `story_branch/story_message/story_job/story_event/offline_life_plan/offline_life_run`，计划以同账号 personId 为资源 ID。`validateStoryControls(runtime,targets)` 与 `world-actions.mjs` 联合验证 owner、fork cutoff、冻结场景、闭合来源、历史授权、每日唯一、真实独立运行和成功内容；隔离只改变待执行任务控制字段并关闭计划，保留 `plan_snapshot`、尝试预算、成功状态、事件和回执，不制造授权事件。

# R01 迁居后的连续虚拟经历（2026-11-15，本机验收完成）

沿原「关于 TA → 世界 → 迁往 → 原聊天」接通同一人物的主线往事。全新合成账号已通过潮汐回廊→日光庭院→潮汐回廊的原UI及真实OpenAI闭环：第一次挥手两次并说「青舟到岸」，迁居后准确回忆旧发生地并指出当前新居；在新居点头一次并说「星桥见月」，迁回后准确区分两次过去经历及当前所在地。四轮首次结果均保留，各业务尝试1；同一人物／会话，三阶段、两个正式事件、四份回复，两次回忆零新增事件。人物、会话、原历史与珍藏身份不变，无新页面、分支或离线调度。

**来源与权利验收。** 独立只读134项核对原UI请求／正文／永久键与权威四库；回忆在旧双方原文排除下实际引用事件，三轮依次引用1／1／2个历史事件。测试期间生成了11条画像自动记忆，行动任务对画像引用为0，未靠关闭整个自动记忆系统绕开迁居反例。原隐私撤用途后，第一次七域导出含2事件／4任务／8消息；原聊天删除第一阶段行动源后，两阶段的2个事件均停止使用，实际校验器拒绝3份继承任务的旧引用，已存回复仍可读。第二份导出含0有效事件／4历史任务／7消息，两个包均逐域revision核对。随后原UI注销，独立查69张私有表、物理队列、对象前缀和实际Logto用户均清理；17行必要围栏／收据等保留。15角色恢复base，无活动任务，专用scope已移除。

**回归与恢复。** Identity60、People52、Conversations207、前端149项通过；相关TypeScript及service-mode构建通过。恢复94项通过、1项默认原生跳过由本次实际演练补足：八库179表，备份 `20261115050428307-91adb1a9`、run `13d7b67e01bf43b8`，核对新版政策和4任务／2事件／4回复的跨阶段来源，源未变、隔离副本清理、`releaseReady=false`。736个Git候选文件和26个浏览器JS包无私密配置。`.tmp/world-history-dev`仅留受保护证据，账号已注销，禁止重跑／复用；加密备份与证据档案保留，未来恢复发布仍需最新删除／撤权检查点。

**验证边界。** 真实模型只验证上述有限主线场景，不证明任意自然语言均正确，也未验收分支、离线调度、Android安装版或生产。原UI迁居脚本首次因复合dialog可访问名称选择器超时，未发出迁居请求；核对未提交且世界版本未变后修正定位，继续同一账号，未重复模型轮次。pnpm自动安装检查、service构建输出目录及首次扫描路径诊断保留；改用已安装TypeScript与正确产物位置后通过，未以这些局部检查代替真实效果。

- 授权：Identity 新增019与 `person_world_actions` v2（`76165f61-1809-493b-9d3c-414a65641569`），政策能力 `world_event_history_enabled` 默认 false，明确同人物有效主线事件可跨迁居回忆。只有当前明确授予的新版政策返回 `worldActionProcessing.historicalWorldEventsAllowed:true`。旧 v1 不自动扩大，精确授权版本仍在受理、模型前后和提交前复核。原隐私授权区域读取新文档并重授，不新增交互。
- 当前场景与历史出处分离：新行动仍只提交到当前 People 场景，保留全部 `world_context_ref` / 人物版本围栏。历史事件引用保留发生时的 `worldId/worldVersion`，只允许同人物、同账号、main 且不晚于当前阶段；回忆不产生新事件。旧阶段的行动与回忆原文不重新混入当前聊天上下文，只取有完整来源校验的正式事件摘要。
- People 权威解析：Conversations-only `POST /internal/v1/persons/:id/world-stages/resolve`，严格请求 `{expectedPersonVersion,expectedWorldVersion,stages:[{worldId,worldVersion}]}`，1..32个唯一阶段。响应 `{accountId,personId,personVersion,currentWorldVersion,stages:[{worldVersion,world,basis}]}`；`basis` 为 `current_catalog` / `arrival_snapshot` / `departure_snapshot`。当前阶段用当前目录，过去阶段≥2用不可变迁入快照，初始阶段用第一次迁出快照。快照只描述阶段归属，不冒称事件当时目录名称；不受最近8条迁居窗口限制。外部授权复核在只读事务之外；失配沿用 `SOURCE_CHANGED`、`DEPENDENCY_UNAVAILABLE`、`NOT_FOUND`。
- Conversations 复用事件表、队列和事件版本；新增模型输入中的明确发生地、迁居阶段和过去/当前标记，提示修订为 `history-v3`，原 `recipient-v2` 记录仍可回读。无跨库 SQL、外键、事务或锁内 HTTP。来源删除、真实记忆撤销/更正和传递依赖继续失效，不因回忆过去而豁免。
- 新版直接提供当前 People 必要资料，不重复输入随人物版本过期的 profile 自动摘要；新检索、历史助手原文和事件完整依赖闭包中的自动条目均仅接收 message 来源。旧版事件若依赖失效或画像自动条目仍保守停用，不重新激活 Memories 条目、不改写旧事件或豁免删除/更正；本片保证的是仍有可用完整来源的经历，不宣称恢复所有旧版本记录。
- 验证覆盖新版重授、旧许可不跨阶段、A→B→A、超过8次迁居、伪造/未来/他人阶段、迁居并发迟到、跨阶段删源传递失效、原UI真实模型效果、独立导出/注销与原生隔离恢复；未完成这些证据前不称本片验收通过。任何旧合成 fixture 均不可重跑；新验收另建独立账号与受保护目录。

# R01 明确虚拟行动实施基线（2026-11-14，本机验收完成）

用户已选择从明确要求的虚拟行动开始，留下正式事件与人物记忆。入口沿原世界页「和你说说话」进入同一人物私聊，继续使用原文字输入、发送、等待、失败重试和删除。服务端判定意图；不新增行动面板、卡片或确认按钮，不以客户端关键词执行动作。本片已完成下列本机验收；世界剧情的分支、离线生活及发行仍有后续工作。

**真实效果及首次失败。** 全新合成账号经原OTP、独立授权、寻找人物和世界入口验证，未操作真实体验账号或复用旧fixture。初稿四份真实模型回复分别保留：明确挥手／说话请求误判chat，原因是将用户受话者误当第二行动者；回忆只是引用请求短句，不算事件记忆成功。修正提示并增加`promptRevision:recipient-v2`、保留v1契约后，相同原句作为新的独立请求首次保存1个正式事件。刷新后回忆准确包含两次挥手及约定短句，实际引用已存事件；新否定／假设两轮均零新增事件。共8份真实OpenAI回复，各尝试1，没有重滚或覆盖初稿失败。

**原流程与权利。** 实际202受理后中断回包，同标签页刷新保留只读原句，原按钮同body／key重放取得同一source／job。停止Worker时撤用途，恢复后旧任务在模型前因精确授权失效blocked，重授不复活。旧文字任务记1次Worker领取，不能写成业务attempt0；它没有模型结果、回复或事件。原搜索真实UUID、居中／高亮／返回关键词通过，随后准确删除新事件源；已存回复仍可读而无珍藏入口，实际上下文校验器拒绝3份后续回复的旧事件引用。第一次在world用途撤回下七域导出含1个有效事件／9个任务；删源后第二份导出含0个有效事件／9个历史任务，两包逐域revision通过。原UI注销后独立只读核对69张私有表、相应物理队列、对象前缀及实际Logto用户清理；17行必要围栏／收据等记录保留。15个API／Worker恢复原配置，专用scope已删除，无活动任务。

**回归与恢复。** Identity57、Conversations最终完整184、前端最终完整149项通过，相关TypeScript及service-mode构建通过；恢复90项通过、1项默认原生跳过另以实际演练补足。备份`20261114132309065-8a7ef0f4`、run`ba1ee50dfec4405c`完成八库179表及对象恢复，核对9个行动任务、1个事件、8份回复与完整来源／历史授权／永久命令；源未变、隔离副本清理、`releaseReady=false`。最终26个浏览器JS包与Git候选文件无私密配置；Android安装版和生产发布未据此验收。

**证据边界。** `.tmp/world-actions-dev`受ACL及Git忽略保护，保存初稿失败、新稿结果、未知回包、两份tagged导出、恢复和独立擦除证据。账号已注销，全部fixture仅留证，禁止重跑／复用。加密备份和验收档案保留，不等同于在线账号数据；此备份早于后来删源／注销，未来恢复发布必须重放最新删除／撤权检查点。有限场景实测不证明任意自然语言意图都能正确判断。过程诊断保留了已修复的导出排序歧义、旧provider构造兼容，以及前端测试漏VM运行标志的问题；未用编译或模拟替代真实模型及UI效果。

- 首片为当前账号、一个人物、其当前世界、`main` 主线中的一次立即、有限、纯叙事虚拟行动。愿望、假设、引用、否定、未来计划、含糊意图和现实要求不能落为事件；含糊时通过原文字回复澄清。迁居、赠礼、支付、资产、其他人物、循环调度、离线生活和分支不在本片。事件保存不宣称画面、背包或持久物件状态已经改变。
- People继续拥有人物、所在世界和迁居；其`worldVersion`只计迁居，不因剧情递增。Conversations内独立`world-actions`模块拥有本片正式叙事事件；事件、其记忆摘要、实际AI回复和任务成功在同库一次事务落定。模型仅提出候选，未提交候选不构成经历。无新服务、数据库或跨库事务。
- 新独立用途`person_world_actions` v1，对应`worldActionProcessing`，与`storyStorage`、旧`aiTextProcessing`同时有效才进入此管线；不自动授予，不扩展旧许可。受理捕获精确新授权版本，模型前后及提交前复核；撤回再授予不复活旧任务。已保存历史可按story读取；后续模型取虚拟事件必须有当前新授权。新授权说明涵盖叙事事件保存、当前文字意图判断、事件生成和后续记忆使用，仍限名单内本机合成验证。
- 复用现有`generation_jobs`和`chat_reply`、原POST文字请求及队列。新增`world_action_authorization_version`（NULL为原管线）、`world_action_decision`（`pending/chat/clarify/execute`，原管线NULL）、`world_event_context_refs`、必要模型出处。受理即标pending；失败、撤权或未知不能冒充chat。正式事件持久唯一关联job/source/reply及人物、世界、迁居版本、虚拟主线；以独立序号和不可变事件摘要保存人物虚拟经历。
- provider新分支输出严格结构`{text,decision,action?}`：只有`execute`含`{requestQuote,summary,memory}`；引用须来自当前源文字，摘要和memory是已要求有限动作的虚拟结果，不能加入未获准副作用。真实模型区分意图，未知结构失败，不用模板补成功。普通旧管线提示与行为保留。
- 事件记录本身是该人物的虚拟经历记忆，按人物/当前世界/当前迁居阶段/main检索有限相关记录并显式标`reality:virtual`；不写入旧自动记忆中的user_reported事实，不自动珍藏或发布。后续回复保存实际事件引用，历史传递也验证完整来源；删除事件源或原回复使该事件及引用它的模型上下文不可用。原已保存聊天正文仍可读，删除不是宣称虚拟时间倒流。
- 在分类完成前，源文字不可由自动记忆或珍藏候选读取。只有`chat`且没有虚拟事件引用的源可回到旧自动来源链；`clarify/execute`、虚拟事件回复和所有携带虚拟事件谱系的上下文永久排除该链。不会等模型判定后才补过滤，避免MessageAccepted被提前消费。
- 提交验证当前scene引用、输入消息/事件版本、人物及精确授权；新增事件和删除源均锁同一conversation，使用数据库时钟复核lease。不在事务或行锁内做HTTP。无模型请求恰好一次保证；同源最多一个已提交事件和回复，未知回包须复用原body/key找回。
- 前端直接文字发送补完整未知意图锁，保存account/person/conversation/body/clientMessageId/idempotencyKey，原结果查明前保留原文并复用同请求。不因页面重开或改句悄悄启动第二次行动。
- 随片补导出、账号擦除、源删除失效、恢复隔离和跨引用校验；真实原UI闭环使用全新合成账号，禁止复用此前已注销fixture，验证一次明确行动、歧义/否定不执行、后续回忆、未知受理、撤权重授、搜索/删除、七域导出/注销与原生恢复。测试/编译不替代真实模型及UI证据。

# 会话、回忆与空间接口

## R01 原聊天单图实施基线（2026-11-14，本机验收完成）

本片接批准版 `53d5293` 直聊更多菜单中的“照片／拍摄”：单张选中即发，无附言、预览确认或新任务页面；文字草稿不充当图片说明。围坐仍只接受文字。沿现有照片解码压缩后上传，服务端仍独立验证实际字节、规范化与剥除元数据。照片消息、真实看图回应、混合历史／摘要／“一张照片”检索／UUID定位、删除、导出、注销与恢复已完成下述本机合成账号验收；Android相机与安装版、生产发布不在该结论内。

**验收结果。** Identity53项、Conversations原153项及新增1项Media适配器反例、Media39项、前端141项通过；SDK改用当前file图片部件后，两项真实SDK序列化检查再次通过，出站仍为实际WebP的image_url数据，不增加模型调用。TypeScript、service-mode构建与私密配置扫描通过。恢复78项通过，1项默认跳过的原生测试由实际八库178表及对象存储演练补足：备份 `20261114104445859-41c39254`，运行 `95230d1e8931473c`；4条原消息、3份单图来源／任务、1份真实视觉回复、2份当前有效图片的跨域关系核对一致，源库未变、副本清理通过，releaseReady仍为false。

**真实效果与原页面。** 全新“看图闭环测试”账号经原OTP及四项明确授权创建一个虚构人物，不自动发资产。撤旧AI文字许可后，原照片入口将只有几何图形的测试图交给真实OpenAI；首次实际生成准确描述两个红圆、一个蓝三角及白色背景，attempt=1，无模板或重生成。实际图片渲染、输入草稿保留、刷新重开、搜索UUID居中高亮／返回关键词、原气泡删除及未过期旧proof立即404通过。删除图片后既有视觉回复保留，珍藏入口关闭；后续文字模型与自动／候选记忆服务端入口均拒绝视觉来源。受理后丢回包，同标签页刷新沿原照片按钮重放保持完全相同key/body/source/job；撤看图许可使待办任务blocked，重授不复活；撤照片保存仅过滤图片，重授恢复仍有效成品。

**审查与证据边界。** 独立审查修正了Media明确拒绝旧ready图片的409被适配成通用SOURCE_CHANGED的问题，现在PHOTO_SELECTION_INVALID释放尚未受理的旧意图并提示重新选择，AUTHORIZATION_CHANGED／未知结果仍保留原意图。验收脚本曾因响应监听先后、图片无alt的定位假设及返回搜索页无标题而失败，原失败记录保留；修正脚本后继续读同一真实生成结果。另一次脚本在真实受理响应尚未回读时过早关页留下的额外源消息也保留，随后与正式撤权案例一起blocked且attempt=0；没有删除失败历史或借重复生成掩盖结果。

**权利与收尾。** 撤回旧AI／story／chatPhoto／chatImage四项后，原UI七域导出各revision与实际WebP字节／哈希匹配；已删图片不导出，成功视觉回复与任务来源保留。原UI注销后，68张私有表、全部相关物理队列、7个已知对象key及账号前缀、实际Logto用户均确认无该账号残留；必要删除围栏／收据保留。15个源服务正常、专用模型scope已移除、全局活跃任务为零。受保护的 `.tmp/chat-photo-dev/` 保存过程证据，账号已擦除，不可重跑／复用；加密备份及本机验收档案作为隔离证据保留，不声称这些归档已删除。

**用途与模型边界。** 新增 Identity016 `private_chat_photo_storage` v1 → `chatPhotoStorage`，Identity017 `person_chat_image_replies` v1 → `chatImageReplies`。不更改已有用途或让旧授权包含图片。与原文字发送一致，新发送需要私人保存、照片保存和看图三项授权，缺失分别返回 `STORAGE_PERMISSION_REQUIRED`、`CHAT_PHOTO_STORAGE_PERMISSION_REQUIRED`、`CHAT_IMAGE_REPLY_PERMISSION_REQUIRED`，沿现有反馈拒绝，不生成伪回复；已受理操作重放先读原回执。看图模型仅取得本条规范化图片、该人物必要文字资料及当前虚拟世界，不取得旧私聊／珍藏／长期记忆。用户已明确选择先接真实看图、暂不进入后续AI记忆：照片及看图回复不进入后续文字AI、自动记忆、候选记忆或围坐上下文。真实模型用独立 `photo_reply` 任务，输出文本但必须保留明确来源。撤看图授权阻止待执行／剩余重试；重授不复活旧任务。已保存回复仍按私人文字授权可读。撤照片保存只隐藏图片消息／字节，不阻断其余历史；重授可读仍有效成品，旧上传与旧任务不复活。

**共享数据与接口。** Media purpose 为 `conversation_attachment`；上传 target 为 `{kind:'conversation_message',id:clientMessageId,conversationId}`。Conversations 原 `POST /v1/conversations/:id/messages` 新增严格输入 `{clientMessageId,kind:'photo',media:{id,version}}`，无 text/inputMode；输出沿 `{message,generationJobId}`，消息 `{kind:'photo',text:'',photo:{mediaId,version,mimeType:'image/webp',width,height,byteSize},generationKind:'photo_reply',canSuggestMemory:false}`。视觉回复仍为 persona/text，`generationKind:'photo_reply'`。查询／取消／重试使用原 job 路由加 `kind=photo_reply`，返回同类标准状态。公开消息只含元数据，不携带永久URL或浏览器证明；前端按当前会话另取限时证明。

Conversations011 新增 `photo_reply_jobs` 与一对一 `message_media`，messages 新增 `photo_reply_job_id`；严格保留 direct/gather、text/gift 原分支，photo 仅 direct/self，direct persona/text 必须旧文字job与photo job二选一。任务捕获账号、人物、私人保存、照片保存和看图授权版本，固定原消息／媒体版本，最多三次实际尝试、租约及CAS；同库消息／引用／任务／永久命令回执／Outbox／投递同事务提交。Media 增加专用用途列及 `media_conversation_grants`，本库复合约束锁定账号、媒体、会话及clientMessageId。跨库不设FK，不在事务或行锁内调用HTTP。

**跨服务接缝。** 使用现有服务token机制增加 Media↔Conversations 独立受众。Conversations 给 Media 提供 `GET /internal/v1/conversations/:conversationId/photo-target` 与 `POST /internal/v1/conversation-media/validate`（`{refs:[{conversationId,clientMessageId,messageVersion,mediaId,version}]}`，最多100项；返回 `{valid:[boolean]}`，与输入顺序对应）；目标和来源检查不依赖照片当前授权，供GC／rights使用，但检查账号／人物存续、direct目标与有效精确来源。Media 提供 `POST /internal/v1/conversations/:conversationId/messages/:clientMessageId/media-bindings`，输入 `{mediaId,version}`，返回 `{conversationId,clientMessageId,media:{id,version,mimeType,width,height,byteSize},expiresAt}`。先锁外预绑定60秒，再在Conversations本地锁内按数据库时钟核查期限提交；已受理回执不重新绑定。

Media 的浏览器 proof 加 purpose、conversationId、clientMessageId、sourceMessageVersion，并沿现有60秒HMAC及会话／授权版本校验；取字节前后复查来源。视觉内部字节端点 `POST /internal/v1/photo-reply-jobs/:jobId/attempts/:attemptId/media-content` 返回规范化WebP字节；它锁外调用 Conversations 的 `GET /internal/v1/photo-reply-jobs/:jobId/attempts/:attemptId/media-source`，得到 `{conversationId,clientMessageId,messageId,messageVersion,mediaId,version,accountAccessVersion,storyAuthorizationVersion,photoAuthorizationVersion,imageAuthorizationVersion}`。后者独立验证当前运行attempt／租约／原消息、人物和捕获授权，不反查Media，避免循环。Media 在读字节前后验证同一来源和当前权限，模型发出前、完成后、提交前重新校验。不得使用用户proof或把对象存储URL交给模型。

**失效与验收。** 删除原图片消息使旧proof、在途生成和来源失效；已保存视觉回复作为原聊天历史保留，但不再用于生成。Media已绑定删除仍返回 `MEDIA_IN_USE`，从原消息删除入口撤来源；GC保留15分钟预绑定宽限，超时不是来源已删除证据。混合历史分页沿实际sequence过滤无权照片，搜索只匹配原占位文本，不OCR。数据权利独立于普通授权，导出包含消息关联、任务来源及有效WebP实际字节；注销删除新增表／物理队列／对象并保留围栏。恢复需核对账号→direct会话→原消息→单图引用→Media绑定→成品元数据／字节哈希，隔离未完成任务。验收覆盖真实图像识别、原UI刷新及删除、真实回包丢失后同键重放、撤权不复活、普通文字／围坐回归及导出／注销／原生恢复；只用全新合成账号，不复用已擦除的旧fixture。

## R01 原围坐与各自记忆实施基线（2026-11-14，本机验收完成）

本片接批准版`53d5293`的首页／直聊／世界围坐入口、世界会话历史、输入、人物署名、复制／朗读／删除及首页历史搜索定位，保持布局、文案和原决策顺序。它是同账号虚拟人物的文字小聚：每条用户发言触发最多三位人物各一轮真实回应，没有成员选择器、自动轮聊、任务面板或新增重试按钮。源码、隔离回归、真实OpenAI与本机合成账号端到端已完成；首轮模型遗漏及澄清结果如实保留如下。

**本轮验收（2026-11-14）。** Identity46、People46、Conversations132、Memories73、前端129项测试通过；恢复68项通过，另1项默认跳过的原生测试由本轮实际八库演练补足。TypeScript、service-mode构建、Git候选与26个浏览器JS产物的私密配置扫描通过；Identity015／Conversations010已应用。保留批准页面及原交互，未覆盖Android安装版更新或生产发布。

**真实AI及质量边界。** 原模型凭据401已解决，原两条失败私聊和任务保留；原UI另发两条确认消息，得到两份真实回复及各自自动长期记忆。首轮围坐两份真实回复的来源归属正确、无对方暗号，但四个本人暗号只回答三个。当前同版本SDK序列化检查确认本人珍藏原文完整、对方私有暗号不在输入中，此检查不冒充历史请求录制。保留首轮质量失败后，仅增加一轮原UI明确澄清（用户未提供暗号），两人共四项完整匹配，无对方暗号，已共享旧回复的继承来源闭包通过。没有改写成功槽、放宽首轮判断、替换v1 prompt或反复重生成来隐藏遗漏；单次模型回答仍可能遗漏已提供记忆。

**原页面与权限。** 刷新、首页摘要、UUID搜索高亮／返回、删除一条回复通过；撤旧AI后另两份真实围坐回复的私有记忆引用为零。真实受理后丢回包、两人迁出、零居民历史、同标签页刷新后相同key/body/receipt重放通过，无重复源消息，两个槽保持零attempt。撤围坐授权后恢复Worker实际阻断两个槽，重授没有复活；撤story使历史／搜索／锚点403，重授只恢复可读历史。全程普通账号无自动资产发放。

**恢复与清理。** 四轮／八槽／六份真实回复进入八库175表原生备份恢复，raw／checkpoint／来源闭包／成功内容保留／未完成任务隔离／物理队列隔离／sourceUnchanged／cleanup均通过，`releaseReady=false`。备份`20261114090311756-4bded046`、run`df5fb9299e964325`保持隔离。三用途最终均撤回后，原UI七域导出核对全部revision、保留失败原消息、来源和历史槽，排除已删除回复正文；原UI注销完成，独立只读核查63张私有表与3个物理队列的该账号数据为零，会话、授权、OTP和服务端导出副本已清理，必要注销围栏／回执保留。专用模型名单文件已移除，两个Worker恢复基础配置；15个本机服务正常，七个私有API匿名访问均401，无活跃业务任务。私有证据位于忽略目录`.tmp/gather-dev`，不包含在发布产物中，已注销fixture不得复用。

用户于本轮明确选择：每位人物可使用**自己已授权的私聊长期记忆和珍藏**，它们可能在围坐回应中提及；不得读取其他人物的原始私聊或私有记忆。现有说明“依据各自的记忆呈现”保留。以下为前后端、People／Identity／Memories和恢复共同基线，新增决定先修改此处。

- **权威与存储。** 继续使用Conversations的`conversations/messages`保存会话和消息，增加严格的direct／gather目标互斥和消息复合归属约束；direct、礼物与书信的既有约束保留。新建`gather_reply_jobs/gather_reply_participants/gather_reply_slots`：每个用户源消息一个父任务、不可变2–3人名单、每人一个执行槽和至多一条已提交回复。messages增加独立`gather_reply_job_id`，旧`generation_job_id`仍只引用直聊任务。本域事务同时保存源消息、准确序号、永久命令、名单／槽、队列与事件，跨域HTTP不持本域事务锁。
- **授权。** 保存和普通读取沿`private_story_storage`／`storyStorage`；新增独立`person_gather_replies` v1／`gatherReplies`，绑定精确privacy_notice。新发送要求storyStorage和gatherReplies。旧文字AI、照片、书信和赠礼用途不扩义。若受理时`aiTextProcessing`有效，另捕获它的准确版本，才使用该人物当前获准的珍藏／自动长期记忆；未获准则不读取这些私有记忆，资料和参与过的围坐仍可按新用途回应。模型前后、提交前及后台恢复复核所有捕获权限；撤回再授予不复活旧槽。已保存内容仍按storyStorage读取，独立导出／注销不需重授。
- **People元数据接缝。** Conversations专用凭据访问`GET /internal/v1/worlds/:worldId/gather-context`，账号沿现有内部header；返回`{accountId,world:{id,code,displayName,enabled,catalogVersion},residents:[{id,displayName,version,accessVersion,worldVersion,createdAt}],revision}`。同账号active居民按createdAt、id排序；完整上限1000，超过返回413 HISTORY_TOO_LARGE，不截断。无人物／目录停用仍可返回历史所需元数据。来源取单库RR快照、HTTP前后复核账号与来源；revision为稳定SHA256，不冒充全世界成员版本。接口不返回故事、记忆或照片。
- **准入和固定名单。** 新建世界会话和新发送须目录enabled且当前至少两名有效居民；既有会话即使零居民也返回原ID和历史，`canSend=false`。按`sha256(clientMessageId + ':' + personId)`升序、personId为并列次序，从受理时居民取最多三位，重放／重试不换人补位。保存各人的accessVersion和worldVersion，迁出再迁回也不能恢复旧槽；普通资料更新可在执行开始取当前版本，随后整个模型调用和提交使用同一版本。
- **上下文。** 每槽只包含本轮用户文字、当前发言人必要画像／虚拟世界、该人的获准珍藏和自动长期记忆，以及自己确实被选中旧轮次的共享围坐文字。历史最多20条且sequence严格小于本轮源消息；旧轮次包括当时其他参与者已提交的共享回复，但不取本轮其他槽刚生成的文本。模型只看到每条的真实作者与AI标识，AI历史不提升成用户事实。不读取原始私聊、书信、照片，不自动提炼本片围坐、不自动珍藏，不执行资产、迁居或剧情操作。
- **记忆来源隔离。** 私有记忆请求绑定当前槽personId，使用现有Memories上下文API；每个使用引用保存其实际personId、kind、id、version及必要source refs。共享旧回复携带的记忆依赖保留原owner，只验证引用有效性，不加载其他人物记忆正文进模型。新增`POST /internal/v1/persons/:personId/memories/validate`接收`{refs:[{id,version}]}`（最多8个唯一引用）返回`{personId,valid}`，与现有automatic-memories/validate配合分批验证。删除／更正／撤权使相应旧回复不再进入新模型上下文；不自动抹掉独立保存的围坐历史。实际使用的消息、记忆、人物和世界引用均在写回前复核。
- **执行与部分结果。** 队列`gather.reply.v1`载荷`{jobId,personId}`，复用现有Conversations Worker。每槽独立租约／attempt/CAS，领取及租约中断计入最多三次实际attempt；可重试故障后台有限退避，成功槽不再派发。父状态沿queued/running/succeeded/failed/blocked/canceled：有待执行／执行中则相应状态；全成功才succeeded，终局未全成功按失败／阻断／取消归类，始终保留已提交replyIds。源消息删除、账号注销、权限撤回停止剩余槽；单个人物失去资格仅终止其槽。恢复扫描也核对资格，重授／迁回不复活。失败沿原Toast，输入仅在真实受理后清除；未知结果完整body/key/target跨刷新保留并锁定，沿原发送按钮重放。
- **公开API。** CHAT-02支持`{kind:'gather',worldId}`；detail为`{id,kind:'gather',worldId,personId:null,createdAt,version,canSend}`，可附当前居民最小元数据。CHAT-01支持两种会话及kind过滤，gather只列实际存在的世界会话。CHAT-06仍为1–4000 Unicode文字，返回202 `{message,generationJobId,generationKind:'gather_reply'}`。消息DTO为text，`generationJobId`映射父任务并带`generationKind:'gather_reply'`；persona作者显示服务端允许的历史displayName，personId仅在当前可链接时提供。迁出仍active可保留署名和链接，移除后泛化署名并关闭链接，历史不整段404。CHAT-04/05分页、锚点及CHAT-07删除沿现约定。
- **GEN与搜索。** 围坐GEN请求统一携带`?kind=gather_reply`，旧无kind的直聊保持原行为；GET返回父状态、replyIds和各槽最小状态，取消／重试仅作用未完成且仍有预算的槽，不复活旧权限或成功槽。原UI无需新增GEN按钮。首页摘要和完整搜索同时覆盖围坐：hit保持kind=message，新增`conversationKind:'direct'|'gather'`，personId可为null，worldId在gather时必填；旧direct字段语义不变，可兼容未带conversationKind的旧direct结果。按会话身份去重，世界历史即使当前无居民仍可解析、返回原UUID上下文。搜索/读取授权变化不得回填旧窗口，完整revision与预算沿历史搜索基线。
- **权利与恢复。** 导出包含会话、消息、名单、父任务／槽与实际使用来源，删除／注销覆盖相关命令、事件及物理队列；现自动记忆来源扫描显式限定direct。原生恢复校验世界归属、不可变名单、每人唯一回复、精确消息序号、来源与授权版本、记忆owner；保留内容和成功来源，隔离全部未完成槽、父任务及队列。验收使用全新合成账号，真实账号和已擦除旧fixture均不操作。

## R01 原书信与真实回信实施基线（2026-11-14，本机验收完成）

本片沿批准版`53d5293`的三个写信入口、信纸、回信开关／时间选项、封存动画、人物资料信匣和来信提示接真实服务。原信归Conversations独立书信资源，不伪装聊天消息；没有书信聊天卡、系统通知新入口、删除／编辑／手动重试新控件。只有服务真正接受原信才播放成功动画；未知结果保留同一完整意图及clientLetterId，刷新重试不重新建信。原预览模板计时仅用于预览账号。

### 本片统一决定

- Identity新增独立`private_letter_storage` v1（上下文`letterStorage`）和`person_letter_replies` v1（`letterReplies`）。旧政策和旧grant不扩义。原信、实际回信、时间偏好、已读与必要来源记录由letterStorage管理；普通读写不要求AI授权。请求回信另外要求当前letterReplies及storyStorage（读取人物必要文字），不借用赠礼回礼授权，也不要求旧ai_text_processing代替新用途。独立回信授权明确OpenAI、本封原信、当前人物必要文字及当前虚拟世界／最近迁居、即时或一次性预约；不读取照片、其他原信、原始聊天、珍藏或自动记忆，不自动提炼书信记忆，不发推送或循环来信。
- 撤回回信用途停止新处理和未完成任务，已提交原信／回信仍按letterStorage读取；撤letterStorage停止普通读取和新处理。保存时固定账号访问、letterStorage／letterReplies／storyStorage授权版本；撤回再授予不复活旧任务。`none`只保存原信、无模型任务。独立导出／注销不以重新授予书信权限为前提。
- `now`为服务受理后尽快生成；`next_morning`沿现有`nextMorning()`及LETTER-01，取选定IANA时区内严格晚于服务受理时点的第一个08:00（08:00前可为当天），保存UTC时点和时区，客户端时间或后续旅行不移动它。使用PostgreSQL当前时钟及其时区数据库换算，日期无实际08:00时跳过该日期，歧义按数据库时区规则解析。队列预约之外，业务领取也核对到期时间。
- 等待期间的人物正常更新不自动取消整晚排程；领取后使用当前人物和虚拟世界，模型前后及提交前复核该次版本／可见性。原信不可编辑；源版本与授权变动、删除、账号注销或人物不可见均禁止晚到提交。外部调用在数据库锁外。
- 专用书信provider输入仅原信、必要人物文字和已验证虚拟世界；输出非空、最多4000 Unicode字符，沿原信语言，不以模板补失败。保存provider、model、responseId、promptVersion及使用的源／人物／世界引用，不保存密钥。最多3次业务尝试，短暂错误有限退避、Worker中断可恢复；权限／来源变化终止自动重试。保证一信最多一份已提交回信，不宣称外部模型恰好调用一次。
- 信匣沿原信createdAt/id降序，前端完整读取有界快照后再显示／确认已读。每页最多100，最多1000封且总内容不超过8MiB；超限明确`413 LETTER_HISTORY_TOO_LARGE`，不能截断当完整。分页HMAC游标绑定账号／人物／limit／完整结果revision，变化`409 SOURCE_CHANGED`后整组重读一次；`reply.sequence`为人物范围递增十进制字符串。完整组的最高实际reply序号对应throughReplyId，原子推进已读；读页过程中或ACK前新增的更高序号保持未读。单页未完成前不清红点。
- 复用LETTER-01至05：创建永久键、列表／单封回读、`POST .../letters/read {throughReplyId}`单调已读、If-Match删除服务数据权利。DTO补`clientLetterId`、`reply.sequence`和`failure?:{code,retryable}`；`replyJobState`沿queued/running/succeeded/failed/blocked/canceled。GEN-01至03仍为既有聊天任务入口；书信任务随书信资源回读。原等待文案位置承载真实等待／失败／停止反馈；原信保持可读，不新增任务管理页。
- Conversations新增独立letters、letter_reply_jobs、letter_replies、letter_read_cursors，复用本域永久commands、擦除围栏与outbox；预约队列`letter.reply.v1`与原信／任务同事务。回信提交、人物回信序号和`LetterReplyCommitted.v1`同事务；本片站内提醒为原信匣未读提示，通用通知／推送不在本片。
- 导出包括未删除原信、实际回信、排程／任务状态、已读与必要来源并纳入大小预算和revision；注销清理四表、命令、事件和物理排程。原生恢复纳入完整表组、源引用／一信一回信／单调游标交叉检查；保留内容及成功来源，隔离全部未完成书信任务和队列，不自动补跑恢复包。

本轮Identity 42项、最终Conversations 112项、前端118项回归通过，TypeScript与service-mode构建通过。恢复回归59项通过，默认跳过的1项原生路径另由实际八库演练覆盖。新增Identity 014、Conversations 009已在本机迁移，现有Conversations Worker兼任书信队列，仍为15个API／Worker。

全新专用合成账号沿Home、Chat、Profile三个原入口完成三种模式，封存动画仅在真实受理后发生。实际丢弃一次已受理POST响应后，刷新沿原按钮重试，完整意图／键及原信ID不变，数据库仅保存一封。原信匣实际展示原文和真实OpenAI回信；先后两次观察新来信提示，完整DOM显示后保存已读。最终样本为5封原信、2封真实回信、3个任务（2成功、1撤权终止），普通聊天任务／文字消息、赠礼投递及资产入账均为零。

预约采用浏览器真实IANA时区Etc/GMT-2，服务固定UTC 2026-11-14 06:00（该时区08:00，北京时间14:00）。跨原生恢复与服务重启后时点不变；到期前业务与物理队列均未执行。实际在到期前停止Worker，真实截止后两秒仍以只读检查确认零Worker、同一queued任务及无回信，随后启动Worker并取得真实回信。停启协调脚本在Windows输出管道收尾挂起；保留实际前后检查点、核实Worker已恢复后，手动完成回信及原UI验收，没有重造任务或修改时间。脚本随后改为临时文件输出和有界进程等待，并以继承输出句柄的存活后代及超时反例验证；这与实际业务验收分别记录。

原隐私UI撤回回信用途后，新的未来预约实际变为blocked；重新允许没有复活旧任务，已提交回信仍可按保存权限阅读。撤回保存用途得到403，重授仅恢复有效内容的读取。两项用途最终均撤回，再经原OTP重验和原数据权利UI完成七域导出，核对全部revision、五封原信、两封回信、任务来源和已读记录；原注销流程及独立只读复核确认本账号六业务域私有行、书信物理队列、会话／授权／导出和对象前缀已清理，擦除围栏保留。真实体验账号未操作，专用模型scope已移除，原服务配置恢复；七API拒绝未登录读取，所有业务域无活动任务。

实际原生恢复包`20261114051928062-8b43d2f1`、run `ad5a4f21974a4c27`含八库172表，备份时为4封原信、1封已提交回信和1个未来预约；源引用、内容、检查点、未完成任务隔离和临时副本清理通过，源库未变，仍`releaseReady=false`。详见[恢复记录](../../deploy/recovery/README.md#r01-书信原生恢复记录2026-11-14)。本机原UI只使用小样本；分页／预算、乱序已读、撤权竞态、删除／注销晚到隔离及运行中Worker强杀由隔离回归覆盖，不据此声称大历史原UI或生产验收。Android安装版、推送、小聚、聊天图片及获准剧情不在本片。

## R01 原会话历史搜索实施基线（2026-11-13，本机验收完成）

沿批准版 `53d5293` 的相见搜索框、每会话一条最新命中、会话最近活动排序、返回保留关键词和原聊天居中／2.2秒高亮交付。原实现仅靠首页摘要无法检索完整历史，临时数字消息ID也不能跨聊天scope定位。本片使用服务UUID定位真实上下文，不新增搜索页、筛选面板或AI检索；星图搜索继续由Memories拥有。

Conversations新增 `GET /v1/search?scope=conversations&q&locale&limit&cursor`，q去首尾空白后1–160 Unicode字符，拒绝NUL／孤立代理项；locale仅zh-CN或en。按原会话语义作大小写不敏感的字面包含匹配，保留标点／空格，不使用Atlas中文词对、语义推断或SQL通配符。每个已授权直聊只返回最新有效匹配消息：`{kind:'message',id:messageId,personId,conversationId,messageId,sequence,version,messageKind:'text'|'gift',title,excerpt,author,createdAt,lastActivityAt}`；sequence为十进制字符串。title为当前人物称呼，excerpt是实际可见文字的片段，不能泄露模型上下文。客户端将消息结果与当前People资料的名字／真实姓名／关系／世界匹配合并，保持每人物一行；没有消息命中的资料结果仍按原流程打开聊天，搜索不建会话。

文字候选从本账号全部未删除历史匹配后取最新，不能先截最近50条。礼物候选通过现有giftMessage当前Gifts来源授权后，按原可见`[礼物] 送出/收到 名称 ×数量 · 附言`（英文对应原文）匹配；403/404跳过后继续寻找更早命中，依赖不可用明确失败。排序为当前最新可读消息createdAt降序、personId升序。分页沿现有HMAC游标，绑定账号、规范化查询、locale、limit及本轮完整结果修订摘要；翻页期间结果／源版本变化返回409 SOURCE_CHANGED，客户端可重新读取，不能悄悄混页。扫描／响应预算超限明确413 HISTORY_TOO_LARGE，不截断冒充完整。

CHAT-05 `GET /v1/conversations/:id/messages/:messageId/context?limit` 默认20、最大100，返回 `{anchorMessageId,items,beforeCursor,afterCursor}`。items按精确sequence升序，包含当前可见锚点，尽量平分两侧并补足边缘；两个游标只能续读同账号／会话／limit的CHAT-04对应方向，没有更多时为null。锚点UUID、归属、删除和用途在读取前后重新核对；已失效返回404或当前授权错误，不定位别的消息假装命中。前端以服务UUID找到新scope内localId，待真实DOM出现才居中／启动高亮；历史窗口及已扩展页在轮询中保留，边缘继续读取现有方向页，发送新消息后回到近期会话。分页不得将正在阅读的位置拉回底部。

普通文字历史、检索及定位要求当前storyStorage，不要求AI处理授权。原CHAT-04／摘要同步按用途筛选：story撤回不再返回text；giftStorage仍允许时继续按原Gifts授权规则读寄件卡，来礼仍执行原story/gift/return条件；两种读取用途均不可用才403，过滤后真实空页仍为空页。返回前复核账号访问版本、人物访问及使用的用途版本、消息版本／删除；不会宣称跨服务原子撤权。授权变化／切号／改词后的迟到搜索结果与窗口不得回填，失败不能显示成“没有匹配”。

不增加持久化搜索索引、副本、模型调用、搜索记录或数据库表；复用当前账号／会话／sequence索引和数据权利。验收使用新专用合成账号，覆盖超过50条的旧消息、最新匹配、中文与字面符号、礼物附言、准确UUID高亮、双向扩页／轮询／返回、来源删除及撤权。既有星图、寄件／来礼与AI撤回后历史回读纳入相关回归。

验收结果：Conversations 92项真实隔离PostgreSQL／HTTP／任务回归、前端100项测试、TypeScript及service-mode Vite构建通过。新“历史检索测试”账号以受控公开API保存97条真实用户文字，两个人物及免费纸鹤由原UI创建／寄出；无试用资产发放，所有生成任务均在模型传输前因部署名单阻断，零人物文字回复。原Home搜索验证旧消息、最新同词命中、字面`%_`与大小写、资料合并和赠礼附言；点击请求UUID与DOM UUID相同，真实居中、高亮2.2秒、双向续页、轮询位置、返回保留关键词及原气泡删除均通过。实际Vite代理验证scope位于首／中／末均到Conversations，Atlas仍到Memories且查询值中的编码scope不改路由；同账号异人物锚点404。

原隐私UI撤AI后文字可检索；撤story后检索403，CHAT-04及寄件卡锚点仍按独立gift用途可读，文字锚点403；仅重授story后恢复检索，AI保持撤回。另以反例验证文字锚点403会退当前可读会话、首页摘要403清缓存、迟到响应不能回填。原UI完成七域导出，校验全部revision、96条未删除文字与真实礼物引用、已删锚点排除；原注销完成后，只读复核六业务域私有行、队列引用、会话、授权、导出副本及S3前缀清空，保留删除围栏。证据在受保护且忽略的`.tmp/history-search-dev/`，无真实体验账号操作。

本片没有迁移或新增持久化结构，未重新执行原生恢复；既有八库168表恢复证据仅在原范围内复用。15个本机API／Worker继续运行，七域无活跃生成／上传／权利任务。Android安装版、生产规模／性能、正式发布和跨服务原子撤权未验；Atlas排序／失败体验的后续审查不包含在本片。

C01–C07、D01–D05 的目标实现。HTTPS、账号上下文、错误、幂等、分页、SSE 与 Worker 规则以 [共用契约](../backend-api-contract.md) 为准。以下路径用于正式 `/v1`。K03 文字私聊已接入独立 [会话服务](../../backend/services/conversations/README.md)，保留原页面；其余能力按批次接入。表内正文限长均按修剪后 Unicode 字符计数。K04 完成珍藏与星图原文回读，R01 再接图片、小聚、书信和私人动态。X01 的通话与服务端转写须分别通过能力、授权和真机验收。 [交付顺序](../backend-delivery-priorities.md) · [会话列表](../../frontend/src/conversationList.ts) · [人物会话](../../frontend/src/person.tsx) · [回忆检索](../../frontend/src/atlas/memorySearch.ts) · [空间动态](../../frontend/src/moments.tsx)

K03 当前范围：仅文字私聊，消息响应附 `generationJobId`，分页 `meta.afterCursor` 是当前返回页实际最高序号的 newer 锚点。摘要 `lastMessage` 可附原消息 `author`，供原首页区分自己的消息。人物移除后，该人物的会话、消息和任务统一返回 `404`；小聚匿名历史的目标规则不适用于这一步。原首页完整历史搜索及UUID上下文定位现已按上方R01基线接通。模型调用现需独立的 `ai_text_processing` 用途授权；本机名单仍只是额外运行限制。K05 首片已接通 PRV-01–03 与任务授权版本，正式发布及其余 K05 数据权利仍待验收。

K05 首片：新聊天与真正失败重试、珍藏整理分别在所属服务保存 `ai_authorization_version`，并在资料读取后、模型调用后及结果提交前复核同一许可。旧任务版本 0 不继承后续授权；撤回再授予不会复活旧派发。历史读取、已生成候选的人工确认、手写与删除仍按其原有权限处理。授权或政策不再有效时，新生成请求返回 `403 AI_PERMISSION_REQUIRED`，已受理生成进入不可自动重试的 `blocked`。纯幂等回读和不产生新派发的任务查询不要求重新授予。详细授权政策与隐私告知绑定见[Identity K05 基线](./identity-people.md#k05-首片实施基线ai-文字处理授权)。

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
| 通话 | `id, conversationId, personId, mode:'voice', state, version, model, voice, createdAt, expiresAt, startedAt?, endedAt?, durationSeconds?`。X01 由 Conversations 代理 OpenAI Realtime WebSocket，服务端持有提供方凭据。仅保存可信连接／终止元数据；不保存录音、逐字稿或字幕，不生成自动记忆。 |

每次私有读写先以真实 `accountId` 缩小范围，再验证人物、消息、回忆及素材的当前访问。AI 人物是账号内虚拟角色，署名含 `personId`、允许保留的发送时显示名快照及明确的 AI 标识。人物已被删除或限制时，历史的可见内容依保留规则回读，返回缺失姓名的通用署名并关闭人物链接。所有跨账号访问统一返回 `404 NOT_FOUND`。用户主体只能提交自己的作者身份。角色回应、系统行、运营世界条目和礼物投影由相应域生成。

## 会话及消息

列表行 `ConversationSummary` 为 `{kind,conversationId:UUID|null,personId:UUID|null,worldId:UUID|null,title,lastMessage:{id,kind,preview,createdAt}|null,lastActivityAt:string|null}`。没有会话的人物可用 `personId` 进入初次对话，时间和消息摘要为空。会话列表采用 `lastActivityAt DESC NULLS LAST` 加稳定 ID 排序。问候和 AI 说明是 UI 内容，按现有体验单独显示。

当前 `scope=conversations` 搜索同时返回 direct／gather 的最新有效消息命中，按会话身份去重；hit 增加 `conversationKind`，围坐的 `personId=null` 且 `worldId` 必填。人物／关系／世界等元数据匹配仍由前端与真实消息命中合并，不以摘要文字代替完整历史搜索。世界 UUID 独立于当前居民，零居民历史仍能返回原会话与消息 UUID 锚点。

消息 DTO `Message` 使用共同字段 `id,conversationId,sequence,kind,author,createdAt,version` 及可选 `clientMessageId,replyToMessageId,generationJobId,generationKind,contextMemoryId`。围坐文字的 `generationJobId` 指向父任务并带 `generationKind:'gather_reply'`；各人物回复由同一父任务下的独立槽提交。作者为 `{kind:'self'}`、`{kind:'persona',personId?:UUID,displayName:string,aiGenerated:true}` 或 `{kind:'system'}`。类型与专属字段如下。

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
| CHAT-06 `POST /v1/conversations/{conversationId}/messages` | `{clientMessageId:UUID,kind:'text',text,inputMode?}` 或 `{clientMessageId,kind:'photo',media:{id,version}}`。文本去除首尾空白后 1–4000 字符。R01 图片最多一张。返回 `202 {message:Message,generationJobId:UUID,generationKind?:'gather_reply'}` | 校验账号、会话和资格，图片先在事务外取得 Media 60秒预绑定租约，目标精确为当前会话与 clientMessageId；本库锁后按数据库时钟校验期限，消息、单图引用与独立 photo_reply 任务同事务提交，详见顶部单图基线。围坐新发送要求 `storyStorage` 与独立 `gatherReplies`，目录 enabled 且至少两位当前居民；文字保存缺失返回 `403 STORAGE_PERMISSION_REQUIRED`，围坐许可缺失返回 `403 GATHER_PERMISSION_REQUIRED`，世界停用或人数不足返回 `409 GATHER_UNAVAILABLE`。服务按 `sha256(clientMessageId + ':' + personId)` 升序固定最多三位，名单、槽与父任务同事务。已受理同键重放先读原回执，不因后来撤回围坐生成许可或人数不足重新选人；普通读取仍要求文字保存许可。当前实现不接收客户端显式 contextMemoryId，记忆仅由服务器按当前人物及独立权限检索。消息、序号、任务、入队及受理事件同事务：直聊为 `MessageAccepted.v1`，围坐为 `GatherAccepted.v1`。唯一键 `(accountId,conversationId,clientMessageId)`，同参重放回原消息与任务，异参 `409 IDEMPOTENCY_CONFLICT`。前端仅在已受理后清相应版本草稿。 |
| CHAT-07 `DELETE /v1/conversations/{conversationId}/messages/{messageId}` | `If-Match`、幂等键。返回 `200 {id,removedAt,version}` | 校验同会话可见的文字、AI 回复或照片。事务标记移除并写事件，后续授权查询立即隐藏消息，停止仍依赖该条源消息的生成和候选。清理检索、素材绑定和原文引用时保留应保留的业务关系。已由用户确认的独立回忆继续按其自身授权读取，失效来源不可再引用。礼物及通话引用交给来源域管理。 |

同一人物的第一条消息可先调用 CHAT-02 取得会话 ID。只要消息与任务同事务保存，就表示已受理，AI 回复可能稍后到达。发消息时保留原 `clientMessageId`、请求指纹和幂等键，应答丢失时重放同一请求。C03 现阶段可用端侧转写，用户确认后以 `inputMode=transcribed` 提交文本。识别失败、空文本或上滑取消时保持草稿或退出语音模式。C07 草稿按账号和会话／人物在设备内存放，切号时隔离，跨设备草稿同步另行定义。复制、朗读和输入模式切换留端侧。

C03已接真实浏览器SpeechRecognition，保持原语音模式、按住、上滑取消与松手发送。首次切换明确提示浏览器可能将音频交给其识别服务，并由用户允许；西界不保存或接收原录音。松手后等待浏览器异步最终结果，只发非空最终文字，不发送interim、不补示例句；拒权限、网络失败、60秒上限、空结果或取消均不产生消息。退出／切号和迟到permission start会停止识别。浏览器不支持时保留文字路径，不声称离线可用。来源说明见[MDN识别机制](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition)和[stop异步结果](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/stop)。

Conversations014给正式／分支消息增加`input_mode:typed|transcribed|null`；普通直聊、围坐及分支的文字契约接受typed/transcribed，永久指纹包含原mode，DTO及历史回读恢复“语音转文字”标识。模式不是音频真实性证明或额外授权。转写的未知受理保持原完整文字、mode、clientMessageId和UUID；刷新后键盘发送键仍重试原转写，不改成typed。原手写草稿独立保留，不能被待核转写覆盖或在其重试成功时清空。云转写、录音保存和AI通话属于独立用途，不能以此实现冒充。

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

候选整理任务由 Memories 服务拥有。沿用下面的 GEN 路径，但 GET、取消、重试均携带 `?kind=memory_suggestion` 作为网关路由提示；未携带提示的现有聊天请求仍归 Conversations。提示不提供任何访问权限，两服务各自校验账号、人物、任务归属和实际类型；重复或不支持的 `kind` 返回 `400`。候选任务的 `targetId` 为人物 ID，成功时 `resultRef={kind:'memory_candidate',id:UUID}`，前端再通过 MEM-02 读取。

任务状态为 `queued → running → succeeded|failed|blocked|canceled`。文字私聊与候选的正常模型失败等待用户通过 GEN-03 显式重试，要求终态 `failed` 且 `failure.retryable=true`。围坐 GEN 请求携带 `?kind=gather_reply`，返回父状态、部分 `replyIds` 和 `participants`；每人最多三次实际尝试，短暂失败后台有限退避，原 UI 不新增重试按钮或任务面板。书信的短暂错误由后台按最多三次业务尝试有限退避，不使用 GEN-01至03，任务状态随 Letter 回读，也不新增手动重试入口。重试保留同一业务任务 ID，`attemptId` 每次领取更新。用户明确取消、授权撤回、模型策略拦截和运行异常分别记录。围坐如果已有部分合法回复，`replyIds` 保留已提交结果，后续尝试只处理仍合格、有预算且未成功的原名单人物；撤权再授予、迁出再迁回不会复活旧槽。

| 编号与接口 | 输入和结果 | 后端执行、权限、并发及恢复 |
| --- | --- | --- |
| GEN-01 `GET /v1/generation-jobs/{jobId}` | `{id,kind,targetId,state,version,replyIds?,resultRef?,failure?:{code,retryable},updatedAt}` | 校验当前账号和目标授权。回复和候选用权威详情读回。前台可通过 SYS-02／SYS-03 接收变化，掉线后查询本接口。 |
| GEN-02 `POST /v1/generation-jobs/{jobId}/cancel` | 无业务体，返回当前任务 `200` | 锁业务任务。排队、执行中可终止后续写入，更新版本和状态，再请求外部取消。已有提交结果保留。重复取消返回当前任务。已成功则返回成功状态。 |
| GEN-03 `POST /v1/generation-jobs/{jobId}/retry` | 无业务体，返回 `202` 同一任务 | 只允许业务校验通过的可重试失败，重新核对资格与预算并锁任务。新尝试只在状态由失败转回排队时入队。原任务已重试则复用现有执行，永久失败、取消或撤权以域错误返回。 |
| LETTER-01 `POST /v1/persons/{personId}/letters` | `{clientLetterId:UUID,body,replyMode:'none'\|'now'\|'next_morning',timeZone?,sourceMemory?:{id:UUID,version:integer}}`，正文 1–10000 字符。早晨模式须传 IANA 时区。返回 `201 Letter`，含 `replyAt?,replyJobId?` | 校验人物与letterStorage，请求回信另校验letterReplies／storyStorage。关联珍藏时另校验该人物下当前可用的精确原文版本。无回信模式只存原信。即时模式按当前 UTC 排队。早晨模式取用户时区第一个严格晚于受理时间的08:00，保存解析出的 UTC 时点与时区，后续旅行或设置变化不移动已排程任务。信、生成任务及入队同事务，`(accountId,personId,clientLetterId)` 唯一。 |
| LETTER-02 `GET /v1/persons/{personId}/letters` | 通用分页。返回 `Letter[]`，含 `replyJobState?`、`failure?` 与 `unread:boolean` | 按原信提交时间及 ID 降序，当前人物与letterStorage可见才返回。回复按权威已提交记录展示，失败和等待从任务读取。完整快照revision游标、1000封／8MiB预算和整组读取后已读边界见本片基线。 |
| LETTER-03 `GET /v1/persons/{personId}/letters/{letterId}` | 返回一封 `Letter` | 校验当前人物、letterStorage、归属和信件关系，回读当前原信、回信及任务状态。本片入口为原人物信匣，不创建系统通知。 |
| LETTER-04 `POST /v1/persons/{personId}/letters/read` | `{throughReplyId:UUID}`，返回 `{lastReadReplyId,readAt}` | 收件人查看已回读范围后确认。通过本账号同一人物真实回复的序号推进已读位置，使用原子最大值，较旧页面的请求不能回拨或覆盖尚未读取的新来信。 |
| LETTER-05 `DELETE /v1/persons/{personId}/letters/{letterId}` | `If-Match`，返回 `{id,removedAt,version}` | 用户权利接口，不新增原页面删除控件。事务标记删除，后续信匣读取不展示原信与回信，并停止未完成回信任务；不要求重新授予letterStorage。晚到的回信结果不能重建原信。 |

`Letter` 对外字段为 `id,personId,clientLetterId,body,replyMode,timeZone?,sourceMemory?:{id,version},replyAt?,replyJobId?,replyJobState?,failure?:{code,retryable},reply?:{id,body,sequence:string,createdAt,aiGenerated:true},createdAt,version,unread`。已提交原信与尚未到达的AI回信分别呈现。C05排程依据服务器时间，回信、单调序号和可靠事件同事务。本片站内提示为原信匣未读；通用系统通知与远程推送留待相应入口独立接入。

新关联遇到无权访问、原文移除或版本变化时返回 `409 LETTER_MEMORY_SOURCE_CHANGED`。未提交的回信若发现原文已失效，以同一原因结束且不可重试。已提交信件与回信沿用独立的书信访问权限。

## 回忆、星图与动态

### 人物记忆的整体目标（2026-11-11 需求校准）

**人物记忆不能依赖用户点击「珍藏」。** 珍藏是用户主动编辑、保存和重读的作品入口；人物记忆是支撑持续交流与虚拟生活的后台能力。下列内容是后续增量实现的设计基线，不代表现有 K04 已全部具备，也不改变现有页面与接口的含义。

| 素材来源 | 应形成的记忆及用途 | 必须保留的区别 |
| --- | --- | --- |
| 用户最初输入及后续修改的人物画像、关系、称呼、故事和获准素材 | 人物背景、关系与用户提供的往事；资料更新后用于下一次交流和剧情生成 | 保存用户提供这一来源身份，不把模型补写当作本人真实生平；照片、声音不直接证明性格或经历 |
| 当前账号与该人物的全部已授权聊天，后续包括书信、转写及可参与的小聚 | 自动提取相关经历、偏好、关系变化、未完成约定和近期关切；跨会话能够接续 | 原消息保留说话者、对象和版本。假设、引用、玩笑、否定与用户真实陈述不能混成事实；用户当下情绪不直接固化为永久性格。当前书信和围坐均不进入自动记忆或自动珍藏；围坐只读取各自获准的既有记忆及本人参加过的共享旧轮次。未来提炼这些来源须另行确定用途范围与授权，不能沿用回信或围坐回应许可 |
| 虚拟人物在世界中实际提交的生活事件、剧本进展和故事 | 该世界与时间线内的虚拟经历、地点、关系、目标和后续情节 | 生成草稿或随口设想不等于已发生事件；虚拟经历可以被角色记住，但不得改写现实生平 |
| 用户主动珍藏、手写和更正的回忆 | 用户希望特别保留的文字与重要线索，继续支持原文重读 | 珍藏不是自动记忆的前置条件，也不因点击确认就变为经过外部核实的历史事实；自动整理不得静默改写珍藏原文 |

全部聊天属于可用素材，不代表每句话都提炼为长期事实，更不代表每轮把全部历史发送给模型。原始素材、可追溯的长期记忆、近期上下文与用户珍藏分开维护，摘要和检索索引都是可重建的派生结果，不能替代原始来源。

#### 自动整理与上下文的职责

- People 继续拥有用户输入的画像与版本，Conversations 拥有消息；Memories 后续扩展自动长期记忆的整理和检索，保留现有珍藏原文的独立身份。虚拟世界的正式事件和当前场景状态由后续世界／剧情领域拥有，Memories 引用其 ID 和版本，不直接写其他服务的数据库。
- 所属服务提交来源事实后，通过可靠事件异步整理可用记忆；用户不用逐条点击收藏或确认。抽取结果保留来源、说话者、人物、主题、现实／虚拟属性、推断或用户明确提供的依据以及适用时间。不确定或相互冲突的信息不静默提升为确定事实；明确纠正使旧结论失效，不按出现次数判真。
- 记忆作用域至少区分账号、人物与适用参与者；虚拟经历还须绑定世界和时间线／分支。同账号的另一人物、未参加的小聚角色不能默认获得全部聊天。用户偏好需要跨人物复用时单独定义可见范围。
- 每次回应组合最新画像、当前近期对话、相关长期记忆、相关珍藏和当前分支的有效虚拟事件，并保留实际使用的来源引用及版本。新消息先进入近期上下文，不等待后台整理完成；长期整理失败可恢复，不能假装已有跨会话记忆。更正、删除和撤权在检索及生成写回前复核，派生摘要、索引和缓存同步失效；多来源结论仅保留仍有有效依据的部分。
- 「移出珍藏」与「让角色忘记某项信息」是不同意图。前者按现有原文删除规则处理，不默认删除仍有独立授权依据的聊天记忆；后者需要按适用范围停止使用并传播到派生结论、摘要和检索，保留防止旧资料重扫再次学回的最小约束。已独立确认的珍藏原文也不因聊天来源删除而自动改写或消失，除非用户同时请求删除该原文。
- 发生时间、记录时间与适用时间分开。人物迁居保留同一人物的既往经历，但旧世界的当前场景不覆盖新居；平行分支只继承明确的共同历史，兄弟分支不会自动互相记忆或合并结局。

#### 现实与虚拟的双向影响

例如，用户补充「外公喜欢种花」，后续虚拟生活可生成种花的情节；只有种花事件在该世界正式提交后，角色才能在下一次聊天中接着说那盆花的进展。用户再提出换住处，可以形成新的剧情行动与迁居事件，影响后续生活。此链路应在原有聊天、世界与动态中自然呈现，不要求用户维护后台记忆条目。

用户表达、剧情提议、行动执行与事件落定是不同阶段：一句「我想给你换个住处」不等于已经迁居。涉及邮资、礼物、资产或其他有副作用的操作，仍由各业务接口校验并提交，AI 叙述不能代替执行。事件携带前因与来源引用；重复投递只更新一次，单次因果链与生成预算有界，不能由 AI 故事和回复相互递归触发无限生成。虚拟事件能够影响后续互动与虚拟世界，但不自动改变用户现实资料或把虚构故事写成真实往事。

#### 分期与验收边界

1. 保留已经完成的 K04 珍藏、候选、原文和检索接口。当前候选的单对消息限制只适用于这一入口，不作为完整记忆系统的来源限制。
2. 在已有真实数据试点门槛下，先补「画像 + 全部获准文字对话 → 自动长期记忆 → 新会话调用」；验收不点珍藏也能接续、更正后使用新信息、来源移除后旧结论失效，并验证跨账号与跨人物隔离。自动记忆不得消费珍藏确认序号、发布 `MemoryConfirmed.v1` 或获得珍藏邀请奖励。
3. R01 的世界／私人空间接入正式事件和时间线后，再完成「聊天影响剧情 → 世界事件落定 → 后续聊天与故事接续」，同时验证迁居、并行分支、草稿未执行、重复事件、迟到结果及循环触发边界。

自动长期文字记忆按下述首片契约增量实施；世界正式事件与分支组合仍随 R01 实现。现有 `memories` 表和 MEM-01–07 继续表示用户珍藏原文与其候选，不把它们改义为所有自动记忆。当前 FIND-01 的原文搜索范围也不等于 AI 上下文的全部可用素材。

### 自动长期文字记忆首片（2026-11-12）

本片保持原聊天、人物资料、珍藏与星图 UI。最新画像直接参与回复；People 的正式画像版本与 Conversations 的全部获准用户文字消息另经可靠事件交给 Memories 异步整理。AI 前文最多六条，仅用于理解语境，不能作为真实经历的证据；尚无正式世界事件时不把 AI 自述当作虚拟生活已落定。问候、假设、引用、虚构请求及一时情绪可以没有长期条目，零结果也是正常完成。

| 所属服务／持久资源 | 本片职责与约束 |
| --- | --- |
| People `006_automatic_memory_sources.sql`、Conversations `004_automatic_memory_sources.sql` | 保留既有 Outbox，新增独立 `automatic_memory_event_acks`。按调用方明确账号集合读取未确认事件，不使用时间／自增高水位；事件 UUID 逐条幂等确认，复合外键绑定原账号及事件，注销随原事件级联清理。 |
| Memories `automatic_memory_sources` | 唯一 `(account_id,person_id,source_kind,source_id)`，类型 `profile`／`message`，状态 `active`／`removed`／`blocked`，保存权威来源版本、来源时间、消息精确 bigint 序号及本地状态时间，不重复保存原文。乱序旧版本不能覆盖墓碑。 |
| Memories `automatic_memory_receipts` | 唯一 `(origin,event_id)` 和请求摘要，结果 `accepted`／`stale`／`ineligible`／`removed`。先持久受理再确认来源事件；权威 404、旧授权和已擦除来源不会永久堵住队头，临时依赖故障仍重试。 |
| Memories `automatic_memory_jobs` | 独立 `memory.extract.v1`，载荷仅 `{jobId,dispatchId,dispatchGeneration}`；任务保留来源／上下文引用、摘要、人物／账号／存储／AI 版本、尝试与租约及状态时间。`queued → running → succeeded/failed/blocked`；同人物最多一个 running，较早来源优先，有界重试，旧尝试及派发不能写回。 |
| Memories `automatic_memory_entries` | 最多六条原子结果／任务；正文最多 600 字、依据最多 400 字且必须是当前来源的原文子串。记录主题、适用时间说明、来源 ID／版本／作者／时间及上下文引用；现实属性仅 `user_reported` 或 `user_provided_profile`。状态 `active`／`superseded`／`withdrawn`，与珍藏确认序号、奖励资格完全独立。 |

来源端和记忆端都不直连其他服务的数据库。内部接口仅对专用服务凭据开放：

| 接口 | 输入和输出 |
| --- | --- |
| 两个来源服务 `GET /internal/v1/automatic-memory/events` | 必填 `accountIds`（1–100 个 UUID），`limit` 默认 50、最大 100，先按账号过滤。返回事件 `{eventId,accountId,personId,sourceKind,sourceId,sourceVersion,change:'upsert'|'remove',occurredAt}`，不带正文。 |
| 两个来源服务 `POST /internal/v1/automatic-memory/events/{eventId}/ack` | 空对象，返回 `{eventId}`。同一事件重复确认不重复写，擦除围栏与原事件存在性再次核对。仅 Memories 凭据。 |
| Conversations `GET /internal/v1/automatic-memory/messages/{id}` | 账号请求头；只返回本账号当前人物可见的用户文字源、原生成任务 AI 授权版本、精确 `sequence` 字符串及至多六条同授权前文。存储授权前后复核；源授权为 0 或旧版本不能借新许可补领。 |
| Conversations `POST /internal/v1/automatic-memory/validate` | 账号请求头与 `{personId,refs:[{id,version}]}`，最多 64 条；仅返回仍可见的引用，不返回正文。账号、人物、源版本和擦除围栏仍核对；存储授权撤回后允许此元数据校验，用于失效控制与用户数据复制。 |
| Memories `GET /internal/v1/persons/{personId}/automatic-memories/context?q=` | Conversations 凭据与账号请求头。最多八条当前有效条目。按查询词在本人物全部有效历史中用参数化 SQL 粗排，再取至多 200 条候选并按原证据评分选取；不把“最新 200 条”误作全部历史。返回正文及完整来源引用。读前后复核授权、来源及本地条目；批量来源校验分为至多 64 条一组，不与珍藏原文接口混义。 |
| Memories `POST /internal/v1/persons/{personId}/automatic-memories/validate` | 同一调用方，`{refs:[{id,version}]}` 最多八条。只复核本次回复实际使用的条目及其权威来源；无关新条目的到达不会阻止正常回复。 |

聊天把最新画像、近期对话、珍藏及自动条目分别传给模型。实际使用的 ID、版本及来源引用在 Conversations `generation_jobs.memory_context_refs` 留痕，结果提交前再次校验。远端授权与本地提交仍是 RPC 边界，不声称跨数据库原子撤权；已经发送给供应方的请求也不能被追溯收回。

生成专用近期上下文另行过滤已删父消息的历史 AI 回复，以及直接或继承引用了失效自动条目的历史 AI 正文；历史页面仍按其原有权限展示。已验证历史 AI 的引用通过内部 `memoryContextRefs` 传给下一轮，和本轮直接引用去重后保存到新任务，不能通过 A→B→C 转述摆脱来源失效。较新 AI 优先，历史继承最多 24 个不同自动引用，本轮最多再加入八个，合计不超过 32；超预算或版本冲突的整条历史 AI 退出提示词，用户消息保持可用。相同引用组复用本次校验，跨服务每批至多八条；依赖故障不会默认允许旧正文。生成期间引用失效仍阻断写回，不以过滤界面文字代替来源控制。

更正由新来源的明确依据指定被替代条目，限同账号／人物、当前有效且较早的来源。消息排序使用精确 bigint 序号，同毫秒不靠 UUID 或 JS 浮点数猜先后。被替代条目不会因删除更正消息、重投旧事件或旧任务而复活；某来源版本成功整理后不因换授权或上下文而自动重新学习。自然语言是否构成更正仍依赖模型判断，证据与时序限制不保证任意矛盾都能识别。主题级遗忘及重新学习的用户交互、世界时间线与多方共享范围另行实现。

所有新表接入账号擦除写围栏。导出含自动条目及来源／状态并参与 revision；被替代、撤回或来源已失效的条目只提供最小元数据，不返回旧正文、依据或主题。复制已有资料不要求重新允许 AI。注销清理新增表与对应 pg-boss 派发，迟到生成不能恢复内容。恢复演练同时阻断自动任务，保持副本受限。

`AUTOMATIC_MEMORY_ENABLED` 默认 `false`，本机 Worker 还受明确的 `MODEL_ALLOWED_ACCOUNT_IDS` 和新的 OpenAI AI 文字政策 v2 共同约束。Identity 006 为当前政策保存明确能力标记；必须有权威 `aiTextProcessing.automaticMemoryAllowed===true`，旧 v1 的 `allowed:true` 不足以启用。新隐私告知 v3 和新 AI 政策必须在原浮层重新确认／允许，不能从较大版本号或白名单推导同意。Worker 每次先筛选当前有效授权账号，再取其来源事件；未授权账号的事件不被擅自确认，也不堵住其他账号。已授予新用途之前的旧聊天不自动回填，重新学习另行取得明确授权。生产提供方门禁仍关闭。

### R01 迁居与文字聊天接续首片（2026-11-12）

复用原人物资料「关于 TA → 所在世界 → 迁往」，没有新增页面、收费或 AI 确认步骤。People 是人物当前住处和用户已提交迁居事实的权威；迁居不改变人物身份、访问版本、直聊 ID 或珍藏原文。此片只落实主线迁居，不包含自动世界剧本、分支、小聚、私人动态、图片或书信。

Conversations 经专用服务凭据和账号请求头读取 `GET /internal/v1/persons/{personId}/world-context`，响应为 `{accountId,personId,personVersion,worldVersion,reality:'virtual',branch:'main',currentWorld,recentMovements,revision}`。`currentWorld` 与迁居两端快照均为 `{id,code,displayName,catalogVersion,enabled}`；迁居为 `{id,worldVersion,personVersion,fromWorld,toWorld,occurredAt,recordedAt}`，按世界版本倒序，最多八条。初始世界版本为 1；后续版本必须连续、最新目的地必须对应当前位置。原住处目录停用仍可回读，目的地必须启用。缺失、跨账号、断链或摘要错误按依赖失败处理，不能退回前端演示场景。

`revision` 为上述对象去掉 `revision` 和顶层 `personVersion` 后的规范 JSON SHA-256：对象键递归按字典序排列，数组顺序保留。普通画像编辑不会重写世界历史；生成仍单独校验人物整体版本。真实用户迁居动作产生正式事件，聊天中的愿望、AI 自述和生成建议不执行迁居，也不产生世界事件。

最新画像、近期文字、珍藏、自动记忆和虚拟世界上下文分开传给模型。世界事实明确标为虚拟主线，不能改写真实生平。生成前、模型返回后及提交前重读权威上下文；期间迁居、往返迁居或目录变更会阻止旧场景回复写回。新迁移 `Conversations/005_virtual_world_context.sql` 保存实际使用的 `generation_jobs.world_context_ref`，包含账号、人物、人物／世界／目录版本、世界 ID、迁居 ID 和摘要，随数据导出返回。旧任务保持 `null`，不伪造历史引用。

生成提示词排除世界版本／摘要已不匹配的历史 AI 正文，迁居后也排除没有世界引用的旧 AI；用户消息和页面历史继续保留。A→B→A 不会使旧 A 场景回复重新成为当前事实。授权及世界权威读取与本库提交之间仍有 RPC 竞态窗口，不宣称跨库原子迁居。无需 AI 即可迁居／回读；后续文字生成继续遵守现有 AI 文字用途、模型运行名单及提供方门禁，不开启自动世界故事。

原 UI 实测已完成：独立新合成账号在未允许 AI 时直接迁居，刷新后世界和成员正确，人物／直聊／珍藏身份不变；随后在原隐私浮层明确允许既有 AI 文字用途，原聊天经真实 OpenAI 正确回答迁入地。再从原按钮搬回，世界版本为 3，回复同时正确识别当前及上一个住处。旧迁居键重放只返回当前人物且不新增事件，聊天表达未来搬家愿望也没有改变住处。成功任务保留实际版本 2／3 的世界引用；自动画像来源同步到最新人物版本，无旧版本有效条目。原隐私浮层经 OTP 同会话重验后下载四域 JSON，迁居事实、聊天引用、珍藏及全部域 revision 交叉核验通过，下载已清理。

联调曾暴露 People → Identity 只读账号上下文缺少角色许可，已只补该读接口的已配置 People 凭据；三套独立角色 token 的真实 HTTP 反例与 Identity 全量 24 项回归通过。Conversations 全量 80 项、People 32 项及前端适配器七项回归通过。以上为本机 Web 原页面和指定真实模型的证据，不替代安装版或生产供应方验收。

上述联调资料随后通过新五库 127 表原生备份／恢复，实际迁居与世界引用保留、源库未变、临时目标清理均通过；受限副本保持不可对外启用。报告与生产未验范围见[恢复演练记录](../../deploy/recovery/README.md#本次验证记录2026-11-12)。

### R01 私人文字动态与迁居投影（本轮实施基线）

本片沿原空间页接 FEED-01–08 的私人文字发布、手动点赞／评论和迁居事实投影；媒体、AI 回响、AI 自动互动、世界自动剧本与公开社交均不启用。新增独立 `social` NestJS／PostgreSQL 服务（API 3105、开发数据库 5437），不跨库查询或写入。Identity 校验主体及用途，People 保有迁居权威，Social 只拥有动态与互动。旧文字保存政策仅覆盖人物故事，不能默认扩大：Identity 增量 007 追加告知 v4、文字保存政策 v2 和明确的 `private_feed_enabled` 能力标记。沿原浮层重新确认／允许后，权威 `storyStorage.allowed` 与 `storyStorage.privateFeedAllowed===true` 共同门禁本片读取／发布／互动／投影，不按版本号推导用途；不需要 AI。旧政策、决定及 AI 政策 v2 不改义，不自动授权，不向模型提交动态。删除、复制／注销不以重新授予该用途为前提。

Social 公共 DTO 沿 FEED 表：`Post={id,kind:'user'|'world_notice',author:{kind:'self'}|{kind:'system',worldId},body,mediaIds:[],worldId?,personId?,sourceMovementId?,worldMovement?,reactionCount,commentCount,reactedByMe,reactionPreview,commentPreview,createdAt,version}`；`worldMovement={id,personId,personName,worldVersion,reality:'virtual',branch:'main',fromWorld,toWorld,occurredAt,recordedAt}`，世界卡片沿迁居首片。`Comment={id,postId,author:{kind:'self'},body,replyToCommentId?,createdAt,version}`，无 AI 作者。`reactionPreview` 为至多八个作者，`commentPreview` 为最新三条、时间升序。所有 UUID 保持字符串；端侧映射原 numeric ID，不拿数组下标充身份。迁居的显示标签为「迁居记录」，不标成 AI 回响或世界时令，人物空间按关联 `personId` 筛选。

FEED-03 增加客户端稳定 UUID `clientPostId`，FEED-07 增加 `clientCommentId`；传输 `Idempotency-Key` 与客户端意图双重去重，异参同意图 409。FEED-05 只设置 `{active}`，以服务端结果更新显示，不发送 toggle。写操作继续同源／预期会话／幂等校验；删除带 `If-Match`。文字发布为 1–500 Unicode 字符，评论 1–1000，非空 `mediaIds` 明确失败并保留端侧草稿。成功、取消、未知结果和切号的迟到响应不能提前清空草稿或给新账号显示旧结果。分页继续账号／筛选／limit 绑定 HMAC 游标，动态按时间／ID 倒序、评论升序。公开接口从 Cookie 推导作者，不接受客户端伪造。

People 新增仅 Social 独立凭据可读的内部接口，不开放 story／聊天／自动记忆：

- `GET /internal/v1/social/persons`，账号请求头，返回 `{accountId,persons:[{id,displayName,worldId,version,accessVersion,worldVersion}]}`。只包含当前可见人物，最多 1000，超限明确失败；同时复核 Identity active 与本地擦除围栏。
- `GET /internal/v1/social/persons/{id}/world-movements?afterVersion=N&throughVersion=T&limit=100`，返回 `{accountId,person:{上述元数据},items:[迁居首片 DTO],nextAfterVersion,hasMore}`。初始 N=1，T 固定为本次人物目录的 worldVersion，1≤N≤T≤当前版本；按世界版本连续升序读至 T，不用时间戳高水位，不截成最近八条。每页使用一致快照，缺失事实、断链或权限失败不返回伪空结果。

Social 在空间回读时按账号同步已有事实的读投影，不创建世界事件或模型任务。每个人物的 lastProjectedWorldVersion 与本页投影同事务保存；唯一 `(account_id,source_movement_id)`／`(account_id,person_id,source_world_version)`，同一来源不同摘要拒绝覆盖。网络读取在本库短事务之外，账号擦除门闩先于游标与帖子锁。固定 horizon、有界页数，预算耗尽明确失败，保留已安全提交的水位供后续继续，不能静默丢失历史。再次读取和互动复核当前可见人物；移除人物立即排除其所有迁居帖和关联互动，People 依赖失败不能以旧缓存替代权限。

新表必须含创建／更新时间、正版本、受限状态、同账号复合 FK、活动点赞唯一性、计数一致性及账号擦除围栏；删除不复活，幂等重放回读当前资源。用户帖、评论、点赞、迁居投影与同步水位均进入第五域数据导出、注销及第六库受限恢复；未配置 Social 的旧部署维持原四域路径，配置后任何 Social 故障不得跳过该域假报成功。复制已有资料不触发生成，删除途中晚到同步不能恢复正文。RPC 权威核对与本库提交间的竞态边界仍需明确，不声称跨库原子。

本轮实施与原 UI 验收（2026-11-12）：Identity 007／Social 001 已应用，五个独立 API、四个既有 Worker 和 Web 联调已启动。Identity 28、People 35、Social 14 项真实 PostgreSQL／Nest／来源 HTTP 回归通过，前端 13 项实际适配器及原 Moments 异步副作用测试、TypeScript 和独立生产构建通过。

专用新合成账号从原 OTP、寻找 TA、原告知与存储授权进入：未授予 AI 即可迁居，在原空间读到唯一正式迁居帖，标签与历史目的地正确；原浮层文字发布、点赞／取消及四条手动评论保存并刷新回读，前三条 preview 不会被当成完整列表。原「我的空间」只显示本人帖，人物空间包含对应迁居。真实服务已保存但丢失响应时，原草稿保留、同键／客户端意图重试只产生一条动态；图片未接时文字与图片均保留。进入人物资料时只确保原有直聊，没有创建消息或调用模型。

旧合成账号的旧许可被拒绝访问动态，在原隐私浮层明确升级；存储撤回后立即 403，真实授权已提交而丢响应后，原 X 关闭／重开仍可用原身份重试，授权版本只增加一次，AI 历史／版本不变。用途之间的状态刷新和 intent namespace 分开，失效组件不能清掉新实例的重试身份。

原隐私浮层经 OTP 同会话重验下载五域 JSON，实际帖子、完整评论、点赞状态、迁居来源及同步水位与公开 API 交叉核验，五域 revision 均正确，原人物／直聊／珍藏保持，下载已清理。另一专用旧合成账号随后经原注销入口与 OTP 清理，匿名收据完成、旧 Cookie 写入被拒；Identity 进度包含四个数据域与提供方，四域私有表全清并保留写围栏，新合成账号不受影响。六库恢复的实际报告见[恢复演练记录](../../deploy/recovery/README.md#本次验证记录2026-11-12)。这些是本机 Web 联调证据，不替代安装版或生产发布。

### R01 珍藏回响与所属人物评论（本轮实施基线）

本片只接「新许可后新珍藏／修订 → 空间 AI 回响 → 用户评论 → 原文所属人物 AI 回应」，沿原珍藏编辑、空间行、引用框、AI 标签与评论浮层。普通用户帖、迁居帖、其他人物、未确认候选及自动记忆条目不参与，不自动点赞，不执行世界副作用，不由 AI 产物递归触发生成。珍藏成功只依赖原文保存，回响异步失败不回滚原文。

保留隐私告知 v4、文字保存 v2；新增 AI 政策 v3，明确上述新动作范围且保留原自动长期记忆能力。Identity 增量 `private_feed_processing_enabled` 默认 false，仅 AI 政策可启用；权威 `aiTextProcessing.privateFeedProcessingAllowed===true` 才能派发，旧许可不升级。公开 Policy DTO 增加 `privateFeedProcessingEnabled`，原 AI 浮层可在允许前说明新用途，不按版本数字猜能力。仅此存储授权不会送模，已有普通动态和旧珍藏不默认回扫。

Memories 仍拥有确认原文。新 create／patch 在既有 `MemoryConfirmed.v1`／`MemoryUpdated.v1` 事务 Outbox payload 捕获 `echoAiAuthorizationVersion`：仅受理动作的当前 AI 许可允许本用途时保存其正版本，否则 0；旧事件缺失视为 0。Social 按允许账号逐事件持久 receipt／任务后 ack，来源端独立 ack 表用原事件同账号复合 FK、擦除级联，不能以时间或确认序号作永久高水位。移除事件无需 AI 许可；重复、乱序按源版本和墓碑处理，撤回再允许不复活旧任务。

专用服务来源契约（仅 Social 独立凭据，不开放既有通用原文／故事端点）：

- Memories `GET /internal/v1/social/memory-events?accountIds=...&limit=50` → `{data:[{eventId,accountId,personId,memoryId,sourceVersion,change:'upsert'|'remove',echoAiAuthorizationVersion,occurredAt}]}`；账号最多 100、页最多 100。`POST .../memory-events/{eventId}/ack {}` → `{eventId}`。
- Memories `GET /internal/v1/social/persons/{personId}/memories/{id}/context?expectedVersion=V&expectedAiVersion=B` → `{accountId,personId,id,title,body,origin,version,confirmedAt,updatedAt}`。只返当前可用且版本精确为 V 的确认原文，前后复核账户、人物、存储／私人空间及新 AI 旗标，当前 AI 授权版本须精确为 B。该准确原文版本的正式 `MemoryConfirmed.v1`／`MemoryUpdated.v1` upsert 还须曾捕获正的 `echoAiAuthorizationVersion`，仅当前 grant 并不足以读取原先无此用途的版本。手写／已采用候选均可，独立珍藏不随原聊天删除而消失。
- Memories `POST /internal/v1/social/persons/{personId}/memories/validate {refs:[{id,version}]}` → `{personId,valid:[{id,version}]}`，最多 64。只返当前有效 ID／版本，不返正文，不要求重新允许 AI／存储，用于已保存结果失效与导出；账号／人物权限及擦除围栏仍检查。
- People `GET /internal/v1/social/persons/{id}/ai-context?expectedAiVersion=B` → `{id,accountId,displayName,relationship,calledMe?,story,version,accessVersion,worldId,worldVersion}`，同样前后核验当前新用途准确版本 B；`GET /internal/v1/social/persons/{id}/world-context?expectedAiVersion=B` 返回迁居首片的规范虚拟主线 DTO，不混为真实生平。

原文版本的历史用途依据与当前任务授权分开。若版本 V 的正式 upsert 曾捕获授权 A>0，后来撤回并明确重新允许为 B，用户在仍合法可读的旧回响下发表的新评论属于新意图，可以由绑定 B 的新任务读取版本 V；不要求历史 A 等于当前 B。原来绑定 A 的排队、失败或在途任务仍要求当前授权精确等于 A，不能借 B 自动恢复。历史捕获值为 0 或缺失的版本不能借后来 B 进入模型；只有用户重新确认新珍藏或主动修订产生新版本、新事件，才按新动作再次判定，既有珍藏与旧评论不补扫。

Social 新增独立 pg-boss Worker。业务任务与物理入队同事务，载荷只有任务 ID／派发代次；任务保存 account／person／memory／post／comment、各授权及来源版本、尝试／租约／状态时间、失败／取消与实际世界引用，不保存提示词或模型密钥。回响唯一 `(account,memory,sourceVersion)`；同原文最多一个当前有效回响，源变更／删除立即让旧帖和互动退出读取，旧 ID 不恢复。新版本生成新帖，保留原 `memoryId`；原文和事实不会被模型改写。

公共 Post 扩 `kind:'memory_echo'`、`author:{kind:'persona',personId,displayName,aiGenerated:true}`、`sourceMemoryId`／`sourceMemoryVersion`／`sourceMemory:{personId,memoryId,version,excerpt}`，excerpt 为准确原文最多 320 字符；记录生成时世界 ID／引用，历史地点不随迁居改写。Comment 作者扩同形 persona，角色固定为该回响源人物；只在新的 self 评论受理时捕获当前允许的新 AI 版本并事务创建 `feed_reaction` 任务，缺许可仍正常保存用户评论且不补扫。精确 `replyToCommentId` 沿原点击评论交互传递，不能只按作者猜目标。AI 评论不再派发任务。

生成前、实际模型前、模型后、提交前核对账号、存储、AI 精确版本、人物／世界、确认原文、回响与父评论当前状态。取消、编辑、删除、移居、撤权或旧 attempt 不能写回；读取、互动及导出另验证权威原文，依赖失败不能放行旧 quote。已保存 AI 可在撤回 AI 后按存储权读取；来源失效的旧正文不能被导出或转述为新事实。RPC 与本库提交仍存在窗口，不声称跨库原子撤权。

新增来源 ack、Social 任务／派发、AI 帖／评论及引用全部进入五域数据权利、账号擦除和六库隔离恢复。复用当前模型 SDK／OpenAI 范围、`store:false`、受限账号名单、超时／取消和生产门禁。手动原文和评论保留，不用模板伪造回响。完成、部署与原 UI／真实供应方效果分别记录，本节当前为实施基线。

AI v3 保留 `automaticMemoryAllowed` 能力，不代表旧自动长期记忆会跨授权版本自动继承。现有 Memories 检索仍要求条目的 AI／存储授权版本与当前 grant 精确相同；升级后新 grant 与历史版本不同，旧条目仍保留，并按来源当前有效性导出（失效来源仅最小元数据），但不会自动带入新聊天，也不因此重新抽取已经处理的旧来源。复用历史自动条目的产品规则须单独明确，不能为本片回响放宽旧授权或来源约束。

### K04 珍藏实现边界

MEM-01–07 与 FIND-01 已接入独立 `memories` 服务。原气泡「珍藏」和手写入口沿用原编辑确认弹层：直接摘录和手写为 `manual`，实际采用并确认 AI 候选后为 `ai_candidate`。生成只产生候选，正式原文始终由用户确认；R01 动态回响后续接入。

当前真实文字聊天的输入包括 People 最新 `story`、同会话截至源消息的最近 20 条有效消息、相关珍藏原文（最多 8 条，无匹配时最近 4 条），以及上文独立授权的自动长期记忆和已提交迁居上下文。珍藏不再被描述为唯一记忆来源。虚拟迁居与真实生平分开；尚未实现的自动生活、剧本和分支不能因 AI 自述而成为正式事件。

已实施原文迁移见 [`001_memories.sql`](../../backend/services/memories/db/001_memories.sql)，[`002_memory_candidates.sql`](../../backend/services/memories/db/002_memory_candidates.sql) 增加候选、任务及来源关联，保持已应用迁移不变。`original_created_at` 仍随 K05 旧资料导入添加。

### K04 候选整理实施基线

- 原消息「珍藏」立即打开原弹层，后台请求 MEM-01。候选实际填入前保持直接摘录身份；进入修改、聚焦、键入或确认后，迟到建议不再自动填入。只有编辑器实际采用候选，MEM-03 才携带 `candidateId,candidateVersion`。候选未确认时不分配确认序号，不发 `MemoryConfirmed.v1`，不进入搜索或后续聊天的已确认记忆。
- 模型仅依据用户提供的人物故事、对应本人消息和选中 AI 回复这一对对话整理。新增受记忆服务凭据保护的 Conversations `GET /internal/v1/messages/{id}/memory-context`，返回 `{source,messages:[本人父消息,选中AI回复]}`，两条均需当前有效、同账号同会话，禁止混入后续消息。所有实际消息 ID/版本和账号、人物、授权版本在入队、生成前后、候选读取及确认时核对。AI 回复仅为辅助资料，不能把 AI 自述升级为用户真实经历；资料不足时任务以 `NO_MEMORY_FACTS` 阻断，保留原摘录供用户编辑。
- `memory_generation_jobs`、`memory_candidates` 和真实 pg-boss 入队归记忆库；任务创建与入队同事务，网络请求在事务外。任务具备状态、尝试/派发身份、租约、创建/开始/结束/更新时间和有界恢复。队列只携带业务任务引用；正常模型失败由原任务显式重试，禁止 SDK 重试与业务重试叠加。
- `candidate_commands` 永久保存已受理的申请/取消/重试的请求指纹和结果引用，不保存正文，独立于普通七天的 `memory_commands`。同源当前 `queued/running` 或有效 `ready` 结果复用；同完整快照的失败返回原任务供 GEN 重试；已消费结果保留原任务与消费元数据。完整消息/人物/授权快照变化且当前来源仍有效时，新操作键可重整；旧活跃任务先在同一门闩事务中阻断并撤销旧尝试资格。过期、撤回、取消后新操作键可申请新任务，旧键只回读原操作，不能再次付费生成或复活已删原文。重试保留业务任务 ID，使用新的物理派发 ID，并与同源活跃任务互斥。
- 候选在生成成功后创建为 `ready`，有效期 24 小时；仅允许 `ready → consumed/expired/withdrawn`，状态推进记录 `state_changed_at`，消费记录 `consumed_at`。仅当前有效 `ready` 返回标题与正文；临时依赖故障返回可恢复错误，不永久撤回。已消费候选保持独立消费事实，后续删来源不倒改状态。
- 新迁移将 `memories.origin` 扩为 `manual|ai_candidate`，增加同账号同人物的 `candidate_id` 本地复合外键及非空唯一约束。MEM-03 在本库账号游标锁序下消费候选、写用户最终文字、确认序号、命令引用与事件；相同客户端操作回读已有原文，另一操作争同候选返回 `CANDIDATE_CONSUMED`。候选状态/版本/截止时间及完整来源必须在确认时有效。
- 已采用的候选后来失效时保留用户草稿，返回 `CANDIDATE_EXPIRED/WITHDRAWN/CONSUMED/NOT_READY` 或 `SOURCE_CHANGED`。原弹层仅在此错误态提供明确的「按手写保存」：用户主动选择后才清空候选及旧消息来源，以新的客户端操作身份保存当前文字为 `manual`，不会自动降级。

- MEM-03 增补可选且必须成对的 `sourceMessageId`、`sourceMessageVersion`，记录原聊天摘录的来源。当前账号、人物、AI 回复作者、可见性与版本由 Conversations 内部接口核验；失效来源不能在保存时悄悄转为无来源手写。已确认原文独立存在，后来删来源只隐藏来源引用。
- MEM-04 可带 `include=body` 返回完整 `Memory[]`，供原人物记忆卡片使用；不带时仍返回摘要。详情及所有原文浮层通过 MEM-05 再校验。PATCH、DELETE 沿用原站、幂等键与 `If-Match`；DELETE 成功返回 `200 {id,removedAt,version}`。移除允许在存储用途撤回后清理，读取与新保存需当前用途授权。
- 确认顺序由记忆库的 `memory_account_cursors(account_id,last_confirmed_seq,created_at,updated_at)` 分配，和原文、命令及 `MemoryConfirmed.v1` 同事务。Identity 的旧 `accounts.memory_confirmation_seq` 兼容保留，不再承担记忆库确认顺序。外部账号、人物、消息只保留稳定 ID 和权威上下文校验，不伪造跨库 SQL 外键或行锁。
- `memory_commands` 存操作、目标、请求指纹、资源结果引用、`created_at` 与默认七天的 `expires_at`；完整私人正文不放入重放缓存或 Outbox。原文的客户端身份与请求指纹保留，已移除条目的旧成功重放不得恢复正文或重新建档。
- FIND-01 的本轮范围为 `scope=atlas`，保留现有星图的 NFKC、中文词对、单句证据与否定谓词规则。人物、世界与已确认原文先按当前账号及访问范围筛选，再排序分页；游标绑定账号和规范化查询，可选 `locale=zh-CN|en`。会话历史搜索仍属 R01。
- Conversations 通过记忆服务内部上下文接口读取相关的已确认记忆，最多八条、每条正文最多 1200 个 Unicode 字符；无相关结果时选最近四条。生成前与写回前复核实际引用的记忆 ID/版本，变化或删除则阻断旧结果。原文和引用片段分离，AI 候选不直接进入已确认上下文。跨服务复核与本地提交之间仍有时间窗口，不宣称跨库原子撤权。

内部调用：Identity/People 的既有会话、账号、人物上下文新增允许独立 `XIJIE_MEMORIES_SERVICE_TOKEN`；People 增加 `GET /internal/v1/worlds` 返回 `{id,code,displayName,enabled,catalogVersion}[]`。Conversations 增加 `GET /internal/v1/messages/{id}/context`，仅接受记忆服务凭据和 `X-Xijie-Account-Id`，返回当前有效的 `{id,accountId,personId,conversationId,kind,author,text,version,createdAt}`。记忆服务的 `GET /internal/v1/persons/{personId}/memories/context?q=` 仅接受 Conversations 凭据和同账号头，返回 `{personId,memories:[{id,version,title,body}]}`；此入口只校验 Identity/People 与记忆库，不反向读取聊天来源，避免调用递归。以上内部路径均不经前端代理。

`Memory` 详情为 `{id,personId,title,body,origin,source?,confirmedAt,originalCreatedAt?,version}`。`source` 的返回范围经权限筛选，可为 `{kind:'message',messageId}`、`{kind:'contribution',contributionId}` 或空。被移除或当前不可访问的来源引用从读 DTO 省略，已确认原文仍按其自身权利规则处理。原文始终保存用户确认过的文字。

| 编号与接口 | 输入和结果 | 后端执行、权限、并发及恢复 |
| --- | --- | --- |
| MEM-01 `POST /v1/persons/{personId}/memory-candidates` | `{sourceMessageId:UUID}`，返回 `202 {generationJobId}` | 只接受同账号当前人物的有效 AI 回复和同一会话的可授权对话。按来源消息及版本复用已有有效任务，入队生成候选。候选过期、失败或源授权变化时重新验证后再申请。 |
| MEM-02 `GET /v1/persons/{personId}/memory-candidates/{candidateId}` | `{id,personId,sourceMessageId?,title?,body?,state,expiresAt,version,consumedByMemoryId?}` | 校验候选归属和人物访问。状态 `ready`、`consumed`、`expired`、`withdrawn`。只有可读的 `ready` 候选返回原文和源消息。其他状态可返回可见元数据，以便前端保留用户已编辑的端侧输入。 |
| MEM-03 `POST /v1/persons/{personId}/memories` | `{clientMemoryId:UUID,title,body,sourceMessageId?,sourceMessageVersion?,candidateId?,candidateVersion?}`，标题 1–120 字符，正文 1–10000 字符。消息来源成对且与候选互斥；候选确认须传版本。返回 `201 Memory` | 仅本账号用户确认。本轮手写及直接摘录为 `manual`，来源通过当前 Conversations 上下文校验。记忆库锁 `memory_account_cursors` 分配不可变 `confirmed_seq`。创建回忆、来源、确认序号、命令与 `MemoryConfirmed.v1` 同事务。确认序号用于邀请资格先后，API 返回原 `confirmedAt`。客户端 ID 唯一并保留请求指纹，同参重放回读当前原回忆，异参 `409 IDEMPOTENCY_CONFLICT`；删除后不重放旧正文。候选在本库锁定、复核状态/版本/源授权并原子消费，一候选只对应一条原文。失效候选保留用户输入，不自动降级为手写。回响和检索不影响保存结果。 |
| MEM-04 `GET /v1/persons/{personId}/memories` | 通用分页。默认 `{id,personId,title,excerpt,origin,confirmedAt,version}[]`；`include=body` 返回完整 `Memory[]` | 验证人物与授权，按确认时间及 ID 降序。空列表真实返回，不填充示例。 |
| MEM-05 `GET /v1/persons/{personId}/memories/{memoryId}` | 返回 `Memory` 和 `ETag` | 星图、世界场景、人物页及聊天原文统一入口。验证两级 ID 的归属和关系。移除后的旧链接返回 `404`。 |
| MEM-06 `PATCH /v1/persons/{personId}/memories/{memoryId}` | `{title?,body?}`，至少一个字段，`If-Match`。返回 `Memory` | 检查版本与同账号访问。保留原 ID、最初确认时间及来源类型，更新文本和版本，记录最小审计和 `MemoryUpdated.v1`。来源与奖励资格不因修订重复产生。 |
| MEM-07 `DELETE /v1/persons/{personId}/memories/{memoryId}` | `If-Match`。返回 `200 {id,removedAt,version}` | 同事务移除原文可见性并写 `MemoryRemoved.v1`。当前直接查权威原文过滤；后续回响和索引由其所属服务过滤当前权限并异步清理。已有效发放奖励按活动规则由邀请域处理。 |
| FIND-01 `GET /v1/search` | `scope=atlas\|conversations`，`q` 去空白后 1–160 字符，`cursor,limit`。返回带判别字段的 `SearchHit[]`，标点归一化为空时返回空列表 | K04 支持星图人物、世界和真实回忆。R01 接已授权历史消息。先按账号和实时可见性裁剪，再按 NFKC 规范化、确定性证据和排序分页。直接人名命中导资料，真实原文命中导回忆，文字证据来自实际可见源。忽略虚构引导、演示和生成的背景故事。保留否定谓词匹配，避免从单个关键词误推相反含义。 |
| FEED-01 `GET /v1/feed` | 可选 `author=self\|person\|world`、`personId,worldId,kind,cursor,limit`。返回 `Post[]` | 只读自己的私人动态投影以及允许展示的系统世界条目。过滤项关联校验，按 `createdAt DESC,id DESC` 分页。原文和人物授权失效后即时排除相应回响。 |
| FEED-02 `GET /v1/posts/{postId}` | 返回 `Post` 与 `ETag` | 同 FEED-01 访问规则。回响返回 `sourceMemoryId` 与经鉴权的 `sourceMemory` 投影，可进入原文路由。 |
| FEED-03 `POST /v1/posts` | `{clientPostId,body,mediaIds?}`，正文最多500字符、最多九张图，正文或图片至少一项。返回 `201 Post` | 作者为当前用户。按[空间配图基线](./identity-people.md#r01-私人空间配图实施基线2026-11-13)，事务外向独立Media幂等预绑定成品，本库将帖子、`post_media`顺序关联、幂等与发布事件同事务提交；不宣称HTTP可加入跨库事务。图像来源和当前权限在读图时再次核对。有一项失败保留草稿，未知结果固定原投稿身份重试。普通用户图／文帖不触发AI互动。 |
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
| CALL-01 `POST /v1/conversations/{conversationId}/call-sessions` | `{mode:'voice'}`，返回 `201` 通话 DTO，初始 `state:'created'`；UUID 幂等键 | 只允许当前本人直聊。独立 `person_voice_calls` 和文字保存授权；生产还需当前 production v2 授权与显式运行审批。每账号最多一个活跃通话；创建不等于接通。`video` 返回 `VOICE_MODE_UNSUPPORTED`，原影像只作动态资料照片预览。 |
| CALL-02 `POST /v1/call-sessions/{callSessionId}/grants` | 空对象，返回 `200 {url,token,expiresAt}`，不缓存 | 复核来源会话、人物和精确授权版本；10 秒、一次性、绑定同账号同会话。URL 没有 token；浏览器以 `xijie.voice.v1,xijie.grant.<token>` 子协议发送，响应仅回第一个协议。相同键返回原凭证；明确过期后用新键申请，不能让重放延长旧凭证。 |
| CALL-03 `GET /v1/call-sessions/{callSessionId}` | 返回完整通话 DTO | 权威状态为 `created→connecting→connected→ending→ended/failed`，未加入过期为 `expired`。提供方 `session.updated` 验证且服务端连接成功后，DB 才写 `startedAt`。仅收到可信正常终止确认才写 `endedAt` 及两时间相减的整秒时长；异常或结果未知保留 null。 |
| CALL-04 `POST /v1/call-sessions/{callSessionId}/end` | 空对象、UUID 幂等键；返回 `200` 当前 DTO | 未连接可直接结束；连接中／已连接先转 `ending`，停止代理音频并关闭实际提供方。回读或 WS 获得最终状态；3 秒强制断开仍未确认则失败且不捏造结束时间。重复请求、迟到回调不重开通话。 |
| CALL-05 `GET /v1/call-sessions/{callSessionId}/stream`（WebSocket upgrade） | 固定同源路径、无 query，当前 HttpOnly session cookie＋上述一次性子协议 | 只收 24 kHz、单声道、PCM16LE 二进制音频和固定 `mute/interrupt/end` 控制；客户端不能提交 connected／时间／模型配置。后端单独连接官方 Realtime，持有私密 API key；真实 `session.created/session.updated` 握手及来源复核后转发音频和短暂 AI 字幕。每 2 秒复核会话、人物、用途和生产授权；来源超过 3 秒未能确认则关断。默认 60 秒，上限 120 秒；中央预算持久记录一次尝试并授予 150 秒 lease。 |
| SPEECH-01 `POST /v1/conversations/{conversationId}/transcriptions` | `{mediaId,language?}`，返回 `202 {generationJobId}` | 云转写获准启用后，媒体域先扩展并发布 `transcription_input` 音频用途和保留约束，校验临时音频、授权及会话关系，再将绑定、任务和入队一并提交。通过 GEN-02 取消，原文件与结果按授权和保留时限清理。 |
| SPEECH-02 `GET /v1/transcriptions/{transcriptionId}` | `{id,conversationId,text,createdAt,expiresAt}`，结果 ID 来自 GEN-01 `resultRef` | 同账号当前授权。读取转写仅填入可编辑草稿，用户确认再调用 CHAT-06。取消或失效后清除临时资源。 |

## 模块调用、任务和事件

同进程服务接收可信 `RequestContext`。跨表事务内把同一事务对象传给资源所属域。Worker 从任务绑定的权威对象及账号状态建立受限的账号代理上下文，包含任务用途与当前授权版本。退出设备会话不等于停止已受理任务。跨网络调用在短事务外执行。输入文本通过最少读取构造，任务和事件载荷仅保留 ID、时间与版本。

| 调用方 → 目标 | 类型接口及用途 | 权限和故障处理 |
| --- | --- | --- |
| 会话、回忆、动态 → 人物和媒体 | People／Media 各自拥有本库事实；业务域通过带独立服务凭据的内部 HTTP 接口取得归属、accessVersion 和精确来源／成品元数据 | 全部跨服务调用在本库事务与行锁外。单图先取得60秒预绑定，再在本库锁后校验截止时间及同库事实；提交后读取及Worker按当前来源、用途和捕获版本再次验证。Media用途包括post_attachment、person_photo、gift_delivery_photo、conversation_attachment；不设跨库FK或跨库SQL事务，浏览器短proof与内部模型字节用途分离。 |
| 礼物 → 会话 | `ConversationService.ensureDirect(tx,ctx,{personId}) → {conversationId}` | 赠礼前校验目标。可在赠礼同一事务为还未聊天的人物取得唯一会话。礼物事件消费后按 `(conversationId,giftRefId)` 唯一地追加或刷新时间线引用。 |
| 会话 → 礼物 | `GiftService.getConversationProjection(ctx,{deliveryId?;receivedGiftId?}) → GiftProjection` | 每次读校验原寄件或收件可见性，聚合时可批量调用同一查询语义。备注与留影由礼物详情接口返回。当前状态从权威寄件／收件读取。 |
| 共创 → 回忆 | `Memories.confirmFromContribution(tx,ctx,{personId,goalId,contributionId,text,sourceAuthorizationVersion}) → {memoryId,version}` | 共创域锁定目标、贡献和授权，使用可信原文调用。回忆域校验人物，按 `(accountId,personId,goalId,contributionId)` 唯一确认。当前 `origin='shared_contribution'`、`qualifiesForReferral=false`，登记原文与事件同事务。 |
| 数据权利 → 会话与回忆 | `ConversationService.importLegacy(tx,actor,{importId,legacyConversationId,target,messages}) → {conversationId,importedCount}`。`Memories.importLegacy(tx,actor,{importId,legacyMemoryId,personId,title,body,source?,originalCreatedAt?}) → {memoryId,version}` | 仅受信导入任务处理已确认批次，核对摘要、归属、每条旧 ID 和正式映射。`target` 使用已映射的人物或世界，`messages` 使用已确认原文、旧消息 ID 和原时间。正式 ID 由域分配。会话保留历史顺序，不安排新 AI 回复。回忆标记 `origin='import'`、`qualifiesForReferral=false`，可发事实事件用于索引。分块及映射规则按 PRV-07–09。 |
| 运营 → 原内容域 | `ConversationService.restrictMessage(tx,operator,{messageId,reportId,reasonCode})` 或 `FeedService.restrictPost(tx,operator,{postId,reportId,reasonCode})`，返回 `{id,version}` | 校验受信运营角色与工单关联。按内容当前可见性执行阻断及审计，并发布相关变更事件。公开工单状态按主文档处理。 |
| Worker → 模型适配层 | `GenerationProvider.generate({jobId,attemptId,kind,locale,context,outputSchema,timeoutMs}) → {output,providerRequestId?,usage?}`；`cancel({jobId,attemptId,providerRequestId?})` | `context` 只含该任务允许的人物、消息、回忆、媒体及已同意的用途。适配返回结构化文本、候选或已知失败。提供方支持时用稳定尝试 ID 去重或查回。原始报文及提示词排除在日常日志之外。 |
| Worker → 会话、回忆与动态写回 | `Generation.complete(tx,{jobId,attemptId,expectedVersion,output}) → {state,resultRef?,replyIds?}` | 在短事务内锁任务，并用当前版本及必要行锁复核尝试、状态、对象和授权。按类型提交回复、候选或动态派生资源，处理与撤权或取消并发时以事务提交顺序为准。重新验证生成内容、作者和输出限额。已取消、已提交或迟到的尝试返回原结果或丢弃。 |
| 通话 → Realtime | `VoiceProvider.available(accountId)`，`connect({accountId,person}, callbacks) → {audio,interrupt,close,terminate}` | 当前实现仅连 `wss://api.openai.com/v1/realtime`，无重定向／自动重试。最小用户确认人物资料、语气偏好；音色仅选标准 `marin/coral/cedar`，不读音频样本，不克隆，不读取旧聊天／珍藏／图片。真实提供方配置 ack 不替代 DB 授权复核。 |

### 后台任务

| `jobType` | 入队来源、有效负载与幂等 |
| --- | --- |
| `conversation.reply.v1` | 直聊 CHAT-06 同事务入队，实际载荷 `{jobId}`，按用户源消息唯一；人物、来源与授权版本从本库任务读取 |
| `gather.reply.v1` | 围坐 CHAT-06 同事务为固定名单的每个槽入队，载荷 `{jobId,personId}`。同一父任务、人物唯一；每次领取复核原名单、当前资格与捕获授权，最多三次实际尝试，不重跑成功槽 |
| `letter.reply.v1` | LETTER-01 按 `replyAt` 直接入队，实际载荷仅 `{jobId}`，原信、人物与授权版本从本库业务任务回读。每封信最多一份已提交回信；回信、人物回信序号与提交事件同事务。前端回读原信匣状态，不派发通用系统通知 |
| `memory.suggest.v1` | K04 的 MEM-01 直接入队，实际载荷 `{jobId,dispatchId,dispatchGeneration}`，人物、来源与版本从业务任务回读。同一有效来源版本复用结果，候选超过 24 小时失效；此队列是珍藏候选整理，不代表全量自动记忆管道 |
| `memory.echo.v1` | R01 消费 `MemoryConfirmed.v1` 或 `MemoryUpdated.v1` 后入队，`{jobId,memoryId,sourceVersion}`。一个原文一个回响，原文变更后旧任务不能覆盖较新版本。导入和演示来源默认不自动生成回响 |
| `search.project.v1` | 消费消息、回忆、人物和媒体变化，`{eventId,resourceType,resourceId,sourceVersion}`。按事件与消费者去重，投影可重建，检索返回前仍读取当前授权 |
| `feed.react.v1` | R01 消费适用的用户发布或评论事件，`{jobId,postId,sourceCommentId?,speakerPersonId}`。同源动作、角色、互动类型唯一。用户动态发布可选择至多两位获准角色，用户评论最多触发一位角色。仅用户动作的已知事件触发互动，AI 产物不会递归触发生成 |
| `media.transcribe.v1` | SPEECH-01 直接入队，`{jobId,conversationId,mediaId,authorizationVersion}`。转写以任务去重，取消后清临时结果和用途绑定 |
| 通话进程扫描（非 pg-boss 队列） | 每 2 秒回收本库已过期 created 或已失去 lease 的连接；重启后不自动重连。连接进程保有有界心跳和实际 provider close；旧 owner／attempt 的迟到 connected/finish 无法提交。恢复备份永久隔离全部活跃通话并删除一次性 grants |

队列领取时记录 `attemptId`、任务代次、租约截止、源对象及用途授权版本，读取素材后发起有限时的调用。临时网络错误按配置退避，超过尝试上限进入可查失败。政策拒绝、明确取消和权限撤回停止自动重试。模型供应商的请求成功与业务提交分别核验。正式内容只在当前尝试写回事务通过后可读。前台 SSE 只提示资源状态变化，正文走经授权的 GET。撤权或删原文后，缓存、历史查询和派生投影都受同一当前可见规则约束。

### 本域事件负载

| 事件 | 权威生产者与负载 | 消费方 |
| --- | --- | --- |
| `MessageAccepted.v1` | 会话域 `{conversationId,messageId,acceptedAt}` | 会话摘要、检索和用户可见事件。回复工作由 CHAT-06 的事务内入队触发一次 |
| `ReplyCommitted.v1` | 会话域 `{conversationId,messageId,replyToMessageId,jobId,committedAt}` | 会话摘要、检索和前台。重复消费不重复增加回复 |
| `MessageRemoved.v1` | 会话域 `{conversationId,messageId,removedAt}` | 清除检索投影和旧候选，刷新列表 |
| `GenerationChanged.v1` | 生成域 `{jobId,kind,targetId,state}` | 用户可见任务刷新。正文与失败细节走 GEN-01 或结果详情 |
| `GatherAccepted.v1` | 会话域 `{jobId,kind:'gather_reply',targetId,state,messageId,clientMessageId}`，targetId 为世界会话 ID | 与源消息、固定名单、槽和入队同事务记录受理；不触发自动记忆 |
| `GatherReplyCommitted.v1` | 会话域 `{conversationId,messageId,jobId,personId,sourceMessageId}` | 与该槽的实际回复和成功状态同事务；首页和围坐通过获准 GET 回读 |
| `GatherGenerationChanged.v1` | 会话域 `{jobId,kind:'gather_reply',targetId,state}` | 父状态变化记录；原界面回读 GEN，不新增通知或任务面板 |
| `GatherMessageRemoved.v1` | 会话域 `{conversationId,messageId}` | 记录逻辑删除；删除源消息同时终止尚未完成槽，已提交其他回复保留 |
| `LetterReplyCommitted.v1` | 书信域 `{letterId,personId,replyId,jobId,sequence}`，`sequence` 为十进制字符串 | 同事务记录实际回信及序号的提交事实；原信匣通过获准 GET 回读未读与正文。本片没有书信系统通知消费者或推送 |
| `MemoryConfirmed.v1` | 回忆域 `{memoryId,personId,confirmedAt,origin,qualifiesForReferral}` | 检索、回响和邀请域。邀请核对权威记录，资格由服务端活动规则按真实用户确认与来源判定，当前仅 `manual` 或合规的 `ai_candidate` 可进入资格核对 |
| `MemoryUpdated.v1`、`MemoryRemoved.v1` | 回忆域分别为 `{memoryId,personId,updatedAt}`、`{memoryId,personId,removedAt}` | 按事件信封中的资源版本刷新或撤除检索、回响与前台 |
| `PostChanged.v1` | 动态域 `{postId,change:'published'\|'removed'\|'restricted'\|'reaction'\|'comment_added'\|'comment_removed',commentId?}` | 前台读回动态。仅活跃且由用户提交的发布或评论可进入自动互动任务 |
| 通话 WS `state`（非持久 outbox 事件） | `{call:CallSessionDTO}`，失败／重连后 GET 重新读取 | `GET /v1/conversations/{id}/call-sessions?after=...` 按毫秒时间＋UUID 分页每页 100；原聊天合并可信已结束通话元数据，不制造聊天回复或模型历史 |

跨域消费 `AccountAccessRevoked.v1`、`PersonConfirmed.v1`、`PersonWorldChanged.v1`、`PersonAccessRevoked.v1`、`MediaUseRevoked.v1`，刷新访问与派生视图。人物撤权后阻断其直聊和新生成写回，并重算小聚参与资格，既有小聚记录按各条历史可见规则回读。礼物事件 `GiftDeliveryAccepted.v1`、`GiftDeliveryArrived.v1`、`GiftDeliveryFailed.v1`、`PersonaGiftReceived.v1` 按交易域约定的 `conversationId` 和礼物引用刷新原会话，投递失败也沿用原卡片。当前账号的用户可见事件采用主文档 `ClientEvent`。本域建议的 `resourceType` 为 `conversation,message,generation_job,letter,memory,post,call_session`，`kind` 为 `resource.changed`，用户回读目标的版本决定是否更新本机。

## 领域错误与验收

| 业务错误 | 含义和用户恢复 |
| --- | --- |
| `403 GATHER_PERMISSION_REQUIRED` | 新围坐发言缺少独立回应许可；输入保留，通过原隐私浮层授权。已受理意图仍沿原键查回，不重新选人。 |
| `409 GATHER_UNAVAILABLE` | 当前小聚参与资格或人数不足。可继续读允许的旧历史，条件满足后再发送。 |
| `409 MEDIA_NOT_READY` | 上传成品尚未就绪。保留草稿，查询素材状态或重新选择。 |
| `409 MEMORY_CANDIDATE_UNAVAILABLE` | 候选到期、撤回或已消费。重读候选或使用用户自己确认的手写稿。 |
| `409 GENERATION_NOT_RETRYABLE` | 目标任务已结束或不可重试。查回权威状态，修复授权或输入后再执行新的合法动作。 |
| `409 CALL_ALREADY_ACTIVE` | 已有可见的活跃会话。可按返回的 `callSessionId` 继续或结束。 |
| 任务失败码 `CONTEXT_REVOKED`、`MODEL_OUTPUT_BLOCKED`、`GENERATION_UNAVAILABLE` | 分别表示源权限变化、输出策略拦截、供应商暂不可用或预算耗尽。仅后者在相应条件满足时可重试。HTTP 状态查询本身仍可返回 `200`。 |

- **K03 会话恢复**。关闭 App 或让请求丢失后重放同一客户端消息 ID，只出现一条用户消息和一次有效 AI 回复。切换账号不读到原账号的消息、礼物引用或旧事件。
- **K04 原文与撤权**。保存后在另一设备通过人物、星图和世界回到同一 `memoryId`。回响任务失败仍可读取原文。删除或撤销用途后，历史链接、索引、迟到回复和新的签名读取按当前权限失效。
- **R01 历史一致性**。迁居保留直聊 ID、可读小聚历史和寄件引用。预约回信在进程关闭后只提交一次，新来信未被较旧已读请求覆盖。重复点赞或发评论请求不增加重复行。
- **X01 媒体恢复**。拒绝权限、转写为空、通话未接通、网络切换、过期令牌、迟到提供方回调及未知终止均可恢复或安全结束。设备时长和客户端回调不作为历史权威。

原型路径与正式接口的覆盖关系为 C01 CHAT-01–05 与 FIND-01，C02 CHAT-06–07 与 GEN-01–03，C03 CHAT-06 和按需 SPEECH-01–02，C04 CHAT-02–06，C05 LETTER-01–05，C06 CALL-01–05，C07 设备内草稿。D01 MEM-01–07，D02 FIND-01、MEM-04–05 及 CHAT-02，D03 FEED-01–02，D04 FEED-03–08，D05 端侧操作及世界目录复用。

### 已落地文字文件导入

Memories `008_memory_imports.sql` 增加 `origin:'import'`、永久批次和条目来源约束。`POST /v1/persons/:personId/memory-imports` 接收 `{batchId:UUID,sourceSha256:64hex,items:[{itemId:UUID,title:string,body:string}]}`；每批1–50条，标题最多120字符，正文最多10000字符，总文字最多100000字符。注册Origin、当前ExpectedSession、UUID Idempotency-Key以及 `If-Match` 人物版本必填。内存文件解析只准备预览，不发送/创建记忆。

批次在Memories本库事务中原子保存原文、确定顺序、条目来源、Outbox和永久命令；一条失败即全部回滚。返回 `{batchId,personId,itemCount,items:[{itemId,memoryId,version,status:'active'|'removed'}]}`。同批/key只返回当前权威条目，旧条目被移除后不复活。同键异参409，人物版本不匹配412；跨服务People/Identity在本库锁外前后核查，提交期间变化则不确认旧快照，按原批重试读已受理结果。

导入严格使用 `origin:'import'`，事件 `qualifiesForReferral:false`，不冒充手写或AI候选，不触发首次正式记忆邀请奖励，也不自动发AI动态。`ReferralQualification` 仍只认可manual/ai_candidate。导出增加 `importReceipts`；账号擦除删除批/item来源，native account gate阻断迟到写回，恢复检查点随域擦除收敛。

原资料卡「关于TA→记忆与素材」保留明确标注的预览示例，另有真实文件选择→原Sheet预览→明确确认。首版支持UTF-8 `.txt`（单段文字，文件名作标题）和显式JSON `{"schemaVersion":1,"memories":[{"title":"标题","body":"文字原文"}]}`，最大512KiB。不推断人物性格/未知事实，不把音视频示例当转录。浏览器写前冻结batch/item/key/person版本，未知结果、刷新和切号保留同一账号命令；存储失败先拒绝POST。通过受控Edge实际File、预览、丢回包、刷新恢复同批和原记忆接口读回验证，未把HTTPmock当作真实账号或真实模型验收。
