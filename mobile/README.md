# 西界 · Figma Android USB 调试壳

本目录承载仓库内的 [共享 React/Vite 前端](../frontend/)，用于 Android USB 联调。

- 包名：`app.elysium.figma.dev`；名称：`西界·Figma调试`。
- Android API 24+；compile/target SDK 36；JDK 21；Gradle 8.13；AGP 8.13.2；Capacitor Android 8.5.2。
- 官方模板及 runtime 已复制到本目录，来源与 runtime 构建版本调整见 `sources.json`；许可证随 runtime 保留。
- `MainActivity` 继承 Capacitor `BridgeActivity`，注册 `WindowSurface` 以同步前端主题与窗口底色，并让前端优先处理应用内返回。Manifest 声明 `adjustResize`。
- SystemBars 保留默认 `insetsHandling: css`、默认系统栏样式和显示状态；Capacitor 按 WebView 版本及 `viewport-fit` 处理自身 inset，并提供 `--safe-area-inset-*`。这里没有额外消费或覆盖这些变量。

## 构建

设置 `JAVA_HOME` 指向 JDK 21，从 `mobile/` 在 PowerShell 运行 `./build-debug.ps1`。SDK 优先使用 `ANDROID_HOME`，其次是 `ANDROID_SDK_ROOT` 和 Windows 默认 SDK 目录。脚本也支持 `-Jdk` 和 `-Sdk` 参数。Gradle 依赖从 Google/Maven Central 获取。缓存完整后可加 `-Offline`。脚本不启动服务或安装到手机。环境变量仅在进程内设置，结束后恢复；不会改变系统持久环境变量。TEMP/TMP 临时指向本目录 `.tmp/`，避开本机 JDK 的默认临时目录管道连接错误。debug 签名保存在本目录的 `.android-user-home/`，不应提交或分享。

输出：`artifacts/xijie-figma-usb-debug.apk`；日志：`artifacts/build-debug.log`。更换机器可通过参数指定已安装的 JDK/SDK。

运行 `python verify-apk.py` 可重新核验 APK 包名、名称、debug 标记、launcher、API 级别、adjustResize、实际打包的 loopback 网络策略及 v2 签名；结果保存为 `artifacts/verification.json`。它不连接设备。

2026-11-06 本机结果：正常官方依赖解析后构建成功（71 tasks），上述 APK 核验 PASS。首次纯离线尝试缺少部分 Maven 元数据，不能称为首次离线构建成功；过程日志保存在 `artifacts/`。

## USB 体验边界

从仓库根目录运行 `pnpm dev --host 127.0.0.1 --port 5174`，手机获准 USB 调试连接后，由操作者执行 `adb reverse tcp:5174 tcp:5174`，再安装并启动本包。相对 `/api/gifts`、`/api/invites` 请求仍到同一个 Vite 服务。

这是独立包名的 **USB 联调安装版**，不是脱离电脑即可完整工作的离线版。设备 WebView 本地资料与电脑浏览器分开，不迁移或覆盖旧应用资料。连接不可用时显示等待连接页面，不伪造演示数据。

HTTP 例外只在 debug XML 中允许 `127.0.0.1`，没有全局明文放行。debug config 才包含开发 URL 和 WebView debugging；main config 没有开发地址且关闭调试；release variant 已禁用。

安装包核验与真机验收分开：键盘、安全区、系统返回和业务路径仍须在实际设备检查。
