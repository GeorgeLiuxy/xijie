ALTER TABLE letters
 ADD COLUMN source_memory_id uuid,
 ADD COLUMN source_memory_version integer,
 ADD CONSTRAINT letter_memory_reference CHECK (
  (source_memory_id IS NULL AND source_memory_version IS NULL)
  OR (source_memory_id IS NOT NULL AND source_memory_version IS NOT NULL AND source_memory_version > 0)
 );
