CREATE TABLE accounts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    registration_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    status text NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'restricted', 'deletion_pending', 'deleted')),
    display_name text NOT NULL DEFAULT '西界来客',
    locale text NOT NULL DEFAULT 'zh-CN',
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    access_version integer NOT NULL DEFAULT 1 CHECK (access_version > 0),
    memory_confirmation_seq bigint NOT NULL DEFAULT 0 CHECK (memory_confirmation_seq >= 0),
    registered_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    UNIQUE (id, registration_id)
);

CREATE TABLE auth_identities (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id uuid NOT NULL REFERENCES accounts (id),
    issuer text NOT NULL,
    subject text NOT NULL,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    created_at timestamptz NOT NULL,
    verified_at timestamptz NOT NULL,
    UNIQUE (issuer, subject),
    UNIQUE (account_id, id)
);

CREATE TABLE app_session_slots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    binding_hash text NOT NULL UNIQUE,
    generation integer NOT NULL DEFAULT 0 CHECK (generation >= 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE auth_attempts (
    id uuid PRIMARY KEY,
    slot_id uuid NOT NULL REFERENCES app_session_slots (id),
    client_registration_key text NOT NULL,
    purpose text NOT NULL CHECK (purpose IN ('sign_in', 'switch')),
    initiating_session_id uuid,
    idempotency_key text NOT NULL,
    expected_generation integer NOT NULL CHECK (expected_generation > 0),
    state text NOT NULL DEFAULT 'pending'
        CHECK (state IN ('pending', 'completed', 'cancelled', 'expired')),
    state_hash text NOT NULL UNIQUE,
    nonce text,
    pkce_verifier text,
    authorization_url text,
    exchange_claim_id uuid,
    exchange_lease_until timestamptz,
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
    finished_at timestamptz,
    UNIQUE (slot_id, id),
    UNIQUE (slot_id, id, client_registration_key),
    UNIQUE (slot_id, idempotency_key),
    CHECK ((purpose = 'switch') = (initiating_session_id IS NOT NULL)),
    CHECK ((exchange_claim_id IS NULL) = (exchange_lease_until IS NULL)),
    CHECK (
        (state = 'pending' AND nonce IS NOT NULL AND pkce_verifier IS NOT NULL
            AND authorization_url IS NOT NULL AND finished_at IS NULL)
        OR
        (state <> 'pending' AND nonce IS NULL AND pkce_verifier IS NULL
            AND authorization_url IS NULL AND exchange_claim_id IS NULL AND finished_at IS NOT NULL)
    )
);

CREATE INDEX auth_attempts_pending_expiry
    ON auth_attempts (expires_at, id) WHERE state = 'pending';

CREATE TABLE app_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slot_id uuid NOT NULL REFERENCES app_session_slots (id),
    client_registration_key text NOT NULL,
    account_id uuid NOT NULL REFERENCES accounts (id),
    auth_identity_id uuid NOT NULL,
    auth_attempt_id uuid NOT NULL UNIQUE,
    credential_hash text NOT NULL UNIQUE,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
    account_access_version integer NOT NULL CHECK (account_access_version > 0),
    authenticated_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
    revoked_at timestamptz,
    UNIQUE (slot_id, id),
    FOREIGN KEY (slot_id, auth_attempt_id, client_registration_key)
        REFERENCES auth_attempts (slot_id, id, client_registration_key),
    FOREIGN KEY (account_id, auth_identity_id) REFERENCES auth_identities (account_id, id),
    CHECK ((status = 'revoked') = (revoked_at IS NOT NULL))
);

CREATE UNIQUE INDEX app_sessions_one_active_per_slot
    ON app_sessions (slot_id) WHERE status = 'active';

ALTER TABLE auth_attempts ADD CONSTRAINT auth_attempts_initiating_session_fk
    FOREIGN KEY (slot_id, initiating_session_id) REFERENCES app_sessions (slot_id, id);

CREATE TABLE outbox_events (
    event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    type text NOT NULL,
    schema_version integer NOT NULL CHECK (schema_version > 0),
    account_id uuid NOT NULL REFERENCES accounts (id),
    aggregate_type text NOT NULL,
    aggregate_id uuid NOT NULL,
    aggregate_version integer NOT NULL CHECK (aggregate_version > 0),
    occurred_at timestamptz NOT NULL,
    request_id uuid NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    dispatched_at timestamptz,
    next_retry_at timestamptz
);

CREATE UNIQUE INDEX outbox_one_registration_event_per_account
    ON outbox_events (account_id) WHERE type = 'AccountRegistered.v1';
