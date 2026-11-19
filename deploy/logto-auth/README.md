# 登录渠道配置

继续使用自建开源 Logto 1.46.0（MPL-2.0）。西界只保存既有 OIDC 主体和会话；手机号密码验证、短信校验、密码策略与密码写入均由 Logto 完成。Google、Apple 和微信复用官方连接器，Android 微信采用官方 OpenSDK 6.8.40。没有应用或短信资质时，不启用真实渠道或显示虚假的成功。

## 本地准备

开发 Compose 使用本目录固定上游摘要的派生镜像。只对上游审计脱敏函数补充 `code / verificationCode / authorization_code`，保留原许可证和源码；构建时校对版本、唯一源码锚点，并执行真实编译函数断言。API 的状态码、验证码验证结果和密码策略不改变。开发 Mock SMS 仅用于合成账号，它仍会在开发容器写测试验证码，生产不得安装 Mock SMS。

```powershell
docker compose --project-name xijie-identity-dev --env-file .tmp/identity-dev/compose.env --file deploy/identity-dev/compose.yaml up -d --build
node deploy/logto-auth/configure-login.mjs --env .tmp/identity-dev/server.env --enable-phone-password
node deploy/logto-auth/provision-local-reader.mjs --env .tmp/identity-dev/server.env
```

`configure-login.mjs` 从私有文件读取已有运维 Management API 凭据，只更新原手机号方法的密码和找回开关，保留短信首选、注册规则和页面配置。开发 Mock 增补 ForgotPassword 模板；真实短信连接器需自行填写对应的找回模板。默认不带修改参数时只检查配置。不要将私有 env 或密码复制进聊天、仓库或命令行参数。

固定的自建版本实际只提供 Management API 的 `all` 权限，没有 `read:users`。所以本地辅助程序另建 `xijie_phone_reader`，仅能读取 `xijie_auth_reader.bound_phones(subject,phone)` 两列视图，视图限定 `tenant_id='default'`；数据库端限制只读和查询超时。Identity 通过 `LOGTO_ACCOUNT_READ_DATABASE_URL` 参数化读取当前绑定号，既不缓存号码，也不拿注销用的管理凭据来查资料。本机数据库只在 `127.0.0.1:5441` 暴露。服务配置更新后需要迁移并重启 Identity。

## 生产配置

先部署本目录 Dockerfile 的审计脱敏镜像，数据库迁移遵循固定 Logto 版本；不要直接给 Identity 配置 Logto 数据库所有者。由数据库管理员在对应租户创建上述两列 `security_barrier` 视图，给独立 `NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT` 角色授予该视图的 `SELECT`、视图 schema 的 `USAGE` 及数据库 `CONNECT`，设置 `default_transaction_read_only=on` 和 `statement_timeout=5s`。不要授予原 `users` 表、密码列或其他表的权限。生产使用私网 TLS 地址。多租户部署必须将视图的租户过滤改为实际固定租户，禁止由请求传入租户名。

如果其他 Logto 部署确实提供细分的 `read:users`，可以改用 [私有配置模板](../production/social-login.env.example) 中的 M2M reader 三项，与数据库 reader 互斥。工具 `--create-reader` 只接受真实存在且唯一的 `read:users`，自建版本会明确拒绝，不会以 `all` 降级。

| 登录方式 | Logto 配置 | 西界配置和上线核对 |
| --- | --- | --- |
| 短信 | 官方短信连接器，例如阿里云、腾讯云或 Twilio；填写服务凭据、签名、SignIn/Register/ForgotPassword 模板 | 保持手机验证码登录开启；验证实际送达、限频、错码、过期和跨境区号 |
| 手机号密码 | phone 方法开启 password，保留 verificationCode；forgotPasswordMethods 含 PhoneVerificationCode | 原界面密码入口自动读取真实策略；验证设密后旧会话失效、找回不登录、不注册 |
| Apple | 官方 Apple 连接器；Apple Developer 的 Services ID、Team ID、Key ID、私钥及回调 | OIDC_APPLE_ENABLED=true；核对生产域名、返回地址和实际 Apple ID |
| Google | 官方 Google 连接器；Google Cloud OAuth Client ID/Secret、同意屏幕及授权回调 | OIDC_GOOGLE_ENABLED=true；核对授权域和发布状态，实际 Google 账号验证 |
| 微信网页 | 官方 WeChat Web 连接器；网站应用 AppID/Secret及回调域 | OIDC_WECHAT_ENABLED=true；核对真实网站应用资质 |
| 微信 Android | 官方 WeChat Native 连接器；移动应用 AppID/Secret | OIDC_WECHAT_NATIVE_ENABLED、固定连接器实例 ID、WECHAT_NATIVE_APP_ID；Android 构建配置相同 AppID，微信平台登记正式包名和签名摘要 |

连接器的完整字段以固定版本官方 `packages/connectors/connector-*/docs/config-template.json` 及其 `src/types.ts` 为准。Apple、Google、微信是不同的应用登记，不能只填一个统一“授权码”。AppSecret、Google Secret、Apple 私钥仅在 Logto；APK 只包含公开微信 AppID。普通原生浏览器回流还需第一方 HTTPS、已验证 AppLink 与生产签名，原生 SDK 不接受客户端自报 openid 作为身份。

所有第三方登录在西界仍经 OIDC 签名、issuer/sub、state/nonce、S256 PKCE 和原浏览器/会话归属校验。微信 SDK 的 code 由原生私有加密记录交给固定 BFF，再由官方连接器换取身份；未知结果不反复消费一次性 code。第三方无手机号账号可使用同一第三方重新验证后导出或注销，不会被强制改用短信。

本地隔离协议/模拟器测试不等于真实短信或真实 Apple、Google、微信验收。发布前需要实际资质、生产域名/签名、真实投递/授权及发行环境验证。
