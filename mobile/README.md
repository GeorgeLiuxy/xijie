# 西界 · Figma Android USB 调试壳

本目录承载仓库内的 [共享 React/Vite 前端](../frontend/)，用于 Android USB 联调。

- 包名：`app.elysium.figma.dev`；名称：`西界·Figma调试`。
- Android API 24+；compile/target SDK 36；JDK 21；Gradle 8.13；AGP 8.13.2；Capacitor Android 8.5.2。
- 官方模板及 runtime 已复制到本目录，来源与 runtime 构建版本调整见 `sources.json`；许可证随 runtime 保留。
- `MainActivity` 继承 Capacitor `BridgeActivity`，注册 `WindowSurface` 以同步前端主题与窗口底色，并让前端优先处理应用内返回。Manifest 声明 `adjustResize`。
- SystemBars 保留默认 `insetsHandling: css`、默认系统栏样式和显示状态；Capacitor 按 WebView 版本及 `viewport-fit` 处理自身 inset，并提供 `--safe-area-inset-*`。这里没有额外消费或覆盖这些变量。

## 构建

本轮登录接入补充 Google 的系统浏览器回流和微信官方 OpenSDK `6.8.40`。微信公开 AppID 通过构建参数 `-WechatAppId` 提供，默认空值不初始化 SDK；AppSecret 只在 Logto 服务端。debug／release 只导出各自 `${applicationId}.wxapi.WXEntryActivity`，保留微信 SDK 对回调来源的信任检查，未增加 Android 权限。包验证器读取真实 APK／AAB Manifest、DEX 和能力方法，检查官方 SDK、Google、正确回调类和精确权限集合。

独立 API34 模拟器已通过 51 条原生受控断言，覆盖 Google prepare、同账号重新验证、加密私有授权记录、实际进程终止后原键恢复、socket 断流、未知结果、取消及迟到回包。见[原生验证](../.tmp/login-native-research-20261117/verification.json)。这些受控端点和 instrumentation 结果不等于真实微信／Google／Apple 授权，也没有把它们计作物理手机验证。实际渠道、正式签名与域名配置见[登录渠道配置](../deploy/logto-auth/README.md)。

设置 `JAVA_HOME` 指向 JDK 21，从 `mobile/` 在 PowerShell 运行 `./build-debug.ps1`。SDK 优先使用 `ANDROID_HOME`，其次是 `ANDROID_SDK_ROOT` 和 Windows 默认 SDK 目录。脚本也支持 `-Jdk` 和 `-Sdk` 参数。Gradle 依赖从 Google/Maven Central 获取。缓存完整后可加 `-Offline`。脚本不启动服务或安装到手机。环境变量仅在进程内设置，结束后恢复；不会改变系统持久环境变量。TEMP/TMP 临时指向本目录 `.tmp/`，避开本机 JDK 的默认临时目录管道连接错误。debug 签名保存在本目录的 `.android-user-home/`，不应提交或分享。

输出：`artifacts/xijie-figma-usb-debug.apk`；日志：`artifacts/build-debug.log`。更换机器可通过参数指定已安装的 JDK/SDK。

调试服务使用不同端口时，可加 `-Origin http://127.0.0.1:5184`。只接受带明确端口的 HTTP 回环源，不接受外部主机、凭据、路径、查询或片段；构建脚本在 `mobile/.tmp/` 暂存独立 debug assets，不改仓库默认的 `5174` 配置或 release 配置。Gradle 只将该暂存目录用于 debug variant。对应核验执行 `python verify-apk.py --origin http://127.0.0.1:5184`；不传参数时仍核验默认 `5174`。手机使用同一端口做 `adb reverse tcp:5184 tcp:5184`，服务的 CSRF／cookie 源配置也必须精确匹配，不改写请求的 Origin 头。

运行 `python verify-apk.py` 可重新核验 APK 包名、名称、debug 标记、launcher、API 级别、adjustResize、实际打包的 loopback 网络策略及 v2 签名；结果保存为 `artifacts/verification.json`。它不连接设备。

