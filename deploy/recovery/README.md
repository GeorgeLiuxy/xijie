# 本机加密备份与隔离恢复演练

此工具是 K05 的恢复验证切片，沿用 PostgreSQL 原生 `pg_dump/pg_restore`，不覆盖现有业务库。恢复目标没有外部网络、发布端口、宿主数据卷、业务 API／Worker、Logto 进程或模型调用。图片验证另启动隔离 S3 与临时字节校验进程，仅共享同一 network-none 命名空间。即使检查通过，也只表示隔离副本通过本次校验，**不是可自动启服的生产灾备**。

## 实施约定

- 唯一工程根为 `D:/AI/xijie figma`，默认私有产物在本工程忽略的 `.tmp/recovery-dev/archives`。独立备份 key 在 `.tmp/recovery-dev/keys`，不能放进备份包、Git 或浏览器构建；同盘 key/密文只适用于本机演练，异地副本与独立保管另行部署。
- 配置 Gifts 后当前八个源仅允许既有 Compose 的 Identity16、People16、Conversations16、Memories16、Social16、Media16、Gifts16、Logto17 数据库，另备份私有图片对象；旧五／六／七库包保留原边界。验证容器项目/服务标签及 DB/user/major；`pg_dump` 在对应源容器运行，二进制直接流入 AES-256-GCM，不经 PowerShell 文本重定向或宿主明文文件。原生工具只读源库。
- 备份保留每库独立快照边界，不声称跨服务原子时点。主业务表快照的稳定摘要在 dump 前后核验，变化时拒绝把该次包标为完成。加密包同时保存角色/权限依赖及允许列表内的私有配置，配置只校验、不自动应用到恢复实例，防止源 DATABASE_URL 被误用于目标。
- Logto 使用17对应工具，并恢复其租户角色/成员关系与访问策略；角色备份不含角色密码，恢复容器随机口令不沿用源口令。七业务库以各自专用角色恢复，保留迁移校验和与约束。
- 清单、密文长度、SHA-256 和 GCM 认证都必须通过。数据库归档解密只能先写新建隔离容器内的临时文件，认证成功后才执行 `pg_restore --single-transaction --exit-on-error`，禁止未认证字节进入 SQL 执行器。对象字节在内存中完整认证后才写临时私有S3；失败不得输出成功报告。
- 恢复后先核对数据/迁移/约束，再隔离旧会话、OTP/OIDC挑战、下载授权、AI任务和数据权利队列；不伪造用户授权决定，不清零 consent 版本。所有恢复账号保持限制，未有更新的删除/更正/撤权依据时不得放行。
- 独立加密检查点记录账号、资源、PK/FK及行哈希，不保存私聊、画像或记忆正文，也不保存凭据。新检查点支持单调的安全回放：使较旧副本中已删除／更正的行失效，应用最新明确撤权及删除围栏，保留未变化的独立珍藏；不补造最新正文。过期、不匹配、已被较新可信head替代或schema漂移的检查点拒绝使用。差异及回放结果分别报告，不宣称恢复到了完整的最新业务状态。
- 临时目标必须带本次随机 run ID 和专属 label；清理前复核名称、label、network=none、无端口/绑定卷，仅删除本次目标。恢复产物不交给普通产品页面或日志，不启动模型、不调用供应方账号删除。

## 运行与验收

在仓库根目录使用 Node.js 22 或更高版本、PowerShell 7 和 Docker。当前已配置的八个源数据库及 Media 私有对象存储须已运行；按对应 `deploy/*-dev/README.md` 启动，不要重置库或删除卷。图片备份另需在 `deploy/recovery` 安装已锁定的 AWS SDK 依赖（`pnpm install --frozen-lockfile --ignore-workspace`）。选择业务停止写入的时段执行，工具发现数据库或对象在备份期间变化会拒绝将该包标为完成。

| 域 | Compose 项目 / 服务 | 数据库与角色 | PostgreSQL |
| --- | --- | --- | --- |
| Identity | `xijie-identity-dev / identity-db` | `xijie_identity` | 16 |
| People | `xijie-people-dev / people-db` | `xijie_people` | 16 |
| Conversations | `xijie-conversations-dev / conversations-db` | `xijie_conversations` | 16 |
| Memories | `xijie-memories-dev / memories-db` | `xijie_memories` | 16 |
| Social | `xijie-social-dev / social-db` | `xijie_social` | 16 |
| Media | `xijie-media-dev / media-db` | `xijie_media` | 16 |
| Gifts | `xijie-gifts-dev / gifts-db` | `xijie_gifts` | 16 |
| Logto | `xijie-identity-dev / logto-db` | `logto`，另含租户角色 | 17 |

来源工具使用对应容器的版本。目标使用备份记录的准确 `imageId`，不以当前可变 tag 替换旧镜像；镜像必须仍在本机，移机准备镜像属于独立运行前提。Logto 应与固定的 `ghcr.io/logto-io/logto:1.46.0` 配置一起理解，但本工具不会启动 Logto 或验证重新登录。

Gifts 额外核对每个批次的发行 credit／分录余额、每笔投递的原扣减与失败冲正，以及 People／Conversations 的同账号人物与会话身份。已有聊天卡必须保持同版本事实和不可变快照、时间、分录引用；尚未发生的可靠投影可缺席。隔离副本的全部可执行 Gifts 任务转为 blocked，不修改批次、流水、投递和成功任务。旧包明确标记无 Gifts，不能补造新域余额或将旧恢复结论扩为新域已验证。

