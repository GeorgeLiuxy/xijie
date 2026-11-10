# 西界后端设计评审

评审范围包括当前原型、目标部署、数据结构与关键交互。当前方案建议按 K01–K05 验证私人体验，再启用礼物、正式支付、邀请和公开共创。图中的首期与后续表示设计安排，运行证据单独列在下方。

本次数据评审补上业务时间、状态迁移、请求与业务去重、取锁顺序和提交边界。可先看 [逐表数据规则](./backend-data-lifecycle.md)，再在结构图中对照状态和时点。

## 1 · 架构

### 当前原型

~~~mermaid
flowchart LR
    web["浏览器预览"] --> vite["Vite 预览与页面资源"]
    android["Android USB 调试壳"] -->|"本机回环与 ADB reverse"| vite
    web --> device["浏览器 / WebView 本机数据"]
    android --> device
    vite --> preview["礼物 / 邀请 / 接力预览接口"]
    preview --> temp["临时 JSON 预览数据"]
    classDef current fill:#e8f2ed,stroke:#63907c,color:#21392f;
    classDef data fill:#f5efe5,stroke:#ad8c61,color:#48351c;
    class web,android,vite,preview current;
    class device,temp data;
~~~

当前浏览器与 Android 宿主共享界面代码。原型用本机状态模拟登录、AI 和支付，预览接口由 Vite 注册。USB 调试 APK 需要本机开发环境，验证正式版还需单独构建和安装。 [预览入口](../vite.config.ts) · [Android 调试说明](../mobile/README.md)

### 目标部署与调用

~~~mermaid
flowchart TB
    app["原生 App / Web"] --> edge["HTTPS 接入"]
    ops["运营入口"] --> edge
    edge -->|"REST / SSE"| api["NestJS API · TypeScript"]
    edge -->|"OIDC 授权与回跳"| identity["Logto OSS 候选"]
    api -.->|"验令牌"| identity
    subgraph business ["同一业务代码库 · 两个运行角色"]
        api
        worker["Worker · TypeScript"]
    end
    businessDb[("PostgreSQL · 业务与 pg-boss")]
    objectStore[("S3 兼容 · 私有素材")]
    identityDb[("身份库 · 独立权限")]
    api -->|"提交业务与任务"| businessDb
    worker -->|"取任务、提交结果"| businessDb
    api -->|"签名、授权读"| objectStore
    worker -->|"校验、清理"| objectStore
    identity --> identityDb
    identity -.-> authChannel["短信 / 第三方授权"]
    worker -.-> model["模型服务"]
    worker -.-> pay["支付渠道 · M01"]
    worker -.-> rtc["系统推送 / 通话 · 按需"]
    classDef clientNode fill:#e8f2ed,stroke:#669080,color:#19382c;
    classDef apiNode fill:#d9ebe4,stroke:#54806f,color:#19382c;
    classDef dataNode fill:#eff2f5,stroke:#8b9bad,color:#223a50;
    classDef extNode fill:#f8f0e3,stroke:#bb986a,color:#47351f;
    class app,ops,edge clientNode;
    class identity,api,worker apiNode;
    class identityDb,businessDb,objectStore dataNode;
    class authChannel,model,pay,rtc extNode;
~~~

