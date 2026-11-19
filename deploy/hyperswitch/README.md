# 自部署国际收银台：Hyperswitch

西界使用 Hyperswitch 开源版 v1 的 Payment Links：服务端创建固定身份的支付后，原购买流程打开自建网关的收银链接；网关自己的页面加载 Unified Checkout SDK，并按已配置处理商和设备条件显示银行卡、Apple Pay、Google Pay、PayPal等方式。西界不接收卡号、钱包支付令牌或处理商密钥。国内微信／支付宝可同时使用 [Jeepay](../jeepay/README.md)，两者共用西界订单和权益账本，但每笔付款操作固定其原提供方。

此处 Apple Pay／Google Pay 指钱包支付，与 App Store 内购／Google Play Billing 是不同产品；本次收银台适配不替代应用商店内购接入。

## 固定源码与当前证据

[source-lock.json](./source-lock.json) 分别锁定支付引擎、Web SDK、控制台和文档的精确commit；三个代码仓库许可证均为Apache-2.0。没有使用商业闭源连接器，也不要求先注册Hyperswitch Cloud。当前固定支付引擎包含实际 Stripe／PayPal connector、Payment Links HTML／JavaScript、付款／退款查询和发送给商户的HMAC签名通知。

本轮已实际构建固定支付引擎与 Web SDK，启动独立 PostgreSQL、Redis、Superposition 配置服务、router、SDK 和仅回环开放的反向代理共 6 个常驻服务。564 个 v1 迁移、配置初始化、实际合成未确认收银链接、本机 SDK／iframe 和其真实 API 读取链路通过，并验证停止重启后保留原数据库、凭据与数据。实际镜像身份及最小结果见 [runtime-proof.json](./runtime-proof.json)。没有配置真实商户或 connector，没有付款／退款或钱包设备成功证据；合成链接始终为 `requires_payment_method`，实收为空，confirm 请求为 0。不能把本地运行和静态链路通过当作实际钱包交易通过。

## 自建组件与获取

本机隔离执行工具为 [local.py](./local.py)、[Backend.Dockerfile](./Backend.Dockerfile)、[Sdk.Dockerfile](./Sdk.Dockerfile) 和 [Migration.Dockerfile](./Migration.Dockerfile)。它们使用 Linux amd64 Docker 引擎，后端固定 Rust 1.94.1、`--locked` 和 `v1,oltp,olap,redis-rs,accounts_cache,stripe`，按本地验证需求编译 router；未启用生产发布、遥测、演示 connector、key-manager 或额外分析基础设施。Web SDK 运行真实 ReScript／Webpack 构建，保留 SDK 的固定 `shared-code` gitlink `8302158df08f849201f2752ae282b3309f8ba49a`。不用上游 postinstall/start，因为其脚本会把子模块移动到 mutable main；也不运行上游会发送 Scarf 运行信息的 poststart hook。SDK 部署构建删除上游 HTML 的 Scarf 像素，关闭 SDK 日志，并为自选本机端口补入明确的 CSP 源；原始固定源码保留。

工具从官方固定 commit 归档获取源码并保存哈希和逐文件完整性清单，不运行远程安装脚本。迁移工具为官方 Diesel CLI 2.3.5 Linux amd64 二进制，先验证官方 SHA-256 `264d6f71426d9cf25ce389d1669ef9a18df0bc8f1807736be76a757843ee1645`，再在独立镜像中运行原始 v1 migrations。基础镜像按工具内真实 digest 固定；构建完成后将三份自建镜像锁到实际本地 image ID，保存 manifest descriptor，启动不依赖 mutable tag 或远端拉取。

从西界工程根目录执行，`<10位随机hex>` 必须是新生成的目录名，不能复用另一个部署或已有业务目录：

