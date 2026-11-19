-- Invitation participation is resource-scoped and never grants a private-data purpose.
CREATE TABLE referral_links(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),account_id uuid NOT NULL REFERENCES accounts(id),
 campaign text NOT NULL DEFAULT 'first-memory-v1' CHECK(campaign='first-memory-v1'),
 public_name text NOT NULL CHECK(char_length(public_name) BETWEEN 1 AND 32 AND btrim(public_name)<>''),
 token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),token_cipher text NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 rules_accepted_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),revoked_at timestamptz(3),
 CHECK(revoked_at IS NULL OR revoked_at>=created_at)
);
CREATE UNIQUE INDEX referral_one_active_link ON referral_links(account_id,campaign) WHERE revoked_at IS NULL;
CREATE TABLE referral_commands(
 account_id uuid NOT NULL REFERENCES accounts(id),operation text NOT NULL CHECK(operation IN('create','revoke')),
 idempotency_key uuid NOT NULL,request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 link_id uuid NOT NULL REFERENCES referral_links(id) ON DELETE CASCADE,created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(account_id,idempotency_key)
);
CREATE TABLE referral_join_intents(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),link_id uuid NOT NULL REFERENCES referral_links(id) ON DELETE CASCADE,
 browser_hash text NOT NULL CHECK(browser_hash ~ '^[a-f0-9]{64}$'),idempotency_key uuid NOT NULL,
 campaign text NOT NULL DEFAULT 'first-memory-v1' CHECK(campaign='first-memory-v1'),
 created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz(3) NOT NULL DEFAULT(clock_timestamp()+interval '24 hours'),
 rules_accepted_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),closed_at timestamptz(3),
 consumed_account_id uuid REFERENCES accounts(id),consumed_at timestamptz(3),
 UNIQUE(browser_hash,idempotency_key),CHECK(expires_at>created_at),
 CHECK((consumed_account_id IS NULL)=(consumed_at IS NULL)),CHECK(consumed_at IS NULL OR closed_at IS NOT NULL)
);
CREATE INDEX referral_browser_intents ON referral_join_intents(browser_hash,created_at DESC,id DESC) WHERE closed_at IS NULL;
CREATE TABLE referral_auth_bindings(
 attempt_id uuid PRIMARY KEY REFERENCES auth_attempts(id) ON DELETE CASCADE,
 intent_id uuid NOT NULL REFERENCES referral_join_intents(id) ON DELETE CASCADE
);
CREATE TABLE referral_attributions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),link_id uuid NOT NULL REFERENCES referral_links(id) ON DELETE CASCADE,
 intent_id uuid NOT NULL UNIQUE REFERENCES referral_join_intents(id) ON DELETE CASCADE,
 inviter_account_id uuid NOT NULL REFERENCES accounts(id),invitee_account_id uuid NOT NULL UNIQUE REFERENCES accounts(id),
 registration_id uuid NOT NULL UNIQUE,campaign text NOT NULL DEFAULT 'first-memory-v1' CHECK(campaign='first-memory-v1'),
 registered_at timestamptz(3) NOT NULL,state text NOT NULL DEFAULT 'awaiting_memory' CHECK(state IN('awaiting_memory','rewarded')),
 receipt_id uuid UNIQUE,qualified_at timestamptz(3),rewarded_at timestamptz(3),
 CHECK(inviter_account_id<>invitee_account_id),CHECK(qualified_at IS NULL OR qualified_at>=registered_at),
 CHECK((state='rewarded')=(receipt_id IS NOT NULL AND qualified_at IS NOT NULL AND rewarded_at IS NOT NULL)),
 CHECK(state='rewarded' OR(receipt_id IS NULL AND qualified_at IS NULL AND rewarded_at IS NULL))
);
CREATE INDEX referral_inviter_records ON referral_attributions(inviter_account_id,registered_at DESC,id DESC);
-- The surviving recipient keeps their own award fact without the erased peer ID.
CREATE TABLE referral_reward_receipts(
 account_id uuid NOT NULL REFERENCES accounts(id),attribution_id uuid NOT NULL,receipt_id uuid NOT NULL,
 role text NOT NULL CHECK(role IN('inviter','invitee')),qualified_at timestamptz(3) NOT NULL,rewarded_at timestamptz(3) NOT NULL,
 PRIMARY KEY(account_id,attribution_id),UNIQUE(account_id,receipt_id)
);
