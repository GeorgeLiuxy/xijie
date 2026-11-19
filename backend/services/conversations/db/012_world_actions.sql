-- Explicit, finite narrative actions are committed with their reply. This is
-- independent of People's relocation version and of user-reported memories.
ALTER TABLE conversations ADD COLUMN world_event_revision bigint NOT NULL DEFAULT 0 CHECK(world_event_revision>=0);
ALTER TABLE messages ADD COLUMN source_domain text NOT NULL DEFAULT 'private_text' CHECK(source_domain IN('private_text','world_action_pending','virtual_action','virtual_context'));
ALTER TABLE messages ADD CONSTRAINT messages_virtual_domain CHECK(source_domain='private_text' OR(kind='text' AND conversation_kind='direct' AND generation_job_id IS NOT NULL AND photo_reply_job_id IS NULL));
ALTER TABLE generation_jobs ADD COLUMN world_action_authorization_version integer CHECK(world_action_authorization_version>0);
ALTER TABLE generation_jobs ADD COLUMN world_action_decision text CHECK(world_action_decision IN('pending','chat','clarify','execute'));
ALTER TABLE generation_jobs ADD COLUMN world_event_context_refs jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(world_event_context_refs)='array' AND jsonb_array_length(world_event_context_refs)<=32);
ALTER TABLE generation_jobs ADD COLUMN world_action_message_refs jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(world_action_message_refs)='array' AND jsonb_array_length(world_action_message_refs)<=20);
ALTER TABLE generation_jobs ADD COLUMN world_event_revision bigint CHECK(world_event_revision>=0);
ALTER TABLE generation_jobs ADD COLUMN world_action_provenance jsonb;
ALTER TABLE generation_jobs ADD CONSTRAINT generation_world_action_shape CHECK(COALESCE(
 (world_action_authorization_version IS NULL AND world_action_decision IS NULL AND world_event_context_refs='[]' AND world_action_message_refs='[]' AND world_event_revision IS NULL AND world_action_provenance IS NULL)
 OR(world_action_authorization_version IS NOT NULL AND world_action_decision IS NOT NULL AND
  ((state<>'succeeded' AND world_action_decision='pending' AND world_event_context_refs='[]' AND world_action_message_refs='[]' AND world_event_revision IS NULL AND world_action_provenance IS NULL)
   OR(state='succeeded' AND world_action_decision IN('chat','clarify','execute') AND world_event_revision IS NOT NULL AND world_context_ref IS NOT NULL
    AND jsonb_array_length(world_action_message_refs)>0 AND jsonb_typeof(world_action_provenance)='object'
    AND world_action_provenance->>'promptVersion'='person-world-actions-v1'
    AND length(world_action_provenance->>'model') BETWEEN 1 AND 200 AND length(world_action_provenance->>'responseId') BETWEEN 1 AND 300))),false));
ALTER TABLE messages ADD UNIQUE(account_id,conversation_id,id,generation_job_id);
ALTER TABLE messages ADD UNIQUE(account_id,conversation_id,id,generation_job_id,reply_to_message_id,speaker_person_id);
ALTER TABLE generation_jobs ADD UNIQUE(account_id,conversation_id,id,source_message_id,person_id,reply_id);