最短完整演练命令：

```powershell
Set-Location -LiteralPath 'D:/AI/xijie figma'
node deploy/recovery/recovery.mjs drill
if ($LASTEXITCODE -ne 0) { throw 'Recovery drill did not complete.' }
```

它依次创建加密备份、创建与该备份绑定的检查点、恢复到临时隔离库、核对原始数据与迁移、隔离凭据和任务，并清理目标容器。最终还会回读源库摘要；只有恢复、清理与 `sourceUnchanged=true` 同时满足，独立 `drill-<runId>.json` 才能记录完成。不要从文件存在或控制台出现某个中间阶段自行推断演练通过。

需要分阶段执行时：

```powershell
$savedBackup = node deploy/recovery/recovery.mjs backup | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Backup failed; do not continue.' }

$savedCheckpoint = node deploy/recovery/recovery.mjs checkpoint --backup $savedBackup.directory | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Checkpoint failed; do not continue.' }

node deploy/recovery/recovery.mjs restore --backup $savedBackup.directory --checkpoint $savedCheckpoint.file
if ($LASTEXITCODE -ne 0) { throw 'Restore verification failed.' }
```

`checkpoint` 必须回读该备份包记录的全部来源容器实例，并在每域及跨域捕获前后确认稳定。`restore` 必须显式提供同包、已认证的检查点描述文件；它须在备份完成之后捕获，执行恢复时不超过一小时，不能来自未来。现代检查点还须匹配包外受控 `.tmp/recovery-dev/checkpoints/<backupId>.json` 中HMAC保护的最新head，拒绝选择已被替代的旧point；并发发布采用独占锁。迁移到别机时，可信head属于独立受控材料，不能仅从不可信备份包自行选定。恢复本身不要求来源在线，但要求备份、镜像、独立key、可信head和有效检查点齐备。旧仅摘要检查点仍可做原始隔离演练，明确记录 `securityReplay.applied=false`，其差异不能被称作安全回放已完成。

安全回放先验证原生恢复的原始快照和跨域来源闭包，再只写本次随机label、准确镜像、network-none、无发布端口／绑定卷的临时数据库。已删除账号的旧私有行被清除；其他表只保留最新point中同PK且同行哈希的旧行，并按真实FK删除失效依赖，无法闭合时失败清理。更正的新正文不会被导入，相关资料可能暂时不可用；跨库纯来源ID不会当作FK删除独立珍藏。最新明确revoke的安全元数据可补入，旧grant只作历史，不作为current authority；不会补入新的grant。模型计数、已领取attempt及人工财务审计保留单调性，预算倒退、审计改写或擦除围栏倒退会失败。

安全元数据的导入只限审核过的围栏、已脱敏deleted账号、明确撤权、模型计数／授权快照及财务操作审计／最小留存记录。仍在留存期内的archive不得因较新point缺席就删除；只有原retainUntil已过且最新Gifts已擦除围栏成立，才接受源已清理的旧archive失效。当前仍在的archive不得改写或延长期限。对象先核验全部旧加密字节，再按最新key／hash／类型／长度交集实际删除旧字节，不把point新增对象冒充已恢复。最后继续执行账号／会话／模型／队列隔离，`releaseReady=false`。这一机制验证安全失效，不提供自动生产发布、自动迁移兼容或完整业务再开放。

默认首次 `backup/drill` 会先保护受管 `keys` 父目录，再生成新 key；已有 key 会继续沿用。可在每个命令末尾传 `--key-file '受控目录中的备份 key 绝对路径'`，但自定义 key 必须预先存在，是私有保管、含 64 个十六进制字符的普通文件；工具不会为它创建文件或收紧任意外部父目录。不能把 key 放在 `archives` 内；其他阶段必须使用对应备份的同一 key。默认位置与产物如下：

| 位置 / 文件 | 含义 |
| --- | --- |
| `.tmp/recovery-dev/keys/backup.key` | 32 字节随机备份 key 的十六进制文本，独立保存 |
| `archives/<backupId>/manifest.json` | 完整备份的公开最小描述；索引本身仍受 GCM 认证 |
| `*.enc` | 原生数据库 dump、角色依赖、配置、索引或检查点的密文 |
| `checkpoint-*.json` | 绑定同一备份的加密检查点描述，供 `--checkpoint` 使用 |
| `restore-<runId>.json` | 单次恢复、检查点差异、隔离断言及清理结果 |
| `drill-<runId>.json` | 完整演练及源库未变的核验结果 |
| `FAILED.json` | 本次备份没有满足完成条件，不能用于宣称成功 |

恢复报告中的 `completed=true` 只表示本次隔离恢复检查完成，`releaseReady` 始终为 `false`。检查点匹配也不意味着具备对外启服资格；原始数据核验后，恢复账号仍受限，旧会话、OTP/OIDC、短时下载授权和生成／权利队列不能继续执行。

### Windows 私有权限与 key 保管

工具仅用原生字节流传输 custom dump，不能用 PowerShell `>`、`Out-File` 或 `Get-Content` 中转二进制备份。Windows 私有文件／目录由 PowerShell 7 调用 .NET，仅修改 DACL，保留 Owner 和 SACL；允许当前用户 SID 与 SYSTEM，权限设置失败即停止，不降级为普通共享文件。POSIX 使用文件 `0600`、目录 `0700`。

