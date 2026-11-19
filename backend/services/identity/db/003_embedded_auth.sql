-- Short-lived bridge to the provider's Experience API. OTP generation and checking stay in Logto.
CREATE TABLE auth_sms_challenges (
    id uuid PRIMARY KEY,
    browser_hash text NOT NULL,
    idempotency_key uuid NOT NULL,
    phone_hash text NOT NULL,
    purpose text NOT NULL CHECK (purpose IN ('sign_in', 'switch')),
    attempt_id uuid UNIQUE REFERENCES auth_attempts(id),
    phase text NOT NULL DEFAULT 'preparing'
        CHECK (phase IN ('preparing', 'ready', 'verifying', 'completed', 'failed', 'expired')),
    context_cipher text,
    result_cipher text,
    operation_key uuid,
    code_hash text,
    last_result text CHECK (last_result IN ('incorrect', 'expired')),
    lease_until timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    resend_at timestamptz NOT NULL DEFAULT clock_timestamp() + interval '60 seconds',
    expires_at timestamptz NOT NULL DEFAULT clock_timestamp() + interval '5 minutes',
    UNIQUE (browser_hash, idempotency_key),
    CHECK (expires_at > created_at AND resend_at > created_at),
    CHECK ((phase = 'verifying') = (lease_until IS NOT NULL)),
    CHECK (phase <> 'completed' OR result_cipher IS NOT NULL)
);
CREATE INDEX auth_sms_challenges_browser_time ON auth_sms_challenges(browser_hash, created_at DESC);
CREATE INDEX auth_sms_challenges_phone_time ON auth_sms_challenges(phone_hash, created_at DESC);
CREATE INDEX auth_sms_challenges_expiry ON auth_sms_challenges(expires_at) WHERE phase <> 'expired';
