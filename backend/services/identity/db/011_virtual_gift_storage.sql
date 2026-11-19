-- This independent purpose does not amend existing published policies.
ALTER TABLE policy_versions DROP CONSTRAINT policy_versions_kind_check;
ALTER TABLE policy_versions ADD CONSTRAINT policy_versions_kind_check CHECK(kind IN ('privacy_notice','private_story_storage','ai_text_processing','private_photo_storage','private_person_photo_storage','virtual_gift_storage'));
ALTER TABLE consent_events DROP CONSTRAINT consent_events_purpose_check;
ALTER TABLE consent_events ADD CONSTRAINT consent_events_purpose_check CHECK(purpose IN ('privacy_notice','private_story_storage','ai_text_processing','private_photo_storage','private_person_photo_storage','virtual_gift_storage'));
ALTER TABLE consent_events DROP CONSTRAINT consent_events_check;
ALTER TABLE consent_events ADD CONSTRAINT consent_events_check CHECK((purpose='privacy_notice' AND decision='acknowledge') OR (purpose IN ('private_story_storage','ai_text_processing','private_photo_storage','private_person_photo_storage','virtual_gift_storage') AND decision IN ('grant','revoke')));
ALTER TABLE consent_events DROP CONSTRAINT consent_events_ai_notice_binding;
ALTER TABLE consent_events ADD CONSTRAINT consent_events_ai_notice_binding CHECK(CASE
 WHEN purpose IN ('ai_text_processing','private_photo_storage','private_person_photo_storage','virtual_gift_storage') AND decision='grant' THEN notice_authorization_version IS NOT NULL AND notice_authorization_version>0
 WHEN purpose='private_story_storage' AND decision='grant' THEN notice_authorization_version IS NULL OR notice_authorization_version>0
 ELSE notice_authorization_version IS NULL END);
INSERT INTO policy_versions(id,kind,version,document_zh_cn,document_en) VALUES
('a8e4ca02-fd22-44a6-a873-88f76ef19d9f','virtual_gift_storage',1,
'西界虚拟赠礼与试用资产保存说明

这是虚拟赠礼的独立授权，不改变已有文字、AI或照片授权。本阶段用于本机合成资料联调，不涉及真实付款、兑换现金或真实物品。
允许后，你主动寄出的礼物、数量、赠言、人物与世界快照、投递进度，以及试用邮资、赠礼券和库存的发放、使用与退回流水会保存在当前账号，仅供你在聊天卡片、寄件记录、资产与人物空间查看和核对。赠言和赠礼卡片不交给AI，不触发AI回礼或自动记忆。付费、邀请奖励、共创、回礼、赠礼照片和推送不包含在此用途。
试用资产只按服务端明确的版本化政策发放，浏览器预览余额不会导入。允许本授权不代表获得初始额度。一次寄件只使用你确认的单一来源，余额不足不会自动改扣其他来源。未知结果沿用原操作查回，不重复扣减。投递失败按原扣减流水退回；已到期批次不会因此获得新的有效期。
你可以单独撤回本授权，停止新的赠礼和正常读取；未完成任务不借重新授权自动恢复。撤回不等于删除。独立导出和账号注销不要求重新允许本用途，导出包含真实流水、回执和引用，注销清理试用流水、赠言、快照、卡片及任务，仅保留防止数据复活所需的最小擦除收据。本片无付费交易特殊留存例外。
备份与恢复仅为受限本机演练，本授权不表示生产发布或其他设备已经验收。',
'Xijie virtual gifts and trial asset storage

This separate permission does not change existing text, AI or photo permissions. This local development slice uses synthetic data and involves no real payment, cash redemption or physical goods.
If allowed, sent gifts, quantities, notes, person and world snapshots, delivery progress, and issuance, usage and reversal records for trial postage, vouchers and inventory are saved privately in this account. They support chat cards, delivery history, asset records and character-space display. Notes and gift cards are not sent to AI and do not trigger AI returns or automatic memory. Payments, invitation rewards, shared goals, return gifts, gift photos and push notifications are outside this purpose.
Trial assets require an explicit versioned server policy. Browser preview balances are never imported. Granting permission does not award an initial balance. Each gift uses the funding source you confirm; insufficient balance never silently switches sources. Unknown outcomes use the original operation. Definite failures reverse the original debit without extending expired lots.
You may independently withdraw permission to stop new gifts and ordinary reads. Renewed permission does not revive unfinished tasks. Withdrawal is not deletion. Export and erasure remain available without renewing permission. Exports include actual records and references. Erasure removes trial records, notes, snapshots, cards and tasks, retaining only minimal receipts that prevent resurrection. No paid-transaction retention exception applies.
Backup and recovery remain restricted local rehearsals. This permission does not establish production or device acceptance.');