当前 Docker CLI 不支持 `--env-file -`，临时 PostgreSQL 使用本次私有运行目录中的一次性 env 文件传随机口令；argv、报告与日志均不带口令，启动后删除该文件。它不沿用来源口令。允许列表中的原服务配置只进入加密包，不自动写入恢复数据库、环境或宿主文件。

key 与密文必须分开保管，key 所在目录也应限制访问。默认同盘位置仅便于本机演练，不能承担磁盘损坏或主机丢失后的恢复；key 遗失时密文无法解密。不要将 key、解密配置或数据库正文粘贴到报告，不要提交到 Git 或打入前端构建。

### 失败与孤儿清理

正常失败和 SIGINT/SIGTERM 会等待隔离目标清理；不要把非零退出当成功。`pg_restore` 只有在密文长度／摘要和 GCM 认证均通过之后执行，损坏、错误 key、不匹配或过期检查点不能跳过校验。

如果主进程被强制结束或机器重启，根据恢复报告里的准确 `runId` 执行清理。若报告尚未落盘，可先只读列出工具标签，从目标名称／标签确认运行 ID：

```powershell
docker ps -a --filter label=app.xijie.recovery.run --format '{{.Names}} {{.Label "app.xijie.recovery.run"}}'
```

然后执行：

```powershell
node deploy/recovery/recovery.mjs cleanup --run '<本次报告中的 runId>'
if ($LASTEXITCODE -ne 0) { throw 'Cleanup did not pass ownership checks.' }
```

该命令逐一核对本次 label、名称、固定 PostgreSQL 镜像、`network=none`、无端口且只有 tmpfs 的目标，再删除；重复执行无残留时返回 `removed=0`。任何所有权或隔离条件不符都会拒绝，不要用 `docker rm` 通配符或 `compose down -v` 绕过。清理不删除备份包和 key；强制结束后还应按本次 runId 核对 `.tmp/recovery-dev/runtime/<runId>/` 是否残留一次性 `postgres-*.env`，确认只属于该次运行后单独移除，不读取其内容或批量清空其他目录。

### 测试命令与验收口径

无业务写入的格式、加密、检查点与策略测试：

```powershell
node --test deploy/recovery/crypto.test.mjs deploy/recovery/policy.test.mjs deploy/recovery/cli.test.mjs
```

显式创建隔离容器的 runtime 集成测试：

```powershell
$env:XIJIE_RECOVERY_RUNTIME_TESTS = '1'
try { node --test deploy/recovery/runtime.test.mjs }
finally { Remove-Item Env:XIJIE_RECOVERY_RUNTIME_TESTS -ErrorAction SilentlyContinue }
```

验证真实约束、旧会话／任务隔离及更正／删除差异的合成数据测试：

```powershell
node --test deploy/recovery/policy.integration.mjs
```

这些测试将破坏性操作限定在新建的本次隔离容器；runtime 测试会只读识别 Identity 来源，policy 集成会只读识别 Identity、People、Conversations 与 Memories 来源，不读取或修改源库业务正文。最终五库验收仍须独立执行 `drill`，核对数据／角色／迁移摘要、恢复凭据与任务不可执行、损坏拒绝、源库未变及临时目标清除。

R01 世界迁居的定向恢复反例可单独运行：

```powershell
node --test --test-name-pattern='real (People world|Conversations quarantine)' deploy/recovery/policy.integration.mjs
```

People 合成数据覆盖 A → B → A 的两条成功迁居、不可变约束、空快照拒绝、历史删除差异以及隔离前后当前世界／世界版本／事件正文不变。`person_world_movements` 以 `world_version` 纳入 `person_world_movement` 资源摘要，状态仅表示已经提交的 `committed`，不向摘要或报告返回世界快照正文。Conversations 覆盖 queued／running 任务阻断、成功任务完整证据保留、所有状态的 `world_context_ref` 不被隔离改写，以及成功引用被更正时检查点能检出差异。它们验证隔离策略与真实数据库约束，不代替五库原生 dump／restore 演练。

### 本次验证记录（2026-11-12）

- 完整演练：备份 `20261112011710052-67ed34e8`，运行 `fba179cd4c764551`，覆盖五库中的 120 张表的数据摘要以及队列状态、迁移和角色／权限核对；八份配置只校验、不应用。四业务库及 Logto 旧凭据／任务隔离断言全部通过，保留的业务原文及授权历史摘要未变。
- `drill-fba179cd4c764551.json`：`completed=true`、`sourceUnchanged=true`、`cleanupComplete=true`，`releaseReady=false`。各域隔离断言见同目录 `restore-fba179cd4c764551.json`；产物只存在本机忽略的 `.tmp/recovery-dev/archives/<backupId>/`，不提交到仓库。
- 无 Docker 的加密／检查点／策略／故障注入测试 20 项通过；真实 runtime 集成 1 项通过；真实约束与索引条件反例集成 3 项通过。错误 GCM tag 不执行恢复 SQL，创建中断仍清理孤儿，清理失败不能标记成功。
- Logto 的两个部分索引在原生 dump／restore 后出现数组类型转换的等价反序列化写法。现在使用同版本 PostgreSQL 的 `EXPLAIN (FORMAT JSON, VERBOSE, COSTS OFF)` 归一谓词，未执行 `ANALYZE`；索引主体仍严格比较。真实反例确认不同常量、AND／OR／NOT 和混合优先级仍能检出，不通过删除 SQL 词元放宽校验。

