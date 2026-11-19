-- A stored task must carry the exact AI purpose decision that accepted it.
-- Existing tasks predate this purpose and must not inherit a later grant.
ALTER TABLE generation_jobs
    ADD COLUMN ai_authorization_version integer NOT NULL DEFAULT 0
    CHECK (ai_authorization_version >= 0);

