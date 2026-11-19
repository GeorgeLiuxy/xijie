# 西界境外真实上线方案 · 中国大陆个人开发者

2026 年 11 月 19 日。开发者本人居住在中国大陆，只有大陆个人银行账户，目前没有个体工商户或公司。建议先服务新加坡成年中文用户，提供中英界面，通过免费 Web 邀请测试验证产品，通过 Google Play 验证收款。新加坡是本方案选定的试点，可按实际能招募到的用户调整。以下是实施方案；开户结果、生产部署、模型权限、商店审核和结算均以本人账户的实际证据为准。

## 第一个可以交给用户的版本

用户用自己的 Google 账号登录，用称呼和一句回忆找 TA，沿用已有的关系确认，发消息并得到真实回复。重新打开后能找到同一个人、上次对话和一条主动保存的回忆。用户可以举报单条回复、删除内容、导出和注销。人物设定复用已有输入。界面说清 AI 虚拟演绎，允许使用昵称、虚构角色和日常回忆，个人版不要求上传人脸、健康资料或声音样本。

第一件付费商品建议选**一次性小额邮资包**，沿用西界现有账本和寄信场景。先验证买得到、只到账一次、能实际花掉、能退款和对账。首版不需要同时运营订阅、网页收银台或多个地区的价格。用户回来聊天不依赖持续付费买礼物。开放一个入口前，先为它完成下面对应的验收。

## 本人先办的四件事

