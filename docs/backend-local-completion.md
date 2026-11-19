# 本地交付状态

## 首次体验与回访增量（2026-11-18）

本机服务预览 `http://127.0.0.1:5184/` 已更新。先创建了加密的数据库与对象存储备份 `20261118095836572-9aba24d5`，再应用 Identity 032–035、Memories 009 和 Conversations 016–017，逐域回读全部迁移哈希。此前的源码备份保存在 `D:/AI/xijie-backups/xijie-before-core-experience-20261118-172444`。

- 寻找入口按真实条件反馈；游客在设备上写下人物和回忆，再登录明确带入。真实浏览器验证了两次已受理后丢失响应，重开后持续使用原人物草稿与原回忆标识，后端各保存一份。 [测试结果](../.tmp/guest-journey-real-proof.json)
- 用户主动引用珍藏时，信件记录对应来源版本，源失效会阻止未完成的回信。普通书信继续按原有权限读取；首页来信定位到对应信件。自动记忆支持查看来源、更正和停用单条记录。
- 私聊增加明确紧急风险场景的支持提示；空间可举报指定评论。语音和视频入口支持分别登记与取消开通提醒。星火心愿笺、祈福河灯和居所礼物回执沿用现有赠礼链路，邀请船票可先预览并自填留言。
- 已保留按用途选择模型与记录实际用量的能力，以及服务端活跃路径指标。预设异步语音与 Google Play 验单分别经过受控测试，真实模型、语音和收费在本机关闭。
- 部署后的 Edge 实测覆盖两种通话提醒各自重开与取消、安全提示的原消息保留与零人物回复、信匣重开后打开精确原文、授权后的自动记忆空态，以及新礼物服务端目录回读。两件新礼物的实际寄送与效果由隔离测试覆盖，本机浏览器这次只验证目录。 [部署复验](../.tmp/preview-combined-real-proof.json) · [原文与目录复验](../.tmp/preview-focused-real-proof.json)
- Android 版号 2 的无签名 [APK](../mobile/artifacts/xijie-2-unsigned.apk) 和 [AAB](../mobile/artifacts/xijie-2-unsigned.aab) 已离线构建。两个包的清单、签名状态和 72 项前端资源已核验。真实 Android 14 模拟器使用调试壳从本机预览打开游客页并通过系统返回键退出；无签名成品使用预留 HTTPS 域名。 [构建核验](../.tmp/core-experience-v1/android-code2-release/code2-artifact-details.json)

正式渠道联调待 Google Play／App Store 的测试环境、Mac／Xcode、正式 HTTPS 与发行签名，以及语音供应商的获准项目可用后继续。商店交易与权益发放的完整链路，以及个性化声音和推送的真实验收仍待完成。

## 2026-11-17 历史本地交付

## 最新补充：登录模块

随后按用户“部署手机看看效果”要求，已在物理 Pixel 8／Android 16 保留数据覆盖安装最新 debug 包，安装实物 SHA 与 `33c179fa…` 精确一致。原生 WebView 实际点击检查了短信首屏、登录方式列表、密码显示切换、键盘滚动、找回入口与系统返回；未配置的 Apple／Google／微信均显示暂未开通，页面无横向溢出。手机留在空白、未勾选声明的密码登录页，电脑服务和 USB 转发保留。此次只检查提交前页面，没有发送短信、登录／注册或修改账号；不把它升级为真实渠道或真机完整密码闭环验收。[手机部署与界面证明](../.tmp/login-phone-preview-20261117/phone-ui-proof.json)。下文原“未安装手机”描述属于此前实现收尾时点。

用户已确认暂时没有正式短信和 Apple／Google／微信开发者应用，要求先完成本地接入。本次保留原短信首屏和一次声明，补充手机号密码登录、账号内设置／修改、短信找回、Google、Android 微信官方 SDK 及同主体第三方再认证。密码校验和写入复用真实自建 Logto 1.46.0，不在业务库实现另一套密码校验。配置和资质清单见[登录渠道配置](../deploy/logto-auth/README.md)，公共 DTO 和安全语义见[身份契约](backend-api/identity-people.md)。

前端最终 410／410 测试、TypeScript 和 3 条实际 ReactDOM StrictMode 路径通过。[冻结证据](../.tmp/login-module-20261117/frontend-freeze-evidence.json)。后端包含真实 HTTP、隔离 PostgreSQL、`openid-client` 签名／nonce／S256、账号切换、未知结果和恢复隔离反例；[后端证据](../.tmp/login-module-20261117/backend-auth-verification.json)与[微信 Cookie 专项](../.tmp/login-module-20261117/native-wechat-cookie-verification.json)分列验证范围。原生另有 51 条受控断言，不冒充真实渠道授权或物理手机登录验收。

全新合成账号 F 已在原完整 App／Edge 页面与真实本地 Logto 跑通：短信登录→设置密码→旧会话失效→密码登录原账号→错误密码被拒→短信找回→旧密码被拒／新密码仍进原账号。找回不自动登录，成功后保留手机号、原声明勾选和成功提示。注销仍需本人的实际短信再验证和再次明确确认。[真实原界面](../.tmp/login-module-20261117/real-logto-ui-proof.json)。F 已停止使用、禁止复用，测试密码和 Cookie 已清，模型与购买始终关闭。验证码使用本地 Mock SMS，不能计为真实短信送达。

固定自建 Logto 的 Management API 实际只有 `all`，本次另建限定本租户的两列只读视图及独立角色，用原主体实时读取绑定手机号；实测读原 users 表和写入均被数据库拒绝。上游镜像增加验证码／授权码审计脱敏，并在构建中执行真实编译函数断言；F 的实际测试密码和最后一次本人验证 OTP 均未出现在提供方审计与服务日志。[脱敏核查](../.tmp/login-module-20261117/audit-redaction-proof.json)。私有凭据仅在忽略目录，APK 只可包含公开 AppID。

以下章节保留此前业务、拍摄及真机历史证据；其中旧版迁移编号、386 项测试和包哈希仅代表当时版本，本次最终安装包以 `mobile/artifacts` 的当前报告为准。真实短信、Apple／Google／微信、正式签名／HTTPS／AppLink 及发行环境仍需外部配置后实测。

