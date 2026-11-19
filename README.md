# 西界

前端视觉、文案、入口和操作顺序以已确认的首版设计（`53d5293`）为基准。后端开发只做必要的数据与接口接线；尚未接通的能力保留原入口并通过既有反馈说明，不能裁页面、改变操作步骤或以演示数据冒充真实结果。

当前本地实现、真实源环境验收、删除／恢复证据及仍需外部条件的范围，统一见[本地交付记录](docs/backend-local-completion.md)。自建收银台的构建、启停和渠道准备见[支付配置](deploy/checkout-setup.md)。

登录已补充手机号密码、设置／修改／找回、Google 和 Android 微信官方 SDK，继续复用自建开源 Logto。真实渠道需对应短信和开发者应用配置，准备步骤见[登录渠道配置](deploy/logto-auth/README.md)；本地协议和真实本机 Logto 验证范围见交付记录。

| 目录 | 职责 |
| --- | --- |
| [frontend/](frontend/) | React、TypeScript、Vite 应用。页面、组件、状态、主题与素材在这里维护。Web 直接运行这套前端，移动端可以复用它的构建产物。 |
| [frontend/preview-server/](frontend/preview-server/) | 礼物、邀请和接力的本地预览接口；正式服务模式使用真实 `/v1` 服务，不把预览结果作为真实账号的数据。 |
| [mobile/android/](mobile/android/) | 现有 Capacitor Android USB 调试宿主。 [构建与联调](mobile/README.md) |
| [backend/](backend/) | Identity、People、Conversations、Memories、Social、Media、Gifts 七个独立服务及相应任务进程，分别维护迁移、用途授权、数据权利与业务账本。 |
| [docs/](docs/) | 后端架构、数据模型、交互与 API 契约。 [设计评审](docs/backend-review.md) |

## 开发和构建

在仓库根目录运行以下命令。Node.js 与 pnpm 版本见 [.mise.toml](.mise.toml)。

```powershell
pnpm install --frozen-lockfile
pnpm dev --host 127.0.0.1 --port 5174
pnpm build
pnpm preview --host 127.0.0.1 --port 4173
```

`pnpm build` 输出根目录 `dist/`。Figma Make 配置及前端工具链仍由仓库根目录维护。Android USB 调试宿主访问电脑上的 `127.0.0.1:5174`，需按移动端说明建立 USB 转发。

## 客户端边界

- **Web** 直接部署 `dist/`，共用前端以浏览器方式运行。静态产物包含前端，原型接口由 Vite 提供。Web 账号与会话可显式启用 `/v1` 本机联调。 [启动步骤](backend/README.md#k01-web-本机联调)
- **Android** 使用独立 Gradle 工程，保留 USB 调试宿主；服务模式发布构建已生成并检查无签名 APK／AAB。正式域名、发行签名、AppLink 和真机／渠道验收仍待配置，见[移动端说明](mobile/README.md)。
- **iOS** 在接入时建立 `mobile/ios/`。采用 Capacitor 时可复用 Web 产物，维护独立 Xcode 工程与平台能力。
- **HarmonyOS** 在接入时建立 `mobile/harmonyos/`。先验证 ArkWeb 复用 Web 产物的效果。采用 ArkUI 时，原生界面在鸿蒙工程实现，继续复用素材与 API 契约。

登录回跳、支付、推送、系统权限和签名按客户端适配。正式服务通过共用 `/v1` 契约管理身份、业务状态和数据，平台差异通过已注册的客户端及渠道配置处理。 [API 契约](docs/backend-api-contract.md)
