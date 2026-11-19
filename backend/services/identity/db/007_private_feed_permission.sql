-- Existing text-draft grants never expand into private-feed permission.
ALTER TABLE policy_versions ADD COLUMN private_feed_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE policy_versions ADD CONSTRAINT policy_private_feed_scope
 CHECK(NOT private_feed_enabled OR kind='private_story_storage');

-- New storage grants may bind the exact current notice, like existing AI grants.
-- Old storage records remain NULL and never gain this capability from migration.
ALTER TABLE consent_events DROP CONSTRAINT consent_events_ai_notice_binding;
ALTER TABLE consent_events ADD CONSTRAINT consent_events_ai_notice_binding CHECK (
 CASE WHEN purpose='ai_text_processing' AND decision='grant'
   THEN notice_authorization_version IS NOT NULL AND notice_authorization_version>0
 WHEN purpose='private_story_storage' AND decision='grant'
   THEN notice_authorization_version IS NULL OR notice_authorization_version>0
 ELSE notice_authorization_version IS NULL END
);

INSERT INTO policy_versions(id,kind,version,document_zh_cn,document_en,private_feed_enabled) VALUES
('014ab349-a7c7-4764-98ec-c00cbec15e15','privacy_notice',4,
'西界文字与私人空间联调隐私告知

本环境仅用于账号、人物资料、文字聊天、珍藏、自动长期文字记忆与私人空间的开发联调。请只使用虚构人物和合成测试资料，当前版本不是正式上线服务。
西界按当前账号保存你主动提交的人物资料、聊天、珍藏，以及另行允许后发布的私人文字动态、点赞和评论。私人空间还可以显示你已完成的虚拟人物迁居记录；这些只是既有事实的私人读投影，不会执行新的迁居或生成世界剧情。
确认本告知、允许文字及私人空间存储、允许 AI 文字处理是不同动作。私人动态、点赞、评论和迁居投影不会因本次存储授权交给模型，也不公开分享或展示给其他账号。原有文字画像与聊天的 AI 回复及自动长期记忆继续遵守独立 AI 政策，不能从私人空间授权推导新的 AI 用途。
旧版文字草稿许可不包含私人动态，本次新增范围需要你在原浮层明确允许。你可以随时撤回，停止新的私人空间读取、发布、互动和投影同步；撤回不等于删除已有文字。删除、导出与账号注销可按原权限继续办理，不要求重新允许 AI 或私人空间用途。下载副本由你自行管理。
照片、音视频、公开社交、自动世界剧情和正式支付不包含在本次范围内。备份恢复仅完成本机隔离演练，不代表生产发布或灾备已验收。请勿提交真实私人素材。',
'Xijie text and private-space sandbox privacy notice

This environment tests accounts, profiles, text chats, treasured originals, automatic long-term text memory and private space. Use fictional people and synthetic material only. It is not a production service.
Xijie stores profiles, chats and treasured originals under your account, plus private text posts, likes and comments after separate storage permission. Private space may also display your committed virtual-person moves. These are read projections of existing facts; they neither execute another move nor generate world stories.
Notice acknowledgement, text and private-space storage, and AI text processing are separate decisions. This storage permission does not send private posts, likes, comments or movement projections to a model, publish them or show them to other accounts. Existing profile/chat replies and automatic long-term memory remain governed by independent AI policy; private-space permission grants no new AI purpose.
Earlier text-draft permission does not include private posts. The new scope requires an explicit decision in the existing panel. You can revoke it to stop new private-space reads, publishing, interactions and projection sync. Withdrawal does not itself delete stored text. Deletion, export and account erasure continue under their own authority without renewing AI or private-space permission. You manage downloaded copies.
Photos, audio, video, public social networking, automatic world stories and production payments are outside this scope. Backup recovery has passed local isolated rehearsal only, not production or disaster-recovery acceptance. Do not submit real private material.',false),
('0133ea0a-4d27-465c-8544-42bce81c68e9','private_story_storage',2,
'西界文字与私人空间存储授权

允许后，西界可以按当前账号保存你主动提交的虚构人物称呼、关系、故事、文字聊天和珍藏，以及私人文字动态、点赞和评论，供原页面继续使用。私人空间可以保存与显示你已正式完成的虚拟迁居事实投影，保留原人物和来源，不创造新事件。
本次明确授权才包含私人空间；旧版草稿存储许可不会自动升级。此范围不包含图片、声音、视频、公开分享或其他账号社交，也不把私人动态、互动或迁居投影送给模型，不触发 AI 回响、自动互动或世界剧情。AI 文字回复与既有自动长期记忆仍须单独明确允许，不由本授权代替。
你可以在原「隐私与 AI 说明」浮层撤回。撤回后停止新的私人空间读取、发布、点赞、评论与迁居投影同步，但不等于删除已有资料；复制、删除与账号注销不要求重新允许。本授权绑定当前告知，告知改变后不会自动补领新的范围。
本授权仅用于合成资料开发联调，不代表正式上线的媒体、支付、模型或发布要求已经验收。',
'Xijie text and private-space storage permission

If allowed, Xijie may store fictional names, relationships, stories, text chats and treasured originals you submit under your account, together with private text posts, likes and comments for the existing pages. Private space may store and display projections of committed virtual moves, retaining their person and source without creating new events.
Only this explicit permission includes private space; earlier draft storage is not upgraded. It excludes images, audio, video, public sharing and cross-account social networking. Private posts, interactions and movement projections are not sent to a model and do not trigger AI echoes, automatic interactions or world stories. Existing AI replies and automatic long-term memory require separate explicit AI permission.
You can revoke in the existing Privacy & AI panel. New private-space reads, publishing, likes, comments and movement projection sync then stop. Withdrawal does not delete existing data; copying, deletion and account erasure do not require renewal. Permission is bound to the current notice and cannot silently acquire a later scope.
This permission is for development with synthetic material only and does not certify production media, payments, model-provider or release readiness.',true);
