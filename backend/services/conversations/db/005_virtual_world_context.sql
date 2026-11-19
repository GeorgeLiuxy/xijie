-- A user-confirmed virtual world state is separate from real-life memories.
-- Existing replies predate this capability and retain a null reference.
ALTER TABLE generation_jobs ADD COLUMN world_context_ref jsonb;
ALTER TABLE generation_jobs ADD CONSTRAINT generation_world_context_reference
 CHECK(world_context_ref IS NULL OR COALESCE((
  jsonb_typeof(world_context_ref)='object'
  AND world_context_ref->>'reality'='virtual' AND world_context_ref->>'branch'='main'
  AND world_context_ref->>'accountId'=account_id::text AND world_context_ref->>'personId'=person_id::text
  AND world_context_ref->>'personVersion'=person_version::text
  AND jsonb_typeof(world_context_ref->'worldVersion')='number'
  AND world_context_ref->>'worldVersion' ~ '^[1-9][0-9]{0,9}$'
  AND world_context_ref->'worldVersion'<=to_jsonb(person_version)
  AND jsonb_typeof(world_context_ref->'catalogVersion')='number'
  AND world_context_ref->>'catalogVersion' ~ '^[1-9][0-9]{0,9}$'
  AND world_context_ref->>'worldId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  AND world_context_ref->>'revision' ~ '^[0-9a-f]{64}$'
  AND CASE WHEN jsonb_typeof(world_context_ref->'movementIds')='array' THEN jsonb_array_length(world_context_ref->'movementIds')<=8 ELSE false END
 ),false));
