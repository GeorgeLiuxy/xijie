-- People owns ordered references. Media owns the private immutable image bytes.
-- The draft ID remains the source identity when a person is confirmed.
CREATE TABLE person_draft_media (
 account_id uuid NOT NULL,
 draft_id uuid NOT NULL,
 media_id uuid NOT NULL,
 position smallint NOT NULL CHECK(position BETWEEN 1 AND 6),
 media_version integer NOT NULL CHECK(media_version>0),
 mime_type text NOT NULL CHECK(mime_type='image/webp'),
 byte_size integer NOT NULL CHECK(byte_size BETWEEN 1 AND 1048576),
 width integer NOT NULL CHECK(width BETWEEN 1 AND 2048),
 height integer NOT NULL CHECK(height BETWEEN 1 AND 2048),
 created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(account_id,draft_id,media_id),
 UNIQUE(account_id,media_id),
 UNIQUE(account_id,draft_id,position),
 FOREIGN KEY(account_id,draft_id) REFERENCES person_drafts(account_id,id)
);
CREATE TRIGGER person_draft_media_erasure BEFORE INSERT OR UPDATE ON person_draft_media
 FOR EACH ROW EXECUTE FUNCTION enforce_account_erasure_fence();
