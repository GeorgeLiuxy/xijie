-- The provider's cookies and one-time verification state never enter a client.
ALTER TABLE native_auth_handoffs ADD COLUMN transport text NOT NULL DEFAULT 'browser'
  CHECK (transport IN ('browser','wechat_sdk'));
CREATE TABLE native_wechat_transactions (
  attempt_id uuid PRIMARY KEY REFERENCES native_auth_handoffs(attempt_id) ON DELETE CASCADE,
  connector_id text NOT NULL, app_id text NOT NULL,
  sdk_state_hash text NOT NULL,
  phase text NOT NULL DEFAULT 'pending' CHECK (phase IN
    ('pending','launching','waiting_provider','verifying','principal_verified','verified','unknown','cancelled')),
  launch_key uuid, complete_key uuid, complete_fingerprint text,
  lease_id uuid, lease_until timestamptz,
  private_cipher bytea,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL,
  CHECK (expires_at > created_at),
  CHECK (sdk_state_hash ~ '^[a-f0-9]{64}$')
);
CREATE INDEX native_wechat_expiry ON native_wechat_transactions(expires_at);
