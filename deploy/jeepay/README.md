# Jeepay 独立收银台

西界通过 HTTP 连接自部署的 Jeepay 开源版，保留西界自己的订单、权益账本、退款预留及用户归属。微信／支付宝的渠道凭据由 Jeepay 管理；西界保存 Jeepay 网关地址、商户号、商户应用 ID 和应用签名密钥。两种密钥不能互换。本目录包含部署适配及构建脚本；Java／Vue 上游源码只保存在独立私有部署目录，不编译进西界。

## 固定版本与已验证范围

版本及基础镜像 digest 以 [source-lock.json](./source-lock.json) 为准：后端 commit `e1ac9086d679826bab593f20431b7ecd292eb685`（上游 `v3.2.9_20260527`），UI commit `9c64a11719f2b5231256496dbbfa02d93fb8e16b`。两仓库实际 LICENSE 均为 LGPL-3.0。构建保留上游源码和 LICENSE；部署方仍须履行实际修改、分发方式对应的许可证义务。

本机已在 Docker 29.4.3／Compose v5.1.3、Linux amd64 上完成以下验证，证据位于受保护的 `.tmp/jeepay-local-cfd1dbbebd/`：

- 固定源码真实 Git 对象核对通过；Maven `-T1 -DskipTests clean package` 的 10 个模块构建成功。此命令跳过上游测试，不能视作上游测试通过。
- 收银台、运营台、商户台均由实际 Vue 源码完成依赖安装及生产构建；记录了 6 个自建应用镜像的实际 image ID 和基础镜像 digest。
- 独立项目 `xijie-jeepay-cfd1dbbebd` 的 10 个服务全部健康；仅 4 个端口发布到 `127.0.0.1`，中间件和管理后端端口不发布。
- Edge 实际渲染 3 套页面，6 项入口 JS／CSS 资源均为 200，未见页面脚本错误。收银台使用无交易的错误页；运营台和商户台使用原登录页，未登录或创建商户。
- 真实 SQL 回读商户、应用、支付、退款均为 0，运营账号已在首启阶段写入独立随机密码。停止后重新启动，仍为同一 MySQL server UUID，账号凭据和数据保留，10 个服务再次健康。

关键证据为 `image-build-proof.json`、`runtime-proof.json`、`restart-proof.json`、`final-state.json` 及 3 张页面截图。**最终状态已停止**，配置、镜像和所有数据卷保留；重启不重新生成密码或初始化数据库。未连接西界的 8 个源服务数据库，未配置真实商户、付款或退款。渠道支付、正式 HTTPS 域名和通知验收仍待实际商户资料准备后完成。

源码与镜像已锁定；Maven 传递依赖和构建环境并未宣称完全可复现，实际构建日志与镜像 ID 需随部署留存。

## 准备新的独立部署

需要 Git、Python 3.11+、Node 22 和 Docker Desktop／Compose >=2.24.4。脚本使用私有 Maven／Node 容器构建，不要求主机安装 JDK 或 Maven。下列 PowerShell 命令从西界工程根目录执行：

```powershell
$taskToken = [guid]::NewGuid().ToString('N').Substring(0,10)
$taskHome = Join-Path (Get-Location).Path ".tmp/jeepay-local-$taskToken"
New-Item -ItemType Directory -Path $taskHome | Out-Null
python deploy/jeepay/prepare-local.py --deployment $taskHome --fetch --subnet 10.253.244.0/24 --ports 29116 29226 29227 29228
if ($LASTEXITCODE -ne 0) { throw 'Deployment preparation failed; inspect its private log' }
python deploy/jeepay/local.py build --deployment $taskHome
if ($LASTEXITCODE -ne 0) { throw 'Build failed; inspect its private log' }
python deploy/jeepay/local.py start --deployment $taskHome
if ($LASTEXITCODE -ne 0) { throw 'Startup failed; inspect its private log' }
python deploy/jeepay/local.py status --deployment $taskHome
```

子网和端口只是本次验证使用的值。准备及启动脚本会检查既有 Docker 网络、Windows 主机路由和所选端口；冲突时选择另一个私有 IPv4 `/24` 和空闲端口，不删除现有网络或容器。脚本只接受工程 `.tmp/jeepay-local-<10位十六进制>` 目录，并固定 Compose 项目、数据卷和构建缓存归属。

`--fetch` 仅获取 source-lock 的两个官方仓库固定 commit，不运行上游安装脚本。Windows 的系统代理仅传给 Git 子进程，不输出代理值。已有精确源码的全新目录可省略 `--fetch`；已有配置、凭据或初始化 SQL 的目录会拒绝覆盖。获取失败保留私有日志，排除网络问题后应使用另一新目录，不能把部分下载当作完整部署。