- API 和 Worker 分进程部署，人物、聊天、礼物、支付等业务模块通过类型化代码边界协作。队列与业务表使用同一业务 PostgreSQL，因此受理和入队能在同一事务提交。 [完整架构图](./backend-architecture.svg) · [服务调用](./backend-api-contract.md#41-调用方式与权威数据)
- 对象的二进制上传可凭短签名直达私有存储。对象读回前检查用途及授权。需要即时撤权的读取走 API 授权流。通话启用时，实时媒体经客户端与 LiveKit 传输，Agent 和 API 分别验证通话权限。 [媒体与通话适配](./backend-api-contract.md#42-外部适配接口)
- Android、iOS、鸿蒙和 Web 的业务接口与数据结构共用。平台差异由应用发行配置和登录回跳、支付、推送、权限等适配承接。各新端独立验收。
- 身份库由 Logto 管理。西界只以已验证的 `issuer + subject` 建立账号映射，切号成功后替换应用会话。支付通知经 HTTPS 入口交给 API 验签并持久化，再由 Worker 查单、推进状态和发放。 [跨域事务](./backend-api-contract.md#44-四条跨域实现顺序)

## 2 · 环境与验证结果

| 环境或能力 | 本轮结果 | 证据范围及待验项 |
| --- | --- | --- |
| Web 原型构建 | **通过**。Windows Node 24.14.0 下通过类型检查和 Vite 8.0.5 构建。开工核对在隔离 Linux 容器用 Node 22.23.2 和 pnpm 10.34.3，按冻结锁文件重新安装、类型检查和构建，均通过。 | 三维资源分块有体积提示。Node 22 的证据来自 Linux 容器。正式后端的依赖与构建在首批开工后单独锁定并验收。 |
| Web 原型实际操作 | **通过所测路径**。Headless Chromium 145，390 × 844 和 1440 × 900。检查了错误与正确演示验证码、登录后刷新、取消切号、A／B 往返和退出后刷新，进入了四个主标签。移动视口另用合成资料从寻找 TA 创建人物、发文字并读到模板回复、珍藏一条回忆。刷新后从星图搜索并逐字核对原文。 | 使用现有演示身份与本机状态，覆盖页面逻辑。刷新回读来自同一浏览器。真实短信、第三方登录、跨设备云端恢复和正式 API 待验。 |
| Android 调试包 | **现有包静态检查通过**。包名 `app.elysium.figma.dev`，SHA-256 `ccdbfa6…13fe`，minSdk 24、targetSdk 36，调试回环地址 `127.0.0.1:5174`。 | 现有 APK 的结构、签名和调试配置均可核对。USB 只读检查识别到 Pixel 8。真机安装、独立启动、原生授权及支付回跳待验。 [验包工具](../mobile/verify-apk.py) |
| 原型局部逻辑 | **通过所测分支**。直接运行模拟认证和本地回忆检索，核对错误、过期、取消和结果指向原文的 ID。 | 证明了独立函数的结果。正式鉴权、检索权限和跨设备回读另验。 |
| 数据库约束样例 | **17 项通过**。在 PGlite 的 PostgreSQL 17.5 内存实例执行代表性 SQL。包括跨账号关联拒绝、重复建号或写入拦截、唯一发放、余额非负和事务回滚。 | 使用为验证编写的最小 DDL。正式迁移、多连接竞争、RLS、pg-boss、API／Worker、备份和恢复待联调。 [数据库样例结果](./backend-review-data.md) · [PGlite 内存实例](https://pglite.dev/docs/) |
| PostgreSQL 双连接反例 | **14 项通过**，其中 12 项实际观察到等锁。验证幂等、锁等待跨到期、旧授权、Worker 迟到、抢最后库存／席位、退款上限与发放竞争。 | 使用 PostgreSQL 16.14 临时隔离容器和最小 DDL。正式业务迁移及 Worker 联调另验。 [本轮验证](./backend-data-lifecycle.md#验证证据与迁移门槛) |
| iOS、预发布、生产及真实渠道 | **待验证**。 | 仓库已有 Android 调试宿主。正式 iOS 目标、Logto 部署、私有存储、真实模型、短信、支付及发布包按渠道逐项验收。 |

运行证据来自当前项目文件和本轮测试。评审页的 14 张图也已用 Edge 渲染并检查导航和 390 px 宽度下的图表缩放。正式环境验收应固定包版本、渠道与配置，在结果中分别记录浏览器、安装版、沙箱或生产证据。

## 3 · 评审需要确认的决定

| 优先级 | 评审题 | 当前建议与会影响的范围 |
| --- | --- | --- |
| 先定 | 访客入口与首次正式保存 | 游客看样例，上传真实素材、跨设备保存及领邀请奖励前做真实认证。认证后回到原动作，客户端再次核对目标及权限。该方向仍需评审并验证 Logto 托管页面与 Android 回跳。 |
| 先验 | 首发地区、客户端和主要登录方式 | 当前按一个地区、一个主客户端、一种已验证方式做第一批。确定方案后冻结授权回跳和恢复路径。K01 的账号 ID、资料归属与提供方解耦。 |
| 先验 | 照片撤权与 AI 使用边界 | 私有存储先验证不可变成品、签名与撤权。AI 使用需独立用途许可。失效后阻断读取和迟到写回。K05 以前只用合成资料联调。 |
| 发布前定 | 数据留存、备份恢复、正式商品与退款 | 删除和恢复策略在真实数据前验证。支付只挑一个已获准渠道和一个商品走通。重复扣款、退款时权益已用、通知验签和商店确认先在沙箱验证。 |
| 按期评估 | 通话、更多支付渠道、共创及旧接力 | 按需求分别启用。首期定好引用和事件，各扩展独立迁移和验收。 |

设计评估是 **核心边界合理，可以作为评审基线**。复用一个代码库、两种运行角色和同库事务，能让发消息、保存回忆、扣减权益等流程先证明一致性。仍可能随着真机认证、媒体存储、支付或检索的验证调整适配实现及索引。优先稳定 `accountId`、`personId`、`memoryId`、数据归属、用户可见状态及幂等语义。需要变更时，先核对 API、迁移和消费者，再以增量迁移逐步切换。

### 实施时怎么核对

1. 用合成资料跑通 **验证身份 → 确认一位 TA → 发送文字 → 确认回忆 → 第二端搜索同一原文**。每个动作能从实际页面发起并在权威数据库回读。
2. 用两个账号和两个会话验证跨账号引用、切号取消和旧事件流。并发重复发送、确认同一候选，观察消息、任务和原文的真实条数。
3. 注入 Worker 中断、网络超时和撤权。检查操作 ID 查回、旧任务不能写回、备份恢复后权限仍然有效。完成这些验证再开放真实资料。 [首批验收](./backend-api-contract.md#52-联调验收与变更)

## 4 · 对照图与接口

- [数据结构图与约束](./backend-review-data.md)
- [交互、状态和失败路径](./backend-review-interactions.md)
- [正式 API 草案与数据库结构](./backend-api-contract.md)
