# 自建收银台与西界支付配置

本轮同时提供两个独立自建网关的适配：JeePay 用于微信／支付宝等国内渠道，Hyperswitch v1 Payment Links 用于银行卡及 Apple Pay／Google Pay／PayPal 等国际渠道。西界继续拥有订单、报价、用户归属、邮资账本和退款预留。网关负责商户配置、付款页及与支付平台交互。当前没有真实商户凭据或已确认价格，功能默认关闭。

这是可配置接线，不是已经开通上述平台。钱包的实际可用性由商户所在地、已接通 connector、币种、付款设备及域名验证共同决定；网关会按真实资格展示。Apple Pay／Google Pay 钱包支付与 App Store／Google Play 数字内容内购分别接入，本片不宣称完成商店内购。

## 1. 自建与渠道配置

- 国内网关按 [JeePay 固定版本指南](./jeepay/README.md)部署；在自己的 JeePay 后台登记普通商户、应用和微信／支付宝官方渠道凭据。西界仅保存该 JeePay 应用的 API 凭据。
- 国际网关按 [Hyperswitch 固定版本指南](./hyperswitch/README.md)部署 API、Control Center 和付款页 SDK。付款页 SDK 地址及其后端地址都指向自建服务，不能保留上游默认 Cloud 地址。为商户的 business profile 配置收单 connector、所需钱包及 PayPal 账户；分别完成钱包要求的商户和域名验证。
- 支付网关管理端仅供受控运维访问；数据库／缓存／MQ不对公众开放。API、付款页和回调在实际环境使用 HTTPS。西界不会代部署商户、申请账户、替用户接受服务条款或产生真实交易。

## 2. 西界私有配置

完整变量模板见 [Gifts .env.example](../backend/services/gifts/.env.example)。只加载到 Gifts API／Worker，不能复制到前端或 `VITE_*` 变量。可以只启用一个网关，也可同时配置：

```dotenv
GIFTS_COMMERCE_ENABLED=false
GIFTS_COMMERCE_PROVIDERS=jeepay,hyperswitch
GIFTS_COMMERCE_PRODUCTS_FILE=<正式商品JSON的绝对路径>
```

JeePay 需要 `JEEPAY_GATEWAY_ORIGIN`、`JEEPAY_CASHIER_ORIGINS`、`JEEPAY_MCH_NO`、`JEEPAY_APP_ID`、`JEEPAY_APP_SECRET`，以及 `GIFTS_PUBLIC_ORIGIN`。国际网关需要 `HYPERSWITCH_API_ORIGIN`、`HYPERSWITCH_CASHIER_ORIGINS`、商户 API key、merchant/profile ID、profile webhook secret 和 sandbox/live 操作环境标记；API 不返回 livemode，因此该标记不冒充支付环境的外部验证。两个网关共享已有的 `GIFTS_WEB_ORIGIN`，回到应用后只回读原订单。

Origin 值只含协议、主机及端口；`*_CASHIER_ORIGINS` 是允许返回给用户打开的付款页 origin 列表，以逗号分隔。禁止账号密码、URL fragment 和重定向到未配置域名。只有非生产的 loopback 地址可用 HTTP。启用时缺少必要信息会拒绝启动，而非退回模拟付款。

商品文件模板 [checkout-products.example.json](./checkout-products.example.json) 故意为空。请填写已确定的 SKU、商品版本、名称、到账邮资数量、整数最小货币单位金额和实际币种，每条结构如下（尖括号内容需替换，不能直接运行）：

```text
{ "id": "<sku>", "version": <正整数>, "name": "<商品名称>",
  "units": <邮资数量>, "assetType": "postage", "assetId": "postage",
  "price": { "amount": <整数最小货币单位>, "currency": "<ISO币种>" },
  "channel": "jeepay 或 hyperswitch" }
```

文件为上述对象组成的数组，允许1–20个明确商品，ID唯一。JeePay商品仅CNY，Hyperswitch按实际商户支持配置币种；界面按币种小数位换算金额，不把预览价格转成正式价格。不通过语言或操作系统自动猜测商户地区。

## 3. 回调与恢复

- JeePay notifyUrl：`<GIFTS_PUBLIC_ORIGIN>/v1/callbacks/payments/jeepay` 和 `/v1/callbacks/refunds/jeepay`，原始 form 字段按 API1.0 MD5 协议验证。
- Hyperswitch business profile webhook 可指向 `/v1/callbacks/payments/hyperswitch`；退款专用同形路径也接受。配置 `enable_payment_response_hash` 与 `payment_response_hash_key`，后者与西界 `HYPERSWITCH_WEBHOOK_SECRET` 一致。服务器按原始 JSON 字节校验 `X-Webhook-Signature-512`，不把解析后重序列化的 JSON 当原文。
- 两种回调都只唤醒同一笔交易的查询，不直接发放资产。Worker通过私有凭据主动查单，精确核对商户／应用或profile、原订单、操作、金额、币种；只有真实成功证据才能在同事务内确认付款和发放邮资。只授权或部分扣款进入待核对，不发整单权益。
- 付款确认最多30分钟，正常等待每30秒查询；退款最多24小时，每60秒查询；异常累计最多3次，达到预算后保留未知结果。超时、离开付款页和刷新都不等于失败。签名有效的迟到回调不能越过恢复隔离或已耗尽预算。
- Worker在发起外部操作前保存永久操作身份。丢回包后仅查询同一操作，不再次下单扣款。Hyperswitch支持按固定payment ID恢复付款链接；JeePay查询不返回原付款链接，下单回包完全丢失且链接未保存时只能保持待确认，不能伪造或另开一笔未知交易。
- 商户标识与网关地址绑定到原操作。更换商户、profile或网关地址后，不会用新商户继续执行旧操作；密钥轮换不改变商户绑定。

## 4. 配置后的真实验收

完成商户配置与商品审批后，先应用 Gifts007 增量迁移，编译并重启 Gifts API／Worker，再明确开启 `GIFTS_COMMERCE_ENABLED=true`。从原钱包「购买邮资」进入：查看服务端商品和价格→创建订单→明确打开自建收银台→付款→回原订单查到账；随后核对重复回调、离开重开、结果未知和整单退款。Apple Pay、Google Pay、PayPal分别在实际支持的设备／浏览器上验证，不能用显示Logo代替成功交易。

普通查询保持纯读；退款仍仅自动处理原邮资完整未消费的整单预留。已消费退款进入人工核对。正式财务留存规则尚未确定，已付款（含已退款）账户的擦除仍返回 `FINANCIAL_RETENTION_POLICY_REQUIRED`；不可为方便测试跳过该事实保护。生产发布、财务留存与商店发行验收仍单列，不因本轮适配完成自动开放真实收费。
