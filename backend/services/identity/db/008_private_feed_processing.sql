-- A fresh AI decision is required; existing text and private-space storage scopes stay intact.
ALTER TABLE policy_versions ADD COLUMN private_feed_processing_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE policy_versions ADD CONSTRAINT policy_private_feed_processing_scope
 CHECK(NOT private_feed_processing_enabled OR kind='ai_text_processing');

INSERT INTO policy_versions(id,kind,version,document_zh_cn,document_en,ai_automatic_memory_enabled,private_feed_processing_enabled) VALUES
('d26b17f9-a510-4aae-9792-37fe6a347476','ai_text_processing',3,
'西界 AI 文字处理授权（OpenAI 联调）

允许后，西界可以将本次任务所需的虚构人物文字画像、获准聊天和相关珍藏发送至 OpenAI API，生成文字回复、供你确认的珍藏候选及不依赖逐条收藏的私人自动长期文字记忆。原有记忆处理仍保留来源、版本、更正与删除边界，不表示真实本人或其意识在延续。
本次新增范围仅包括：你明确允许本版本之后新确认或主动修订的珍藏，可以异步生成一条该人物署名的私人 AI 回响；你在这条回响下新发表的手动评论，可以由该珍藏所属人物生成一次 AI 回应。相关原文、必要画像、该条回响与本次相关评论可发送给 OpenAI。原文保存与用户评论不依赖模型成功，回响和回应均明确标为 AI。
旧版许可不包含这项新用途；本次明确允许不会默认回扫旧珍藏、旧评论或历史普通动态，也不会自动恢复撤回前的任务。普通私人用户帖、迁居记录、其他人物、未确认候选、自动记忆条目及无关评论不因本用途送给模型。AI 产物不递归触发回应，不自动点赞，不执行迁居、支付、赠礼或其他世界副作用。
AI 回响是虚构表达，不能改写珍藏原文或现实经历。原文更正、删除或人物失效后，相关旧回响与派生回应停止作为当前可读依据；生成前、调用前、模型返回后与写回前仍核对来源、存储与精确 AI 授权版本。已经发送给提供方的内容不能靠撤回收回。
你可以在原「隐私与 AI 说明」浮层撤回。撤回后停止新的模型派发与迟到写回，已保存结果可按文字存储及来源权限查看、复制或删除。文字与私人空间存储仍受独立授权约束，本次许可不代替存储许可。
照片、声音、仿声、视频、公开分享、普通私人帖自动互动、自动世界剧情与其他提供方不在本授权内。仅用于合成资料开发联调，不代表生产提供方或发布要求已验收。',
'Xijie AI text processing permission (OpenAI sandbox)

If allowed, Xijie may send necessary fictional text profiles, authorized chats and relevant treasured originals to the OpenAI API for text replies, editable treasured suggestions and private automatic long-term text memory without a separate cherish action. Existing memory processing keeps source, version, correction and deletion boundaries and does not represent a real person or continued consciousness.
The new scope is limited to treasured originals you newly confirm or actively revise after explicitly accepting this version. They may produce one private AI echo attributed to that person. A new manual comment you post under that echo may receive one AI response from the original source person. The relevant original, necessary profile, that echo and related comments for the current task may be sent to OpenAI. Saving originals and user comments does not depend on model success; echoes and responses are identified as AI.
Earlier permission does not include this scope. Accepting now does not scan old originals, old comments or ordinary historical posts, or resume tasks from before withdrawal. Ordinary private user posts, movement records, other people, unconfirmed candidates, automatic-memory entries and unrelated comments are not sent under this purpose. AI output does not recursively trigger responses, auto-like content, move a person, make payments, send gifts or execute world actions.
An AI echo is fictional expression and cannot edit the original or factual biography. Correction, deletion or loss of person access invalidates related old echoes and derived responses. Sources, storage and the exact AI authorization version are checked before generation, before the model call, after the model reply and before commit. Withdrawal cannot recall material already sent to the provider.
You can withdraw in the existing Privacy & AI panel. New model dispatch and late writeback stop. Saved results remain readable, exportable or deletable under storage and source permissions. Text and private-space storage require their independent permission; this grant does not replace it.
Photos, audio, voice cloning, video, public sharing, automatic interactions with ordinary private posts, automatic world stories and other providers are outside this scope. This is development with synthetic material only and does not certify production providers or release readiness.',true,true);
