-- Person photos are expressly excluded by space-photo v1. Add a distinct decision;
-- preserve every published policy and existing text, AI and space-photo grant.
ALTER TABLE policy_versions DROP CONSTRAINT policy_versions_kind_check;
ALTER TABLE policy_versions ADD CONSTRAINT policy_versions_kind_check CHECK(kind IN ('privacy_notice','private_story_storage','ai_text_processing','private_photo_storage','private_person_photo_storage'));
ALTER TABLE consent_events DROP CONSTRAINT consent_events_purpose_check;
ALTER TABLE consent_events ADD CONSTRAINT consent_events_purpose_check CHECK(purpose IN ('privacy_notice','private_story_storage','ai_text_processing','private_photo_storage','private_person_photo_storage'));
ALTER TABLE consent_events DROP CONSTRAINT consent_events_check;
ALTER TABLE consent_events ADD CONSTRAINT consent_events_check CHECK((purpose='privacy_notice' AND decision='acknowledge') OR (purpose IN ('private_story_storage','ai_text_processing','private_photo_storage','private_person_photo_storage') AND decision IN ('grant','revoke')));
ALTER TABLE consent_events DROP CONSTRAINT consent_events_ai_notice_binding;
ALTER TABLE consent_events ADD CONSTRAINT consent_events_ai_notice_binding CHECK(CASE
 WHEN purpose IN ('ai_text_processing','private_photo_storage','private_person_photo_storage') AND decision='grant' THEN notice_authorization_version IS NOT NULL AND notice_authorization_version>0
 WHEN purpose='private_story_storage' AND decision='grant' THEN notice_authorization_version IS NULL OR notice_authorization_version>0
 ELSE notice_authorization_version IS NULL END);
INSERT INTO policy_versions(id,kind,version,document_zh_cn,document_en) VALUES
('b1829393-dcaf-4d35-9702-e8b08a951d6f','private_person_photo_storage',1,
'西界人物照片保存说明与授权

这是寻找TA与人物资料的独立照片授权，不扩大已有私人空间配图、文字保存或AI授权。当前仍为本机开发联调，请仅使用合成测试图片。
允许后，你主动选入寻找TA草稿或人物资料的照片会保存到当前账号的私有对象存储，仅供你保存、查看和导出。照片是可选资料，每位TA最多六张，首张作为头像；确认人物后继续保留同一组照片，可在资料中替换、选择头像或移除。照片会校正方向、缩放并转成WebP成品，移除原始元数据；临时上传文件在处理、拒绝或到期后清理，不承诺保留原始文件。
这项授权不包含私人空间动态配图、聊天附件、公开分享、其他账号访问、音视频、仿声、人脸识别、仿生重建或AI图片处理。照片与图片字节不会交给模型，不用于生成AI人物画像或回复。文字与AI用途仍需各自独立授权。
你可在原隐私浮层单独撤回人物照片授权，停止新的上传、绑定和读取。撤回不等于删除；已有照片仍可通过独立数据权利导出或注销，无需重新允许照片或AI。移除照片、替换旧照片或移除人物后，失效来源不能继续签发或使用旧读取证明；仅在没有有效引用后可靠清理图片。已下载或已显示的副本无法远程收回。
导出包含仍有效的实际WebP成品、顺序与来源。现有JSON导出有20MiB上限，超限明确失败，不截断。注销须完成各数据域与暂存、成品对象清理。备份恢复仍为受限本机演练，必须同时包含数据库及真实对象；本授权不表示生产发布或真机验收完成。',
'Xijie person photo storage notice and permission

This is a separate permission for Find TA drafts and person profiles. It does not broaden existing private-space photo, text-storage or AI permissions. This remains local development; use synthetic test images only.
If allowed, photos you select for a draft or person profile are stored privately in this account for your own saving, viewing and export. Photos are optional, with at most six per person and the first used as the avatar. Confirmation preserves the same photos; you may replace them, select the avatar or remove them. Processing corrects orientation, resizes and converts to WebP, removing original metadata. Temporary uploads are cleaned after processing, rejection or expiry. Original files are not retained as a promised feature.
This permission excludes private-space post attachments, chat attachments, public sharing, access by other accounts, audio, video, voice cloning, facial recognition, biometric reconstruction and AI image processing. Photos and image bytes are not sent to models and are not used to generate AI profiles or replies. Text and AI purposes require their own permissions.
You may independently withdraw person-photo permission in the existing privacy panel, stopping new uploads, bindings and reads. Withdrawal is not deletion. Independent export and account erasure remain available without renewing photo or AI permission. Removing or replacing photos or removing a person invalidates the source and old read proofs. Objects are reliably cleaned only when no valid references remain. Displayed or downloaded copies cannot be remotely recalled.
Exports contain actual current WebP copies, their order and sources. JSON exports have a 20MiB limit and fail explicitly rather than truncate. Account erasure must clean every domain, temporary upload and publication object. Backup recovery remains a restricted local rehearsal and requires databases and real objects together. This permission does not establish production or device acceptance.');