F 注销还验证并修复了滚动升级时旧后台进程处理新认证数据的缺口：新版 worker 会对已注销账号幂等清理新增认证遗留，与正常注销共用清理逻辑；原已完成回执不被改写，不清理后来复用同一浏览器的新活跃账号。实际重启新版 worker 自动补偿后，独立只读核查 F 的七域 122 张私有表、新密码／SDK 临时数据、凭据 fence、实际 Logto 身份、旧会话及六域擦除围栏均通过；没有手工删库冒充产品清理。[最终源核查](../.tmp/login-module-20261117/f-erasure-proof.json)。

最终补丁另有 Rights 27／27、密码 HTTP 15／15，通过的 114 项 Identity 全量保留为补丁前基线，不冒称重新全量执行。Identity 当前 031、全部 31 份迁移 SHA 与源库一致；密码／找回已开启，正式第三方开关均关闭。[滚动升级回归](../.tmp/login-module-20261117/rolling-erasure-verification.json) · [运行与迁移回读](../.tmp/login-module-20261117/final-runtime-proof.json) · [完整收口报告](../.tmp/login-module-20261117/final-verification.json)。新 debug APK 和 unsigned release APK／AAB 均已生成并核验，264 个构建输入一致；本轮登录没有在物理手机安装或验收，详细实物哈希见[当前包记录](../mobile/README.md#当前本机产物2026-11-17)。

本轮目标是完成已确认范围内、无需真实商户和发行条件即可完成的实现与本机验收。既有实现、源环境迁移、真实原页面验收、合成账号清理和八库原生恢复已收尾。本次另补充原生拍摄进程恢复，实现、受控测试、新包构建，以及独立 API34 AVD 的完整原页面／真实本地服务整合与最终账号清理均已完成；随后已在用户 Pixel 8／Android 16 上快速验证核心新增拍摄恢复路径并清理新合成账号，具体范围分列如下。真实收费及模型执行仍保持关闭；没有自动给普通账号发行试用资产，没有操作真实体验账号，也没有复用此前已注销的验收账号。

本文件是当前状态与证据入口。各 API 契约和交付优先级中按日期保留的历史结果只代表当时范围，不替代此处当前结果。

补充完成 Pixel 8／Android 16 的 USB 真机验收，以及用户明确要求的“一份声明、一次同意”交互。真机结果、修复及未验边界见下节；此前浏览器、隔离数据库和恢复证据保留各自范围。两个本轮全新合成账号现已从原界面注销并独立核对清理，没有复用已删除账号。

## 已完成的实现

| 范围 | 当前结果 |
| --- | --- |
| 身份、跨端与正式处理控制 | 昵称 CAS／永久重试；Web Apple／微信 OIDC 选路及 Android 一次性 native handoff；独立用途与正式模型政策、每账号每日次数和全局并发预算。真实第三方身份与设备仍待外部配置，旧授权不自动扩大。 |
| 人物资料、提醒与导入 | personality／life／unknowns／catchphrase 独立于原故事；纪念提醒持久设置、时区和站内记录；真实 TXT／JSON 预览确认、来源和批次回执，导入不计邀请首条正式记忆奖励。Atlas 失败与成功空结果明确区分。 |
| 原声保存 | 原 Seek／Gear 录制或选文件、真实 ffmpeg 解码、私有 S3、People 绑定、授权播放、替换／解绑／删除恢复及字节导出／擦除。样本不传给 AI、不仿声、不作为通话声线。服务模式状态已改为实际“原声已保存”。 |
| 浏览器转文字与 AI 语音通话 | 原按住控件接实际 SpeechRecognition 生命周期，最终转写来源持久化，未知发送不覆盖手写草稿；通话接后端代理 WebSocket、真实音频管道、独立授权、时长／预算／撤权、可信通话记录及首页摘要。物理麦克风、真实 Realtime 接通不由受控传输测试替代。 |
| 拍摄与进程恢复 | Android 原私聊拍摄接私有原生缓存，正常返回即发送；中断重建后由用户明确继续发给原 TA 或丢弃本机照片。固定照片字节与原媒体／消息标识跨进程保存，本机最多保留一小时，未知发送及清理失败可继续处理。受控验证、独立审查和双包构建已完成；独立 API34 AVD 的发送、丢弃、真实 202 回包丢失后的冷启动继续及带未发原图注销均通过。物理 Pixel 8 已快速通过正常发送、相机前台终止恢复、首次继续、受理丢回包后冷重试和最终账号清理；丢弃／带未发原图注销未在本次物理补验重测。 |
| 世界、增长与共同心愿 | 保留已确认的分支／离线规则、邀请及共创相册。小屋／航班接原创建页类型控件；真实投稿审核通过才推进，初始 1／4、目标 6／20、航班每份 +2、最多 8 席。发起人审核、采纳入记忆和每账号／目标一次基础券分别保存，不扣邮资或背包。 |
| 账本、购买与财务权利 | 持久报价／订单／付款／退款及冻结请求恢复；双网关验签唤醒后权威查证；全账号注销前财务预检、显式期限的最小留存、独立运营查证／退款审核。没有商户／正式商品与价格时不开真实收费，不凭回跳或手工断言发权益。 |
| 举报与处置 | 原消息／动态／投稿可举报，本人可读进度；独立运营凭据、取证审计及可靠处置，实际来源限制落实后才结案。当前取证提供文本与必要元数据，不提供私有图片二进制。 |
| 自建收银台与发布准备 | JeePay、Hyperswitch 固定源码与镜像实物、本地完整开发堆栈及停启验证；生产编排、只读预检、TLS 路由示例；Android 服务模式 unsigned APK／AAB 真实构建和实物检查。 |

原影像仍是明确标识的动态照片预览。实时 AI 视频、声线克隆、分支照片／赠礼等未选扩展、应用商店数字内容内购，以及独立 iOS／HarmonyOS 客户端没有混入本轮完成项。

## 当前源环境

- 七个服务已构建并应用当前所有迁移，源库逐文件 SHA-256 一致：Identity028、People011、Conversations015、Memories008、Social006、Media005、Gifts008，共 81 份迁移。[迁移回读](../.tmp/local-completion-final/migration-proof.json)
- 本机恢复 15 个启用的服务／任务进程和 7 个 API 监听。无授权账号范围的 automatic-memory、echo 两个模型任务保持停止；模型执行及实际购买开关关闭，不加载已注销账号的旧 scope 文件。[运行记录](../.tmp/local-completion-final/runtime-proof.json)
- 迁移前后 8 库中原有 210 张表的原字段、原行哈希一致。跨完整验收的最终对照确认原业务行保留；唯一统计例外为 Logto `daily_token_usage`，实际合成登录、重新验证及身份清理产生 OAuth 使用统计，没有回滚该统计。不能将此最终结果写成所有统计也毫无变化。[迁移后基线](../.tmp/local-completion-final/source-after-proof.json) · [最终业务对照](../.tmp/local-completion-final/source-final-proof.json)
- 所有运行配置、运营密钥、账号 state、下载、数据库与对象备份保存在受保护的本机忽略目录；没有将真实凭据写入产品界面、Git 或客户端构建。

## 实际原页面与真实存储验收

本轮两个账号均由原手机号页面使用已核实的本机 Logto mock SMS 新注册；不是现有真实账号，也没有向真实手机号发送短信。业务写入经过原界面，额外 HTTP 重放和专用运营动作在下文单列。

1. 主账号沿原寻找流程保存一位合成人物。原 Gear 保存一条 life，原 story 和人物名不变；TXT／JSON 各一次明确预览确认并按 `origin=import` 精确读回；提醒启停后恢复原关闭状态，日期未改，邀请概览未因导入增加。[实际源补充](../.tmp/local-completion-final/source-extra/proof.json)
2. 1.25 秒、无真人声的合成 PCM 文件经过真实上传、ffmpeg、S3 和 People 绑定，得到 mono24k PCM WAV、60044 字节；原页面播放取得的字节类型、数量和 SHA-256 与绑定一致。保留该对象用于本次原生恢复反例。[实际声音](../.tmp/local-completion-final/voice-journey-proof.json)
3. 小屋匿名投稿经发起人审核后 1/6→2/6；参与账号明确领取，真实账本仅一笔来源一致的基础券。航班先 4/20→6/20，再以独立匿名恢复验证投稿达到 8/20，均未花邮资、未自动采纳进记忆或调用模型。
4. 航班真实已受理的 HTTP 200 被浏览器故障注入截断，原界面显示未知处理。工具的 CDP 取消导航产生 InterceptionId 错误，失败记录保留；没有把它伪写成原 UI 刷新验收通过。随后用捕获的原 UUID／正文／CAS 进行明确 HTTP 协议重放，返回实际 200，进度仍 8/20、两份 approved、券与账本无新增；数据库只存在一条原审核命令。原 UI 刷新同键恢复另由受控浏览器和独立组件反例验证。[真实协议复核](../.tmp/local-completion-final/goal-source-protocol-proof.json) · [原命令唯一](../.tmp/local-completion-final/goal-source-command-proof.json) · [受控原界面](../.tmp/shared-goals-dev/proof.json)
5. 一条用户文字真实保存，任务实际被 `WORLD_ACTION_PERMISSION_REQUIRED` 阻止，零人物回复、零示例回退；这是更早的用途围栏，不单独证明模型关闭分支。原 Bubble 举报可在本人记录读取；专用运营 CLI 取证后限制原消息，真实源墓碑及版本推进后才 resolved。[实际处置](../.tmp/local-completion-final/report-source-proof.json)
6. 两账号均从原隐私页面下载七域导出。主账号声音文件的实际字节／SHA 与 People 绑定对应；权限未因导出改变。[主导出](../.tmp/local-completion-final/export-proof.json) · [参与账号导出](../.tmp/local-completion-participant/export-proof.json)
7. 原账号管理分别注销两账号。每账号 116 张私有表、物理队列、全部相应对象、实际 Logto 用户及会话已独立只读核对；只保留必要围栏／匿名回执等最小记录。账号均标记 erased，不再复用。[主清理](../.tmp/local-completion-final/lifecycle-erase-proof.json) · [参与账号清理](../.tmp/local-completion-participant/lifecycle-erase-proof.json)

工具定位、异步等待、配置重写和故障注入中遇到的失败均保留在私有证据目录。后续只读识别已受理阶段，不重复导入、发文字、创建心愿或发券；未把仅编译或主观观察当作端到端成功。

## Pixel 8 真机补充与一次同意交互

设备为 Pixel 8、Android 16／API36。只覆盖更新 `app.elysium.figma.dev`，使用实际 Android WebView、系统点击／滑动、键盘与原产品入口；额外 GET、源数据库与文件读取用于独立核对。模型和真实收费全局关闭，普通账号无自动资产发行。原本机 mock SMS 仅供本轮两个新合成账号登录，其他账号和另一个已安装应用未被操作。

| 真机范围 | 实际结果与证据 |
| --- | --- |
| 隐私与 AI 说明 | 按用户最新要求改为一份可滚动完整声明、底部一个“同意并继续”；细项管理默认不挂载。一个真实点击补齐 9 项缺失授权，各返回 201，18 项服务端有效状态全部为 true；当前隐私确认版本未重复递增。关闭重开显示“已同意”，新增授权 POST 为 0。[操作与回读](../.tmp/phone-acceptance-20261116/single-agreement-ui-proof.json) · [重开状态](../.tmp/phone-acceptance-20261116/consents-reopened-private.json) |
| 首次使用与续接 | 寻找 TA 的保存、预览及人物照片授权层复用同一份声明，保留草稿和原操作。真机在综合同意后再次填写虚构称呼／故事，直接进入寻找预览，无旧双勾选或新增授权；新草稿随账号最终清理。初次缺权限、503、取消、已有同意后的继续与账号切换由实际组件测试补充。[原寻找路径](../.tmp/phone-acceptance-20261116/seek-after-single-agreement-ui-proof.json) |
| 人物、文字与记忆 | 原寻找创建人物；life 保存未改变原故事／名字。消息缺权限时保留输入，明确同意后同次重试实际保存，模型关闭时没有伪造回复。手写 1 条、TXT／合法 JSON 各导入 1 条实际读回；错误 JSON 数组被拒绝且未加记忆。[恢复回读](../.tmp/phone-acceptance-20261116/resume-memories-private.json) |
| 记忆读取闪烁修复 | USB 通道断开时每 5 秒后台读取失败曾反复显示同一提示。修复保留重试和已有内容，同一连续故障仅提示一次；实际同类断网前 4 次提示、修复后 1 次，恢复后连续 200。成功刷新后新的故障仍可正常提示。[修复前](../.tmp/phone-acceptance-20261116/memory-offline-before.json) · [修复后](../.tmp/phone-acceptance-20261116/memory-offline-after.json) |
| 原声与相机 | 拒绝麦克风不造样本。补齐 Capacitor 所需 normal 权限 `MODIFY_AUDIO_SETTINGS` 后，真实采录 1.2 秒，ffmpeg／S3／人物绑定及原生播放器推进通过。仅为 `IMAGE_CAPTURE` 增加包可见性查询，原拍摄由错误照片选择器恢复为系统相机；取消不新增照片。未验证完整实拍取回和上传，未增加直接 CAMERA 或广泛包查询权限。[播放](../.tmp/phone-acceptance-20261116/real-mic-playback-probe.json) |
| 免费赠礼与书信 | 零余额纸鹤寄送并到达，无扣款；观看完整旅途后保存实际 WebP 留影。原书信选择只保存，正文精确回读，replyMode=none、回复与回复任务均 0。[寄送](../.tmp/phone-acceptance-20261116/free-crane-arrival-ui-proof.json) · [原信](../.tmp/phone-acceptance-20261116/letter-saved-private.json) |
| 分支与离线设置 | 创建并打开分支后返回主线；离线设置开启／GET／暂停均实际保存，最终暂停。没有将配置保存写成真实 AI 经历生成通过。[分支](../.tmp/phone-acceptance-20261116/story-branches-created-private.json) · [暂停](../.tmp/phone-acceptance-20261116/offline-paused-private.json) |
| 邀请、共创与奖励 | 第二账号从原邀请页 sign_in 新注册，首条手写正式记忆后双方各到账 1 券。小屋／航班投稿待审时不推进，发起人批准后分别 2/6、6/20；采用的航班贡献成为准确来源记忆。参与者每目标各领 1 券，加邀请共 3 券；重复按钮不增请求／账本。[配对邀请](../.tmp/phone-participant-20261116/referral-paired-ledger-source-proof.json) · [审核／采用／回礼](../.tmp/phone-participant-20261116/goals-adoption-paired-rewards-source-proof.json) |
| 举报与资产 | 自有合成消息实际提交举报并读回处理进度。零初始余额、购买关闭、订单为空；只出现已满足条件的推广奖励。[举报](../.tmp/phone-acceptance-20261116/report-created-private.json) · [订单](../.tmp/phone-acceptance-20261116/purchase-orders-ui-proof.json) |
| 原生数据导出 | 复现 WebView 声称浏览器下载但 Downloads／MediaStore 均无文件。新增固定第一方、expected-session、原短授权的原生流式保存桥；读回完整 JSON 与 bytes／SHA、复核当前会话后才发布并提示保存。两账号分别从原 UI 保存实际文件，ADB 取回与原生回执一致、MediaStore pending=0。[修复前反例](../.tmp/phone-acceptance-20261116/export-native-missing-before-fix.json) · [主导出](../.tmp/phone-acceptance-20261116/export-file-device-proof.json) · [参与导出](../.tmp/phone-participant-20261116/export-file-device-proof.json) |
| 导出附件与清理 | 主导出 145178 字节，七域归属一致；其中原声实际 base64 解码得到 57644 字节 PCM WAV，与人物声音的字节数及 SHA 完全一致。两个账号各 121 张私有表、S3／物理队列、Logto／会话、导出密文／授权及六域围栏独立核对通过；注销参与者同时撤回投稿与发起人的采用记忆。两张公开邀请已从原 UI 关闭，仅清理本轮手机上的 7 个已知测试文件。[声音附件](../.tmp/phone-acceptance-20261116/export-original-voice-proof.json) · [主清理](../.tmp/phone-acceptance-20261116/lifecycle-erase-proof.json) · [参与清理](../.tmp/phone-participant-20261116/lifecycle-erase-proof.json) · [采用撤回](../.tmp/phone-participant-20261116/owner-flight-adoption-revoked-source-proof.json) · [设备文件](../.tmp/phone-acceptance-20261116/device-file-cleanup-proof.json) |

本节保留此前批次的范围：当时未覆盖 API24–28 SAF、手机图片完整上传、浏览器转文字和真实 Realtime。后续补验见下节，不能把相机取消、录音或组件测试扩大为其他能力通过。AI 回信、回礼、看图、离线经历及其他模型产物仍受关闭的真实提供方执行条件限制。模型关闭、发布占位域及未签名构建不等于真实上线。

## 后续手机补验与故障恢复

本批使用第三个全新合成账号，只操作同一 Pixel 8 和 `app.elysium.figma.dev`；两个此前已注销账号没有复用。账号现已从原界面注销，手机回到登录页。模型与真实购买保持关闭。

| 范围 | 实际结果与边界 |
| --- | --- |
| 相册与完整实拍 | 原私聊入口经真实系统选图、系统相机拍照并确认，保存两条照片消息及两个 ready WebP。终止并冷启动应用后，原消息／media身份、版本和实际加载 blob SHA 均一致，字节数3518／48786；不是只看见缩略图。[回读证明](../.tmp/phone-ux-followup-20261116/photo-full-path-proof.json) |
| 文件添加与未知结果 | 原入口直接选本轮文字文件，预览目标人物和正文。服务器实际200受理后，在响应阶段截断连接；页面保留原内容并显示“重试添加”。原按钮重试后只有一条 origin=import 的准确记忆，没有重复添加。[故障注入原记录](../.tmp/phone-ux-followup-20261116/memory-interrupted-save-private.json) · [结果](../.tmp/phone-ux-followup-20261116/memory-retry-proof.json) |
| 照片停止本机重试 | 实际相机图片在 Media PUT 前被中断；页面刷新保留原 marker，缺原图恢复区可操作。停止仅清除对应本机记录，已有两条照片仍在，能够重新打开选图并取消，零新增照片消息。一次重新进入被动画遮挡的测试工具失败另行保留，随后从同一原操作继续验收。[手机恢复结果](../.tmp/phone-ux-followup-20261116/photo-recovery-device-proof.json) |
| 语音失败反馈 | 实际按住说话产生 start／audiostart，随后 error=network，无 result。新文案明确识别服务连接失败；零消息POST，切回键盘后手写草稿完整保留。转写本身仍未通过，不归因于麦克风未授权。[事件与结果](../.tmp/phone-ux-followup-20261116/voice-network-final-proof.json) |
| 一次同意与语言 | 手机重开综合说明显示“已同意”，管理授权默认收起，无额外授权POST。简体中文和English切换实际生效，未提供的三种语言禁用，恢复简体中文。[声明](../.tmp/phone-ux-followup-20261116/statement-reopen-proof.json) · [语言](../.tmp/phone-ux-followup-20261116/language-device-proof.json) |
| 新宿主升级与导出 | 新debug覆盖安装成功、保留原会话／数据。原页面准备并保存86677字节资料文件，ADB实际文件SHA与原生回执一致，已安装APK与新包hash一致。[文件核查](../.tmp/phone-ux-followup-20261116/updated-host-export-proof.json) |
| API26 SAF | 独立新AVD／Chrome69中，真实系统SAVE、取消、截断JSON和错误schema分支均有回执、文件回读和失败后删除证明。成功路径仅使用隔离端点的诊断cookie；不作为现行Lax策略完整业务导出通过。[范围与证据](../.tmp/phone-ux-followup-20261116/legacy-export/README.md) |
| 旧WebView兼容提示 | 原Lax/HttpOnly cookie在Chrome69的原生CookieManager中不可读。修复后仅对明确识别的旧标准Chromium提供程序给出更新WebView／Chrome提示，不再误报登录失效；0原生下载、0临时文件。74仅针对这一已知取cookie问题，不是整个App最低版本。[实测](../.tmp/phone-ux-followup-20261116/legacy-export/outdated-webview-fix/verification.json) |
| 合成账号与设备清理 | 七域只读核查：121张私有表、Logto／会话、照片对象、物理队列、导出密文／授权均清理。只删除本批8个精确测试文件，四张相机临时图逐一对应实际拍摄时间；旧相机文件保留，无递归清理，Downloads索引无残留。[账号](../.tmp/phone-ux-followup-20261116/lifecycle-erase-proof.json) · [设备](../.tmp/phone-ux-followup-20261116/device-file-cleanup-proof.json) |

上述手机批次另有一次相机往返期间旧进程收到 SIGKILL，新进程回到联系人页。此证据不证明应用崩溃或内存不足，也不代表 PUT 已经到达；当时 HTML capture 的文件回调只保存在进程内，确实暴露了跨进程原图交付缺口。本次已用下节原生拍摄恢复实现补齐该缺口；旧批次的正常拍摄或页面刷新恢复仍只代表各自已验范围。[原反例](../.tmp/phone-ux-followup-20261116/camera-process-interruption-boundary.json)

## 原生拍摄进程恢复补充

原私聊的“拍摄”在 Android 调试宿主中接入 `ChatCapturePlugin`，图库、浏览器和非 Android 保留原入口。拍摄前保存当前账号、会话、原人物与操作身份；原生在受控私有目录只生成一次固定 JPEG，不把文件路径或原图放进网页历史。正常返回仍立即发送；进程重建后只显示“继续发给原 TA／丢弃本机照片”，明确点击继续才返回原聊天处理。恢复区说明照片在本机最多保留一小时，并显示截止时间，不增加授权步骤。

继续前重新核验原账号、会话、人物和图片用途，沿用同一个拍摄、媒体与消息标识；上传进度、续传键、已生成媒体及消息提交状态先持久保存再执行后续请求。浏览器存储清空也不分配新媒体或换键重发。结果未知时保留原进度；确认发送成功、用户明确丢弃／停止、照片到期，或核实原身份／权限已失效时，按对应范围精确清理原图与本机日志。清理失败保留恢复入口；本机停止和丢弃不会撤回可能已发送的聊天照片。账号或会话切换阻断旧图片读取，暂时无法确认登录状态不当作用户退出。

| 验证范围 | 当前证据与限制 |
| --- | --- |
| 原生系统相机与私有缓存 | 独立 API34 AVD、受控第一方身份／授权响应下，32 项原生断言及 12 项 CAS 子断言通过。实际系统相机拍摄、取消、相机在前台时终止宿主进程后原操作恢复，以及身份、授权、并发清理和落盘失败边界均有受控结果；全过程没有业务上传或消息 POST。[断言结果](../.tmp/phone-ux-followup-20261116/chat-capture-native/final-device-cases.json) |
| 照片字节与保密边界 | 归一化照片重复读取逐字节一致，与独立 ADB 私有文件回读一致；普通 logcat 未出现照片 base64。这只证明受控设备上的固定字节与日志边界。[回读证明](../.tmp/phone-ux-followup-20261116/chat-capture-native/readback-proof.json) |
| 前端同次继续与失败恢复 | 原拍摄专项 75/75；兼容补丁和首次继续修复后，当前全部前端 386/386，根 TypeScript 无诊断。覆盖正常即发、明确继续、浏览器存储全失、上传／发送／续传丢回包、原生清理失败、过期原图、第二次继续与迟到结果隔离；新增真实 hook／Talk 重复挂载反例及实际 ReactDOM 复现。原生与前端独立源码复查均通过，无剩余已观察源码阻断；模拟结果不替代整合设备验收。[原拍摄冻结](../.tmp/chat-capture-recovery-20261116/frontend-freeze-evidence.json) · [最终首次继续检查](../.tmp/chat-capture-recovery-20261116/strict-replay-freeze-evidence.json) · [原生复查](../.tmp/chat-capture-recovery-20261116/native-review.json) · [前端复查](../.tmp/chat-capture-recovery-20261116/frontend-independent-review.json) |
| 新原页面正常拍摄与恢复后丢弃 | 独立 API34 AVD、新调试宿主、真实本地 Vite／后端；新合成账号从原 UI 注册并核对来源归属，按原流程同意声明、保存人物。正常系统拍摄保存一条照片消息后，原生待发记录和对应管理文件清空。另一次在相机前台真实终止宿主，新进程恢复同一 ready 操作，没有自动发送；原 UI 丢弃后消息仍为一条，待发记录和管理文件均清零。[新账号核查](../.tmp/phone-native-capture-20261116/registered-audit.json) · [恢复画面与身份](../.tmp/phone-native-capture-20261116/returned-discard-private.json) · [丢弃回读](../.tmp/phone-native-capture-20261116/discard-full-app-proof.json) |
| 原页面首次继续与受理丢回包恢复 | 原待发照片恢复至 ready 后，首次“继续”能在原聊天处理原照片。服务器实际以 202 受理，随后在响应阶段截断；原图和已尝试发送的完整进度保留。返回桌面并真实终止宿主后冷启动，旧新 PID 不同，原生进度逐字段相同；再次明确继续按同一个消息键和正文回放，媒体身份／版本、消息和生成任务不变。最终三条照片、三个媒体，重试新媒体分配为零，已确认发送后原生待发与管理文件清空，原页面实际加载 2788／2954／2858 字节照片。机器断言交叉检查原始请求、202 回执、原生进度和真实消息通过；相机前台终止宿主的操作绑定单独见下一行注销样本。[完整 App 结果](../.tmp/phone-native-capture-20261116/complete-app-capture-proof.json) · [交叉核验方法](../.tmp/phone-native-capture-20261116/verify-full-path.py) |
| 带未发照片注销与七域清理 | 另一次独立样本在相机前台真实终止宿主，新 PID 恢复同一 owner／操作／page 的 ready 原图；该样本与 202 发送故障分别绑定各自原始记录。未发送这张原图，直接从原 UI 申请注销，应用自动清空对应原生记录和管理文件，原会话返回 401。随后七域只读删除核验完成：121 张私有表、Logto 身份、三个照片对象及 staging／ready 前缀、物理队列、会话、私有导出／授权、SMS／native handoff 和六域围栏均通过；本批账号已标为 erased，不复用。界面“申请已受理”截图只证明申请，完成依据是后续源核查。[完整 App 清理绑定](../.tmp/phone-native-capture-20261116/complete-app-capture-proof.json) · [最终七域核查](../.tmp/phone-native-capture-20261116/lifecycle-erase-proof.json) · [原生清空](../.tmp/phone-native-capture-20261116/native-after-erasure-private.json) · [原会话 401](../.tmp/phone-native-capture-20261116/after-delete-session-private.json) |
| 最终设备状态与边界 | 原页面回到登录页，原生管理图片在测试工具清理前已经为空；工具只删除该独立 AVD 本批的一个精确 XML 和本机私有 OTP 文件，没有手工删除原图或递归清理。随后只移除该 AVD 自有的 5184／9225 调试映射并关闭它，当时最终 ADB 设备列表为空。该 AVD 批次未操作当时未连接的用户物理手机，AVD 结果不计为该手机通过；后续物理快速补验见下节。真实看图模型和支付保持关闭。[最终登录页](../.tmp/phone-native-capture-20261116/08-finished-signed-out.png) · [设备清理范围](../.tmp/phone-native-capture-20261116/device-cleanup-proof.json) · [AVD 收尾](../.tmp/phone-native-capture-20261116/device-teardown-proof.json) |

实际 API34／WebView113 整合首先暴露 `AbortSignal.any` 缺失：会话、同意记录和政策的独立 GET 都为 200，但页面在发起原声明请求前失败。兼容补丁只在原方法缺失时，于前端首入口安装组合取消方法，保留原生方法、现有超时与取消原因。补丁后运行时方法为 function，原声明真实加载并显示可点的“同意并继续”，一次点击综合同意后可按原流程预览并创建人物。六项专项反例和独立源码复查通过。本批早期同意回读只记录进行中的 10 项，不能将它当作 18 项全部齐备的终态；完整用途语义由此前真机 18 项终态回读和综合同意完成后才续接的流程分别支持。[修复前原记录](../.tmp/phone-native-capture-20261116/webview-113-before-private.json) · [修复后页面](../.tmp/phone-native-capture-20261116/01-statement-on-webview113.png) · [一次同意后的续接](../.tmp/phone-native-capture-20261116/02-after-one-agreement.png) · [早期进行中快照](../.tmp/phone-native-capture-20261116/agreed-consents-private.json) · [兼容检查](../.tmp/chat-capture-recovery-20261116/abort-signal-verification.json) · [独立复查](../.tmp/chat-capture-recovery-20261116/abort-signal-independent-review.json)。这不扩大为全部旧 WebView 能力通过。长时间验证后会话实际过期，后续从原 UI 重新登录同一当时尚未注销的合成账号，并重新核对来源后继续，没有复用已删除账号。[重新登录核查](../.tmp/phone-native-capture-20261116/relogin-source-proof.json)

首次点击恢复“继续”进入原聊天却未发送，也没有错误提示，实际只发生原生待发读取。原因是开发模式首次挂载时，Talk 在原会话尚未绑定前就消费了导航请求，随后 effect 清理重建使旧作用域的异步结果被正常隔离；同一原操作第二次明确继续能发送。最终仅为恢复效果增加“等待原会话身份已绑定”的条件和依赖，不改正常拍摄、权限或原操作标识。实际 ReactDOM StrictMode 反例修复前为两次挂载／一次清理、一次消费、零图片读取／消息，修复后仍只读取和保存一条原照片。隔离测试文档的 Vite HMR 传输错误原样单列保留，组件错误和真实业务网络漏出均为零，不能将其表述为整个测试页面毫无错误。[真实整合反例](../.tmp/phone-native-capture-20261116/continue-no-send-private.json) · [受控修复前](../.tmp/chat-capture-recovery-20261116/strict-replay-before.json) · [受控修复后](../.tmp/chat-capture-recovery-20261116/strict-replay-after.json) · [最终复查](../.tmp/chat-capture-recovery-20261116/strict-continuation-independent-review.json)

## Pixel 8 核心新增流程快速补验（2026-11-17）

用户重新连接物理 Pixel 8／Android 16 后，覆盖更新同一 `e3ae7b44…` 新调试包，实际安装的 `base.apk` 字节数／SHA 与本地 canonical 包一致，其他包未动。使用全新合成账号“手机拍摄快速验证”，未复用已注销账号。本次继续使用真实本地七域服务和原 UI，模型与购买保持关闭，没有改产品源或重建包。[实际安装包核对](../.tmp/phone-native-quick-20261117/installed-package-proof.json)

| 快速补验范围 | 物理手机实际结果 |
| --- | --- |
| 一次同意与正常拍摄 | 原页面一次综合同意后，完成态回读为 18 项用途均有效，随后创建人物。正常系统相机拍照立即保存一条照片消息，原界面实际加载 34776 字节图片，原生待发记录与管理文件清空。[完成态授权](../.tmp/phone-native-quick-20261117/completed-agreement-private.json) · [正常照片回读](../.tmp/phone-native-quick-20261117/photo-readback-normal-private.json) |
| 相机终止、首次继续和未知发送恢复 | 相机在前台时真实终止宿主，新 PID 恢复同一个 owner／操作／page 的 ready 原图。首次“继续”经真实 202 受理后在响应阶段截断，原图与进度保留；返回桌面再终止进程并冷启动，进度逐字段相同。再次明确继续沿用原操作、消息键、逐字节相同正文、媒体／版本和生成任务，恰好一次消息重放，零新媒体分配。最终两条照片、两个媒体，原界面实际加载 34776／36284 字节图片，确认发送后待发与管理文件为空。只读交叉检查匹配相机前台终止、新旧 PID、原始 202 回执、重放请求及消息。[本次完整路径](../.tmp/phone-native-quick-20261117/complete-app-capture-proof.json) · [核验方法](../.tmp/phone-native-quick-20261117/verify-full-path.py) |
| 注销、来源清理与手机状态 | 新账号从原 UI 注销，七域 121 张私有表、两个照片对象及 staging／ready 前缀、Logto 身份、会话、物理队列、私有导出／授权、SMS／native handoff 和六域围栏均核查通过。账号标为 erased，不复用。原会话 401、原页面回到正常登录页；原生待发及管理图片在手工收尾前已经为空，只删除本轮一个精确系统 UI XML 和本机私有 OTP 文件，无递归删除，手机与调试服务保持连接。[七域清理](../.tmp/phone-native-quick-20261117/lifecycle-erase-proof.json) · [手机收尾](../.tmp/phone-native-quick-20261117/device-cleanup-proof.json) · [最终登录页](../.tmp/phone-native-quick-20261117/08-finished-signed-out.png) |

本次物理手机快速补验只覆盖上表核心新增路径，没有重测“明确丢弃”和“带未发原图注销”，这两条仍保留前述独立 API34 AVD 的证据范围。真实看图 AI、其他模型、支付及正式 release 安装／升级没有因此记为通过。

## 用户理解与操作恢复复查

按用户本轮要求复查原页面文案与实际状态，保留现有视觉、情感文案和导航。修改以用户能判断“现在是什么状态、下一步做什么”为准，不新增模型、文件格式或支付支持。

| 范围 | 本轮修正 |
| --- | --- |
| 从文件添加记忆 | 主入口不再要求用户先理解 TXT／JSON，直接选文件，添加前展示实际内容和目标人物；格式说明放在可展开的“支持哪些文件？”中。区分文件为空、过大、内容过长、格式不支持或读取失败；Word／PDF 不伪装成已支持。未知保存沿用原请求重试。 |
| 隐私与 AI 说明 | 原阅读框内改为八段日常语言说明，完整详细条款默认收起，底部仍为一个“同意并继续”。仍核验完整政策并保存原 18 用途授权，不扩大既有数据使用范围；系统权限在使用时请求。 |
| 聊天、原声与世界 | 权限、上传、麦克风和 AI 回复停止等错误说明原因与下一步；原声保存、书信读取与发送失败分别说明。离线设置未确定时只继续原开启／暂停操作，防止相反按钮重放旧动作。 |
| 赠礼、共创与购买 | 领取后按钮变为“去挑礼物”；审核、刷新、继续原处理各自对应实际动作。余额、背包、用量和通知读取失败不再当作零余额或没有内容；订单不展示渠道内部代码。 |
| 人物、提醒、资料与语言 | 提醒读取中不显示成关闭；切换人物／服务后旧结果不能覆盖当前状态，未知保存重试原选择。资料刷新明确说明覆盖未保存编辑；“下载我的资料”说明实际包含的文字和附件。语言仅允许选择已有的简体中文／English，其余入口明确暂未提供。 |
| 举报与账号切换 | “刷新进度”与“查看更多记录”分开；确定的输入错误可修改，结果未确认时继续原请求。账号切换只重置举报状态，不重挂主界面，旧账号的迟到结果不能进入新账号。 |

本次拍摄恢复、兼容与首次继续补充后，冻结的 43 个前端测试文件共 **386/386** 通过，失败／取消／跳过均为 0；TypeScript 无诊断，最新 Web／Android 双包构建与包内资源一致。原用户理解反例继续覆盖同次重试、迟到结果、读取错误、领取后去向和可选语言，新增拍摄恢复反例见上节。自动化检查不单独证明真实 AI、支付或完整设备流程；对应手机操作证据和未验边界分别记录。[完整前端记录](../.tmp/phone-final-artifacts/frontend-validation.json)

隔离 Edge 实际渲染本轮原组件，在 411×914 视口检查中文记忆入口、实际文字文件预览、英文记忆入口及中英文声明共五个状态；主要按钮均可用且完整可见，高 46–48px，无横向溢出或页面错误。格式帮助和详细条款默认收起；预览显示实际内容及目标人物。新建无账号浏览器阻断真实后端，声明使用只读合成响应，未点击最终保存／同意，业务和测试响应写入均为零。这是组件显示验证，不是新一轮真实账号或手机端到端验收。[视觉检查结果](../.tmp/user-ux-review-20261116/visual-proof.json) · [文件确认画面](../.tmp/user-ux-review-20261116/02-memory-review.png) · [声明画面](../.tmp/user-ux-review-20261116/04-privacy.png)

## 八库原生备份与删除回放

备份 `20261115171804871-cc8400f6` 保存本轮真实合成内容及一个声音对象；随后才通过原入口清理账号，再创建与该备份绑定、由包外可信最新 head 认证的删除后检查点。恢复 run `d8e7c201974e438a`：

- 8 个数据库、233 张表原生 pg_dump／pg_restore 的数据、迁移、约束及跨域来源核对通过。
- 安全回放后、删除副本前，另行读取全部八个副本：两已删账号的私有行均为 0，Identity 已去标识、Logto 用户不存在；旧声音对象实际认证恢复后被最新检查点清除，1 个旧对象失效、0 个保留。
- 与删除后检查点逐域对照，源数据库及源 S3 完全未变；本次临时数据库／对象容器已清理。
- `completed=true`、`securityReplayApplied=true`、`sourceUnchanged=true`、`cleanupComplete=true`；始终 `releaseReady=false`，不自动开放任何恢复账号或任务，也不补造更正后的最新正文。

[本轮原生恢复与独立私有行检查](../.tmp/local-completion-final/native-recovery-proof.json) · [恢复工具与边界](../deploy/recovery/README.md)

## 构建与独立检查

- 七服务复用既有完整测试 **672/672**：Identity88、People57、Conversations231、Memories89、Social69、Media51、Gifts87；本次修改限前端与 Android，没有重复宣称执行未重跑的后端项。用户理解与拍摄恢复补充后，最终前端 43 文件 **386/386**，无失败／跳过／取消，根 TypeScript 无诊断。[当前完整前端记录](../.tmp/phone-final-artifacts/frontend-validation.json)
- 恢复测试 **152 项：151 通过、1 个默认原生项跳过**；本轮另执行上文实际八库原生恢复，不将默认跳过写成单元项通过。
- 根与七服务 TypeScript、干净 service-mode Web 构建、差异检查通过。Web 的 38 个文本产物与 33 项私有配置值匹配为 0；独立源文件扫描 789 个交付文本、42 个私有值也为 0，不输出原值。[客户端扫描](../.tmp/local-completion-final/build-secrets-proof.json)
- 原 Seek／Gear 录制使用真实 WebAudio 合成设备驱动原生 MediaRecorder，受控 Edge 10 路径；浏览器转文字、模型通话 HTTP／WS／数据库、授权撤回、未知重试另有独立实际组件和隔离库反例。合成设备／传输不代表物理麦克风或云服务已验。

## 两套自建收银台

| 范围 | 本机实证与当前状态 |
| --- | --- |
| [JeePay](../deploy/jeepay/README.md) | 固定源码；Maven 10 模块构建、3 Vue 前端、6 应用镜像；10 服务实际健康，3 页面、6 入口资源及 API 代理通过。0 商户／应用／付款／退款，随机运营密码已初始化。停止重启后同一 MySQL UUID、凭据及数据；最终停止，13 专属卷、私有配置和镜像保留，端口关闭。Maven 使用 `-DskipTests`，不宣称上游测试执行过。 |
| [Hyperswitch](../deploy/hyperswitch/README.md) | 固定 router／SDK／共享代码实际构建；6 服务、564 迁移及真实配置服务。无 connector 的合成商户只创建一个未确认链接，页面、本机 SDK／iframe 与实际 session／config／client API 均 200；仍 requires_payment_method，实收为空、0 paid／refund／confirm。移除模板 Scarf 后观测窗口 0 已知遥测／Cloud 支付 API，19 外部静态／钱包脚本阻断，不是钱包交易证明。停启后集群、10 个随机秘密、迁移与计数一致；最终停止，3 专属卷和镜像保留。当前开发 mock_locker，不宣称生产 vault／控制台／结算调度通过。 |

两网关使用独立项目、数据库、卷、网络及回环端口，不连接上述八个源库。准备、构建、启停、固定版本／镜像及目录／项目防误操作检查已交付；真实凭据不输出。开始真实渠道验证前按[支付配置](../deploy/checkout-setup.md)启动并填写商户、发行与商品配置，不能只根据开源 connector 存在判断钱包可用。

## Android 与仍需外部条件的范围

[unsigned APK](../mobile/artifacts/xijie-1-unsigned.apk)／[unsigned AAB](../mobile/artifacts/xijie-1-unsigned.aab) 包含最新原声、原生导出、一次同意与首次寻找续接、native handoff、共同心愿、用户文案与状态修正，以及本次原生拍摄恢复桥、前端继续、缺失组合取消兼容和首次继续生命周期修复。最终 Vite 4748 模块、Gradle 124 项任务构建及双包实物验证通过；72 个打包 public 文件逐个 SHA 与本次构建一致，254 个冻结输入（含全部 201 个前端源文件）构建期间未变。APK 11850530 字节／SHA-256 `692e357892130a674c42d2df38165a5cad388e6209f0214f6ee724a07ee6e720`；AAB 11684220 字节／`8e61301bf4bbf7bcf8ad8cc7455f40f4a68640bce48243bbd3a71f0e035cf83f`。当前 debug 基线为 4170250 字节／`e3ae7b44840bc04da802ea2ed59b0b1a236cecec2fba0dc3b3a7c30762feed2c`。release 仍使用 `.invalid` 源、没有发行签名；签名工具已确认 unsigned，不是签名验证成功。电脑在构建期间曾暂停，日志墙钟约十一小时包含该暂停，不作连续构建性能结论。此前 354 项测试与旧包记录单独保留为历史；378／384 阶段记录不作为当前包的哈希或最终恢复证明。[当前构建与测试证据](../mobile/artifacts/final-build-evidence.json) · [实物报告](../mobile/artifacts/release-verification.json) · [历史包记录](../.tmp/phone-final-artifacts/history-before-native-chat-capture/) · [移动端说明](../mobile/README.md)

原生拍摄恢复的实现、受控验证、新包，以及独立 API34 AVD 的完整原页面／真实本地服务恢复和注销闭环均已完成；用户物理 Pixel 8 的核心新增拍摄恢复及最终账号清理也已按上表快速通过。本次未重测的物理分支保留原证据范围，与下述必须具备真实外部条件的项目分别记录。

以下依赖真实外部条件，保留待验，不计为本轮真实上线通过：

- 微信／支付宝及 Stripe／PayPal 等商户和 connector、发行地区／客户端、正式商品与价格、发行主体的财务留存政策；Apple Pay 证书／域验证、Google Pay 参数／发布批准、HTTPS 回调及真实扣款／退款／设备。
- 真正 SMS、Apple／微信身份提供方连接、正式域名证书／AppLink、Android 发行签名和正式包真机升级。既有调试包覆盖更新、正常实拍／相册上传及冷重开已按上述范围验证；新拍摄恢复的正式包行为仍须在实际发行条件下复验。旧系统 SAF 已有 API26 受控分支证据，原始 Chrome69 与现行会话策略仍不兼容，其他系统／文档提供程序及生产包行为未外推通过。
- 真实 OpenAI Realtime：获准的唯一短探测在 5 秒限制内超时，无有效 session.updated／音频；不能宣称真实接通。正式模型开放仍需当前独立用途／生产授权、明确账号范围、私有凭据和预算。
- 生产环境的 vault／密钥保管、支付运维、发行与外部备份保管；本机开发堆栈和隔离恢复均不等于生产放行。
