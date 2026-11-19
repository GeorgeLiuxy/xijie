-- Letter storage and requested AI replies are independent purposes. Published policies and grants are immutable.
ALTER TABLE policy_versions DROP CONSTRAINT policy_versions_kind_check;
ALTER TABLE policy_versions ADD CONSTRAINT policy_versions_kind_check CHECK(kind IN ('privacy_notice','private_story_storage','ai_text_processing','private_photo_storage','private_person_photo_storage','virtual_gift_storage','person_gift_returns','gift_delivery_photo_storage','private_letter_storage','person_letter_replies'));
ALTER TABLE consent_events DROP CONSTRAINT consent_events_purpose_check;
ALTER TABLE consent_events ADD CONSTRAINT consent_events_purpose_check CHECK(purpose IN ('privacy_notice','private_story_storage','ai_text_processing','private_photo_storage','private_person_photo_storage','virtual_gift_storage','person_gift_returns','gift_delivery_photo_storage','private_letter_storage','person_letter_replies'));
ALTER TABLE consent_events DROP CONSTRAINT consent_events_check;
ALTER TABLE consent_events ADD CONSTRAINT consent_events_check CHECK((purpose='privacy_notice' AND decision='acknowledge') OR (purpose IN ('private_story_storage','ai_text_processing','private_photo_storage','private_person_photo_storage','virtual_gift_storage','person_gift_returns','gift_delivery_photo_storage','private_letter_storage','person_letter_replies') AND decision IN ('grant','revoke')));
ALTER TABLE consent_events DROP CONSTRAINT consent_events_ai_notice_binding;
ALTER TABLE consent_events ADD CONSTRAINT consent_events_ai_notice_binding CHECK(CASE
 WHEN purpose IN ('ai_text_processing','private_photo_storage','private_person_photo_storage','virtual_gift_storage','person_gift_returns','gift_delivery_photo_storage','private_letter_storage','person_letter_replies') AND decision='grant' THEN notice_authorization_version IS NOT NULL AND notice_authorization_version>0
 WHEN purpose='private_story_storage' AND decision='grant' THEN notice_authorization_version IS NULL OR notice_authorization_version>0
 ELSE notice_authorization_version IS NULL END);

