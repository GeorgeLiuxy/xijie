# Local Gifts database

Use the dedicated `xijie-gifts-dev` Compose project and private `.tmp/gifts-dev/compose.env`; PostgreSQL listens only at `127.0.0.1:5439`. This stack does not reuse any other domain's database. API, delivery worker and return worker are separate Node processes on the host; only API listens at `3107`.

From the repository root:

```powershell
docker compose --project-name xijie-gifts-dev --env-file .tmp/gifts-dev/compose.env -f deploy/gifts-dev/compose.yaml up -d
pnpm --dir backend/services/gifts install --frozen-lockfile
node backend/services/gifts/node_modules/typescript/bin/tsc -p backend/services/gifts/tsconfig.json
node --env-file=.tmp/gifts-dev/server.env backend/services/gifts/dist/migrate.js
node --env-file=.tmp/gifts-dev/server.env backend/services/gifts/dist/main.js
# Run the worker in a separate hidden process:
node --env-file=.tmp/gifts-dev/server.env backend/services/gifts/dist/worker.js
# Run the return/projection worker as another separate hidden process:
node --env-file=.tmp/gifts-dev/server.env backend/services/gifts/dist/return-worker.js
```

The migration history is checksum protected. The return slice adds Gifts `002_person_gift_returns.sql`, requires Identity `012_person_gift_returns.sql` plus its new People return-context route, and Conversations `008_received_gift_cards.sql`. Migrate each domain with its own configuration; never edit an applied migration. Catalog seeding adds missing approved entries without overwriting modified catalog versions. API and workers never seed wallet balances. Trial issuance is a separately gated synthetic-only CLI described in the service README. Never print private env values or copy them into tracked files.

Keep `GIFTS_AI_ENABLED=false` unless explicitly enabling this slice for a new, dedicated synthetic account. The return worker also requires nonproduction mode, `MODEL_ALLOWED_ACCOUNT_IDS` containing only explicitly approved synthetic UUIDs, `MODEL_BASE_URL=https://api.openai.com/v1`, `MODEL_NAME` and `MODEL_API_KEY` in private configuration. Empty/missing allowlist, a different provider or production mode cannot transmit text. This deployment switch does not grant `giftReturns`: the account must independently allow current person returns, story storage and gift storage. Original captured versions must remain current. The delivery worker enqueues only newly accepted, eligible gifts that actually arrive; enabling the switch or granting later does not backfill earlier gifts. `none` is a real model outcome, failed/expired attempts have a maximum budget of three, and neither outcome fabricates a gift or grants assets.

Identity must include `XIJIE_GIFTS_URL` in its rights configuration, and recovery must include the dedicated Gifts database. With every current service enabled, exports contain seven business domains and native recovery covers eight databases including Logto. Received records, generation sources, notifications and mutation receipts participate in export/erasure; all return/projection work must be quarantined after restore. Older six-domain rights or seven-database evidence does not cover Gifts, and earlier Gifts evidence does not cover new return tables until rerun. Tests use random schemas on the dedicated PostgreSQL service and clean only their schemas. Code and automated checks are complete; real AI/original UI and this slice's native recovery acceptance remain in progress in the root task. Do not run fixture schema tests during a native backup interval.

本片整体验收现已完成：原UI真实OpenAI回礼、收件与通知、撤权后的七域导出、八库165表恢复及合成账号注销清理均通过。测试开关与名单已关闭，仍仅为本机合成验证；详见[交付接续](../../docs/backend-delivery-priorities.md)的2026-11-13回礼记录，替代上文进行中的状态说明。
