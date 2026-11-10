# 西界

| 目录 | 职责 |
| --- | --- |
| [frontend/](frontend/) | React、TypeScript、Vite 应用。页面、组件、状态、主题与素材在这里维护。Web 直接运行这套前端，移动端可以复用它的构建产物。 |
| [frontend/preview-server/](frontend/preview-server/) | 礼物、邀请和接力的本地原型接口，由 Vite 的 dev 和 preview 加载。 |
| [mobile/android/](mobile/android/) | 现有 Capacitor Android USB 调试宿主。 [构建与联调](mobile/README.md) |
| [backend/](backend/) | 正式服务的独立目录，目前包含开发入口说明。 |
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

- **Web** 直接部署 `dist/`，共用前端以浏览器方式运行。静态产物只含前端，原型接口由 Vite 提供，正式 `/v1` 尚待接入。
- **Android** 使用独立 Gradle 工程。当前为 USB 调试版，发布版需另行接入构建产物并验收。
- **iOS** 在接入时建立 `mobile/ios/`。采用 Capacitor 时可复用 Web 产物，维护独立 Xcode 工程与平台能力。
- **HarmonyOS** 在接入时建立 `mobile/harmonyos/`。先验证 ArkWeb 复用 Web 产物的效果。采用 ArkUI 时，原生界面在鸿蒙工程实现，继续复用素材与 API 契约。

登录回跳、支付、推送、系统权限和签名按客户端适配。正式服务通过共用 `/v1` 契约管理身份、业务状态和数据，平台差异通过已注册的客户端及渠道配置处理。 [API 契约](docs/backend-api-contract.md)