此记录是本机特定数据及版本的演练证据；后续资料变化、迁移或运行环境变化，应按实际影响重新生成备份与检查点并验证。

新增自动记忆后的复验（2026-11-12）：Identity 006／People 006／Conversations 004／Memories 005 已应用，再次执行完整五库演练。备份 `20261112024829390-db872442`、运行 `656f123c69bb4356`，覆盖 126 张表及队列状态；`completed=true`、`sourceUnchanged=true`、`cleanupComplete=true`，`releaseReady=false`。自动来源、条目、收据和成功任务的原文／来源摘要保持不变，自动任务亦纳入不可执行断言。对应 `drill-656f123c69bb4356.json` 与 `restore-656f123c69bb4356.json` 仍只在本机忽略目录。扩展策略单元及故障测试 21 项通过，合成真实约束另外验证 queued／running／failed 自动任务阻断及 pre005 兼容，不以实际库中恰好没有排队任务代替该反例。

R01 世界迁居的恢复增量（2026-11-12）：新增 People `007_world_movements.sql` 与 Conversations `005_virtual_world_context.sql`。初始人物的 `world_version=1` 不补造迁居；既有聊天任务的 `world_context_ref` 保持 NULL，不伪造旧回复曾使用的新世界依据。迁居行、当前世界版本及新聊天实际引用必须随原生备份一同恢复，隔离操作不重写迁居历史或引用正文。恢复旧包保留该包的准确迁移边界，不在恢复器内自动运行当前迁移或启动新版服务；若以后计划启服，应另行完成缺失迁移、最新删除／撤权回放及对应版本验收。

本轮策略单元测试 6 项通过，R01 定向真实隔离数据库测试 2 项通过，临时目标已清理。原页面实际完成往返迁居、三轮真实模型回复及 OTP 导出后，暂停本机写入并执行新五库原生 `drill`：备份 `20261112043751343-343a9d71`、运行 `b69c987296fb45eb`，共 127 张表（Identity 16、People 10、Conversations 8、Memories 14、Logto 79）。每库 `rawSnapshotVerified/checkpointMatches=true`；总报告 `completed=true`、`sourceUnchanged=true`、`cleanupComplete=true`、`releaseReady=false`，受限副本策略通过。原迁居事实、当前世界版本及成功聊天世界引用随新包恢复并完整保留，临时容器全部清理。报告仍只在本机忽略的 `.tmp/recovery-dev/archives/20261112043751343-343a9d71/`；完成源库稳定性核验后已重启本机 Logto、四个 API 与四个 Worker。上面的 126 表记录仅保留为前一批迁移的历史证据。

当前不覆盖：对外恢复切换、持续 WAL/PITR、异地存储、RPO/RTO 承诺、备份到期保留策略、完整供应方登录恢复、生产角色/密钥轮换和旧用户资料导入。正式放行需要更新的可信变更记录、各域删除回放、独立密钥与供应方/客户端复验。

私人动态增量复验（2026-11-12）：Identity 007／Social 001 已应用，Social 独立数据源纳入当前备份，配置归档扩展到十份；精确兼容旧五库包，旧包不会凭空出现 Social 数据。新增 Social 的帖子、评论、点赞、迁居来源与同步水位、账号擦除门闩均进入资源摘要及正文保持检查。恢复只作用于本次 owned、无网络／端口的 tmpfs 容器，不启动 Social API 或自动同步，不应用备份配置。

原空间、五域导出及另一专用合成账号的五域实际注销通过后，暂停本机写入执行完整六库原生演练：备份 `20261112071854532-dbe3cdcf`，运行 `b1f9d155d41447f8`，共 135 表（Identity 16／People 10／Conversations 8／Memories 14／Social 8／Logto 79）。六库 `rawSnapshotVerified/checkpointMatches=true`；总报告 `completed/sourceUnchanged/cleanupComplete=true`、`releaseReady=false`。临时副本已清理，源服务已恢复，原 UI 再次确认三条动态、四条评论、正式迁居及同一珍藏／人物均可回读。删除旧合成账号的围栏保留，新合成账号不受影响。

珍藏回响增量（2026-11-12）：Memories `006_social_memory_sources.sql` 的逐事件 ack、Social `002_memory_echo.sql` 的来源／receipt／任务及独立 pg-boss 队列已纳入恢复。保存实际模型回响、两轮人物回应及修订后的回响后，在 AI 已撤回的状态暂停十个源 API／Worker 和 Logto 应用，执行六库完整演练。备份 `20261112092939802-8756a7f4`、运行 `0e29aad51b3d41eb`，共 **139 表**（Identity 16／People 10／Conversations 8／Memories 15／Social 11／Logto 79）；各库 `rawSnapshotVerified/checkpointMatches=true`，总报告 `completed/sourceUnchanged/cleanupComplete=true`、`releaseReady=false`。模型成功任务及其世界／记忆／评论谱系保持不变；隔离目标不启服、不调用模型，临时容器已清理。Logto 和十个源进程已恢复运行。

回响定向验证另覆盖 queued／running 任务与原始来源谱系：恢复相关单元测试 25 项、Social 原生隔离目标测试 1 项通过，不依靠本次实际库中恰好没有排队任务来证明阻断能力。以上仍为本机隔离演练，未完成生产切换、异地备份或新检查点之后的删除／撤权重放，不可用于生产放行。

