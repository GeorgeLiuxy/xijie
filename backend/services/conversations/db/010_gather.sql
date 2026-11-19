ALTER TABLE conversations DROP CONSTRAINT conversations_kind_check;
ALTER TABLE conversations ALTER COLUMN person_id DROP NOT NULL;
ALTER TABLE conversations ADD COLUMN world_id uuid;
ALTER TABLE conversations ADD CONSTRAINT conversations_target CHECK((kind='direct' AND person_id IS NOT NULL AND world_id IS NULL) OR(kind='gather' AND person_id IS NULL AND world_id IS NOT NULL));
ALTER TABLE conversations ADD UNIQUE(account_id,id,kind);
ALTER TABLE conversations ADD UNIQUE(account_id,id,kind,world_id);
CREATE UNIQUE INDEX conversations_gather_world ON conversations(account_id,world_id) WHERE kind='gather';
ALTER TABLE messages ADD COLUMN conversation_kind text NOT NULL DEFAULT 'direct';
ALTER TABLE messages ADD COLUMN gather_reply_job_id uuid;
ALTER TABLE messages ADD CONSTRAINT messages_conversation_kind_fk FOREIGN KEY(account_id,conversation_id,conversation_kind) REFERENCES conversations(account_id,id,kind);
ALTER TABLE generation_jobs ADD COLUMN conversation_kind text NOT NULL DEFAULT 'direct' CHECK(conversation_kind='direct');
ALTER TABLE generation_jobs ADD CONSTRAINT jobs_direct_fk FOREIGN KEY(account_id,conversation_id,conversation_kind) REFERENCES conversations(account_id,id,kind);

