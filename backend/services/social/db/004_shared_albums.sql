CREATE TABLE shared_albums (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL, person_id uuid NOT NULL,
 title text NOT NULL CHECK(char_length(title) BETWEEN 1 AND 40), message text NOT NULL CHECK(char_length(message) BETWEEN 1 AND 500),
 token_hash text NOT NULL UNIQUE CHECK(length(token_hash)=64), token_cipher text NOT NULL,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','closed')), version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(), closed_at timestamptz(3)
);
CREATE INDEX shared_albums_owner ON shared_albums(account_id,created_at,id);
CREATE TABLE shared_album_contributions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), album_id uuid NOT NULL REFERENCES shared_albums(id) ON DELETE CASCADE,
 visitor_hash text NOT NULL CHECK(length(visitor_hash)=64), author_account_id uuid,
 body text NOT NULL CHECK(char_length(body)<=500), status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','withdrawn')),
 seat integer CHECK(seat BETWEEN 1 AND 5), version integer NOT NULL DEFAULT 1 CHECK(version>0),
 rejection_reason text CHECK(rejection_reason IN ('not_suitable','unsafe','capacity')),
 allow_adoption boolean NOT NULL CHECK(allow_adoption), created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(album_id,visitor_hash), CHECK((status='approved')=(seat IS NOT NULL)), CHECK(status='withdrawn' OR char_length(body)>0)
);
CREATE UNIQUE INDEX shared_album_seats ON shared_album_contributions(album_id,seat) WHERE seat IS NOT NULL;
CREATE UNIQUE INDEX shared_album_account_claim ON shared_album_contributions(album_id,author_account_id) WHERE author_account_id IS NOT NULL;
CREATE TABLE shared_album_commands (
 actor text NOT NULL, idempotency_key uuid NOT NULL, operation text NOT NULL, request_hash text NOT NULL,
 album_id uuid NOT NULL REFERENCES shared_albums(id) ON DELETE CASCADE, resource_id uuid NOT NULL,
 created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(actor,idempotency_key)
);
CREATE TABLE shared_album_decisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), album_id uuid NOT NULL REFERENCES shared_albums(id) ON DELETE CASCADE,
 contribution_id uuid REFERENCES shared_album_contributions(id) ON DELETE CASCADE, actor_account_id uuid, visitor_hash text,
 decision text NOT NULL CHECK(decision IN ('create','submit_allow_adoption','approve','reject','withdraw','close','adopt','claim_reward')),
 rules_version integer NOT NULL DEFAULT 1 CHECK(rules_version=1), reviewer text, reason text,
 created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION shared_album_decision_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Participation decisions are append only.' USING ERRCODE='23514'; END $$;
CREATE TRIGGER shared_album_decision_no_update BEFORE UPDATE ON shared_album_decisions FOR EACH ROW EXECUTE FUNCTION shared_album_decision_immutable();
CREATE TABLE shared_album_adoptions (
 contribution_id uuid PRIMARY KEY REFERENCES shared_album_contributions(id) ON DELETE CASCADE,
 album_id uuid NOT NULL REFERENCES shared_albums(id) ON DELETE CASCADE, account_id uuid NOT NULL, person_id uuid NOT NULL,
 source_version integer NOT NULL CHECK(source_version>0), status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','fulfilled','revoked')),
 memory_id uuid, recovery_blocked boolean NOT NULL DEFAULT false, created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CHECK(status<>'fulfilled' OR memory_id IS NOT NULL)
);
CREATE TABLE shared_album_rewards (
 album_id uuid NOT NULL REFERENCES shared_albums(id) ON DELETE CASCADE, account_id uuid NOT NULL,
 contribution_id uuid NOT NULL UNIQUE REFERENCES shared_album_contributions(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','fulfilled','canceled')), receipt_id uuid, granted_at timestamptz(3), dispatch_started_at timestamptz(3), recovery_blocked boolean NOT NULL DEFAULT false,
 created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(album_id,account_id),
 CHECK((status='fulfilled' AND receipt_id IS NOT NULL AND granted_at IS NOT NULL) OR (status<>'fulfilled' AND receipt_id IS NULL AND granted_at IS NULL))
);
-- Source revocation survives deletion of the public aggregate. It contains no author identity or text.
CREATE TABLE shared_album_source_cleanup (
 contribution_id uuid PRIMARY KEY, album_id uuid NOT NULL, account_id uuid NOT NULL, erasing_account_ids uuid[] NOT NULL DEFAULT '{}', recovery_blocked boolean NOT NULL DEFAULT false,
 created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);