### 私人照片与对象字节增量（2026-11-13）

新增 Media PostgreSQL 来源及私有对象归档，两者必须同时存在；仅七库 dump、缺图片字节的包会在起恢复目标前拒绝。对象来源限定正式 `xijie-media-dev-object-store-1` 的项目／服务标签、固定 SeaweedFS 4.53 镜像及回环8333端口；SDK只读列举和读取，逐对象记录键、大小、内容类型及SHA-256，备份前后全量核对。每对象独立AES-GCM加密，清单存入已加密index；Media ready元数据必须与实际对象一致。现工具支持最多1000对象、单对象11MiB、总计256MiB，超过明确失败，不静默截断。

对象恢复先在宿主内存认证全部密文，不落宿主明文文件，再启动准确源镜像ID的临时 S3：`network=none`、只读根、仅tmpfs、无端口／宿主绑定卷、随机新凭据。Node22字节校验容器共享该隔离命名空间，经短期签名 PUT／GET 恢复并回读全部对象，逐字节hash和完整清单相同且匿名读取拒绝才完成；不使用源凭据、不启动业务。两个角色使用独立 `xijie.recovery.objects.run` 标签，失败也核验身份并清理，`cleanup --run` 同时覆盖PG和对象目标。Media数据库上传槽撤销、未完成任务阻断，成功成品／来源／清理谱系保持；旧五／六库包仅恢复当时已有内容。

在实际九图／纯图、未知响应重试、撤回／重授与六域图片导出后，暂停十二个 API／Worker 及 Logto 应用执行完整演练：备份 `20261113021602406-57b87d65`，运行 `670114e130cb4b07`。共 **148表**（Identity16／People10／Conversations8／Memories15／Social12／Media8／Logto79），七库 `rawSnapshotVerified/checkpointMatches=true`；实际 **10张成品、80656字节**的对象恢复 `rawSnapshotVerified/checkpointMatches/anonymousReadBlocked/networkIsolated/cleanupComplete=true`。总报告 `completed/sourceUnchanged/cleanupComplete=true`、`releaseReady=false`；源数据库和对象清单未变，临时目标清理。源服务恢复后，原页删帖、再导出及真实合成账号注销／S3清理已补验，旧合成账号文字路径只读回归通过。

定向覆盖另包括真实Media隔离PG1项、Media策略2项、对象清单／密文篡改及真实隔离S3往返3项。原九图和实际对象恢复不能代表生产对象存储备份、异地恢复或最新删除／撤权回放已通过。

加密／检查点／域集合兼容等无 Docker 测试 23 项通过；Social 真实隔离数据库定向测试一项另验不可改迁居投影、评论删除差异、计数、正文保持与擦除后迟到写入拒绝。报告仅保存在本机忽略的 `.tmp/recovery-dev/archives/20261112071854532-dbe3cdcf/`。这些记录没有放行生产恢复、跨库原子撤权或旧包最新删除回放。

### 人物照片关联增量（2026-11-13）

People008 的 `person_draft_media` 与 Media002 的 `media_person_grants` 纳入完整快照及逐资源检查点。`person-photos.mjs` 对每个有效来源核对同账号、稳定草稿目标、连续 1–6 位置、媒体版本、active grant、图像元数据，以及 `ready/{accountId}/{mediaId}/{attemptUUID}` 路径归属、WebP MIME、大小及实际对象摘要。旧包缺人物照片表时返回明确的 legacy 边界，不补造能力。封装备份前重新核对所有域和对象完整快照，拒绝顺序 dump 期间的跨域漂移；这仍不宣称跨库原子快照。

原 UI 六图保存／确认／替换与撤权状态导出之后，完整恢复运行 `18f1f1d3f7a64860` 已验证七库 **150表**、**7对象／56832字节**和 **6条当前人物照片引用**。数据库与对象原始快照、检查点、对象匿名访问拒绝和网络隔离均通过，临时目标清理完成。完整 drill 的 `completed/sourceUnchanged/cleanupComplete=true`，源服务已恢复；`releaseReady=false`，未代替生产或真机验收。

