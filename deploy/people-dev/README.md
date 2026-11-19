# 人物服务本机联调

本环境用于 K02 文字人物联调，测试内容使用合成资料。人物服务独立运行，拥有专用 PostgreSQL 数据库。身份服务通过内部会话接口确认请求账号与当前文字保存授权。

## 配置与启动

先完成 [本机身份服务配置](../identity-dev/README.md)，并保持 `.tmp/identity-dev/server.env` 中的 Logto 与数据库配置。使用本机随机生成的两个不同 32 字节密钥。密码与服务凭据都用 64 位十六进制格式。

- 在 `.tmp/people-dev/compose.env` 写入 `XIJIE_PEOPLE_DB_PASSWORD=<数据库密码>`。
- 在身份服务的 `.tmp/identity-dev/server.env` 增加 `XIJIE_PEOPLE_SERVICE_TOKEN=<服务凭据>`。
- 在 `.tmp/people-dev/server.env` 写入如下配置。

```dotenv
DATABASE_URL=postgres://xijie_people:<数据库密码>@127.0.0.1:5434/xijie_people
XIJIE_IDENTITY_URL=http://127.0.0.1:3101
XIJIE_PEOPLE_SERVICE_TOKEN=<与身份服务相同的服务凭据>
PEOPLE_WEB_ORIGIN=http://127.0.0.1:5184
PEOPLE_PORT=3102
```

从仓库根目录运行。

```powershell
docker compose --project-name xijie-people-dev --env-file .tmp/people-dev/compose.env --file deploy/people-dev/compose.yaml up -d --wait
cd backend/services/people
pnpm install --frozen-lockfile
pnpm build
node --env-file=../../../.tmp/people-dev/server.env dist/migrate.js
node --env-file=../../../.tmp/people-dev/server.env dist/main.js
```

运行身份服务的新迁移并重启身份服务。另开一个 PowerShell，在仓库根目录启动联调前端。

```powershell
$env:VITE_XIJIE_AUTH_MODE = 'service'
$env:XIJIE_IDENTITY_URL = 'http://127.0.0.1:3101'
$env:XIJIE_PEOPLE_URL = 'http://127.0.0.1:3102'
pnpm dev --host 127.0.0.1 --port 5184
```

从 `http://127.0.0.1:5184` 登录测试账号，进入原「相见 → 寻找 TA」。通过原来的「称呼」「故事」「时光」「地点」浮层填写文字；称呼页的第二项仍为名字，关系在相认后选择。点「开始寻找」保存并预览，首次保存时分别确认说明和授予文字保存权限。按原「很像 TA → 选择关系 → 加入联系人」进入原会话页，头像或更多进入原资料页。退出后用原账号重登，可恢复自己的草稿和已确认人物。草稿浮层可单独保存；`004_original_seek_fields.sql` 使原坐标文字与最终称呼真正入库，应用迁移后再启动服务。尚未接通的文字会话、媒体、礼物等操作保留原界面与入口，用已有反馈说明当前状态，不生成演示消息或资产。

`003_person_lifecycle.sql` 增加原编辑表单的可选资料字段、移除时间及访问版本。进入原资料页「关于 TA → 编辑」可保存、清空可选字段并重新打开回读。生日采用合法 `MM-DD`，允许 `02-29`。同时修改同一版本时返回冲突，界面保留未保存输入，用户可明确选择重新读取。删除确认后人物从列表、星图及查询中失效；撤回文字保存授权后仍允许移除。该操作为逻辑移除，尚未承诺物理擦除与其他服务的清理。

人物服务测试使用 `XIJIE_TEST_DATABASE_URL` 指向允许创建隔离 schema 的 PostgreSQL 库，构建后运行 `pnpm test`。覆盖修改、清空、生日校验、版本竞争、幂等重试、移除与修改竞态、跨账号隔离、旧确认重放，以及撤权后移除的 HTTP 路径。

R01 当前增量：构建后在本服务运行迁移至 `007_world_movements.sql`，同时按会话服务说明迁移 Conversations 005。Identity 须部署允许 People 凭据只读账号上下文的版本，再重启 People 与 Conversations API／回复 Worker。原「人物资料 → 关于 TA → 所在世界 → 迁往」已真实保存；迁居本身无需 AI、免费且保留人物／直聊／珍藏。迁居首片的完整接口和原 UI／真实模型证据见[迁居契约](../../docs/backend-api/identity-people.md#r01-迁居首片2026-11-12)。上文最初 K02 阶段的文字会话限制已由后续 K03–K05 接通，未接通媒体／交易能力不能生成演示结果。