```powershell
$taskHome = '.tmp/hyperswitch-local-' + [Guid]::NewGuid().ToString('N').Substring(0,10)
python deploy/hyperswitch/local.py prepare --home $taskHome --api-port 28180 --sdk-port 28150
python deploy/hyperswitch/local.py build --home $taskHome
python deploy/hyperswitch/local.py start --home $taskHome
python deploy/hyperswitch/local.py verify --home $taskHome
python deploy/hyperswitch/local.py status --home $taskHome
# 停止并移除本项目容器/网络，保留 PostgreSQL 与 Redis 卷和私有配置：
python deploy/hyperswitch/local.py stop --home $taskHome
# 使用原凭据、原数据与同一镜像身份恢复：
python deploy/hyperswitch/local.py start --home $taskHome
```

`prepare` 拒绝覆盖非空目录，Windows 目录继承权限关闭，10 个独立随机秘密只写入该私有目录，命令不输出它们。准备时检查本机路由和已有 Docker 网段，选择不重叠的专属 IPAM；不会更改 Docker 全局地址池或删除已有网络。PG、Redis、配置服务、router 与 SDK 保留在 `internal` 网络，只有独立反向代理同时接入本项目 edge 网络，并仅向 `127.0.0.1` 发布 API／SDK 两个端口。数据库与缓存没有宿主发布端口。必须保留至少 25 GiB 余量并监控 Docker 实际数据盘；脚本没有 prune 或删除卷操作。拓扑哈希、源文件清单及本地镜像 ID 改变会明确拒绝相关操作，项目名必须与原私有目录的随机后缀完全对应，复制目录不能误停原项目。

`verify` 只读取健康、SDK loader、生成页面及应用脚本，核对其实际本机源与 CSP，保存受保护 `verification.json`。另外的 [probe-link.py](./probe-link.py) 只在该独立网关创建明确的合成商户、确认没有任何 connector，创建一笔 `confirm:false` 的未确认链接；[probe-browser.mjs](./probe-browser.mjs) 使用独立 headless Edge 资料目录验证实际链接加载本机 SDK／iframe，阻止外部请求和所有 confirm 请求。这些探针不会给西界创建订单、入账或资产，也不代表商户付款／钱包成功；原始探针凭据与详细结果只留在私有目录。

实际运行修正了配置文件无法覆盖的四个启动边界：构建需要 `libprotobuf-dev` 的标准 proto 头；固定 seed 将两个维度都标为 position 21，部署副本只把 `merchant_connector_id` 改为 22 并保存原／新哈希；当前 provider 要求实验 API，不能单靠文件 fallback，因此按固定上游版本运行真实 Superposition 0.113.0 并初始化 23 个维度、1704 个默认项和 912 个上下文；新数据库还需在 HTTP 启动前明确写入 `payment_callback` 的 `enforced` 策略并清理这个键的旧未找到缓存。初始化使用数据库完成标记／seed 哈希，重启不重新覆盖已初始化配置。调试构建的实际支付读取会超过默认线程栈，因此本机将 `RUST_MIN_STACK` 设为 64 MiB，并把 router worker 数限制为 2。上述修改都在部署配置／构建工具中，不改西界业务服务或固定上游业务源码。

本次浏览器在禁缓存的短观察窗口中，实际读取 Payment Link、SDK 配置、session tokens 与 payment client 接口均为 200，自建 HyperLoader／应用／iframe 均加载成功。该窗口内 Cloud 支付 API、Scarf／Sentry 遥测及 confirm 请求均为 0；19 个外部字体、默认图标和钱包脚本请求被阻断，未计作钱包加载或交易成功。这是该无 connector 场景的证据，不扩写为全部路径永不外联。最终两个独立网关均停止，保留配置、数据库卷和镜像；可按上述 start 使用原数据恢复。正式 HTTPS、允许的渠道网络、实际商户／钱包设备和真实支付退款仍需独立配置验收。

本地实例沿用开发配置的 `mock_locker=true`，未接收真实卡号，也没有运行生产 vault、控制台或结算调度角色。这个构建用于上述 API／SDK 的本地验收，不能只添加真实处理商密钥就改称生产收款；实际使用前还应根据选定连接器的 tokenization／vault 模式、网关调度和发行环境准备相应运行配置，再完成真实商户验收。