`prepare-local.py` 在目录内生成五套独立基础设施密码／JWT 密钥，以及随机运营账号密码，Windows ACL 限当前用户和 SYSTEM；不向终端输出密钥。运营账号为 `jeepay`，密码保存在该私有目录的 `bootstrap-password` 文件，用本机编辑器查看。不要继续使用上游默认密码，也不要把私有 env、SQL、密码、完整 Compose 配置或日志粘贴进聊天／提交仓库。[checkout.env.example](./checkout.env.example) 仅说明字段，正常流程由准备脚本直接生成配置。

本次验证目录可直接按下面命令重启，无须再次 `prepare` 或 `build`：

```powershell
$taskHome = Join-Path (Get-Location).Path '.tmp/jeepay-local-cfd1dbbebd'
python deploy/jeepay/local.py start --deployment $taskHome
python deploy/jeepay/local.py status --deployment $taskHome
python deploy/jeepay/local.py stop --deployment $taskHome
```

`stop` 仅对指定独立项目执行 Compose down，不带删除卷参数，保留所有数据。重启使用原凭据与原卷。不要删除私有目录中的配置或 `bootstrap-password`，也不要通过重复首启来重置运营密码。

默认新部署入口为支付 API `http://127.0.0.1:29116`、收银台 `http://127.0.0.1:29226/cashier/index.html`、运营台 `http://127.0.0.1:29227`、商户台 `http://127.0.0.1:29228`。本轮最终已停止，这些地址须启动后才可访问；管理员入口继续仅通过回环或受限运维通道使用。

## 构建与初始化中的必要适配

- 上游完整 `init.sql` 已包含当前表与菜单；继续执行历史 `patch.sql` 会因重复键中断首启，并可能在下次启动时仅凭 MySQL ping 误判为成功。覆盖文件只挂完整初始化与私有密码 SQL，最后写入专用完成标记；健康检查使用应用账号查询该标记。本轮最初未完成初始化的空卷已隔离保留，验证使用新的 `mysql_verified` 卷，未删除或复用旧数据。
- 运营密码在初始数据库首次对外可用前由上游实际 Spring BCrypt 实现写入；SQL、原始随机密码留在私有目录。现有数据库升级需单独备份和迁移，不能套用首启流程。
- Node 容器执行 `npm ci --ignore-scripts` 和 Vite 生产构建。部分原锁文件指向 `registry.npmmirror.com`；构建副本中的 `resolved` 下载域名改为官方 npm，依赖版本和 integrity 保持一致并校验。原 Git 源码保持不变，不通过重新解析依赖掩盖镜像站失败。
- 本机 BuildKit 解析远端镜像元数据曾持续阻塞，即使镜像已拉取。`local.py build` 对本项目使用 legacy builder 包装已实际构建的 JAR／静态文件，基础镜像按 digest 固定；不修改全局 Docker 配置。Compose 仍保留现代 BuildKit 构建定义，该分支仅检查了配置，不能与本轮实际 legacy 构建证据混同。

`.tmp/jeepay-source-dev` 是旧协议研究的局部源码缓存，不是完整部署目录。私有验收目录包含完整源码、构建记录和保留的数据卷配置。资源不足时可停止本项目，不能清理其他项目容器、镜像、网络或卷。

## 连接商户与西界

1. 在运营台创建自己的普通商户、商户应用和操作账号，取得 Jeepay `mchNo`、`appId`、应用 `appSecret`。在该应用配置实际获准的微信／支付宝渠道，选择对应普通商户或服务商模式，并填写渠道要求的商户／应用、证书和签名配置。切勿把演示商户的凭据用于实际交易。
2. 配置 Jeepay 支付站点的 HTTPS 地址。该地址要提供 `/api/` 以及 `/cashier/` 静态资源路由；开源 QR_CASHIER 实际输出 `/cashier/index.html#/hub/<token>`，并由客户端环境继续到微信／支付宝。可将 HTTPS反向代理转发到收银台 UI（本例为 29226），其 `/api/` 代理到支付服务；核对官方 UI 的 `default.conf.template` 与实际域名、资源路径。管理员入口继续通过回环／受限运维通道访问。
3. 按西界购买配置示例填写网关、允许的收银台源、商户号、应用ID、应用签名密钥、公开通知地址及正式商品与价格。西界的密钥留在服务端；同一站点的 HTTPS 回跳只用于查回原订单，不能将浏览器返回当作付款证据。没有配置正式商品时不采用预览价格。
4. 将付款和退款通知地址指向西界对应的 JeePay 通知路由。通知必须先验签并匹配既有操作，再持久唤醒查单；成功 ACK 为纯文本 `SUCCESS`。失败通知不能先返回成功。实际路由与西界环境变量名称以同目录的西界购买配置／服务README为准。
5. 配置完成后用专用账号完成实际支付、到账、刷新／进程关闭后的查回、重复通知与退款验收。原生应用内是否可以使用该收银台，仍须按选定发行渠道验证；QR_CASHIER 不代表 Apple／Google 应用商店内购。

