-- Current membership and committed, user-initiated moves belong to People.
-- Initial placement is world version 1 and does not invent a migration event.
ALTER TABLE persons ADD COLUMN world_version integer NOT NULL DEFAULT 1 CHECK(world_version>0);
ALTER TABLE persons ADD CONSTRAINT persons_world_version_bound CHECK(world_version<=version);
ALTER TABLE person_draft_commands DROP CONSTRAINT person_draft_commands_operation_check;
ALTER TABLE person_draft_commands ADD CONSTRAINT person_draft_commands_operation_check
 CHECK(operation IN ('create','update','preview','confirm','person_update','person_remove','person_world'));

CREATE TABLE person_world_movements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL, person_id uuid NOT NULL,
 world_version integer NOT NULL CHECK(world_version>1), person_version integer NOT NULL CHECK(person_version>1),
 from_world_id uuid NOT NULL REFERENCES worlds(id), to_world_id uuid NOT NULL REFERENCES worlds(id),
 from_world jsonb NOT NULL, to_world jsonb NOT NULL,
 reality text NOT NULL DEFAULT 'virtual' CHECK(reality='virtual'), branch text NOT NULL DEFAULT 'main' CHECK(branch='main'),
 actor_kind text NOT NULL DEFAULT 'user' CHECK(actor_kind='user'), actor_account_id uuid NOT NULL,
 request_id uuid NOT NULL, occurred_at timestamptz(3) NOT NULL, recorded_at timestamptz(3) NOT NULL,
 FOREIGN KEY(account_id,person_id) REFERENCES persons(account_id,id),
 FOREIGN KEY(account_id) REFERENCES account_erasure_fences(account_id),
 UNIQUE(account_id,person_id,world_version), UNIQUE(account_id,person_id,id),
 CHECK(from_world_id<>to_world_id), CHECK(actor_account_id=account_id), CHECK(occurred_at<=recorded_at), CHECK(person_version>=world_version),
 CHECK(COALESCE(jsonb_typeof(from_world)='object' AND from_world->>'id'=from_world_id::text
   AND jsonb_typeof(from_world->'catalogVersion')='number' AND (from_world->>'catalogVersion')::integer>0
   AND jsonb_typeof(from_world->'enabled')='boolean' AND jsonb_typeof(from_world->'code')='string' AND btrim(from_world->>'code')<>'' AND jsonb_typeof(from_world->'displayName')='string' AND btrim(from_world->>'displayName')<>'',false)),
 CHECK(COALESCE(jsonb_typeof(to_world)='object' AND to_world->>'id'=to_world_id::text
   AND jsonb_typeof(to_world->'catalogVersion')='number' AND (to_world->>'catalogVersion')::integer>0
   AND to_world->'enabled'='true'::jsonb AND jsonb_typeof(to_world->'code')='string' AND btrim(to_world->>'code')<>'' AND jsonb_typeof(to_world->'displayName')='string' AND btrim(to_world->>'displayName')<>'',false))
);
CREATE INDEX person_world_movements_history ON person_world_movements(account_id,person_id,world_version DESC);
CREATE TRIGGER person_world_movements_erasure BEFORE INSERT OR UPDATE ON person_world_movements
 FOR EACH ROW EXECUTE FUNCTION enforce_account_erasure_fence();
CREATE FUNCTION forbid_world_movement_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Committed world movements are immutable' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER person_world_movements_immutable BEFORE UPDATE ON person_world_movements
 FOR EACH ROW EXECUTE FUNCTION forbid_world_movement_update();
