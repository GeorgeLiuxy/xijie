ALTER TABLE automatic_memory_entries
 ADD COLUMN corrected_topic text CHECK(char_length(corrected_topic) BETWEEN 1 AND 120),
 ADD COLUMN corrected_body text CHECK(char_length(corrected_body) BETWEEN 1 AND 600),
 ADD COLUMN corrected_at timestamptz(3),
 ADD COLUMN last_control_key uuid,
 ADD COLUMN last_control_hash text CHECK(last_control_hash ~ '^[a-f0-9]{64}$'),
 ADD CONSTRAINT automatic_memory_correction_complete CHECK (
  (corrected_topic IS NULL) = (corrected_body IS NULL)
  AND (corrected_body IS NULL) = (corrected_at IS NULL)
 ),
 ADD CONSTRAINT automatic_memory_control_complete CHECK ((last_control_key IS NULL) = (last_control_hash IS NULL));