需要支付API、独立PostgreSQL／Redis、Web SDK，另按需要运行控制台与处理后台任务的组件。当前源码的Payment Links页面路由要求同时编译 `v1` 和 `olap` 功能；仅OLTP精简二进制不能提供本次收银页面。上游当前Docker栈还包含配置服务及迁移辅助容器。全部组件使用单独项目、数据库、卷和网络，不连接西界已有私有业务库。公开只提供必要的HTTPS网关／SDK路由；数据库、Redis、管理API、控制台保留运维访问边界。

可在全新的私有目录获取固定源码，以下仅执行Git，不执行下载的安装脚本：

```powershell
$taskRoot = (Get-Location).Path
$taskHome = Join-Path $taskRoot '.tmp/hyperswitch-deploy'
if (Test-Path -LiteralPath $taskHome) { throw 'Choose a new deployment directory' }
New-Item -ItemType Directory -Path $taskHome | Out-Null
icacls $taskHome /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" 'SYSTEM:(OI)(CI)F' | Out-Null
$taskLock = Get-Content -LiteralPath 'deploy/hyperswitch/source-lock.json' -Raw | ConvertFrom-Json
foreach ($taskKey in @('backend','webSdk','controlCenter')) {
  $taskSpec = $taskLock.$taskKey
  $taskDir = Join-Path $taskHome $taskKey
  git init $taskDir
  if ($LASTEXITCODE -ne 0) { throw 'git init failed' }
  git -C $taskDir fetch --depth=1 $taskSpec.repository $taskSpec.commit
  if ($LASTEXITCODE -ne 0) { throw 'git fetch failed' }
  git -C $taskDir checkout --detach FETCH_HEAD
  if ($LASTEXITCODE -ne 0) { throw 'git checkout failed' }
  if ((git -C $taskDir rev-parse HEAD).Trim() -ne $taskSpec.commit) { throw 'Source pin mismatch' }
}
```

