-- A distinct photo purpose supplements the text notice; no existing grant is broadened.
ALTER TABLE policy_versions DROP CONSTRAINT policy_versions_kind_check;
ALTER TABLE policy_versions ADD CONSTRAINT policy_versions_kind_check CHECK(kind IN ('privacy_notice','private_story_storage','ai_text_processing','private_photo_storage'));
ALTER TABLE consent_events DROP CONSTRAINT consent_events_purpose_check;
ALTER TABLE consent_events ADD CONSTRAINT consent_events_purpose_check CHECK(purpose IN ('privacy_notice','private_story_storage','ai_text_processing','private_photo_storage'));
ALTER TABLE consent_events DROP CONSTRAINT consent_events_check;
ALTER TABLE consent_events ADD CONSTRAINT consent_events_check CHECK((purpose='privacy_notice' AND decision='acknowledge') OR (purpose IN ('private_story_storage','ai_text_processing','private_photo_storage') AND decision IN ('grant','revoke')));
ALTER TABLE consent_events DROP CONSTRAINT consent_events_ai_notice_binding;
ALTER TABLE consent_events ADD CONSTRAINT consent_events_ai_notice_binding CHECK(CASE
 WHEN purpose IN ('ai_text_processing','private_photo_storage') AND decision='grant' THEN notice_authorization_version IS NOT NULL AND notice_authorization_version>0
 WHEN purpose='private_story_storage' AND decision='grant' THEN notice_authorization_version IS NULL OR notice_authorization_version>0
 ELSE notice_authorization_version IS NULL END);
INSERT INTO policy_versions(id,kind,version,document_zh_cn,document_en) VALUES
('4d4017f4-8ed1-4cf7-986c-fbecf7156637','private_photo_storage',1,
'西界私人照片保存说明与授权

这是文字与私人空间联调告知的新增照片范围，仅在你明确允许后启用，不改变此前的文字保存或AI授权。当前仍为本机开发联调，请仅使用合成测试图片。
允许后，你主动选入私人空间动态的照片会保存到当前账号的私有对象存储，用于自己发布、查看和导出。单帖最多九张图片。照片会校正方向、缩放并转为WebP发布成品，移除原始元数据；临时上传文件在处理、拒绝或到期后清理，不承诺保存原始文件。
这项授权不包含公开分享、其他账号访问、人物画像照片、聊天附件、音视频、仿声、人脸识别或AI图片处理。照片不会交给模型，也不会因图片动态自动生成AI回应。
你可以在原隐私浮层单独撤回照片保存授权，停止新的上传、发布及读取，不影响独立的文字和AI决定。撤回不等于删除；已存资料仍可通过独立数据权利导出或删除，无需重新允许照片或AI。现有JSON导出有大小上限，超过时明确失败，不截断；导出包含实际发布成品，不含已失效来源的旧图片。
删帖先停止图片的新读取，再可靠清理对象；注销账号须完成各数据域与对象清理。已下载或已显示的副本无法远程收回。备份和恢复仍为受限本机演练，旧包可能不含照片；不能据此视为生产发布或灾备完成。',
'Xijie private photo storage notice and permission

This is an explicit photo supplement to the text and private-space sandbox notice. It does not change earlier text-storage or AI decisions. This remains local development; use synthetic test images only.
If allowed, photos you choose for private-space posts are kept in this account in private object storage for your own publishing, viewing and export, up to nine images per post. Processing corrects orientation, resizes and converts to a WebP publication copy, removing original metadata. Temporary inputs are cleaned after processing, rejection or expiry. Original files are not retained as a promised feature.
This permission excludes public sharing, access by other accounts, character-profile photos, chat attachments, audio, video, voice cloning, facial recognition and AI image processing. Photos are not sent to a model and photo posts do not automatically trigger AI responses.
You may independently withdraw photo storage in the existing privacy panel. New uploads, publishing and image reads stop; text and AI decisions remain independent. Withdrawal is not deletion. Independent export and deletion remain available without renewing photo or AI permission. Existing JSON exports are size-bounded and fail explicitly rather than truncate. Exports include actual publication copies, excluding images whose source is no longer valid.
Post removal first blocks new image reads, then reliably cleans objects. Account erasure completes only after all domains and object cleanup. Previously displayed or downloaded copies cannot be remotely recalled. Backup recovery remains a restricted local rehearsal; older packages may not contain photos. This is not production release or disaster-recovery acceptance.');
