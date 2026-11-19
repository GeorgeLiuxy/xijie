# 西界境外版 · 真实接入与凭据申请清单

核对日期为 2026 年 11 月 19 日。适用条件为中国大陆个人开发者、本人只有大陆收款账户、以新加坡成人用户为首发试点。目标顺序为境外 Web 文字体验、Google Play 数字商品收款、语音及其他渠道。下面的“可申请”来自平台规则，单个账户的开户、模型权限、商店审核与银行入账仍需本人验证。[完整上线方案](./overseas-launch-individual.md)

## 第一批 · 免费 Web 文字版

| 优先项 | 你本人申请或创建 | 项目里放在哪里，怎样才算接通 |
| --- | --- | --- |
| 1. 商用文字 AI | 用本人阿里云中国站个人实名账号核实百炼**新加坡业务空间**的商业调用资格。提供商需确认陪伴类应用、私人回忆处理、计费和留存。取得工作空间 ID、生产 API 地址、该地域 API Key、允许使用的文字模型 ID、限额与账单权限。 | 本机测试账号已有真实回复。当前普通私聊和世界行动两条入口校验官方 OpenAI 主机并记录 OpenAI 为供应商。工程要先增加经核准的百炼适配、更新用途告知、审计和用量，秘密只放服务端。拿虚构人物从两条路径各完成一次，核对实际模型、供应商请求与用量记录，再开放给受邀用户。 |
| 2. 域名与新加坡服务器 | 本人持有的域名、DNS 管理权限、支持联系邮箱；可用腾讯云中国站个人账号购买新加坡服务器。准备公网地址、域名解析、正式 HTTPS 证书及续签方式。 | 域名给 Web、登录回调、隐私与删除页使用。部署已有七个业务服务、Logto、PostgreSQL、对应 worker 和备份。服务令牌、数据库密码、导出和备份加密密钥由部署时生成。用境外手机关闭 Wi-Fi，独立登录、发消息、重开回读和注销。 |
| 3. 私有对象存储 | 可复用上述云账号，创建新加坡私有桶与限定桶权限的子账号凭据。腾讯云对应 Bucket 全名（含 APPID）、地域、Endpoint、SecretId、SecretKey。 | Media 已支持本机真实照片和录音存取；当前服务与备份程序都固定 path-style。腾讯云 2024 年起的新 COS 桶只支持虚拟主机式地址。工程须先适配两处，兼容本地原存储，实测私有写入、并发禁止覆盖、读取、删除、备份恢复和越权拒绝。 |
| 4. 新用户 Google 登录 | 在本人 Google Cloud 项目配置 Google Auth Platform、应用名称、支持邮箱、授权域、测试用户或外部发布状态，创建 **Web application** 类型的 OAuth Client ID 和 Client Secret。Google 后台登记 **Logto 的 Google 连接器显示的回调 URI**。 | Google 的 ID/Secret 放在 Logto。另在自建 Logto 创建“西界”应用，得到西界自己的 OIDC Client ID/Secret、Issuer 和应用回调，放 Identity。现有手机号密码在本机可用；境外首测先验证正式 Google 身份及同一 Google 身份的重新验证、导出和注销。没有手机号的用户也走通，才将其设为首发入口。 |

