-- Photos are a separate resource. No delivery version, arrival or return-job changes.
CREATE TABLE gift_delivery_photos (
 account_id uuid NOT NULL REFERENCES gifts_account_write_gates(account_id),
 delivery_id uuid NOT NULL,
 version integer NOT NULL CHECK(version>=2),
 media_id uuid NOT NULL,
 media_version integer NOT NULL CHECK(media_version>0),
 mime_type text NOT NULL CHECK(mime_type='image/webp'),
 byte_size integer NOT NULL CHECK(byte_size>0),
 width integer NOT NULL CHECK(width>0),height integer NOT NULL CHECK(height>0),
 origin text NOT NULL DEFAULT 'journey_capture' CHECK(origin='journey_capture'),
 account_access_version integer NOT NULL CHECK(account_access_version>0),
 gift_authorization_version integer NOT NULL CHECK(gift_authorization_version>0),
 photo_authorization_version integer NOT NULL CHECK(photo_authorization_version>0),
 created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(account_id,delivery_id),
 FOREIGN KEY(account_id,delivery_id) REFERENCES gift_deliveries(account_id,id)
);
CREATE TABLE gift_photo_commands (
 account_id uuid NOT NULL REFERENCES gifts_account_write_gates(account_id),
 acceptance_key uuid NOT NULL,
 delivery_id uuid NOT NULL,
 requested_media_id uuid NOT NULL,
 request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 expected_version integer NOT NULL CHECK(expected_version>0),
 result_version integer NOT NULL CHECK(result_version=expected_version+1),
 created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(account_id,acceptance_key),
 FOREIGN KEY(account_id,delivery_id) REFERENCES gift_delivery_photos(account_id,delivery_id)
);
CREATE TRIGGER gift_delivery_photos_gate BEFORE INSERT OR UPDATE ON gift_delivery_photos FOR EACH ROW EXECUTE FUNCTION gifts_write_gate();
CREATE TRIGGER gift_photo_commands_gate BEFORE INSERT ON gift_photo_commands FOR EACH ROW EXECUTE FUNCTION gifts_write_gate();
CREATE TRIGGER immutable_gift_photo_commands BEFORE UPDATE OR DELETE ON gift_photo_commands FOR EACH ROW EXECUTE FUNCTION immutable_gifts_ledger();
