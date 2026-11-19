-- No browser or WebView session credential ever travels in an application link.
ALTER TABLE auth_attempts ADD COLUMN native_handoff boolean NOT NULL DEFAULT false;
CREATE TABLE native_auth_handoffs(
 attempt_id uuid PRIMARY KEY REFERENCES auth_attempts(id),
 browser_hash text NOT NULL,expected_session_id uuid,
 request_fingerprint text NOT NULL,verifier_hash text NOT NULL,launch_hash text NOT NULL,
 external_browser_hash text,launch_used_at timestamptz,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','launched','verified','redeemed','cancelled')),
 claim_id uuid,ticket_hash text,private_cipher bytea,redeem_key uuid,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz NOT NULL,
 verified_until timestamptz,redeemed_at timestamptz,
 CHECK(expires_at>created_at),CHECK((state IN('verified','redeemed'))=(ticket_hash IS NOT NULL)),
 CHECK((state='redeemed')=(redeem_key IS NOT NULL AND redeemed_at IS NOT NULL))
);
CREATE INDEX native_auth_expiry ON native_auth_handoffs(expires_at);