INSERT INTO policy_versions(id,kind,version,document_zh_cn,document_en) VALUES
('ddf34724-4784-4234-9256-d5e21cd1d742','private_letter_storage',1,
'西界书信保存授权

这是独立的私人书信保存授权，不扩大已有文字、AI、照片或赠礼许可。允许后，西界按当前账号保存你主动写给虚构人物的原信、另行允许并实际生成的回信、回信时间偏好与预约时点、已读位置和必要的来源记录，供原人物信匣和来信提示使用。保存和阅读书信不要求 AI 授权；选择不回信时只保存原信，不建立模型任务。
本授权不允许模型处理。请求即时或预约 AI 回信还须单独允许「AI 书信回信」，并具有读取人物必要文字资料的私人文字保存权限。没有真实服务回执或模型结果时，不会把本地动画或模板作为保存、回信成功。
你可以单独撤回书信保存授权，停止普通书信读取、新保存及未完成的回信处理。撤回不是删除；重新允许后可按人物当前权限查看仍有效的已保存原信和回信，但不会恢复旧授权下的任务或重新生成旧信。单独撤回 AI 回信授权不会阻止你按本授权阅读已提交的回信。
无需重新允许书信或 AI 用途即可通过独立资料导出取得原信、实际回信、排程与来源记录，或随账号注销清理。擦除清理书信、回信、已读位置、任务、排程和相关操作记录，仅保留防复活所需最小收据。本范围不含照片、公开分享、其他账号通信、推送或自动记忆。仅用于虚构人物和合成资料的本机开发验证，不表示生产发布或灾备验收。',
'Xijie private letter storage permission

This independent permission does not expand existing text, AI, photo or gift permissions. Xijie may store letters you actively write to fictional characters, replies actually generated under separate permission, reply preferences and scheduled times, read positions and necessary provenance under your account for the existing letter box and incoming-letter indicator. Saving and reading letters do not require AI permission. Choosing no reply stores only your letter and creates no model job.
This permission does not authorize model processing. Requesting an immediate or scheduled AI reply also requires independent AI letter reply permission and private text storage permission to access necessary character text. Local animations or templates are never treated as successful saves or replies without an actual service receipt or model result.
You can independently withdraw letter storage permission to stop ordinary letter reads, new saves and unfinished reply processing. Withdrawal is not deletion. Renewing permission permits reading still-valid saved letters and replies subject to current person access, but does not revive old jobs or regenerate old letters. Withdrawing AI letter reply permission alone does not prevent reading committed replies under this storage permission.
Independent export and account erasure remain available without renewing letter or AI permission. Export includes letters, actual replies, schedules and provenance. Erasure removes letters, replies, read positions, jobs, schedules and related operation records, retaining only minimal anti-resurrection receipts. This scope excludes photos, public sharing, communication with other accounts, push notifications and automatic memory. It is restricted to local development with fictional people and synthetic material, not production or disaster-recovery acceptance.'),
('a463e496-1354-4de2-9390-6fc3bf3df1df','person_letter_replies',1,
'西界 AI 书信回信授权（OpenAI 联调）

这是独立的 AI 书信回信用途，不由旧 AI 文字处理或赠礼回礼授权代替，也不要求先授予旧 AI 文字处理用途。实际回信还须具有当前书信保存授权和私人文字保存权限。允许后，仅对你此后主动提交并逐封选择回信的新原信执行一次回信任务；选择不回信的原信不会交给模型。
西界可将本封原信、当前人物的必要文字资料、当前虚拟世界和最近已提交的迁居记录发送至 OpenAI API，生成该人物署名且明确标识为 AI 的回信。虚拟世界和迁居只作为应用内场景，不是真实本人经历；回信不代表真实本人的意识、承诺或行为。不会读取照片、其他原信、原始聊天、珍藏或自动记忆，不自动提炼书信记忆，不执行赠礼、迁居、支付、循环来信或推送。
你可逐封选择服务受理后尽快回信，或所选 IANA 时区内严格晚于受理时点的第一个早上 08:00；08:00 前受理可在当天执行。预约会固定保存 UTC 时点和时区，后续旅行或时区设置不移动它。到期后可在你离线时处理，仅生成本封回信，不形成持续订阅。等待期间使用执行时仍有权读取的当前人物及虚拟世界；来源与授权在模型前后和写回前复核。
每封原信最多保存一份真实回信。模型失败不以模板代替；短暂故障可有限重试，最多三次业务尝试，不承诺外部请求恰好执行一次。请求使用 store:false；保存必要的提供方、模型、响应标识、提示版本及人物、世界、来源引用，不把密钥写入书信记录。已发送给提供方的内容不能靠撤回收回。
你可单独撤回此授权，停止新处理、未完成任务和迟到写回。已提交的原信和回信仍可按书信保存及人物权限阅读；重新允许不会补跑旧信或恢复旧任务。书信保存撤回、原信删除、人物失效或账号注销也禁止旧任务写回。独立导出和注销不要求重新授予本用途。仅用于名单内合成账号的非生产本机验证，不表示正式模型服务或生产发布。',
'Xijie AI letter reply permission (OpenAI sandbox)

This independent AI letter reply purpose is neither replaced by existing AI text processing or gift-return permission nor conditional on granting the old AI text processing purpose. Actual replies also require current letter storage and private text storage permission. Only new letters you actively submit after allowing this purpose, with an explicit per-letter reply choice, create a reply job. Letters with no reply selected are not sent to a model.
Xijie may send this letter, necessary current character text, the current virtual world and recent committed virtual moves to the OpenAI API to generate a reply attributed to that character and marked as AI. Worlds and moves are application scenes, not a real person biography. Replies do not represent a real person consciousness, promises or actions. The purpose excludes photos, other letters, raw chat history, treasured or automatic memories, automatic extraction of letter memories, gifting, moves, payments, recurring letters and push notifications.
For each letter you may request a reply as soon as practicable after acceptance or at the first 08:00 in the chosen IANA time zone strictly after acceptance. A letter accepted before 08:00 may run that same day. The resolved UTC time and time zone are fixed; later travel or settings changes do not move the schedule. Processing may run while you are offline once due, for this letter only, without an ongoing subscription. Necessary current character and virtual-world context is obtained at execution, with source and authorization checks before and after the model call and before commit.
At most one actual reply is saved per letter. Failures never use a template as an AI substitute. Transient errors may retry within a budget of three business attempts; external requests are not promised to execute exactly once. Requests use store:false. Necessary provider, model, response identifier, prompt version and person, world and source references are recorded without secrets. Withdrawal cannot recall material already sent to the provider.
You can independently withdraw this permission to stop new processing, unfinished jobs and late commits. Committed letters and replies remain readable under letter storage and person access. Renewed permission neither backfills old letters nor resumes old jobs. Letter storage withdrawal, letter deletion, loss of person access or account erasure also prevents old jobs from committing. Independent export and erasure do not require renewing this purpose. This is restricted non-production local validation for allowlisted synthetic accounts, not a production model service or release.');