百炼 Key 的可用模型跟随所属地域与工作空间，同一业务空间已授权的文字、视觉和语音模型可复用一把推理 Key；运营上可按测试、正式环境分别发 Key。购买前先取得该账号的实际地域和用途确认，中国站与国际站各自开户。若托管不放行，备选是用本人可购买的新加坡算力自托管具备商用许可的 Qwen 权重，另验质量与成本。OpenAI 的支持地区不含中国大陆，本机成功记录不足以确认生产资格。[创建百炼 Key](https://help.aliyun.com/zh/model-studio/get-api-key) · [工作空间权限](https://help.aliyun.com/zh/model-studio/permission-management-overview/) · [新加坡推理与数据范围](https://help.aliyun.com/zh/model-studio/singapore-regional-access-information) · [OpenAI 地区说明](https://help.openai.com/en/articles/7947663-chatgpt-and-openai-api-supported-countries-and-territories)

基础设施与登录办理入口可分别参考官方文档。Google 登录需要的最小身份资料独立于 Google Play 查单和设备推送的授权。[腾讯云境外地域](https://cloud.tencent.com/document/product/213/17276) · [COS 的 S3 兼容设置](https://cloud.tencent.com/document/product/436/41284) · [Google 登录接入 Logto](https://docs.logto.io/integrations/google)

给百炼工单可以直接使用下面这段，并按实际首发地区调整。

> 我是中国大陆个人实名开发者，计划面向新加坡成年用户运营一款 AI 陪伴应用。用户可以根据自己的回忆创建虚拟角色，也可能以亲友或已故亲友为原型，产品会说明回复由 AI 生成。首版只发送生成文字对话所需的资料和消息，后续希望开放图片理解和标准合成音朗读。请确认我的中国站个人账户能否在新加坡工作空间按量付费，将模型 API 用于上述商业场景。若可以，请告知可用模型及端点、输入输出的保留期限与删除方式，以及如何设置限额。也请单列以真人为原型时的使用条件。

## 第二批 · Android 封测可以并行准备，收费在验收后开启

| 项目 | 要申请、配置或生成的东西 | 当前差距和完成凭据 |
| --- | --- | --- |
| Google Play 个人账号与发行 | 用本人真实资料注册 Play Console 个人开发者，准备平台接受的付费卡、身份/地址证明、可验证的 Android 真机。创建应用并确认包名，当前构建为 `app.elysium.xijie`；启用 Play App Signing，本人生成并保管上传 keystore。正式 App Links 使用商店安装包的**应用签名证书**指纹。 | 仓库能生成 AAB，正式签名和商店安装还要实测。新个人账号注册费 25 美元，封测至少 12 人连续加入 14 天后，申请生产发布资格。个人变现会公开完整地址。 |
| 商家和结算 | 在 Play Console 建立中国大陆付款资料，登记本人同名账户、开户行要求的英文收款信息、SWIFT 等。向银行确认可接收这类持续的软件收入，向属地核对收费经营与申报要求。 | Google 列中国为开发者和商家支持地区；美元电汇最低可付余额 100 美元。真实订单和实际银行入账分别留证。 |
| 首个一次性内购与验单 | 建一个一次性可消耗邮资商品，记录 Product ID、地区和价格。在 Google Cloud 启用 **Google Play Android Developer API**，创建专用服务账号，邀请到 Play Console，授予该应用所需的购买与订单权限。可复用登录的 Cloud 项目，服务账号与登录客户端分别授权。 | 当前只有单商品只读验单工具及受控测试。工程要接 Android BillingClient、服务端身份换短期令牌、凭证与西界账号绑定、幂等发邮资、消费确认、退款冲销与对账。购买凭证 purchaseToken 由每次交易产生。封测先用测试订单，之后核对正式订单与结算单。 |
| 订单状态通知 | 若采用实时开发者通知（RTDN），在同一 Cloud 项目建 Pub/Sub 主题和订阅并给 Google Play 发布权限。 | 第一张沙箱验单可先主动查单。正式运营前落实可靠的订单与退款同步；收到通知后再次向 Google 查询权威状态。 |

[个人开发者与变现](https://support.google.com/googleplay/android-developer/answer/13634885?hl=zh-Hans) · [中国商家支持](https://support.google.com/googleplay/android-developer/answer/9306917?hl=zh-Hans) · [公开资料](https://support.google.com/googleplay/android-developer/answer/13628312?hl=en) · [个人封测](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en) · [电汇条件](https://support.google.com/googleplay/android-developer/answer/2700656?hl=en) · [Play Developer API 开通](https://developers.google.com/android-publisher/getting_started) · [Billing 设置](https://developer.android.com/google/play/billing/getting-ready) · [订单通知](https://developer.android.com/google/play/billing/rtdn-reference)

## 按功能判断是否要再办一把 Key

| 功能与现状 | 真正缺什么 | 办理时机 |
| --- | --- | --- |
| 找 TA、草稿、人物资料、聊天和历史保存、本机密码登录 | 已有真实数据路径；本机专用账号已验证从找 TA 到收到真实回复。现有资料能提取明确线索。多维模型人格、跨情境语气与稳定声线仍要开发，复用文字模型及后续语音能力即可。 | 首版先部署已有链路；多维人格无需单独开户、测评问卷或 IPIP Key。 |
| 文字私聊、世界行动、书信、围坐、分支、离线生活、记忆候选、自动记忆、动态回响、礼物回礼 | 这 10 种模型用途已经有服务端入口；多项有历史本机真实模型记录。当前个人测试账号此前只为文字私聊/世界行动开通。生产需按用途配置工作进程、权限、模型、开关与预算，逐项用实际产物验证。 | 同一合格文字模型项目。先私聊，随后逐项开放；保存聊天或手动珍藏本身不消耗模型权限。 |
| 聊天图片理解、相册、原声保存 | 存储照片或录音复用私有桶和媒体授权。要让 TA 对本条图作出回复，另需工作空间开通支持图片输入的视觉模型，并验证材料处理范围。上传素材不会自动得到人格分析或声线复刻。 | 存储随基础设施；视觉模型在开放图片回复前。 |
| 故事口述、聊天语音输入 | 正式找 TA 的故事口述尚未开放；聊天里已有依赖浏览器 SpeechRecognition 的输入。在多个设备上稳定提供服务端转写时，要申请 ASR 模型权限并补充录音、转写和失败保留流程。 | 首发 Google 登录和文字输入均不依赖 ASR。 |
| 主动朗读、音色、实时语音和视频 | 朗读有受控适配、当前固定标准声；实时语音有后端协议，面向用户的通话入口仍登记提醒。申请标准 TTS 模型及目标语言 voice ID；实时通话另核实时语音模型、端点、配额、费用，补供应商适配、用户入口及真机打断和挂断。视频通话与仿真人声需要独立实现、权利和供应商许可。 | 后续先标准朗读，再实时语音。向同一供应商一次核资格，按获准的能力开通。 |
| 举报、导出、删号、站内收件箱、纪念提醒、邀请和共同相册 | 已有本地业务存储/工作进程。这些功能主要需正式数据库、私有桶、跨服务凭据、处置人员和部署开关。站内通知和“登记开通提醒”已有接口。 | 举报和数据权利随首发验收。操作系统后台推送需另接设备注册、FCM HTTP v1；iOS 阶段再用 APNs。 |
| 手机短信、邮箱、Apple/微信登录 | 短信取决于供应商是否接纳大陆个人给新加坡号码发验证短信，还需发送身份、模板和真实送达。邮箱自助登录需新增注册、找回及再认证；首发 Google 路径不依赖邮件投递 API。Apple 登录需 Services ID、Team ID、Key ID 和私钥；微信网页/移动应用分别审核资质。 | 先用已规划的 Google 登录。需要其他渠道时单独核准。 |
| iOS 上架、StoreKit、Web 收款 | iOS 缺原生工程与商店购买全链，需 Apple Individual、Mac/Xcode、App Store Connect、商品 ID、购买专用密钥与结算。Web 已有 Hyperswitch/JeePay 适配，另须底层收单方批准个人及具体产品、提供商户凭据，再验退款和实收。 | Android 收费优先。Apple 登录、内购、APNs 是不同用途的凭据；Web 支付和 Play 内购分别办理。 |

[本机验收范围](./backend-local-completion.md) · [模型用途登记](../backend/services/identity/src/model-execution.ts) · [语音和视频入口](../frontend/src/CallInterestSheet.tsx) · [供应商标准朗读](https://help.aliyun.com/zh/model-studio/non-realtime-tts-user-guide) · [FCM](https://firebase.google.com/docs/cloud-messaging/android/get-started) · [苹果购买专用密钥](https://developer.apple.com/documentation/appstoreserverapi/creating-api-keys-to-authorize-api-requests) · [网页收款现状](../deploy/checkout-setup.md)

## 拿到材料后放哪里

| 用途 | 已有配置或工程入口 |
| --- | --- |
| 部署和存储 | 各服务的 `DATABASE_URL`，跨服务的 `XIJIE_*_SERVICE_TOKEN`；Media 用 `MEDIA_S3_ENDPOINT`、`MEDIA_S3_REGION`、`MEDIA_S3_BUCKET`、`MEDIA_S3_ACCESS_KEY`、`MEDIA_S3_SECRET_KEY`。桶默认私有。寻址兼容涉及[媒体](../backend/services/media/src/storage.ts)和[恢复程序](../deploy/recovery/object-storage.mjs)。 |
| 登录和账号权利 | Google 凭据进 Logto 的 Google connector；西界的 `OIDC_ISSUER`、`OIDC_CLIENT_ID`、`OIDC_CLIENT_SECRET`、`OIDC_CALLBACK_URL`、`OIDC_GOOGLE_ENABLED` 进 Identity。部署侧为权限处理开启 `DATA_RIGHTS_ENABLED` 并配置导出加密密钥、Logto 删除所需的 M2M 身份及 worker。详见[登录配置](../deploy/logto-auth/README.md)与[生产编排](../deploy/production/README.md)。 |
| 模型 | 现有 `MODEL_API_KEY_FILE`、`MODEL_BASE_URL`、`MODEL_NAME_TEXT_REPLY`、`MODEL_NAME_WORLD_ACTION`、`MODEL_ALLOWED_ACCOUNT_IDS` 及 Identity 的 `MODEL_ALLOWED_PURPOSES`。还有正式批准、执行、并发与每日次数开关。当前为 OpenAI 适配，替换供应商后再配置，记录实际提供方。语音另有 `CONVERSATIONS_SPEECH_ENABLED`、`CONVERSATIONS_SPEECH_MODEL`、构建开关 `VITE_CONVERSATIONS_SPEECH_ENABLED`，实时语音有 `VOICE_CALLS_ENABLED`、`VOICE_MODEL`。这些是开关与模型名，供应商另行授予真实访问资格。[文字配置样例](../deploy/production/model.env.example) · [语音配置样例](../backend/services/conversations/.env.example) |
| Play | 当前工具读取 `GIFTS_GOOGLE_PLAY_VERIFICATION_ENABLED`、`GIFTS_GOOGLE_PLAY_PACKAGE`、`GIFTS_GOOGLE_PLAY_PRODUCT_ID`、`GIFTS_GOOGLE_PLAY_VERIFICATION_MODE`、`GIFTS_GOOGLE_PLAY_ACCESS_TOKEN_FILE`。最后一个字段存短期 OAuth access token 路径，生产接入需实现自动刷新。Android 上传密钥由开发者自建；商店应用签名由 Play App Signing 管理。[只读验单源码](../backend/services/gifts/src/google-play-verifier.ts) · [发行签名](https://developer.android.com/studio/publish/app-signing) |

申请进度只需记录**域名、地域、项目或工作空间 ID、可用的模型 ID、包名、SKU、审批状态和凭据保管位置**。Client Secret、模型 API Key、存储 SecretKey、服务账号私钥、keystore 密码和银行明细请保存在本人控制的私密配置中。公网接入、第三方真实登录、正式模型和真实收费分别验收。