上游 `JeepayKit.getSign` 的 INFO 日志会打印含应用密钥的签名原串；覆盖文件统一将 `com.jeequan.jeepay` 设为 ERROR 以抑制该 INFO 输出，并关闭对外 API 文档及 CORS。若另行修改日志级别，先修正上游该处日志，避免将签名原串写入文件。本轮未进行带真实商户签名的交易，尚未验证所有签名与渠道异常路径的日志行为。

## 本次使用的开源协议

| 操作 | Jeepay 路径与关键字段 |
| --- | --- |
| 下单 | `POST /api/pay/unifiedOrder`；固定 `version:'1.0',signType:'MD5',reqTime`，以及 `mchNo,appId,mchOrderNo,wayCode:'QR_CASHIER',amount,currency,subject,body,notifyUrl,returnUrl`。amount为整数分。当前固定版本默认返回 `payDataType:'payurl'`、`payData` HTTPS链接；不使用商业版WEB_CASHIER。 |
| 查付款 | `POST /api/pay/query`；商户／应用、商户订单号或Jeepay订单号。返回签名后的订单，成功时间和创建时间均为epoch毫秒；state为0生成、1支付中、2成功、3失败、4撤销、5已退款、6关闭。state5不能当作新付款发放。 |
| 退款 | `POST /api/refund/refundOrder`；原 `mchOrderNo` 或 `payOrderId`、稳定 `mchRefundNo`、`refundAmount,currency,refundReason`。返回受理不等于退款成功。 |
| 查退款 | `POST /api/refund/query`；`mchRefundNo` 或 `refundOrderId`；返回的原付款订单、payAmount与refundAmount也必须匹配。state为0生成、1退款中、2成功、3失败、4关闭。 |
| 通知 | 上游接收器实际发送 `POST application/x-www-form-urlencoded`，字段为相应查询响应加 `reqTime,sign`；ACK为纯文本SUCCESS，大小写不敏感。 |

签名跳过null／空字符串，保留0，以 `key=value&` 拼接并按键值整项忽略大小写排序，末尾加 `key=<appSecret>`，UTF-8 MD5大写。请求先去掉sign；响应只对data对象签名，不包含外层code/msg，因此同时要求外层业务码成功。通知对完整通知字段去掉sign后验签。未知/不匹配/畸形结果保持待查，不能当作未付款。

原商户订单号和退款单号在固定版本SQL中为VARCHAR(64)，可承载UUID36。查询响应不含原收银链接：首次下单的成功结果必须在西界持久化；响应完全丢失时只能按原商户订单号查状态，不新建另一笔来掩盖未知结果。具体恢复行为以西界实现为准。

## 一手来源

- [固定后端源码与许可证](https://github.com/jeequan/jeepay/tree/e1ac9086d679826bab593f20431b7ecd292eb685)、[固定UI源码与许可证](https://github.com/jeequan/jeepay-ui/tree/9c64a11719f2b5231256496dbbfa02d93fb8e16b)。
- [官方Compose部署说明](https://github.com/jeequan/jeepay/blob/e1ac9086d679826bab593f20431b7ecd292eb685/docs/deploy/compose.md)、[实际QR_CASHIER下单实现](https://github.com/jeequan/jeepay/blob/e1ac9086d679826bab593f20431b7ecd292eb685/jeepay-payment/src/main/java/com/jeequan/jeepay/pay/ctrl/payorder/AbstractPayOrderController.java)。
- [网关签名实现](https://github.com/jeequan/jeepay/blob/e1ac9086d679826bab593f20431b7ecd292eb685/jeepay-core/src/main/java/com/jeequan/jeepay/core/utils/JeepayKit.java)、[仅data响应签名](https://github.com/jeequan/jeepay/blob/e1ac9086d679826bab593f20431b7ecd292eb685/jeepay-core/src/main/java/com/jeequan/jeepay/core/model/ApiRes.java)、[实际通知传输与ACK](https://github.com/jeequan/jeepay/blob/e1ac9086d679826bab593f20431b7ecd292eb685/jeepay-payment/src/main/java/com/jeequan/jeepay/pay/mq/PayOrderMchNotifyMQReceiver.java)。

签名兼容另用官方Java SDK commit `75d1f1a0090e53fa33fefc2ff27e47ab35bb9425` 的未修改 `JeepayKit` 在本机JDK21编译；仅SLF4J使用不输出日志的替身。6份公开合成向量覆盖UTF-8、空值、0、排序和退款查询；证据在受保护的本轮研究目录，未调用任何网关或真实商户。
