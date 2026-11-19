-- A separate purpose: never broaden an existing grant or published policy.
ALTER TABLE policy_versions DROP CONSTRAINT policy_versions_kind_check;
ALTER TABLE policy_versions ADD CONSTRAINT policy_versions_kind_check CHECK(kind IN ('privacy_notice','private_story_storage','ai_text_processing','private_photo_storage','private_person_photo_storage','virtual_gift_storage','person_gift_returns'));
ALTER TABLE consent_events DROP CONSTRAINT consent_events_purpose_check;
ALTER TABLE consent_events ADD CONSTRAINT consent_events_purpose_check CHECK(purpose IN ('privacy_notice','private_story_storage','ai_text_processing','private_photo_storage','private_person_photo_storage','virtual_gift_storage','person_gift_returns'));
ALTER TABLE consent_events DROP CONSTRAINT consent_events_check;
ALTER TABLE consent_events ADD CONSTRAINT consent_events_check CHECK((purpose='privacy_notice' AND decision='acknowledge') OR (purpose IN ('private_story_storage','ai_text_processing','private_photo_storage','private_person_photo_storage','virtual_gift_storage','person_gift_returns') AND decision IN ('grant','revoke')));
ALTER TABLE consent_events DROP CONSTRAINT consent_events_ai_notice_binding;
ALTER TABLE consent_events ADD CONSTRAINT consent_events_ai_notice_binding CHECK(CASE
 WHEN purpose IN ('ai_text_processing','private_photo_storage','private_person_photo_storage','virtual_gift_storage','person_gift_returns') AND decision='grant' THEN notice_authorization_version IS NOT NULL AND notice_authorization_version>0
 WHEN purpose='private_story_storage' AND decision='grant' THEN notice_authorization_version IS NULL OR notice_authorization_version>0
 ELSE notice_authorization_version IS NULL END);
INSERT INTO policy_versions(id,kind,version,document_zh_cn,document_en) VALUES
('285a1f8a-ae9b-4db0-93f5-d22db2439833','person_gift_returns',1,
'西界 AI 回礼与来礼保存说明

这是独立的 AI 回礼授权，不扩大已有虚拟赠礼保存或 AI 文字处理授权。需同时允许私人文字保存与虚拟赠礼保存。本阶段仅用于名单内专用合成账号的本机开发验证，不表示生产发布。
允许后，你此后主动寄出并实际送达的新礼物名称、种类、数量和赠言，以及收件人物的名称、关系、对你的称呼和故事，会交给 OpenAI 决定是否回礼、从允许的虚拟礼物目录中选择一件并生成不超过120字的附言。人物资料和赠言只作为引用资料；回礼是 AI 创作，不代表真实本人的意识、承诺或真实物品。模型可以决定不回礼；调用失败不会用模板冒充成功。
本用途不读取照片、聊天历史、珍藏、自动记忆或迁居历史；不把礼物卡片加入普通聊天模型或自动记忆，不执行真实支付、推送、再次赠礼或资产发放。回礼仅为当前账号可拆开、收藏和陈列的私人虚拟物件，不增加邮资、券或可消费库存。
每份新寄件至多保存一份回礼。来礼、附言、来源寄件、人物和礼物快照、生成提供方与模型的必要来源记录、拆开时间、陈列位置和站内通知已读状态保存在当前账号。进入来礼详情会保存拆开状态；通知已读与拆开分别保存。模型请求不要求提供方保存对话（store:false）。
你可单独撤回本授权，停止新处理、未完成任务及正常来礼读取；重新授权不会补跑旧寄件、恢复旧任务或使旧授权版本的来礼重新可读。撤回不是删除，资料仍可通过独立导出取得或随账号注销清理。无需重新允许此用途即可导出和注销，擦除清理来礼、附言、通知、来源记录和任务，仅保留防复活所需最小擦除收据。备份与恢复仅为受限本机演练。',
'Xijie AI gift returns and received gift storage

This independent permission does not expand virtual gift storage or AI text processing permission. Private text storage and virtual gift storage must also be allowed. This slice is restricted to allowlisted synthetic accounts in local development; it is not a production release.
After you allow it, the name, category, quantity and note of new gifts you actively send and that actually arrive, plus the recipient character name, relationship, name for you and story, are sent to OpenAI. The model decides whether to return one gift from the permitted virtual catalog and writes a note of at most 120 Unicode characters. Character details and notes are reference data. A return is AI-created, not a real person consciousness, promise or physical item. No return is a valid decision. Failed requests never fall back to a template presented as AI output.
This purpose excludes photos, chat history, treasured or automatic memories and movement history. Gift cards do not enter normal chat processing or automatic memory. It performs no real payment, push notification, recursive gifting or asset issuance. Received gifts are private collectibles that can be opened, saved and displayed; they do not credit postage, vouchers or spendable inventory.
At most one return is saved per new sent gift. Received gifts, notes, source delivery references, character and gift snapshots, necessary provider and model provenance, opening time, placement and in-app notification read state are saved in this account. Entering received gift details saves the opened state. Notification read and gift opening are separate. Requests disable provider conversation storage with store:false.
You can independently withdraw permission to stop new processing, unfinished jobs and ordinary received gift reads. Renewed permission does not backfill old gifts, revive old jobs or restore ordinary access to results bound to an old authorization version. Withdrawal is not deletion. Export and erasure remain available without renewing this permission. Erasure removes returns, notes, notifications, provenance and jobs, retaining only minimal anti-resurrection receipts. Backup and recovery remain restricted local rehearsals.');
