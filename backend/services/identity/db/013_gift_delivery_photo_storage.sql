-- Journey captures are a separate permission; published policies and prior grants remain unchanged.
ALTER TABLE policy_versions DROP CONSTRAINT policy_versions_kind_check;
ALTER TABLE policy_versions ADD CONSTRAINT policy_versions_kind_check CHECK(kind IN ('privacy_notice','private_story_storage','ai_text_processing','private_photo_storage','private_person_photo_storage','virtual_gift_storage','person_gift_returns','gift_delivery_photo_storage'));
ALTER TABLE consent_events DROP CONSTRAINT consent_events_purpose_check;
ALTER TABLE consent_events ADD CONSTRAINT consent_events_purpose_check CHECK(purpose IN ('privacy_notice','private_story_storage','ai_text_processing','private_photo_storage','private_person_photo_storage','virtual_gift_storage','person_gift_returns','gift_delivery_photo_storage'));
ALTER TABLE consent_events DROP CONSTRAINT consent_events_check;
ALTER TABLE consent_events ADD CONSTRAINT consent_events_check CHECK((purpose='privacy_notice' AND decision='acknowledge') OR (purpose IN ('private_story_storage','ai_text_processing','private_photo_storage','private_person_photo_storage','virtual_gift_storage','person_gift_returns','gift_delivery_photo_storage') AND decision IN ('grant','revoke')));
ALTER TABLE consent_events DROP CONSTRAINT consent_events_ai_notice_binding;
ALTER TABLE consent_events ADD CONSTRAINT consent_events_ai_notice_binding CHECK(CASE
 WHEN purpose IN ('ai_text_processing','private_photo_storage','private_person_photo_storage','virtual_gift_storage','person_gift_returns','gift_delivery_photo_storage') AND decision='grant' THEN notice_authorization_version IS NOT NULL AND notice_authorization_version>0
 WHEN purpose='private_story_storage' AND decision='grant' THEN notice_authorization_version IS NULL OR notice_authorization_version>0
 ELSE notice_authorization_version IS NULL END);
INSERT INTO policy_versions(id,kind,version,document_zh_cn,document_en) VALUES
('c14e14fb-55be-4135-80f7-b40e52095c02','gift_delivery_photo_storage',1,
'西界赠礼留影保存说明

这是独立的赠礼留影保存授权，不扩大已有文字、照片、虚拟赠礼或 AI 授权。需同时允许虚拟赠礼保存；无需允许私人文字保存、动态照片、人物照片或任何 AI 处理。
在已经实际抵达的寄件回执中，你主动观看完整旅途后，可保存虚拟场景最后一帧作为该次寄件的私人留影。它是应用绘制的虚拟旅途画面，不是真实人物照片、实物交付凭证或 AI 生成图片。提前结束观看不会保存或替换留影。重新完整观看会替换该寄件当前的一张留影，不改变寄件状态、资产或回礼。
画面会上传到私人图片服务，校验内容、去除元数据并转换为 WebP，保存图片尺寸、校验值、寄件关联和必要授权来源记录。图片仅供当前账号在回执中查看，不公开，不交给 AI，不用于聊天、回礼决策或自动记忆。浏览器仅暂存当前会话所需画面，未确认保存时不会冒充已保存。
你可以单独撤回此授权，停止新的上传、绑定及正常图片读取。撤回不是删除；重新允许后可查看仍然有效的已保存留影，但旧授权下未完成的上传和处理不会因重新允许而恢复。替换或来源人物移除后，旧图立即失去正常读取资格，私有对象随后按清理周期删除。
无需重新允许此用途即可通过账号资料导出取得仍然有效的留影及关联记录，或随账号注销清理。擦除包括留影关联、图片、上传及处理记录，并保留最小防复活收据。备份与恢复仅限受保护的本机演练。本阶段不表示生产发布。',
'Xijie journey capture storage

This is a separate permission. It does not expand existing text, photo, virtual gift or AI permissions. Virtual gift storage must also be allowed. Private text storage, feed photos, person photos and AI processing are not required.
After a delivery actually arrives, completing its journey animation can save the final rendered scene as one private capture for that delivery. This is an application-rendered virtual scene, not a photograph of a real person, proof of physical delivery or an AI-generated image. Ending the animation early does not save or replace a capture. Completing another viewing replaces the current capture without changing delivery status, assets or gift returns.
The image is uploaded to a private media service, verified, stripped of metadata and converted to WebP. Dimensions, checksums, the delivery association and necessary authorization provenance are stored. Only the current account can view it in its receipt. It is not public and is never sent to AI, chat processing, gift return decisions or automatic memory. The browser only temporarily holds the scene needed for the current session; an unconfirmed save is never shown as saved.
Withdrawing this permission stops new uploads, binding and ordinary image reads. Withdrawal is not deletion. Renewed permission permits reading still-valid saved captures, but unfinished uploads and processing bound to an old authorization version do not resume. Replacement or removal of the source person immediately invalidates normal reads of the old image; private objects are subsequently deleted by cleanup.
Account export can retrieve still-valid captures and association records, and account erasure can remove them, without renewing this permission. Erasure covers capture associations, bytes, upload and processing records, retaining only minimal anti-resurrection receipts. Backup and restoration are restricted protected local rehearsals. This slice is not a production release.');