固定上游的 [docs/try_local_system.md](https://github.com/juspay/hyperswitch/blob/8e75ce7cce0b462b37d76601ac264a7f603674cc/docs/try_local_system.md) 提供源码构建、迁移和账号API路径；[Web SDK README](https://github.com/juspay/hyperswitch-web/blob/f6f83b9c565753dbef70d7f97e03125150e9a1d3/README.md) 说明SDK构建与后端配置。按自建基础设施替换默认数据库、Redis、管理员密钥、加密／JWT材料及浏览器访问域名后再执行构建和迁移。上游 `docker-compose.yml` 的默认端口、示例密码、mutable镜像和远程迁移安装命令用于开发示例，本目录没有将它直接标为生产部署包，也没有执行其 `scripts/setup.sh`。现有自建Hyperswitch可直接进入下方配置，无需重新部署。

必须显式配置两个方向，才能确保收银台走自己的服务：

```toml
# 支付引擎配置（如 config/development.toml；线上使用自己的配置文件）
[payment_link]
sdk_url = "https://sdk.example.com/HyperLoader.js"
```

Web SDK的 `ENV_BACKEND_URL` 设为自己的公开支付API源，`SDK_ENV`、日志源和构建环境也对应自建实例；默认Cloud地址不能沿用。官方开发Compose的SDK使用 `SDK_ENV=local`、`ENV_BACKEND_URL=http://localhost:8080`，仅适用于本机浏览器。网关Payment Links页面的真实代码从 `state.conf.payment_link.sdk_url` 取脚本，然后调用 `window.Hyper` 创建支付组件。支付引擎默认SDK地址是外部beta服务，漏填该项会使“自建”链路不完整。

## 处理商与钱包配置

先在自建控制台创建自己的普通商户、商户API key及business profile。使用当前v1 API时，常规付款接口的header是 `api-key: <merchant key>`；管理员账号创建等接口按其鉴权要求使用 `Authorization: admin-api-key=<admin key>`。管理员密钥不填写到西界。

| 能力 | Hyperswitch中配置 | 还需准备 |
| --- | --- | --- |
| 银行卡、Apple Pay、Google Pay | 可选Stripe connector，按实际启用的方法配置路由。固定源码显式实现ApplePay、GooglePay及退款支持 | Stripe商户密钥与独立Webhook signing secret、所需收款能力；某些原始卡数据或钱包解密模式需处理商额外开通，不能只根据密钥存在启用 |
| PayPal | 直接PayPal connector；原生OAuth换取token、查单、退款及Webhook验证均在公开源码 | PayPal业务应用Client ID、Client Secret及Webhook配置；普通集成的认证字段为BodyKey：key1=Client ID，api_key=Client Secret，控制台按字段说明填写 |
| Apple Pay Web | 在相应处理商上启用wallet，配置所选PSP解密／自建解密模式及钱包元数据 | 自己的HTTPS收银域、Apple Merchant ID、所选模式对应的身份／处理证书、域验证文件及处理商开通；Cloud服务的共享证书和合规材料不能自动当作自建实例的凭据 |
| Google Pay Web | 在处理商及Hyperswitch启用Google Pay，按支付网关tokenization配置参数 | Google Pay商户／网关参数、测试与正式环境、正式发布批准及适用域名／设备。SDK按实际可用性呈现按钮 |

Stripe在该版本使用 `HeaderKey.api_key` 认证。各处理商的具体支持国家、币种、钱包模式和商户能力需以自己的商户后台及实际联调为准。也可配置公开实现了相关钱包的其他connector（如Adyen），不因更换处理商改写西界账本。

将付款与退款处理商回调先指向Hyperswitch自身的connector webhook；再将该business profile的 `webhook_details` 指向西界。为profile显式启用响应哈希并配置独立 `payment_response_hash_key`。它就是西界的 `HYPERSWITCH_WEBHOOK_SECRET`，与Stripe／PayPal的回调密钥不同。

API参考中 `ProfileCreate`／返回对象包含 `enable_payment_response_hash`、`payment_response_hash_key`、`webhook_details` 和 `payment_link_config`。profile的 `payment_link_config.domain_name` 控制收银链接的域名；必须完成自己的DNS/TLS路由，不能把Cloud文档里的客服开域步骤当作本地配置。Apple Pay的域验证发生在实际收银页域名，不能只验证西界首页域名。

## 西界配置映射

将 [checkout.env.example](./checkout.env.example) 复制到私有配置后填写；完整商品文件和服务配置以 [Gifts模板](../../backend/services/gifts/.env.example) 为准。

| 西界字段 | 来源／作用 |
| --- | --- |
| `HYPERSWITCH_API_ORIGIN` | 自建网关API源，服务端请求只发往此固定源 |
| `HYPERSWITCH_CASHIER_ORIGINS` | 配置允许打开的HTTPS收银源；匹配网关实际生成的链接 |
| `HYPERSWITCH_API_KEY` | 普通商户API key，不是管理员或处理商密钥 |
| `HYPERSWITCH_MERCHANT_ID`、`HYPERSWITCH_PROFILE_ID` | 本次商户／业务profile，核验返回对象的精确归属 |
| `HYPERSWITCH_WEBHOOK_SECRET` | 相同profile的 `payment_response_hash_key` |
| `HYPERSWITCH_ENVIRONMENT` | 本地部署配置标签sandbox或live；仍需独立核对网关connector及其凭据环境，付款响应没有livemode字段 |
| `GIFTS_COMMERCE_PROVIDERS` | `hyperswitch`，或与 `jeepay` 逗号组合；每个商品channel固定提供方 |
| `GIFTS_COMMERCE_PRODUCTS_FILE` | 正式商品JSON的绝对路径，明确币种、整数最小货币单位价格和邮资数量，不采用演示定价 |

通知可统一配置为 `https://<西界公开源>/v1/callbacks/payments/hyperswitch`。接收器按签名内容判断付款／退款类型；`/v1/callbacks/refunds/hyperswitch` 也可接收退款通知。公网可达不等于验签成功，应先在独立商户测试环境观察匹配原操作的持久回执。

## 当前HTTP契约与恢复

| 动作 | 网关API |
| --- | --- |
| 创建收银链接 | `POST /payments`，JSON包含稳定payment_id、amount、currency、profile_id、payment_link:true、confirm:false、capture_method:'automatic'、return_url；返回直接对象中的 `payment_link:{link,payment_link_id,secure_link?}`。顶层跳转必须选 `link`；`secure_link` 是要求iframe及允许域校验的嵌入入口，不能作为普通跳转地址。西界不从应用服务器传卡号或确认钱包令牌 |
| 查付款／恢复链接 | `GET /payments/{payment_id}?force_sync=true`；已存在的PaymentResponse也可包含payment_link。未知响应保持原payment_id查回，不创建另一笔交易 |
| 确认付款 | 托管页面SDK调用网关 `/payments/{payment_id}/confirm` 并处理钱包／认证；西界不因页面回跳或按钮点击标为成功 |
| 发起整单退款 | `POST /refunds`，`{payment_id,refund_id,amount,reason:'requested_by_customer',refund_type:'instant'}`；refund_id稳定，未知结果查原ID |
| 查退款 | `GET /refunds/{refund_id}`；核对payment_id、金额、币种、profile与已验付款关系 |
| 接收通知 | HTTP POST原始JSON，`X-Webhook-Signature-512` 为 `HMAC-SHA512(rawBody,payment_response_hash_key)` 的小写hex。必须用原始字节验签，重新JSON序列化会改变签名 |

当前API规范的payment_id和refund_id均为30字符。西界使用固定前缀加UUID16字节的base64url编码，付款 `pay_xij_`+22字符、退款 `ref_xij_`+22字符；可逆且不会把36字符UUID直接超长传给网关。商户API密钥在请求header，不写入URL或浏览器构建。

PaymentResponse没有 `livemode`，创建／修改时间是ISO字符串 `created/modified_at`；金额为最小货币单位整数，`amount_received`可为空。仅确切的succeeded及足额已捕获、金额／币种／商户／profile匹配才能确认付费权益。requires_capture、部分捕获、处理中、review等不能据此发放。RefundResponse的status为succeeded／failed／pending／review，且不含merchant_id，必须与原已验证付款关联。退款失败才按已核验结果释放预留，未知不能自动解占。

通知结构为 `{merchant_id,event_id,event_type,content:{type:'payment_details'|'refund_details',object:<对应DTO>},timestamp,...}`。有效签名只触发同提供方、同操作的查单；不能直接采用客户端或通知中未经回查的成功状态发放资产。Hyperswitch按2xx判断通知已接收，西界应在持久化唤醒后才ACK。

## 一手来源与后续实测

- [固定v1 OpenAPI](https://github.com/juspay/hyperswitch/blob/8e75ce7cce0b462b37d76601ac264a7f603674cc/api-reference/v1/openapi_spec_v1.json)、[Payment Links服务与自建SDK URL使用](https://github.com/juspay/hyperswitch/blob/8e75ce7cce0b462b37d76601ac264a7f603674cc/crates/router/src/core/payment_link.rs)。
- [Payment Links实际SDK初始化](https://github.com/juspay/hyperswitch/blob/8e75ce7cce0b462b37d76601ac264a7f603674cc/crates/router/src/core/payment_link/payment_link_initiate/payment_link_initiator.js)、[HMAC-SHA512源码](https://github.com/juspay/hyperswitch/blob/8e75ce7cce0b462b37d76601ac264a7f603674cc/crates/router/src/core/webhooks/types.rs)。
- [Stripe公开connector](https://github.com/juspay/hyperswitch/blob/8e75ce7cce0b462b37d76601ac264a7f603674cc/crates/hyperswitch_connectors/src/connectors/stripe.rs)、[PayPal公开connector](https://github.com/juspay/hyperswitch/blob/8e75ce7cce0b462b37d76601ac264a7f603674cc/crates/hyperswitch_connectors/src/connectors/paypal.rs)、[钱包自建配置文档](https://github.com/juspay/hyperswitch-docs/tree/6b4306d2f722da7dad938c8bf3bf4506fa75d689/integration-space/wallets)。

配置到位后还需在自己的网关与商户环境验证：收银链接重开、三种钱包各自的合格设备及不合格空态、实际付款与足额到账、未知响应查回、重复／乱序通知、关闭应用后恢复、整单退款及原币种金额。API协议替身测试不构成这些真实渠道和设备的成功证据。