2026-11-06 本机结果：正常官方依赖解析后构建成功（71 tasks），上述 APK 核验 PASS。首次纯离线尝试缺少部分 Maven 元数据，不能称为首次离线构建成功；过程日志保存在 `artifacts/`。

## USB 体验边界

从仓库根目录运行 `pnpm dev --host 127.0.0.1 --port 5174`，手机获准 USB 调试连接后，由操作者执行 `adb reverse tcp:5174 tcp:5174`，再安装并启动本包。相对 `/api/gifts`、`/api/invites` 请求仍到同一个 Vite 服务。

这是独立包名的 **USB 联调安装版**，不是脱离电脑即可完整工作的离线版。设备 WebView 本地资料与电脑浏览器分开，不迁移或覆盖旧应用资料。连接不可用时显示等待连接页面，不伪造演示数据。

HTTP 例外只在 debug XML 中允许 `127.0.0.1`，没有全局明文放行。debug config 才包含开发 URL 和 WebView debugging；main config 没有开发地址且关闭调试；release variant 默认关闭，只有以下独立脚本提供完整正式输入才可构建。

安装包核验与真机验收分开：键盘、安全区、系统返回和业务路径仍须在实际设备检查。

原生资料导出有一项旧网页组件兼容限制：在独立 Android8.0/API26 镜像自带的 Chrome69 上，浏览器可以携带 `SameSite=Lax` 会话 cookie，但原生 `CookieManager.getCookie()` 返回空。原生导出现在仅在 cookie 为空、API26+ 能确认实际宿主是 Chromium 标准提供程序且主版本低于74时，返回 `EXPORT_WEBVIEW_OUTDATED`，提示到应用商店更新 Android System WebView 或 Chrome、重新打开应用后重试；不再把这一已知情况当作登录失效。API24/25、无法读取版本或厂商自有版本号不据此推测拦截。74仅是这项已知原生导出问题的判断边界，不是整个应用的最低 WebView 版本声明。HttpOnly、SameSite、固定第一方源、账号归属及会话校验保持原有规则；不能通过去除安全属性兼容旧组件。受控端点与系统 SAF 的真实保存、文件回读、取消和写后校验失败证据见 [API26验证说明](../.tmp/phone-ux-followup-20261116/legacy-export/README.md)，其中省略 SameSite 的诊断路径不能代替现行会话策略下的业务验收。

麦克风的安装包检查同时要求 `RECORD_AUDIO` 和 `MODIFY_AUDIO_SETTINGS`：当前 Capacitor 的音频捕获权限请求包含这两项，后者是 Android normal 权限，无需另一个运行时确认框。缺少后者可能在用户已允许录音后仍被 WebView 拒绝，人物原声录制和 AI 通话的 `getUserMedia` 都受影响。2026-11-16 已在 Pixel 8／Android 16 定位该缺失并补充主 Manifest；严格检查器已对修复前 debug／unsigned release 实物明确拒验，修复后的最新构建见文末。设备录音仍须独立复验，不能沿用旧哈希或旧 PASS 记录。