原生行为参考：[pg_dump](https://www.postgresql.org/docs/16/app-pgdump.html)、[pg_restore](https://www.postgresql.org/docs/16/app-pgrestore.html)、[PostgreSQL 17 恢复工具](https://www.postgresql.org/docs/17/app-pgrestore.html)。


## R02八库验证记录（2026-11-13）

备份 `20261113045830251-d0039699`，演练 `bf3862fc8ce64e7a`：八库160表，raw快照／迁移／约束／检查点一致，源数据库和对象未变，临时目标全部清理，releaseReady=false。Gifts交叉验证3批次、4交易、6分录、4回执与4聊天卡，核对同账号People和Conversation、不可变快照、时间、资金来源与分录。副本全部可执行Gifts任务被阻断而业务内容保留。该时点对象数为0；实际S3字节另有两对象隔离测试和此前K02七对象演练，当前空包不扩张图片结论。恢复后本机14个业务API／Worker重启，再经原入口注销本轮合成账号并回查擦除。本包早于该注销，保持隔离，不自动回放最新删除或对外启服。


## R02真实回礼恢复增量（2026-11-13）

Gifts002的新来礼、生成来源、投影任务、通知和永久操作回执纳入快照；恢复保留原opened/placement/readAt与实际模型证据，只阻断未完成执行任务。新增sourceDelivery→真实OpenAI任务→received→incoming以及通知event/owner/object/person引用检查；旧包无新表维持明确旧边界，半schema拒绝。配置归档包含回礼部署开关／名单，恢复副本始终不启动模型。

完整包 `20261113054832326-037646c4`、run `61dc9c9e97fa4f4a` 验证八库165表，1源寄件、1真实生成任务、1来礼、2聊天卡与2通知交叉一致。raw/checkpoint/sourceUnchanged/quarantine/cleanup通过，releaseReady=false；对象0不扩张此前图片字节验收。43项恢复检查通过，1项默认runtime跳过由本次实际隔离PG覆盖。15个本机API／Worker恢复后，原UI注销测试账号并核对新增数据擦除，随后关闭回礼AI测试开关与名单。本备份早于该注销，保持隔离，不自动恢复最新授权、删除或对外启服。


## R01 围坐恢复实现边界

Identity `015_person_gather_replies.sql` 与 Conversations `010_gather.sql` 纳入原生快照；`gather_reply_jobs/gather_reply_participants/gather_reply_slots` 形成完整表组，旧包没有该组时保留旧边界，半套 schema 明确拒绝。资源检查点以 job ID 及 job／person 复合身份覆盖名单与槽。`gathers.mjs` 交叉验证同账号世界会话、固定名单顺序与数量、源消息／永久请求／受理事件、每人唯一实际回复及提交事件、父状态与槽状态、历史人物／迁居版本和捕获授权。

来源验证读取记忆身份与版本元数据，不读取其他人物私有记忆正文。直接私有引用须属于当前槽人物；旧共享回复继承的引用保留原 owner，且消息／记忆依赖须完整闭包、版本和旧 AI 授权相容，未参与轮次不能伪装直接输入。已保存的合法历史允许人物后来迁出或移除、来源后来删除或更正、用途后来撤回；这些变化不能被误判为当时提交非法，也不授权恢复执行。

隔离策略保留消息、固定名单、成功回复及全部来源，把 `queued/running/failed` 父任务和槽转为 blocked，未完成槽清除 attempt／lease、禁止重试，并清空物理围坐队列。已有 blocked／canceled 保持终止，不重跑成功槽；恢复账号继续受限。本节仅说明实现与校验范围，原 UI、真实模型和本轮原生恢复的完成状态由各自实际验收记录确认。

## R01书信恢复实现边界

Identity `014_private_letters.sql` 的独立用途历史与 Conversations `009_letters.sql` 的 `letters/letter_reply_jobs/letter_replies/letter_read_cursors` 纳入各域原生快照和资源检查点。`letters.mjs` 交叉核对同账号人物、受理时的保存／回信／故事授权及告知绑定、原请求摘要和永久命令、原信与任务唯一关系、PostgreSQL 时区规则计算的预约时点、已提交回信及其事件和精确序号、人物／世界来源与模型来源、单调已读游标。旧包没有书信四表时保持原范围；只存在部分表则拒绝恢复校验。

隔离策略保留原信、实际回信、已读位置和成功任务来源；把 `queued/running/failed` 书信任务转为 `blocked / RESTORE_REVIEW_REQUIRED`，清除 attempt 与租约并禁止重试，物理书信队列与其他生成队列一起清空。已有 blocked／canceled 状态保持终止，不自动补跑预约或再次调用模型。本节仅说明实现，具体演练结果应以对应包的完整报告为准。

## R02旅途留影恢复增量（2026-11-13）

Gifts003独立照片状态和永久命令、Media003不可变目标及复合 `media_id:photo_version` grant 纳入快照／检查点。`gift-photos.mjs` 联结同账号、已抵达寄件、有效人物、当前照片版本、媒体版本、grant、WebP元数据、对象路径与已验证实际字节；每份照片须保留从v2到当前版本无洞无重复的永久命令链，并复算原请求SHA256，最新命令必须指向当前图片。历史图片可被GC，命令不得丢失。缺旧表包保持明确旧范围，半schema拒绝。普通撤权不能使GC或恢复误判来源删除。

本轮还修复隔离Seaweed启动时创建桶成功但尚不可读的时序问题：恢复写入前要求相同签名list操作成功，初始化NoSuchBucket仅有界重试，其他权限错误仍立即失败；原生两对象测试通过。

完整包 `20261113063445923-e27544a4`、run `102f3cf3db864108`：八库168表、2对象33474字节，当前1条留影／1源寄件／1聊天卡／1抵达通知，永久版本链与字节交叉一致。raw/checkpoint/coreContent/sourceUnchanged/quarantine/cleanup通过，匿名对象访问被拒绝，releaseReady=false。恢复检查49项通过，1项默认runtime跳过由本次实际PG演练覆盖。15个本机API／Worker重启并核对后，经原入口注销本轮合成账号；只读数据库与实际S3核对新增私人行和对象均清空。本包早于注销，仍为加密隔离包，不自动回放最新删除或对外启服。

## R01 书信原生恢复记录（2026-11-14）

完整包 `20261114051928062-8b43d2f1`、run `ad5a4f21974a4c27`：八库172表，包含专用合成账号的4封原信、1封已提交真实AI回信、2个回信任务和1个已读游标。备份时其中1个任务成功、1个真实未来预约尚未到期；本包私有对象清单为空（0对象／0字节），不据此重复声称非空图片字节验收。

全部数据库rawSnapshot／checkpoint通过，书信受理授权、永久命令、不可变来源版本、PostgreSQL预约时点、人物／世界来源、实际模型来源、事件及游标交叉核对通过。隔离副本的正文与成功来源不变，未来任务被阻断，物理队列清空；源库和对象存储未变，所有临时副本清理完成。仍为`releaseReady=false`，不会启服或自动重新调用模型。源服务已恢复，专用账号后续的真实到期、撤权和注销验收见[书信验收记录](../../docs/backend-api/conversations-memories.md)。

本轮恢复回归59项通过、1项默认原生测试跳过；上述实际八库演练单独覆盖了本次原生路径。备份反映本节所述时点，之后的到期回信、撤权或注销不自动写回旧包，恢复放行仍须更新检查点并处理新删除／撤权依据。

## R01 围坐原生恢复记录（2026-11-14）

完整包 `20261114090311756-4bded046`、run `df5fb9299e964325`：八库175表，包含专用合成账号的4个围坐父任务、8个固定人物槽及6条已提交真实回复。新增三表、统一会话消息、同账号世界与历史人物／迁居版本、固定名单、各自记忆引用及跨轮共享回复的完整继承闭包均进入核验。

全部数据库 rawSnapshot、checkpoint、quarantine、sourceUnchanged 与 cleanup 均通过。隔离副本保留正文、固定名单、已成功回复及其来源，未完成父任务／槽被隔离，物理派发清空；源库未变，临时副本已清理，仍为 `releaseReady=false`。这次实际原生演练与纯校验测试分别成立，不代表可对外启服或生产切换。

备份反映上述时点，不包含之后发生的撤权、迁居、删除或注销变更。本轮原入口注销及独立擦除回读随后已完成：63 张私有表、3 个物理队列的该账号剩余记录为零，七域删除回执及身份提供方删除回执完成，必要删除围栏保留。上述旧备份和受保护的本机证据不属于此次业务账号擦除结论；旧包不自动覆盖最新状态，也不会因重新授权恢复旧槽。原页面的真实模型、未知回包重放与七域导出证据见[围坐记录](../../docs/backend-api/conversations-memories.md)。


## R01 聊天单图原生恢复记录（2026-11-14）

完整包 `20261114104445859-41c39254`、run `95230d1e8931473c`：八库178表及实际对象存储。专用合成账号有4条原消息、3份图片引用／独立任务、1份真实视觉回复，其中源图片一条已删除、2份图片仍有效。`chat-photos.mjs`核对受理命令及哈希、来源／任务、历史精确授权、模型来源、Media目标／grant及归档实际字节；只读取消息长度和必要元数据。

rawSnapshot、checkpoint、quarantine、sourceUnchanged、对象恢复及cleanup全部通过。未完成photo任务的隔离逻辑保留attempt_count、接受事实、回复和来源，清除租约及物理派发；本次真实源任务为1 succeeded、2 blocked，队列隔离、可执行租约和预算变异另有专项反例。完整恢复回归78通过、1默认跳过的原生测试由本次实际演练补足。仍为 `releaseReady=false`，未正式发布或执行生产切换。

之后原UI撤四项授权导出七域并注销，68张私有表／相关物理队列／7个已知对象key与账号前缀／实际Logto用户无该账号残留；源服务15角色恢复、专用模型scope移除。加密旧备份和受保护验收档案保留，不属于在线账号擦除结论；旧包不能替代最新删除／撤权检查点。真实效果、脚本失败保留与完整范围见[单图验收](../../docs/backend-api/conversations-memories.md)。
# 明确虚拟行动恢复增量（2026-11-14）

`person_world_events`是Conversations内正式虚拟叙事与经历摘要权威；事件、源消息、回复、行动任务、永久命令和Outbox必须关联一致。`world-actions.mjs`只读取关联元数据、SQL内计算的文字长度／引用命中／请求哈希，核对历史story／AI／world授权与告知、人物和迁居版本、事件及私有记忆谱系。`generation_jobs:provenance`覆盖所有状态，隔离不得更改捕获授权、尝试预算、上下文引用或模型出处；新用途未决任务仍沿原会话队列隔离，不增加部署角色。支持旧未含该片的包，部分schema失败关闭。

实际备份`20261114132309065-8a7ef0f4`、run`ba1ee50dfec4405c`通过八库179表及对象恢复；9个行动任务、1个正式事件、8份实际回复的引用验证通过，源未变、临时副本清理，`releaseReady=false`。该源包括初稿语义失败的普通回复、新提示修订后的事件和模型前阻断的未知受理任务；不把任务领取次数1说成模型调用1。恢复90项回归通过，默认跳过的原生项已由此实际演练补足。

后来已完成事件源删除、两份七域导出及原UI账号注销，69张私有表／队列／对象前缀／实际Logto用户清理核查通过。加密历史备份和ACL保护的验收档案保留，未来恢复发布必须应用这份备份之后的删除与撤权检查点；本地演练不等于生产恢复放行。详情见[当前会话验收](../../docs/backend-api/conversations-memories.md)。

## R01 分支／离线生活与 M01–M03 恢复增量（2026-11-15）

本轮快照与检查点覆盖 Identity020/021、Conversations013、Memories007、Social004、Gifts004/005/006。新增域校验分别由 `story-controls.mjs`、`referrals.mjs`、`shared-albums.mjs` 与 `gifts-commerce.mjs` 执行；普通备份源和恢复目标均执行同一关联核对，不能只验证隔离副本。资源检查点覆盖业务永久命令、授权、来源版本、派发事实、已兑现回执及完整记忆谱系。

- 邀请保留归因与双方已到账回执，撤销可用链接、关闭未消费意图并清除认证绑定；不删除被既有归因引用的链接和意图。
- 分支和离线未完成任务阻断为 `RESTORE_REVIEW_REQUIRED`，清除可执行租约、禁止重试；离线计划关闭。已提交正文、分叉场景、来源闭包、计划快照、模型出处和实际尝试预算保持不变。
- 相册采纳、奖励和来源清理以独立 `recovery_blocked` 隔离。原状态、派发未知结果、回执和并发注销等待账号不被改写；隔离清理不能谎报注销成功。
- 购买只隔离对账任务，保留订单、渠道证据、已发行批次和退款预留；不能将未知付款改为失败或释放未知退款的预留。物理任务队列统一清空，恢复副本不会自动调用模型、领奖或重试渠道请求。

实际备份 `20261115080612921-9d23e139`、run `67ba0e7be42440a2` 已通过八库 **210 表**：Identity22、People11、Conversations24、Memories16、Social19、Media11、Gifts28、Logto79。全部 rawSnapshot、checkpoint、核心内容、隔离断言、跨域来源验证通过；八个源数据库及对象存储未变，临时容器和对象副本清理完成，`releaseReady=false`。本次对象清单为 0 对象／0 字节，不重述为非空媒体字节验收。

源快照包含真实合成账号的 2 分支、5 条分支消息、3 分支任务、1 分支事件、1 离线计划和 1 已提交真实离线经历；主线世界事件共 3 条。邀请含 1 已兑现归因和双方回执；相册含 1 投稿、5 参与决定、1 采纳记忆及其永久回执、1 奖励领取。Gifts 的 3 个 promotion 批次、3 笔交易、3 条贷记逐一对应两份邀请券和一份相册券。当前无商户，因此订单、付款证据和退款均为零；非空购买核心由隔离 PostgreSQL 测试验证，本次八库演练不能替代真实商户付款或退款验收。

恢复回归 127 项通过，1 项默认跳过的原生测试由本次实际演练单独覆盖。演练期间暂停 16 个源 API／Worker，完成后逐个恢复且无重复角色。备份早于本轮后续删源、撤稿和注销；加密历史包及受保护验收档案保留，恢复发布仍须处理之后的删除／撤权检查点。实际用户路径与最终清理结果分别见[会话记录](../../docs/backend-api/conversations-memories.md)和[邀请／共创记录](../../docs/backend-api/assets-commerce.md)。

### 自建收银台 Gifts007 增量（2026-11-15）

付款链接、其时限和商户绑定为不可变来源；对账累计错误预算和永久截止时间纳入 `gifts-commerce.mjs` 校验。恢复隔离不得改写原付款入口、原merchant绑定、实际尝试或错误预算，也不能延长截止时间；只阻断可执行工作。导出不含付款链接，原生加密备份及来源校验仍需保存它。JeePay真实hash路由可保留，其他URL必须满足HTTPS／非生产loopback、无嵌入账号密码及精确来源规则。旧包没有新列时维持原三次预算，新包须完整满足错误／期限／商户形状约束，部分新元数据拒绝。

最终统一恢复131项中130通过、1默认原生跳过；购买来源／隔离10项专项通过，覆盖商户绑定和链接／截止预算反例。本增量只在本机迁移007、重启Gifts三角色并确认购买关闭，没有再次运行八库原生演练或支付网关备份恢复。上述210表演练仍对应其原时点，不扩写为已经包含新增有效付款链接、真实支付／退款或完整JeePay／Hyperswitch数据。两套网关的独立数据库、密钥及对象备份／恢复需在其实际部署后另行验收。

### 本地补齐模块的恢复隔离

Identity022 的昵称永久命令、023 的每日模型尝试预算及授权／尝试事实、024 的报告命令／审核审计，People009 的结构资料及010的提醒设置／已生成通知／命令，Social005 的审核动作和 Gifts008 的人工对账／最小财务留存均纳入资源检查点。新增表组只允许完整存在或保持旧包全无的边界，不能静默跳过部分迁移。

模型每日预算和已领取 attempt 不重置，未完成 lease 仅置为过期，保留原结果及授权；同一 attempt 无法重领。报告只将 reviewing 的恢复执行标志关闭，原决策、审核人、受理 actionKey、版本和哈希保留；open/resolved 不被冒充已处理。提醒设置关闭且 next_check_at 清空，保留时区、授权、通知去重记录和历史通知，不补发旧生日／相见提醒。财务运行命令隔离为明确 RESTORE_REVIEW_REQUIRED，已完成审计保留；所有未成功对账及留存 archive 均设置不可自动清除的 recovery_blocked，普通 worker、回调、operator CLI 和过期清理都不能复活旧财务操作或提前删除 archive。相册 moderate 的永久命令／审核人／版本指纹与被撤内容的后续清理闭包一起验证。

隔离 PostgreSQL Gifts84、Identity84，以及恢复135通过／1默认原生跳过已验证这些本地变化；该结果不代表新表已迁移源服务，也不代表已再次执行包含这些增量的八库原生恢复。发行地区、正式财务留存期限、实际支付渠道和生产发布仍需单独配置和验收。

