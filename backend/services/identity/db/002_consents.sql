CREATE TABLE policy_versions (
    id uuid NOT NULL,
    kind text NOT NULL CHECK (kind IN ('privacy_notice', 'private_story_storage')),
    version integer NOT NULL CHECK (version > 0),
    document_zh_cn text NOT NULL,
    document_en text NOT NULL,
    published_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    effective_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    retired_at timestamptz,
    PRIMARY KEY (id, version),
    UNIQUE (id, version, kind),
    UNIQUE (kind, version),
    CHECK (effective_at >= published_at AND (retired_at IS NULL OR retired_at > effective_at))
);

INSERT INTO policy_versions (id, kind, version, document_zh_cn, document_en) VALUES
(
    '014ab349-a7c7-4764-98ec-c00cbec15e15', 'privacy_notice', 1,
    '西界联调隐私告知

本环境用于验证账号隔离和文字草稿功能。请只填写虚构的人物称呼、关系和故事。
联调环境保存你的测试账号、告知确认和授权记录。仅阅读并确认这份告知不会启用故事保存授权。
故事文字不会用于 AI 处理，也不会向其他账号展示。',
    'Xijie sandbox privacy notice

This environment is for testing account isolation and text drafts. Enter fictional names, relationships and stories only.
The sandbox stores your test account, notice acknowledgement and authorization records. Acknowledging this notice does not authorize story storage.
Story text is not used for AI processing or shown to other accounts.'
),
(
    '0133ea0a-4d27-465c-8544-42bce81c68e9', 'private_story_storage', 1,
    '西界联调故事存储授权

允许后，西界会把你主动保存的虚构人物称呼、关系和故事保存到当前测试账号，供你下次继续填写。
这项授权仅限联调环境的文字草稿存储。它不授权 AI 处理、公开分享或向他人提供资料。
你可以随时撤回，撤回后停止新的保存。已保存的草稿仍可由原账号查看。',
    'Xijie sandbox story storage authorization

If you allow storage, Xijie saves the fictional name, relationship and story you choose to save under your current test account so you can continue later.
This authorization covers text draft storage in the sandbox only. It does not authorize AI processing, public sharing or disclosure to others.
You can revoke it at any time to stop new saves. Previously saved drafts remain available to their account owner.'
);

CREATE TABLE consent_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id uuid NOT NULL REFERENCES accounts (id),
    purpose text NOT NULL CHECK (purpose IN ('privacy_notice', 'private_story_storage')),
    policy_id uuid NOT NULL,
    policy_version integer NOT NULL,
    decision text NOT NULL,
    authorization_version integer NOT NULL CHECK (authorization_version > 0),
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    idempotency_key uuid NOT NULL,
    request_fingerprint text NOT NULL,
    UNIQUE (account_id, purpose, authorization_version),
    UNIQUE (account_id, idempotency_key),
    FOREIGN KEY (policy_id, policy_version, purpose) REFERENCES policy_versions (id, version, kind),
    CHECK (
        (purpose = 'privacy_notice' AND decision = 'acknowledge')
        OR (purpose = 'private_story_storage' AND decision IN ('grant', 'revoke'))
    )
);

CREATE INDEX consent_history_by_account ON consent_events (account_id, recorded_at DESC, id DESC);

CREATE TABLE current_consents (
    account_id uuid NOT NULL REFERENCES accounts (id),
    purpose text NOT NULL,
    authorization_version integer NOT NULL,
    updated_at timestamptz NOT NULL,
    PRIMARY KEY (account_id, purpose),
    FOREIGN KEY (account_id, purpose, authorization_version)
        REFERENCES consent_events (account_id, purpose, authorization_version)
);