1. **开 Google Play Console 个人开发者账号。** 用本人真实中国大陆资料注册，准备身份证、控制台接受的同名地址证明、经常查收的开发者邮箱、平台支持的非预付卡，以及一台未 root、Android 10 或以上的可验证实体机。注册费一次性 25 美元。中国支持开发者和商家注册，个人账号可以变现。开启商店变现后，Google 会公开个人开发者完整地址，注册前先确认能接受。新个人账号安排至少 12 位测试者连续加入封闭测试 14 天，再申请生产发布资格；正式审核和银行结算另计时间。[开户](https://support.google.com/googleplay/android-developer/answer/6112435) · [个人账号类型](https://support.google.com/googleplay/android-developer/answer/13634885?hl=en) · [中国商家支持](https://support.google.com/googleplay/android-developer/answer/9306917?hl=zh-Hans) · [公开资料](https://support.google.com/googleplay/android-developer/answer/13628312?hl=en) · [设备](https://support.google.com/googleplay/android-developer/answer/14316361) · [封测](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en)
2. **拿具体收款场景问开户行。** 建议原话：“我是中国大陆个人软件开发者，Google Play 将从美国向我的同名个人账户电汇美元，款项是境外用户购买应用内数字商品的平台结算。这个账户能否持续接收这类款，收款人英文拼写、SWIFT、中转行、用途申报、手续费以及合同或销售报表分别需要什么？” 保存银行答复。中国商家的 Google Play 打款说明明确写明美国汇出、美元电汇，电汇的最低可付余额为 100 美元。能付注册费的卡和能接经营性质款项的账户，要分别验证。[中国商家银行字段](https://support.google.com/googleplay/android-developer/answer/7161440?hl=en) · [打款条件](https://support.google.com/googleplay/android-developer/answer/2700656?hl=en)
3. **办个人实名云账号、域名和模型资格。** 基础设施可从腾讯云中国站选新加坡云资源，按本人真实资料签约和人民币账单办理，业务域名、DNS、HTTPS、私有对象存储和备份归本人控制。GPU 只在需要自托管时按量申请，先核对个人账号可见地域、库存、配额和预算。[腾讯云账号适用范围](https://intl.cloud.tencent.com/zh/document/product/378/80429) · [中国站境外资源及付款](https://cloud.tencent.com/document/product/213/17276) · [GPU 购买说明](https://cloud.tencent.com/document/product/560/30211)
4. **建立新加坡测试名单和支持联系方式。** 优先找实际愿意使用的成年测试者。请他们从当地网络用自己的手机、自己的账号加入，保存去标识化的问题记录。同步准备中英文隐私说明、AI 数据用途、举报处理、账号删除网页，以及对审查人员可用的专用测试入口。Google 要求生成式 AI 应用在应用内可举报，支持建号的应用也应有相应的账号删除路径。[Google AI 内容政策](https://support.google.com/googleplay/android-developer/answer/13985936?hl=en) · [账号删除要求](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en)

**收费前另向属地市场监管、税务及开户行核对一项关键事实。** 描述“大陆个人持续经营软件、通过境外商店向境外用户销售数字权益”，确认业务归类、是否应办理市场主体登记、个人收入申报及留存材料。中国《电子商务法》和《网络交易监督管理办法》对适用范围、登记和例外有具体条件。商店允许个人收款不能代替属地认定。若银行或属地要求经营主体且本人暂不注册，可继续免费验证核心体验，将收费阶段保留为待办。结算单、退款、平台费用、汇率和银行入账凭证从第一笔起分别保存。[电子商务法](https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/fgs/art/2023/art_14453aa523094819aa8f1d4530ce3cc4.html) · [网络交易监督管理办法](https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/fgs/art/2025/art_4b47c79b8d994a42bba4835997688faa.html)

## AI 供应商怎样定

现有正式预检、普通聊天和世界行动适配器都限定官方 OpenAI；审计、告知和语音协议也引用了该供应商。OpenAI 公布的 API 支持地区不含中国大陆。境外用户和新加坡主机不能单独证明开发者本人获准使用，本机曾成功请求也不能代替正式供应商资格。[现有生产配置](../deploy/production/README.md) · [文字路径](../backend/services/conversations/src/provider.ts) · [世界行动路径](../backend/services/conversations/src/world-action-provider.ts) · [OpenAI 地区政策](https://help.openai.com/en/articles/7947663-chatgpt-and-openai-api-supported-countries-and-territories)

**优先试托管。** 用本人的阿里云中国站个人实名账号开工单，写明终端用户、商用按量 API、成年用户自创人物、可含已获准的私人回忆，以及目标地域。询问是否允许该账号购买新加坡百炼文字、标准声音和实时语音，各自允许哪些输入、留存多久、工单如何处理删除，以及怎样设硬预算。中国站、国际站分别开户；中国站能实名和新加坡有产品文档，仍需确认这个账号能开这个地域及用途。先用虚构素材完成一轮模型请求，核对账单、地域、模型版本和限流，再接真实用户。可比较通用千问与 Qwen-Character 的中文表现，尤其检查角色模型是否能稳定满足西界世界行动的严格结构输出。[阿里云个人实名](https://help.aliyun.com/zh/account/verify-your-identity-individual-account) · [站点区别](https://help.aliyun.com/zh/account/aliyun-vs-alibaba-cloud) · [角色模型](https://help.aliyun.com/zh/model-studio/role-play)

百炼新加坡接入的静态数据存于所选地域，“国际”推理范围可在中国内地以外的全球节点调度。官方隐私说明分别描述“不用于训练”和“存储调用数据”。用户告知、数据流图和合同要写明实际情况；要求数据全程只在新加坡时，应采用可验证的单地域方案。[新加坡接入与推理范围](https://help.aliyun.com/zh/model-studio/singapore-regional-access-information) · [百炼隐私说明](https://help.aliyun.com/zh/model-studio/privacy-notice)

**托管资格或数据条件不满足时。** 在个人账号可合法购买的新加坡算力上，按量部署 Qwen3-8B 等具备商用许可的具体权重，使用私网推理服务。标准语音可另行实测 Qwen3-TTS 的预置音色模型。两项示例权重标注 Apache-2.0，分发时保留相应声明。先测中文角色一致性、英文、首字延迟、并发、结构化行动和整日 GPU 成本，再确定机型及是否常驻。自托管可解决供应商准入或地域问题，数据保护、内容处理和运维责任随之落在自己身上。[官方文本权重](https://huggingface.co/Qwen/Qwen3-8B) · [官方语音权重](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice)

## 实施和签收

| 阶段 | 工程工作 | 放行证据 |
| --- | --- | --- |
| 1 · 正式 Web 邀请版 | 独立生产环境部署七个现有服务、Logto、PostgreSQL、相应 worker 和私有存储。只公开第一方 HTTPS 和必要回调，隔离内部接口。接通 Google 网页 OAuth 并在首页给新加坡用户可用的入口；若实际 OAuth 开户受限，再补邮箱验证登录、找回与同身份重验。配置模型适配器、供应商白名单、用量审计、速率和金额上限，同时更新中英告知。发布的同意项与实际功能对应 | 测试者关闭电脑和 USB 依赖，从当地移动网络新注册；找 TA、发消息、收到真正的模型结果、离开后回来、导出、删除和注销均成功。真实模型账单或请求证据可与服务端计量匹配。超时保留消息且不伪造回复。恢复一份生产格式加密备份，核验已注销账号仍受删除规则约束 |
| 2 · Android 商店封测 | 用正式域名、包名、上传密钥及应用签名构建 AAB。配置 Google OAuth 回跳、App Links、商店测试轨道、目标国家和审核资料。正式包仅显示已开放功能。邀请名单就绪后开始 Play 封测 | 使用商店安装、蜂窝网络、从头注册到回访；测试断网、升级、举报和删号。保留封测参与及反馈记录，满足 12 人连续 14 天后申请生产资格 |
| 3 · 首笔数字商品 | 新接 Android Play Billing 购买入口；服务端复用现有只读验单和邮资账本。绑定账号、SKU、购买凭证；订单在完成和核验后只发一次；完成消费或确认、未决购买、通知重放、退款撤销和对账。正式店内数字商品走选定市场适用的商店方案 | 沙箱覆盖成功、取消、未决、断网补查、重复回调、退款。上线后记录真实订单、真实扣款、发货及实际使用。达到电汇门槛及结算周期后，用 Google 报表对上大陆本人银行入账；另以退款记录验证冲销 |
| 4 · 人格、记忆和生活 | 接入版本化人物画像，让已有故事自动产生可纠正的表达习惯。按用途开启真实长期记忆、书信、围坐、虚拟世界事件和有开关的离线生活；不同能力各验供应商权限与预算 | 同一个人跨日保持风格，用户纠正后生效；两账号不串记忆，角色之间不读到别人的私聊。打开离线生活能回忆真实提交的世界事件，关闭后停止。私人动态、礼物、相册或邀请若对外展示入口，分别验证跨账号可见性、撤回和实际业务结果 |
| 5 · 声音、iOS 及其余渠道 | 先接标准音色主动朗读，再接实时语音。试听、朗读、通话实听同一人物；验证支持语言、实际声线、打断、挂断、计费停止及撤回。iOS 补原生工程、Mac/Xcode 构建、TestFlight、StoreKit 和服务端购买/退款。推送需另配 Android/iOS 通道，真实设备验证送达、撤权和注销；视频或真人声线复刻另核具体实现、授权及提供方许可 | 跨设备真听、弱网与挂断后无残音/无继续计费。iOS 沙箱与正式单分别验证。真人原声、视频、公开分享等缺少权益或可用提供方时，记录具体阻塞，对外只展示已完成验收的用途 |

当前仓库具备生产编排模板、Logto 登录适配、Android AAB 构建、Google 单商品只读验单；正式付款、权益发放、退款和入账还需打通。网页现有 Hyperswitch/JeePay 接线需要相应真实商户。首期免费 Web 可以支持 iPhone 和 Android 浏览器。以后要给 Web 开收费，再按“大陆个人＋具体 AI 陪伴产品＋结算方式”单独验证收单方资格。Google Pay 钱包、Google Play 内购和大陆银行结算属于不同环节。[部署](../deploy/production/README.md) · [身份回调与无手机号重验](../deploy/logto-auth/README.md) · [正式 Android 构建](../mobile/build-release.ps1) · [Play 验单](../backend/services/gifts/src/google-play-verifier.ts) · [网页支付能力](../deploy/checkout-setup.md) · [Play 支付政策](https://support.google.com/googleplay/android-developer/answer/9858738?hl=en) · [账单集成](https://developer.android.com/google/play/billing/integrate)

## 首发边界和经营成本

- **发行范围。** 新加坡成人中英版是运营选择。商店选择发布地区，同时为 Web 邀请、服务端注册和实际服务范围设计控制；商店国家依据 Play 账户地区，和实时地理位置不同。若面向中国境内公众，2026 年 7 月 15 日已施行的拟人化互动管理办法需专门评估，尤其是虚拟亲属和未成年人。开发者在大陆运维、读取个人信息或跨境传输，还需按实际数据流评估相应义务。服务地点不能仅凭域名或服务器机房判断。[Google 分区](https://support.google.com/googleplay/android-developer/answer/7550024?hl=en) · [网信办办法原文](https://www.cac.gov.cn/2026-04/10/c_1777558395078289.htm) · [数据跨境规定](https://www.cac.gov.cn/2024-03/22/c_1712776611775634.htm)
- **隐私和陪伴体验。** 为新加坡用户提供可联系的资料保护负责人，列出数据接收方、服务器和推理地区、用途、保存、删除及跨境保护。用户提供他人照片、录音或经历时，需要相应权利；先支持最少资料与虚构人物，后续新增用途单独告知。始终清楚标出 AI，避免用“本人复活”或心理治疗宣传获客。举报要有处理人，准备自伤危机识别和当地求助转介流程，不用付费礼物或负罪感换取陪伴。商店年龄分类、受众准入和实际内容需一致。[新加坡 PDPC 义务概览](https://www.pdpc.gov.sg/-/media/Files/PDPC/PDF-Files/Resource-for-Organisation/Data-Protection-Obligations-under-the-PDPA.pdf?la=en) · [Google AI 内容规则](https://support.google.com/googleplay/android-developer/answer/13985936?hl=en)
- **iOS 个人上架。** 中国大陆个人可在 Apple Developer App 注册 Individual，标准年费 99 美元或当地等值，卖家名称显示法定姓名。收费还需签付费协议、完成平台要求的税表并填写本人银行资料。Apple 5.1.1(ix) 对要求敏感用户信息或提供高度监管服务的应用有法律实体提交要求。西界应以真实可用的“昵称＋一句回忆”流程送审，健康、人脸或声纹不作为使用条件；若实际产品依赖这些信息，应先向审核渠道核实主体资格。向第三方 AI 分享个人数据需明确告知并获得明确同意。TestFlight 内购是沙箱，不能据此认定正式收款已通。[大陆个人注册](https://developer.apple.com/cn/help/account/membership/enrolling-in-the-app) · [年费](https://developer.apple.com/programs/enroll/) · [审核条款](https://developer.apple.com/app-store/review/guidelines/#privacy) · [银行与协议](https://developer.apple.com/help/app-store-connect/manage-banking-information/enter-banking-information/) · [TestFlight 内购](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testing-subscriptions-and-in-app-purchases-in-testflight/)
- **算清一次服务的成本。** 封测记录每轮输入/输出 token、每分钟语音费、后台记忆与离线生活任务、数据库、存储、备份、带宽、退款与商店费用。分别测每位活跃用户每天的成本及一笔邮资包的实收净额。托管按本人账号地域的实价测算，自托管按 GPU 开机小时和并发占用测算。配置每日总预算、每账号上限及告警；语音与离线任务可独立停止。一人维护先把这几个数字跑出来再定价。商店费率按实际市场、产品与计划核算。[Google Play 费用](https://support.google.com/googleplay/android-developer/answer/112622?hl=en)

最终签收保留四类证据：境外新用户独立完成的真实体验、每项公开 AI 或媒体功能对应的实际请求与产物、商店交易和账本记录、本人银行入账和可核对的结算单。公开版本的服务故障处置、举报处理、备份恢复及用户删除也需有一次演练记录。