CREATE TABLE person_world_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),account_id uuid NOT NULL,conversation_id uuid NOT NULL,person_id uuid NOT NULL,
 job_id uuid NOT NULL UNIQUE,source_message_id uuid NOT NULL UNIQUE,source_version integer NOT NULL DEFAULT 1 CHECK(source_version=1),reply_id uuid NOT NULL UNIQUE,
 world_id uuid NOT NULL,world_version integer NOT NULL CHECK(world_version>0),sequence bigint NOT NULL CHECK(sequence>0),version integer NOT NULL DEFAULT 1 CHECK(version=1),
 reality text NOT NULL DEFAULT 'virtual' CHECK(reality='virtual'),branch text NOT NULL DEFAULT 'main' CHECK(branch='main'),
 request_quote text NOT NULL CHECK(char_length(request_quote) BETWEEN 1 AND 4000),summary text NOT NULL CHECK(char_length(summary) BETWEEN 1 AND 600),memory text NOT NULL CHECK(char_length(memory) BETWEEN 1 AND 600),
 source_author text NOT NULL DEFAULT 'self' CHECK(source_author='self'),source_kind text NOT NULL DEFAULT 'text' CHECK(source_kind='text'),
 created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),removed_at timestamptz(3),
 UNIQUE(account_id,id),UNIQUE(conversation_id,sequence),
 FOREIGN KEY(account_id,conversation_id,person_id) REFERENCES conversations(account_id,id,person_id),
 FOREIGN KEY(account_id,conversation_id,source_message_id,source_author,source_kind) REFERENCES messages(account_id,conversation_id,id,author_kind,kind) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(account_id,conversation_id,source_message_id,job_id) REFERENCES messages(account_id,conversation_id,id,generation_job_id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(account_id,conversation_id,reply_id,job_id,source_message_id,person_id) REFERENCES messages(account_id,conversation_id,id,generation_job_id,reply_to_message_id,speaker_person_id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(account_id,conversation_id,job_id,source_message_id,person_id,reply_id) REFERENCES generation_jobs(account_id,conversation_id,id,source_message_id,person_id,reply_id) DEFERRABLE INITIALLY DEFERRED,
 CHECK(removed_at IS NULL OR removed_at>=created_at)
);
CREATE INDEX world_events_context ON person_world_events(account_id,person_id,world_id,world_version,sequence DESC) WHERE removed_at IS NULL;
CREATE TRIGGER world_events_erasure BEFORE INSERT OR UPDATE ON person_world_events FOR EACH ROW EXECUTE FUNCTION enforce_account_erasure_fence();
CREATE FUNCTION protect_world_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF NOT EXISTS(SELECT 1 FROM account_erasure_fences WHERE account_id=OLD.account_id AND erased_at IS NOT NULL) THEN RAISE EXCEPTION 'World events are immutable'; END IF;
  RETURN OLD;
 END IF;
 IF(to_jsonb(NEW)-'removed_at') IS DISTINCT FROM(to_jsonb(OLD)-'removed_at') OR(OLD.removed_at IS NOT NULL AND NEW.removed_at IS DISTINCT FROM OLD.removed_at) THEN RAISE EXCEPTION 'World events are immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER world_event_immutable BEFORE UPDATE OR DELETE ON person_world_events FOR EACH ROW EXECUTE FUNCTION protect_world_event();
CREATE FUNCTION check_world_event_commit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e person_world_events; j generation_jobs; s messages;
BEGIN
 IF TG_TABLE_NAME='person_world_events' THEN SELECT * INTO e FROM person_world_events WHERE id=NEW.id;
 ELSE SELECT * INTO e FROM person_world_events WHERE job_id=NEW.id; END IF;
 IF NOT FOUND THEN
  IF TG_TABLE_NAME='generation_jobs' AND EXISTS(SELECT 1 FROM generation_jobs WHERE id=NEW.id AND state='succeeded' AND world_action_decision='execute') THEN RAISE EXCEPTION 'Missing committed world event'; END IF;
  RETURN NULL;
 END IF;
 SELECT * INTO j FROM generation_jobs WHERE id=e.job_id;
 SELECT * INTO s FROM messages WHERE id=e.source_message_id;
 IF j.state<>'succeeded' OR j.world_action_decision<>'execute' OR j.world_action_authorization_version IS NULL OR
  j.world_context_ref->>'worldId' IS DISTINCT FROM e.world_id::text OR j.world_context_ref->>'worldVersion' IS DISTINCT FROM e.world_version::text OR
  j.world_event_revision+1<>e.sequence OR position(e.request_quote IN s.text)=0 THEN RAISE EXCEPTION 'Invalid world event authority'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER world_event_commit AFTER INSERT OR UPDATE ON person_world_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_world_event_commit();
CREATE CONSTRAINT TRIGGER world_job_commit AFTER INSERT OR UPDATE ON generation_jobs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_world_event_commit();
