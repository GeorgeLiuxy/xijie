-- Provider credential material stays encrypted; these are operation receipts, never password verifiers.
ALTER TABLE accounts ADD COLUMN credential_fenced_at timestamptz;
ALTER TABLE accounts ADD COLUMN credential_password_pending uuid;
ALTER TABLE auth_attempts ADD COLUMN credential_kind text CHECK(credential_kind IN('password'));
CREATE TABLE auth_credential_fences(issuer text NOT NULL,subject text NOT NULL,fenced_at timestamptz NOT NULL,password_pending uuid,PRIMARY KEY(issuer,subject));
CREATE TABLE auth_password_logins(
 id uuid PRIMARY KEY, browser_hash text NOT NULL, idempotency_key text NOT NULL,
 request_hash text NOT NULL, phone_hash text NOT NULL, phase text NOT NULL CHECK(phase IN('running','completed','failed')),
 attempt_id uuid REFERENCES auth_attempts(id), result_cipher text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '5 minutes',
 UNIQUE(browser_hash,idempotency_key)
);
CREATE INDEX auth_password_login_rate ON auth_password_logins(phone_hash,created_at);
CREATE TABLE auth_password_challenges(
 id uuid PRIMARY KEY, browser_hash text NOT NULL,scope_generation integer NOT NULL DEFAULT 0, idempotency_key text NOT NULL,phone_hash text NOT NULL,
 purpose text NOT NULL CHECK(purpose IN('manage','reset')),
 initiating_session_id uuid REFERENCES app_sessions(id), initiating_account_id uuid REFERENCES accounts(id),
 account_id uuid REFERENCES accounts(id), auth_identity_id uuid REFERENCES auth_identities(id),
 phase text NOT NULL CHECK(phase IN('preparing','awaiting_code','verifying','verified','staging','saving','unknown','completed','expired')),
 context_cipher text,operation_key text,password_hash text,verify_key text,code_hash text,last_result text CHECK(last_result IN('incorrect','expired')),
 lease_until timestamptz,mutation_claim uuid,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '5 minutes',resend_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '60 seconds',
 UNIQUE(browser_hash,idempotency_key)
);
CREATE INDEX auth_password_challenge_rate ON auth_password_challenges(phone_hash,resend_at);
CREATE INDEX auth_password_challenge_owner ON auth_password_challenges(account_id);
