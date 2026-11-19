-- Independent production authorization. No historical synthetic grant enables release.
ALTER TABLE policy_versions DROP CONSTRAINT policy_versions_kind_check;
ALTER TABLE policy_versions ADD CONSTRAINT policy_versions_kind_check CHECK(kind IN ('privacy_notice','private_story_storage','ai_text_processing','private_photo_storage','private_person_photo_storage','virtual_gift_storage','person_gift_returns','gift_delivery_photo_storage','private_letter_storage','person_letter_replies','person_gather_replies','private_chat_photo_storage','person_chat_image_replies','person_world_actions','person_story_branches','person_offline_life','production_model_execution'));
ALTER TABLE consent_events DROP CONSTRAINT consent_events_purpose_check;
ALTER TABLE consent_events ADD CONSTRAINT consent_events_purpose_check CHECK(purpose IN ('privacy_notice','private_story_storage','ai_text_processing','private_photo_storage','private_person_photo_storage','virtual_gift_storage','person_gift_returns','gift_delivery_photo_storage','private_letter_storage','person_letter_replies','person_gather_replies','private_chat_photo_storage','person_chat_image_replies','person_world_actions','person_story_branches','person_offline_life','production_model_execution'));
ALTER TABLE consent_events DROP CONSTRAINT consent_events_check;
ALTER TABLE consent_events ADD CONSTRAINT consent_events_check CHECK((purpose='privacy_notice' AND decision='acknowledge') OR (purpose<>'privacy_notice' AND decision IN ('grant','revoke')));
ALTER TABLE consent_events DROP CONSTRAINT consent_events_ai_notice_binding;
ALTER TABLE consent_events ADD CONSTRAINT consent_events_ai_notice_binding CHECK(CASE
 WHEN purpose NOT IN ('privacy_notice','private_story_storage') AND decision='grant' THEN notice_authorization_version IS NOT NULL AND notice_authorization_version>0
 WHEN purpose='private_story_storage' AND decision='grant' THEN notice_authorization_version IS NULL OR notice_authorization_version>0
 ELSE notice_authorization_version IS NULL END);

INSERT INTO policy_versions(id,kind,version,document_zh_cn,document_en) VALUES
('25c6497d-f65b-4399-b378-1ac574670f9d','production_model_execution',1,
'西界正式运行 AI 处理授权（OpenAI）
本授权补充正式运行环境，不自动启用任何具体用途，也不沿用本机合成测试许可。正式服务的 AI 文字聊天、珍藏建议、自动长期记忆、私人回响、信件、围坐、看图、明确虚拟行动、故事分支、离线生活及人物回礼，每项仍须单独允许当前版本的对应授权，并满足该用途的来源、保存及范围限制。未允许的用途不会执行。
在你获准的用途内，西界可能把当前人物必要资料（含你确认的人格、生平、口头禅及明确标作未知的事项）、你主动提交的文字或单张获准照片、该用途已授权的有效历史、珍藏、长期线索及虚拟事件交给 OpenAI API 处理。只使用当前账号及当前人物获准的数据，采用 HTTPS、store:false；不允许第三方自定义模型地址，不把未知事项变成事实，也不声称真实意识。照片及看图回复仍不进入后续文字 AI 或长期记忆。
运营方须另行明确启用正式模型执行、配置私有凭据和明确账号范围；本授权不会替运营方开启服务，也不保证每次调用成功。模型调用受全局并发和每账号每日次数限制；失败尝试也可能消耗额度。保存必要任务、真实模型及来源和调用计数，避免重复、迟到或失效来源写入；调用记录不保存提示正文或密钥。
你可随时在隐私设置撤回本授权，停止新的正式模型调用及尚未完成结果写入。撤回不能收回已传给 OpenAI 的内容；重授不会使旧任务自动恢复。其他独立用途授权也可分别撤回。查看、导出、删除个人资料不要求本授权；删除遵循另行说明的保留范围。',
'Xijie production AI processing permission (OpenAI)
This separate permission authorizes the production processing environment. It enables no individual purpose and never inherits a synthetic local test grant. Text replies, treasure suggestions, automatic memory, private echoes, letters, gatherings, image replies, explicit virtual actions, branches, offline life and character gift returns each still require their separate current purpose grants and all source, storage and scope checks.
Only necessary authorized current-account and character data may be sent to OpenAI over HTTPS with store:false: user-confirmed profile, personality, biography and catchphrase, unknowns explicitly labeled as unknown, submitted text or a separately authorized single photo, and the valid history, treasures, memory and virtual events permitted for that purpose. Custom model hosts are excluded. Unknowns are not facts and generated characters are not real consciousness. Photos and image replies remain excluded from later text AI and long-term memory.
The operator must separately approve production execution, private credentials and an explicit account scope. This permission does not activate operations or guarantee responses. Durable global concurrency and daily per-account attempt limits apply; failed attempts also count. Necessary job, model, source and attempt counts prevent duplicate or late writes without storing prompt bodies or secrets in execution records.
Withdrawal in privacy settings stops new production calls and unfinished result commits. It cannot recall data already sent to OpenAI. Regrant does not revive old jobs. Every purpose can also be withdrawn independently. Reading, export and erasure never require this grant, and any separately explained retention still applies.');

-- Refresh each AI-purpose document explicitly; pre-release grants are not reused as current.
INSERT INTO policy_versions(id,kind,version,document_zh_cn,document_en,ai_automatic_memory_enabled,private_feed_enabled,private_feed_processing_enabled,world_event_history_enabled)
SELECT id,kind,version+1,
 document_zh_cn || E'\n\n正式运行版本补充：前文的本机验证或非生产环境限制在本版本由独立的「正式运行 AI 处理授权」及运营正式启用共同控制。前文全部具体用途、来源隔离、保存、撤回和禁止行为规则继续生效。必须重新阅读并单独允许本版本，旧版授权不会自动允许本版本；正式运行还须另行允许当前正式运行 AI 授权。',
 document_en || E'\n\nProduction revision: the prior local-verification or non-production environment restriction is superseded only by the separate current production AI permission AND explicit operator release approval. All specific purpose, isolation, storage, withdrawal and prohibited-action limits above remain in effect. Read and grant this version separately; older grants never authorize this revision. Production additionally requires the separate current production AI grant.',
 ai_automatic_memory_enabled,private_feed_enabled,private_feed_processing_enabled,world_event_history_enabled
FROM (SELECT DISTINCT ON(kind) * FROM policy_versions WHERE kind IN ('ai_text_processing','person_gift_returns','person_letter_replies','person_gather_replies','person_chat_image_replies','person_world_actions','person_story_branches','person_offline_life') ORDER BY kind,version DESC) p;

CREATE TABLE model_execution_days(account_id uuid NOT NULL REFERENCES accounts(id),utc_day date NOT NULL,attempts integer NOT NULL CHECK(attempts>0),PRIMARY KEY(account_id,utc_day));
CREATE TABLE model_executions(
 id uuid PRIMARY KEY,account_id uuid NOT NULL REFERENCES accounts(id),job_id uuid NOT NULL,
 service text NOT NULL CHECK(service IN ('conversations','memories','social','gifts')),
 purpose text NOT NULL,authorizations jsonb NOT NULL,
 claimed_at timestamptz NOT NULL DEFAULT clock_timestamp(),lease_until timestamptz NOT NULL,
 finished_at timestamptz,result_allowed boolean,
 CHECK(lease_until>claimed_at),CHECK((finished_at IS NULL)=(result_allowed IS NULL))
);
CREATE INDEX active_model_executions ON model_executions(lease_until) WHERE finished_at IS NULL;
