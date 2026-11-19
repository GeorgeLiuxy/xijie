-- Gathering is an independent purpose. Published policies and earlier decisions
-- are unchanged; neither storage nor existing AI permission implies this grant.
ALTER TABLE policy_versions DROP CONSTRAINT policy_versions_kind_check;
ALTER TABLE policy_versions ADD CONSTRAINT policy_versions_kind_check CHECK(kind IN ('privacy_notice','private_story_storage','ai_text_processing','private_photo_storage','private_person_photo_storage','virtual_gift_storage','person_gift_returns','gift_delivery_photo_storage','private_letter_storage','person_letter_replies','person_gather_replies','private_chat_photo_storage'));
ALTER TABLE consent_events DROP CONSTRAINT consent_events_purpose_check;
ALTER TABLE consent_events ADD CONSTRAINT consent_events_purpose_check CHECK(purpose IN ('privacy_notice','private_story_storage','ai_text_processing','private_photo_storage','private_person_photo_storage','virtual_gift_storage','person_gift_returns','gift_delivery_photo_storage','private_letter_storage','person_letter_replies','person_gather_replies','private_chat_photo_storage'));
ALTER TABLE consent_events DROP CONSTRAINT consent_events_check;
ALTER TABLE consent_events ADD CONSTRAINT consent_events_check CHECK((purpose='privacy_notice' AND decision='acknowledge') OR (purpose IN ('private_story_storage','ai_text_processing','private_photo_storage','private_person_photo_storage','virtual_gift_storage','person_gift_returns','gift_delivery_photo_storage','private_letter_storage','person_letter_replies','person_gather_replies','private_chat_photo_storage') AND decision IN ('grant','revoke')));
ALTER TABLE consent_events DROP CONSTRAINT consent_events_ai_notice_binding;
ALTER TABLE consent_events ADD CONSTRAINT consent_events_ai_notice_binding CHECK(CASE
 WHEN purpose IN ('ai_text_processing','private_photo_storage','private_person_photo_storage','virtual_gift_storage','person_gift_returns','gift_delivery_photo_storage','private_letter_storage','person_letter_replies','person_gather_replies','private_chat_photo_storage') AND decision='grant' THEN notice_authorization_version IS NOT NULL AND notice_authorization_version>0
 WHEN purpose='private_story_storage' AND decision='grant' THEN notice_authorization_version IS NULL OR notice_authorization_version>0
 ELSE notice_authorization_version IS NULL END);

INSERT INTO policy_versions(id,kind,version,document_zh_cn,document_en) VALUES
('2b26b82b-22d0-48fa-8983-4adb5d65f361','private_chat_photo_storage',1,'西界聊天照片保存授权

这是本人账号与本人创建的虚构人物一对一直聊中单张照片的独立保存用途，不扩大私人空间照片、人物照片、旅途留影、私人文字或任何 AI 授权。允许后可上传、验证和规范化单张图片，剥除图片元数据，私有保存成品、必要尺寸和来源关联，显示于原聊天、历史摘要及照片占位检索。不会向其他账号公开，不用于围坐、人脸身份识别或身份重建。
本授权不允许把照片发送给模型。原选图即发流程还需私人文字保存及独立的 AI 看图回应授权；未同时允许时不会创建成功消息或伪回复。未发文字草稿不会当成照片说明。成品使用受当前账号和有效原消息约束的短期读取凭据，不公开永久链接。
你可以单独撤回本授权，停止新上传、照片读取和相关待执行任务；普通文字历史和已保存的看图文字回复仍按私人文字保存权限读取。重授只恢复仍有效已保存图片的读取，不恢复旧上传、旧任务或被删除的来源。删除原照片消息使读取和在途任务失效；已保存回复保留为文字历史。本片照片及其看图回复不进入后续文字模型上下文、自动长期记忆、候选珍藏或围坐。
独立资料导出与账号注销不需要重新授予本用途，可导出有效照片成品和来源元数据，或清理本账号照片、消息关联、任务及对象。撤回不等于删除。','Xijie private chat photo storage permission

This independent purpose covers one photo at a time in direct chats with fictional characters you created. It does not expand private-space photos, character photos, journey captures, private text or any AI permission. It permits validating, normalizing and stripping image metadata, privately saving normalized bytes, dimensions and source references, and displaying the image in its original chat, history summary and photo-placeholder search. It excludes publication to other accounts, gatherings, face identification and identity reconstruction.
This purpose does not authorize sending images to a model. Select-and-send additionally requires private text storage and independent AI image-reply permission. Missing permission creates no successful message or simulated reply. Unsent text drafts are not captions. Short-lived image access is bound to the current account and valid source message, with no permanent public URL.
Withdrawal stops uploads, photo reads and associated pending processing. Other text history and saved visual replies remain readable under private text storage. Renewed permission restores valid saved images only, never old uploads, tasks or deleted sources. Deleting the source photo invalidates image access and pending work; saved replies remain text history. Photos and visual replies do not enter later text AI, automatic long-term memory, suggested treasured memories or gatherings in this release.
Independent export and erasure require no renewed permission and include valid normalized images, sources, tasks and objects. Withdrawal is not deletion.');
