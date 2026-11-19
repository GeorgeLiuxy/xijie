-- Existing policy versions and consent decisions remain immutable.
ALTER TABLE policy_versions DROP CONSTRAINT policy_versions_kind_check;
ALTER TABLE policy_versions ADD CONSTRAINT policy_versions_kind_check
    CHECK (kind IN ('privacy_notice', 'private_story_storage', 'ai_text_processing'));

ALTER TABLE consent_events DROP CONSTRAINT consent_events_purpose_check;
ALTER TABLE consent_events ADD CONSTRAINT consent_events_purpose_check
    CHECK (purpose IN ('privacy_notice', 'private_story_storage', 'ai_text_processing'));
ALTER TABLE consent_events DROP CONSTRAINT consent_events_check;
ALTER TABLE consent_events ADD CONSTRAINT consent_events_check CHECK (
    (purpose = 'privacy_notice' AND decision = 'acknowledge')
    OR (purpose IN ('private_story_storage', 'ai_text_processing') AND decision IN ('grant', 'revoke'))
);

-- Bind an AI grant to the exact same-account notice acknowledgement. Re-acknowledging
-- a later notice cannot revive an earlier AI grant at the old authorization version.
ALTER TABLE consent_events ADD COLUMN notice_authorization_version integer;
ALTER TABLE consent_events ADD COLUMN notice_purpose text GENERATED ALWAYS AS (
    CASE WHEN notice_authorization_version IS NOT NULL THEN 'privacy_notice'::text END
) STORED;
ALTER TABLE consent_events ADD CONSTRAINT consent_events_ai_notice_binding CHECK (
    CASE WHEN purpose = 'ai_text_processing' AND decision = 'grant'
      THEN notice_authorization_version IS NOT NULL AND notice_authorization_version > 0
      ELSE notice_authorization_version IS NULL END
);
ALTER TABLE consent_events ADD CONSTRAINT consent_events_notice_reference
    FOREIGN KEY (account_id, notice_purpose, notice_authorization_version)
    REFERENCES consent_events (account_id, purpose, authorization_version);

INSERT INTO policy_versions (id, kind, version, document_zh_cn, document_en) VALUES
(
    '014ab349-a7c7-4764-98ec-c00cbec15e15', 'privacy_notice', 2,
    '西界文字服务联调隐私告知

本环境用于账号、人物资料、文字聊天和珍藏功能的开发联调，请只使用虚构人物与合成测试资料。当前版本不是正式上线服务。
账号身份由独立身份服务验证。西界按当前账号保存你提交的人物资料、聊天、珍藏以及告知和授权记录；其他账号不能读取这些私人文字。
文字保存与 AI 文字处理是不同用途。仅确认本告知不会允许 AI 处理；AI 文字回复和珍藏整理需要你另行允许。你可以在「我 → 设置 → 隐私与 AI 说明」查看并撤回 AI 处理授权，撤回不等于删除已保存的记录。
本轮尚未提供完整数据导出、账号注销及自动长期记忆与世界剧情联动，相关能力仍待后续开发和独立验收。请勿在此环境提交真实私人素材。',
    'Xijie text service sandbox privacy notice

This environment tests accounts, person profiles, text chats and treasured memories. Use fictional people and synthetic test material only. It is not a production service.
An independent identity provider verifies sign-in credentials. Xijie stores the person information, chats, treasured memories and authorization records you submit under the current account. Other accounts cannot read this private text.
Text storage and AI text processing are separate purposes. Acknowledging this notice does not permit AI processing. Text replies and memory suggestions require separate permission. You can review and withdraw AI permission in Me > Settings > Privacy & AI. Withdrawal does not delete existing records.
Complete data export, account deletion, automatic long-term memory and world-story integration are not available in this slice and require later implementation and verification. Do not submit real private material here.'
),
(
    'd26b17f9-a510-4aae-9792-37fe6a347476', 'ai_text_processing', 1,
    '西界 AI 文字处理授权（OpenAI 联调）

允许后，西界可以将当前人物的文字资料、相关聊天和珍藏中与本次任务有关的内容发送至 OpenAI API，生成文字回复或供你编辑确认的珍藏候选，并保存对应结果。
只发送当前账号有权使用且本次任务需要的文字。本授权不包括照片、声音、仿声、视频、公开分享、自动长期记忆或虚拟世界自动剧情。改变提供方或处理范围时需要新的政策版本和你的重新授权。
允许 AI 处理不代表允许文字保存，也不代替资料的其他用途授权。你可以随时在本浮层撤回；撤回后不受理新的 AI 生成，已受理任务在执行和写回时复核授权。已经发送给提供方的内容不能靠撤回收回；本片不承诺即时中止提供方正在执行的请求。
撤回不会删除已有聊天、已生成候选或珍藏；你仍可按其原有权限查看、手写和删除。重新允许不会让撤回前的任务自动恢复。
这是使用合成测试资料的开发联调授权，不代表正式上线的提供方、数据处理和发布要求已经验收。',
    'Xijie AI text processing permission (OpenAI sandbox)

If you allow this purpose, Xijie may send the text needed for the current task from the current person profile, relevant chats and treasured memories to the OpenAI API to generate a text reply or an editable memory suggestion, and store the corresponding result.
Only text available to the current account and needed by the task is included. This permission does not cover photos, audio, voice cloning, video, public sharing, automatic long-term memory or automatic world stories. A different provider or processing scope requires a new policy version and fresh permission.
AI permission does not grant text storage or any other data use. You can withdraw it in this panel. New AI generation is then refused, and accepted tasks recheck permission before execution and writeback. Withdrawal cannot recall content already sent to the provider; this slice does not promise immediate cancellation of a provider request already executing.
Withdrawal does not delete existing chats, generated suggestions or treasured memories. Existing reading, manual writing and deletion continue under their original permissions. Allowing processing again does not automatically resume tasks from before withdrawal.
This permission is for development with synthetic test material and does not certify production provider, data-processing or release readiness.'
);
