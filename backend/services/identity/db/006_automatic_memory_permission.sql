-- Never reinterpret an existing AI grant as permission for a new processing scope.
ALTER TABLE policy_versions ADD COLUMN ai_automatic_memory_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE policy_versions ADD CONSTRAINT policy_automatic_memory_scope CHECK(NOT ai_automatic_memory_enabled OR kind='ai_text_processing');

INSERT INTO policy_versions(id,kind,version,document_zh_cn,document_en,ai_automatic_memory_enabled) VALUES
('014ab349-a7c7-4764-98ec-c00cbec15e15','privacy_notice',3,
'西界文字服务联调隐私告知

本环境用于账号、人物资料、文字聊天、珍藏和自动长期文字记忆的开发联调，请只使用虚构人物与合成测试资料。当前版本不是正式上线服务。
西界按当前账号保存你提供的人物资料、聊天、珍藏及授权记录。人物画像和获准聊天可以在你另行允许 AI 文字处理后整理为私人长期记忆，帮助后续对话接续；这些派生线索带有来源，不表示经过外部核实，也不代表本人意识延续。
确认告知、允许文字保存与允许 AI 处理是不同动作。没有新的 AI 文字处理授权，不会因为你过去允许回复或整理珍藏就自动启用长期记忆。只有本次任务所需且你有权使用的文字会交给当前授权政策列明的 OpenAI API。
你可以在原「隐私与 AI 说明」浮层撤回 AI 授权、导出文字资料，在「账号管理」申请注销。撤回停止新的处理，不等于删除已保存的记录；来源更正或删除后相关派生线索停止使用。已下载的副本由你自行管理。备份恢复目前只完成本机隔离演练，不构成正式灾备服务。
照片、声音、视频、公开分享、自动世界剧情和正式支付未包含在本次文字授权内，仍需各自实现和验收。请勿提交真实私人素材。',
'Xijie text service sandbox privacy notice

This environment tests accounts, profiles, text chats, treasured originals and automatic long-term text memory. Use fictional people and synthetic test material only. It is not a production service.
Xijie stores your profiles, chats, treasured originals and authorization records under the current account. With fresh AI text permission, authorized profiles and chats may be organized into private long-term memory for later conversations. Derived clues keep their sources; they are not externally verified facts or a continuation of a real consciousness.
Notice acknowledgement, text storage and AI processing are separate decisions. Earlier permission for replies or treasured suggestions does not automatically permit long-term memory. Only necessary text available to the current account is sent to the OpenAI API identified in the current permission policy.
You can withdraw AI permission and export text in the existing Privacy & AI panel, or request account deletion in Account management. Withdrawal stops new processing and does not itself delete stored records. Corrected or removed sources stop supporting derived clues. You manage copies already downloaded. Backup recovery has only passed a local isolated rehearsal and is not a production disaster-recovery service.
Photos, audio, video, public sharing, automatic world stories and production payments are outside this text permission and require separate implementation and verification. Do not submit real private material.',false),
('d26b17f9-a510-4aae-9792-37fe6a347476','ai_text_processing',2,
'西界 AI 文字处理授权（OpenAI 联调）

允许后，西界可以将当前人物的必要文字画像、获准聊天和相关珍藏发送至 OpenAI API，生成文字回复、供你确认的珍藏候选，以及无需逐条收藏的私人自动长期记忆，并保存对应结果。
自动整理只提炼有来源依据的经历、偏好、关系或约定。AI 前文仅作语境，不作为真实经历依据；没有足够依据可以不生成记忆。派生条目与用户确认的珍藏分开，保留来源和版本，帮助后续交流；模型可能遗漏或误解，更正与删除会使相关旧线索停止使用。
只发送本账号有权使用、本次任务需要且用途授权仍有效的文字。本授权不包括照片、声音、仿声、视频、公开分享或虚拟世界自动剧情。不同提供方或新处理范围需要新政策和重新允许。本次明确的新授权才包括自动长期文字记忆，旧版授权不会被升级为新许可。
你可以随时在原浮层撤回。新任务停止受理，已受理任务在模型调用和写回前复核授权。已经发送给提供方的内容不能靠撤回收回。重新允许不会自动恢复旧任务，也不会自动重新学习已撤回或替代的旧来源版本。
撤回不等于删除已有记录。你仍可以按原权限查看、复制与删除；导出已有资料不需要新的模型调用。文字保存仍受单独的存储授权约束。本授权仅适用于合成资料开发联调，不代表生产提供方或发布要求已经验收。',
'Xijie AI text processing permission (OpenAI sandbox)

If you allow this purpose, Xijie may send necessary text profiles, authorized chats and relevant treasured originals to the OpenAI API to generate replies, editable treasured suggestions and private automatic long-term memory without a separate cherish action, and store the corresponding results.
Automatic organization extracts source-backed experiences, preferences, relationships or plans. AI context is not evidence of real experiences, and insufficient evidence may produce no memory. Derived entries are separate from user-confirmed originals, retain sources and versions, and support later conversations. Models can omit or misunderstand details; correction and deletion stop related old clues from being used.
Only necessary text available to the current account with valid purpose permission is included. This permission does not cover photos, audio, voice cloning, video, public sharing or automatic world stories. A different provider or scope requires a new policy and fresh permission. Only this new explicit grant includes automatic long-term text memory; earlier grants are not upgraded.
You can withdraw in the existing panel. New tasks stop, and accepted tasks recheck permission before model calls and writeback. Withdrawal cannot recall content already sent to the provider. Allowing again does not automatically resume old tasks or relearn withdrawn or superseded source versions.
Withdrawal does not delete existing records. Reading, copying and deletion continue under their own permissions; exporting existing data makes no new model call. Text storage remains separately authorized. This permission is for development with synthetic material and does not certify production provider or release readiness.',true);