原“拍摄”通过系统相机意图取回文件，不直接使用相机设备。主 Manifest 仅为 `android.media.action.IMAGE_CAPTURE` 增加 `<queries><intent>`，不增加 `CAMERA` 或 `QUERY_ALL_PACKAGES`。这是针对 Android 11+ 包可见性查询限制的最小声明，参见 [Android 官方包可见性说明](https://developer.android.com/training/package-visibility/use-cases)。Pixel 8／Android 16 修复前曾在系统可解析相机时仍退回照片选择器；此前补验已实际完成系统拍照、确认、上传和冷启动后的照片字节回读，范围见 [完整实拍证明](../.tmp/phone-ux-followup-20261116/photo-full-path-proof.json)。这项既有正常路径验收不代替下述进程中断恢复验收。

Android 原私聊的“拍摄”现接入 `ChatCapturePlugin`：启动前保存当前账号、会话、收件人物与本次拍摄身份，相机完成后仅在私有缓存生成一次固定 JPEG。正常返回仍立即发送；进程重建后先显示“继续发给原 TA／丢弃本机照片”，不自动发送。照片最多在本机保留一小时，恢复区显示截止时间。继续时重新核验身份与原聊天权限，沿用原媒体、消息和续传标识；发送结果未知时保留进度。确认发送成功、用户明确丢弃／停止、照片到期，或核实原身份／权限已失效时，按对应范围清理原图；清理失败不会显示成功，丢弃不会撤回可能已发送的照片。暂时无法核验登录状态不当作退出。图库、浏览器和非 Android 的原流程保留。

此恢复实现已完成独立 API34 AVD 的受控原生相机中断／重建、重复读取字节一致、保存进度、清理及权限隔离测试，也完成前端故障反例和独立源码复查。[原生受控证据](../.tmp/phone-ux-followup-20261116/chat-capture-native/final-device-cases.json) · [字节回读](../.tmp/phone-ux-followup-20261116/chat-capture-native/readback-proof.json) · [前端拍摄冻结与测试](../.tmp/chat-capture-recovery-20261116/frontend-freeze-evidence.json) · [独立审查](../.tmp/chat-capture-recovery-20261116/frontend-independent-review.json)。独立 API34 AVD 运行新调试宿主与真实本地服务，由全新合成账号走原页面：正常拍摄立即发送；相机前台真实终止宿主后恢复原操作，不自动发送；明确丢弃后消息数不变，待发记录与管理文件清零。最终首次“继续”已在新聊天初始化后成功处理；真实 202 受理回包被截断时保留原图与完整进度，再次终止进程并冷启动后，明确继续沿用原消息键、正文、媒体与生成任务。最终三条照片、三个媒体，重试零新媒体分配，已确认发送后的待发记录和管理文件清零；原界面实际加载 2788／2954／2858 字节图片。[完整 App 原页面证明](../.tmp/phone-native-capture-20261116/complete-app-capture-proof.json) · [丢弃结果](../.tmp/phone-native-capture-20261116/discard-full-app-proof.json)。随后另留一张尚未发送的 ready 原图，从原账号页面注销；原生待发与管理文件由应用自动清空，原会话返回 401，七域 121 张私有表、三个照片对象及相关队列／授权均通过删除回读。原生图片在测试工具清理前已为空，没有手工删除图片来代替产品清理。[最终账号核查](../.tmp/phone-native-capture-20261116/lifecycle-erase-proof.json) · [设备清理范围](../.tmp/phone-native-capture-20261116/device-cleanup-proof.json)。以上是 AVD 各自范围的证据；后续物理手机快速补验见下段。真实模型与支付仍关闭。

这次真实 API34／WebView113 原页面整合还复现了另一项兼容问题：运行时已有 `AbortController` 和 `AbortSignal.timeout`，但缺少 `AbortSignal.any`，使声明在请求前就显示读取失败，而独立 GET 会话、授权和政策均为 200。现在仅在缺失时，于前端入口最先安装组合取消兼容方法，保留原生方法、超时和请求取消规则。补丁后实际页面的 `any` 为 function，声明能读完，一次点击综合同意后可继续原预览与人物创建。[原反例](../.tmp/phone-native-capture-20261116/webview-113-before-private.json) · [恢复后声明](../.tmp/phone-native-capture-20261116/01-statement-on-webview113.png) · [一次同意后续接](../.tmp/phone-native-capture-20261116/02-after-one-agreement.png) · [补丁检查](../.tmp/chat-capture-recovery-20261116/abort-signal-verification.json) · [独立源码复查](../.tmp/chat-capture-recovery-20261116/abort-signal-independent-review.json)。本批早期授权回读发生在处理进行中，只看到 10 项，不能用它宣称 18 项终态全部齐备；完整用途语义沿用此前单次同意验收及本次综合流程完成后才续接的规则。这项兼容只覆盖现有组合取消调用，不代表全部旧 WebView 功能均已支持。

原页面还暴露首次“继续”可能在原会话未绑定前就消费恢复请求，随后开发模式的挂载清理使旧请求被隔离，表现为进入聊天却未发送。最终只在恢复效果中增加等待原会话绑定的条件与依赖，不改正常拍摄或服务权限。真实 ReactDOM StrictMode 与实际 hook／Talk 反例已由零图片读取／发送变为读取一次并保存一条原照片，独立源码复查通过。[最终本地检查](../.tmp/chat-capture-recovery-20261116/strict-replay-freeze-evidence.json) · [独立复查](../.tmp/chat-capture-recovery-20261116/strict-continuation-independent-review.json)。该隔离浏览器文档的 Vite HMR 传输错误单列保留，组件错误与业务网络漏出均为零，不记作整个测试页面没有错误；新宿主原页面结果仍由当前整合记录单独证明。

本批独立 AVD 已关闭，仅移除它自有的 5184／9225 调试映射，最终 ADB 设备列表为空；没有操作用户物理手机或其他模拟器。[收尾记录](../.tmp/phone-native-capture-20261116/device-teardown-proof.json)

2026-11-17 用户重新连接 Pixel 8／Android 16 后，已覆盖更新同一新调试包，并用全新合成账号完成核心新增路径的快速实测：原 UI 一次综合同意后 18 项用途均有效并创建人物；正常系统拍照立即保存一条照片；相机在前台时真实终止宿主，新 PID 恢复同一操作，首次继续遇真实 202 受理回包截断后仍保留原图与进度。返回桌面再次终止宿主并冷启动后，进度逐字段一致，明确重试使用同一操作、消息键、逐字节相同正文、媒体及任务，只有一次重放、零新媒体分配，最终两条照片／两个媒体。原界面实际加载 34776／36284 字节图片，确认发送后待发记录与管理文件为空。[物理手机完整路径](../.tmp/phone-native-quick-20261117/complete-app-capture-proof.json) · [完成后的同意回读](../.tmp/phone-native-quick-20261117/completed-agreement-private.json)。该账号已从原 UI 注销，七域 121 张私有表、两个照片对象、身份／会话／队列及导出授权均清理，手机回到正常登录页；只移除本轮一个精确测试 XML 和本机私有 OTP，手机与调试服务保持连接。[账号清理](../.tmp/phone-native-quick-20261117/lifecycle-erase-proof.json) · [手机收尾](../.tmp/phone-native-quick-20261117/device-cleanup-proof.json)。本次快速实测没有重测“丢弃”或“带未发原图注销”，这两条仍只引用前述 AVD 证据；真实看图 AI 和支付没有开启。

## 独立正式构建

`build-release.ps1` 先以真实 service 模式构建仓库 React 前端并打包到 APK/AAB，随后使用独立正式包名 `app.elysium.xijie`、名称 `西界`，关闭 debuggable、WebView 调试及混合内容。正常运行只连接明确指定的第一方 HTTPS 网页源；所有相对 `/v1/...` 请求仍同源，并沿用现有 HttpOnly 会话 cookie 和服务验证。它不需要 USB reverse。无法连接时显示离线提示，不创建演示账号或成功结果。打包前端不是完整离线服务；正式服务必须先部署，远端网页及其 API 版本由正式部署维护。

构建脚本不安装到设备、不上传商店、不创建 keystore。无真实签名资料时，以下命令仅验证非 debug 的 unsigned 发布产物；示例 `.invalid` 地址只是本机构建输入，不是可连接的真实服务：

```powershell
./build-release.ps1 -Origin https://release-validation.xijie.invalid -VersionCode 1 -VersionName 0.1.0-local-unsigned -Jdk 'C:/Program Files/Java/latest/jdk-21' -Unsigned
python verify-release.py artifacts/xijie-1-unsigned.apk --origin https://release-validation.xijie.invalid
```

真正发行时指定实际 HTTPS 源、递增且未使用过的 `VersionCode` 及版本名；私下设置 `XIJIE_ANDROID_KEYSTORE` 绝对路径、`XIJIE_ANDROID_KEY_ALIAS`、`XIJIE_ANDROID_STORE_PASSWORD`、`XIJIE_ANDROID_KEY_PASSWORD`，去掉 `-Unsigned` 后构建，再执行 `verify-release.py ... --signed`。四项必须同时提供，不会使用 debug 签名代替。长期保管同一发行签名；安装更新必须沿用该签名和包名且递增版本号。 keystore、密码、APK/AAB 和日志不提交。

`verify-release.py` 检查真实 APK 中的正式包名、非 debug 标记、仅 HTTPS 网络策略、指定源、真实前端资源及离线页面；带 `--signed` 才核验 APK 签名。签名证书归属、真实域名可用性、真实短信/第三方登录、支付钱包可用性、通知、手机键盘/安全区/返回/拍摄和升级保留资料仍需正式设备与凭据验收。本轮已接入微信官方 Android SDK；Apple／Google 采用系统浏览器 OIDC 回流。真实外部授权、正式签名／域关联和应用商店发行仍需独立验收。


原生第三方登录使用手工注册的 `NativeAuthPlugin`，不依赖浏览器与 WebView 共享 cookie，也不放行 Apple/Logto 在主 WebView 导航。私有 verifier 以 AndroidKeyStore AES-GCM 加密后存入 app-private SharedPrefs；仅固定第一方 `/v1/auth/native-launch/:id` 可以启动系统浏览器，仅构建时源域的 `/native-auth/complete` AppLink 能提交对应 pending ticket。App 被杀后重启可读取私有 pending 并按相同幂等键恢复兑换，普通网页不读取此私有存储。会话 cookie 只由后端在原 WebView 的兑换响应设置，URL 不包含会话或 OAuth token。

启用需要服务端 `OIDC_NATIVE_HANDOFF_ENABLED=true`、实际第三方 connector 和正式签名域关联。`deploy/production/assetlinks.json.example` 的指纹必须来自最终安装包的签名证书，发布到实际 HTTPS 域名的 `/.well-known/assetlinks.json`；空列表不建立关联。构建与 aapt 检查已验证桥类、Keystore调用及 AppLink 声明，但 Keystore 实机行为、域验证与真实认证仍需真机，不把 Edge 的 synthetic nativePromise 恢复测试当作 Android 实测。


## 当前本机产物（2026-11-17）

最新部署：已按用户要求在物理 Pixel 8／Android 16 用 `install -r` 保留数据更新下表 debug 包，手机实物 SHA 完全匹配；没有改另一款应用。短信／密码／找回入口、显示密码、键盘滚动和系统返回已做提交前实际点击检查，第三方未配置状态正确，当前留在密码登录页供查看。此轮未发送短信、登录或更改账号，不等于真实渠道或手机完整认证验收。[部署与界面证据](../.tmp/login-phone-preview-20261117/phone-ui-proof.json)。

以下记录取代此前同路径产物的哈希。本次密码登录、设置／找回、Google、同主体再认证、微信官方SDK和取消操作修复冻结后，既定版本 `1`／`0.1.0-local-unsigned`、验证源 `https://release-validation.xijie.invalid` 实际完成 Vite service production build（4750 模块）与离线 Gradle `assembleRelease/bundleRelease`（BUILD SUCCESSFUL; 125 actionable tasks, 10 executed, 115 up-to-date）。发行产物保持 unsigned。

| 产物 | 字节数 | SHA-256 |
| --- | ---: | --- |
| [USB debug APK](artifacts/xijie-figma-usb-debug.apk) | 4,299,392 | `33c179fa93c2d57a84f9a4c88dfcb7c54a82fe855e45075dc49c3860110c7e5b` |
| [unsigned release APK](artifacts/xijie-1-unsigned.apk) | 11,928,954 | `f9c31c835d318f24f7936b603db17e9568d99fb228a98a3b2ca19ed0e767cf10` |
| [unsigned release AAB](artifacts/xijie-1-unsigned.aab) | 11,762,766 | `6e1a521787afebb886990aa106dd3c46777154e697f4e4eb630df25ab78eb932` |

本节采用主代理刚构建并通过 [debug 实物报告](artifacts/verification.json) 的新 debug APK 作为基线，源为 `http://127.0.0.1:5184`；release 构建前后其字节数、SHA-256 及报告均未变。本轮已重建并核验 debug 壳，最终两次 release 构建保持该壳和报告不变；没有安装设备，debug 页面由当前 Vite 服务提供。

release 双包各 72 个 public 文件逐个 SHA-256 与最新 staging 一致，各 26 个 JS 实际包含“从文件添加记忆”“添加到记忆”“领取赠礼券”“去挑礼物”“重选原照片”“停止重试这张照片”及语音识别服务断网提示，并保留综合声明、授权 bundle 与首次 Seek 继续回调。DEX 均包含原导出／拍摄桥、NativeAuth 的 Google 能力方法及微信官方 SDK 和正确 applicationId 的回调；JS 含 password-attempts／password-challenges、wechat_sdk 和同主体再认证接线。文案与字节存在是实际打包证据，不能单独证明设备上的保存或恢复操作成功；已知过旧的 WebView 返回兼容提示，也不能当作旧设备导出通过。

release 双包 [实物报告](artifacts/release-verification.json) PASS：正式包名、非 debuggable、固定 HTTPS 源、关闭 WebView 调试／混合内容、service 前端、voice WebAudio、shared-goal review、NativeAuth／AndroidKeyStore 与 AppLink 声明。APK 查询树及 AAB 均有 `RECORD_AUDIO`、`MODIFY_AUDIO_SETTINGS` 和限定的 `IMAGE_CAPTURE` 可见性声明，没有直接 `CAMERA` 或 `QUERY_ALL_PACKAGES`。可从仓库根目录重复执行：

```powershell
python mobile/verify-release.py mobile/artifacts/xijie-1-unsigned.apk --aab mobile/artifacts/xijie-1-unsigned.aab --origin https://release-validation.xijie.invalid
```

实际签名工具结果保存在 [unsigned-signature-check.json](artifacts/unsigned-signature-check.json)：`apksigner verify` 返回 1／`DOES NOT VERIFY`；`jarsigner -verify` 返回 `jar is unsigned`。这证明产物未签名，不是发行签名验证成功。构建输入、产物字节／SHA、JS／DEX 断言及 264 个冻结输入（含全部 203 个前端源码文件）和新 debug 基线未变的核对见 [final-build-evidence.json](artifacts/final-build-evidence.json)，Vite／Gradle 原始日志在 `artifacts/build-release-web.log`、`artifacts/build-release.log`。

全部 45 个前端测试文件实际执行 **410/410**，失败／取消／跳过均为 0，测试文件在运行期间未变。覆盖本轮密码登录／设置／找回、同主体再认证、原生能力判断、未知结果与取消请求、切号迟到隔离，并保留原授权、拍摄、下载、记忆与赠礼等回归。根 TypeScript `--noEmit -p tsconfig.json` 返回 0、无诊断。[实际命令、计数与日志哈希](../.tmp/phone-final-artifacts/frontend-validation.json) · [前端测试日志](../.tmp/phone-final-artifacts/frontend-tests.log) · [TypeScript 日志](../.tmp/phone-final-artifacts/frontend-ts.log)

本节证明当前包的构建、自动化测试与静态实物检查；USB debug 真机路径由 [当前交付状态](../docs/backend-local-completion.md) 单独记录，不能外推为正式 release 已验。release 仍使用不可达的 `.invalid` 源且无发行签名；实际 HTTPS 服务、AppLink 域关联、正式包安装／更新、Keystore 实机行为、系统音频路由、真实身份和支付仍需对应条件与独立验收。