CREATE TABLE gather_reply_jobs(
 id uuid PRIMARY KEY,account_id uuid NOT NULL,conversation_id uuid NOT NULL,conversation_kind text NOT NULL DEFAULT 'gather' CHECK(conversation_kind='gather'),world_id uuid NOT NULL,
 source_message_id uuid NOT NULL UNIQUE,source_version integer NOT NULL CHECK(source_version>0),roster_revision text NOT NULL CHECK(roster_revision~'^[a-f0-9]{64}$'),eligible_count integer NOT NULL CHECK(eligible_count BETWEEN 2 AND 1000),
 state text NOT NULL DEFAULT 'queued' CHECK(state IN('queued','running','succeeded','failed','blocked','canceled')),version integer NOT NULL DEFAULT 1 CHECK(version>0),
 account_access_version integer NOT NULL CHECK(account_access_version>0),story_authorization_version integer NOT NULL CHECK(story_authorization_version>0),gather_authorization_version integer NOT NULL CHECK(gather_authorization_version>0),memory_ai_authorization_version integer CHECK(memory_ai_authorization_version>0),
 created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(account_id,id),UNIQUE(account_id,conversation_id,id),
 FOREIGN KEY(account_id,conversation_id,conversation_kind,world_id) REFERENCES conversations(account_id,id,kind,world_id),
 FOREIGN KEY(account_id,conversation_id,source_message_id) REFERENCES messages(account_id,conversation_id,id),CHECK(created_at<=updated_at)
);
CREATE TABLE gather_reply_participants(
 account_id uuid NOT NULL,job_id uuid NOT NULL,person_id uuid NOT NULL,position smallint NOT NULL CHECK(position BETWEEN 1 AND 3),
 display_name text NOT NULL,person_version integer NOT NULL CHECK(person_version>0),person_access_version integer NOT NULL CHECK(person_access_version>0),world_version integer NOT NULL CHECK(world_version>0),
 created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(account_id,job_id,person_id),UNIQUE(job_id,position),
 FOREIGN KEY(account_id,job_id) REFERENCES gather_reply_jobs(account_id,id)
);
CREATE TABLE gather_reply_slots(
 account_id uuid NOT NULL,job_id uuid NOT NULL,person_id uuid NOT NULL,conversation_id uuid NOT NULL,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN('queued','running','succeeded','failed','blocked','canceled')),version integer NOT NULL DEFAULT 1 CHECK(version>0),
 attempt_id uuid,attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 3),lease_until timestamptz(3),next_attempt_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 failure_code text,retryable boolean NOT NULL DEFAULT false,reply_id uuid,
 person_context_ref jsonb,world_context_ref jsonb,context_message_refs jsonb NOT NULL DEFAULT '[]',memory_context_refs jsonb NOT NULL DEFAULT '[]',provider_provenance jsonb,
 created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(account_id,job_id,person_id),
 FOREIGN KEY(account_id,job_id,person_id) REFERENCES gather_reply_participants(account_id,job_id,person_id),
 FOREIGN KEY(account_id,conversation_id,job_id) REFERENCES gather_reply_jobs(account_id,conversation_id,id),
 FOREIGN KEY(account_id,conversation_id,reply_id) REFERENCES messages(account_id,conversation_id,id) DEFERRABLE INITIALLY DEFERRED,
 CHECK((state='running' AND attempt_id IS NOT NULL AND lease_until IS NOT NULL) OR(state<>'running' AND attempt_id IS NULL AND lease_until IS NULL)),
 CHECK((state='succeeded')=(reply_id IS NOT NULL)),CHECK(NOT retryable OR(state='failed' AND attempt_count<3)),
 CHECK(jsonb_typeof(context_message_refs)='array' AND jsonb_typeof(memory_context_refs)='array'),CHECK(created_at<=updated_at)
);
CREATE INDEX gather_slots_recovery ON gather_reply_slots(state,next_attempt_at,updated_at);
ALTER TABLE messages ADD CONSTRAINT messages_gather_job_fk FOREIGN KEY(account_id,conversation_id,gather_reply_job_id) REFERENCES gather_reply_jobs(account_id,conversation_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE messages DROP CONSTRAINT messages_text_persona_source;
ALTER TABLE messages ADD CONSTRAINT messages_text_persona_source CHECK(kind<>'text' OR author_kind<>'persona' OR(reply_to_message_id IS NOT NULL AND speaker_person_id IS NOT NULL AND display_name IS NOT NULL AND ((conversation_kind='direct' AND generation_job_id IS NOT NULL AND gather_reply_job_id IS NULL) OR(conversation_kind='gather' AND gather_reply_job_id IS NOT NULL AND generation_job_id IS NULL))));
ALTER TABLE messages ADD CONSTRAINT messages_gather_shape CHECK((conversation_kind='direct' AND gather_reply_job_id IS NULL) OR(conversation_kind='gather' AND kind='text' AND generation_job_id IS NULL AND gather_reply_job_id IS NOT NULL));
CREATE UNIQUE INDEX messages_gather_speaker ON messages(gather_reply_job_id,speaker_person_id) WHERE conversation_kind='gather' AND author_kind='persona';

CREATE FUNCTION protect_gather_participant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' OR NOT EXISTS(SELECT 1 FROM account_erasure_fences WHERE account_id=OLD.account_id AND erased_at IS NOT NULL) THEN RAISE EXCEPTION 'Gather participants are immutable'; END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER gather_participants_immutable BEFORE UPDATE OR DELETE ON gather_reply_participants FOR EACH ROW EXECUTE FUNCTION protect_gather_participant();
CREATE FUNCTION check_gather_roster() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid;
BEGIN
 IF TG_TABLE_NAME='gather_reply_jobs' THEN target=NEW.id; ELSE target=NEW.job_id; END IF;
 IF EXISTS(SELECT 1 FROM gather_reply_jobs WHERE id=target) AND ((SELECT count(*) FROM gather_reply_participants WHERE job_id=target)<>(SELECT LEAST(eligible_count,3) FROM gather_reply_jobs WHERE id=target) OR (SELECT count(*) FROM gather_reply_slots WHERE job_id=target)<>(SELECT LEAST(eligible_count,3) FROM gather_reply_jobs WHERE id=target)) THEN RAISE EXCEPTION 'A gather round requires its exact accepted participants and slots'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER gather_jobs_roster AFTER INSERT ON gather_reply_jobs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_gather_roster();
CREATE CONSTRAINT TRIGGER gather_participants_roster AFTER INSERT ON gather_reply_participants DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_gather_roster();
ALTER TABLE messages ADD UNIQUE(account_id,conversation_id,id,gather_reply_job_id,speaker_person_id);
ALTER TABLE gather_reply_slots ADD CONSTRAINT gather_slot_reply_owner FOREIGN KEY(account_id,conversation_id,reply_id,job_id,person_id) REFERENCES messages(account_id,conversation_id,id,gather_reply_job_id,speaker_person_id) DEFERRABLE INITIALLY DEFERRED;
CREATE TRIGGER gather_jobs_erasure BEFORE INSERT OR UPDATE ON gather_reply_jobs FOR EACH ROW EXECUTE FUNCTION enforce_account_erasure_fence();
CREATE TRIGGER gather_participants_erasure BEFORE INSERT OR UPDATE ON gather_reply_participants FOR EACH ROW EXECUTE FUNCTION enforce_account_erasure_fence();
CREATE TRIGGER gather_slots_erasure BEFORE INSERT OR UPDATE ON gather_reply_slots FOR EACH ROW EXECUTE FUNCTION enforce_account_erasure_fence();
CREATE FUNCTION protect_gather_acceptance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF NOT EXISTS(SELECT 1 FROM account_erasure_fences WHERE account_id=OLD.account_id AND erased_at IS NOT NULL) THEN RAISE EXCEPTION 'Gather acceptance is immutable'; END IF;
  RETURN OLD;
 END IF;
 IF (to_jsonb(NEW)-ARRAY['state','version','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','version','updated_at']) THEN RAISE EXCEPTION 'Gather acceptance is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER gather_acceptance_immutable BEFORE UPDATE OR DELETE ON gather_reply_jobs FOR EACH ROW EXECUTE FUNCTION protect_gather_acceptance();
ALTER TABLE gather_reply_slots ADD CONSTRAINT gather_success_provenance CHECK(state<>'succeeded' OR COALESCE(jsonb_typeof(person_context_ref)='object' AND person_context_ref->>'id'=person_id::text AND jsonb_typeof(world_context_ref)='object' AND jsonb_typeof(provider_provenance)='object' AND provider_provenance->>'provider'='openai' AND provider_provenance->>'promptVersion'='person-gather-replies-v1' AND jsonb_array_length(context_message_refs)>0,false));
