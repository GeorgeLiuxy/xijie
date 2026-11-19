-- Narrative branches and explicit, bounded daily life remain Conversations facts.
CREATE TABLE story_branches(
 id uuid PRIMARY KEY,account_id uuid NOT NULL,person_id uuid NOT NULL,main_conversation_id uuid NOT NULL,
 name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 80),version integer NOT NULL DEFAULT 1 CHECK(version>0),account_access_version integer NOT NULL CHECK(account_access_version>0),storage_version integer NOT NULL CHECK(storage_version>0),ai_version integer NOT NULL CHECK(ai_version>0),permission_version integer NOT NULL CHECK(permission_version>0),
 fork_sequence bigint NOT NULL CHECK(fork_sequence>=0),fork_event_revision bigint NOT NULL CHECK(fork_event_revision>=0),scene jsonb NOT NULL CHECK(jsonb_typeof(scene)='object'),
 last_sequence bigint NOT NULL DEFAULT 0,event_revision bigint NOT NULL DEFAULT 0,created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(account_id,id),UNIQUE(account_id,id,person_id),FOREIGN KEY(account_id,main_conversation_id,person_id) REFERENCES conversations(account_id,id,person_id)
);
CREATE TABLE story_messages(
 id uuid PRIMARY KEY,account_id uuid NOT NULL,branch_id uuid NOT NULL,sequence bigint NOT NULL CHECK(sequence>0),
 author_kind text NOT NULL CHECK(author_kind IN('self','persona')),text text NOT NULL CHECK(char_length(text) BETWEEN 1 AND 4000),
 client_message_id uuid,reply_to_message_id uuid,job_id uuid NOT NULL,display_name text,version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),removed_at timestamptz(3),
 UNIQUE(account_id,branch_id,id),UNIQUE(account_id,id),UNIQUE(branch_id,sequence),UNIQUE(branch_id,client_message_id),
 FOREIGN KEY(account_id,branch_id) REFERENCES story_branches(account_id,id),
 FOREIGN KEY(account_id,branch_id,reply_to_message_id) REFERENCES story_messages(account_id,branch_id,id),
 CHECK((author_kind='self' AND client_message_id IS NOT NULL AND reply_to_message_id IS NULL AND display_name IS NULL) OR(author_kind='persona' AND client_message_id IS NULL AND reply_to_message_id IS NOT NULL AND display_name IS NOT NULL)),
 CHECK(removed_at IS NULL OR removed_at>=created_at)
);
CREATE TABLE story_jobs(
 id uuid PRIMARY KEY,account_id uuid NOT NULL,branch_id uuid NOT NULL,person_id uuid NOT NULL,source_message_id uuid NOT NULL UNIQUE,
 source_version integer NOT NULL DEFAULT 1 CHECK(source_version=1),source_hash text NOT NULL,
 account_access_version integer NOT NULL,person_version integer NOT NULL,person_access_version integer NOT NULL,
 storage_version integer NOT NULL,ai_version integer NOT NULL,permission_version integer NOT NULL,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN('queued','running','succeeded','failed','blocked','canceled')),version integer NOT NULL DEFAULT 1,
 attempt_id uuid,attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 3),lease_until timestamptz(3),next_attempt_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),failure_code text,retryable boolean NOT NULL DEFAULT false,reply_id uuid,
 decision text CHECK(decision IN('chat','clarify','execute')),message_refs jsonb NOT NULL DEFAULT '[]',event_refs jsonb NOT NULL DEFAULT '[]',memory_refs jsonb NOT NULL DEFAULT '[]',person_context_ref jsonb,provider_provenance jsonb,
 created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(account_id,id),UNIQUE(account_id,branch_id,id),FOREIGN KEY(account_id,branch_id,person_id) REFERENCES story_branches(account_id,id,person_id),
 FOREIGN KEY(account_id,branch_id,source_message_id) REFERENCES story_messages(account_id,branch_id,id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(account_id,branch_id,reply_id) REFERENCES story_messages(account_id,branch_id,id) DEFERRABLE INITIALLY DEFERRED,
 CHECK((state='running')=(attempt_id IS NOT NULL AND lease_until IS NOT NULL)),CHECK(state='running' OR(attempt_id IS NULL AND lease_until IS NULL)),
 CHECK((state='succeeded')=(reply_id IS NOT NULL)),CHECK((state='succeeded')=(decision IS NOT NULL)),CHECK(NOT retryable OR(state='failed' AND attempt_count<3)),
 CHECK(account_access_version>0 AND person_version>0 AND person_access_version>0 AND storage_version>0 AND ai_version>0 AND permission_version>0)
);
ALTER TABLE story_messages ADD FOREIGN KEY(account_id,branch_id,job_id) REFERENCES story_jobs(account_id,branch_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE UNIQUE INDEX story_one_reply ON story_messages(job_id) WHERE author_kind='persona';
CREATE TABLE story_events(
 id uuid PRIMARY KEY,account_id uuid NOT NULL,branch_id uuid NOT NULL,person_id uuid NOT NULL,job_id uuid NOT NULL UNIQUE,
 source_message_id uuid NOT NULL UNIQUE,reply_id uuid NOT NULL UNIQUE,version integer NOT NULL DEFAULT 1 CHECK(version=1),
 summary text NOT NULL CHECK(char_length(summary) BETWEEN 1 AND 600),memory text NOT NULL CHECK(char_length(memory) BETWEEN 1 AND 600),
 request_quote text NOT NULL,created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),removed_at timestamptz(3),
 FOREIGN KEY(account_id,branch_id,person_id) REFERENCES story_branches(account_id,id,person_id),FOREIGN KEY(account_id,branch_id,job_id) REFERENCES story_jobs(account_id,branch_id,id),
 FOREIGN KEY(account_id,branch_id,source_message_id) REFERENCES story_messages(account_id,branch_id,id),FOREIGN KEY(account_id,branch_id,reply_id) REFERENCES story_messages(account_id,branch_id,id)
);
CREATE TABLE offline_life_plans(
 account_id uuid NOT NULL,person_id uuid NOT NULL,conversation_id uuid NOT NULL,enabled boolean NOT NULL DEFAULT false,time_zone text,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),next_run_at timestamptz(3),last_run_at timestamptz(3),
 account_access_version integer NOT NULL,storage_version integer NOT NULL,ai_version integer NOT NULL,permission_version integer NOT NULL,world_action_version integer NOT NULL,
 created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(account_id,person_id),FOREIGN KEY(account_id,conversation_id,person_id) REFERENCES conversations(account_id,id,person_id),
 CHECK(NOT enabled OR(time_zone IS NOT NULL AND next_run_at IS NOT NULL))
);
CREATE TABLE offline_life_runs(
 id uuid PRIMARY KEY,account_id uuid NOT NULL,person_id uuid NOT NULL,conversation_id uuid NOT NULL,plan_version integer NOT NULL,
 day_key date NOT NULL,local_day date NOT NULL,scheduled_at timestamptz(3) NOT NULL,plan_snapshot jsonb NOT NULL CHECK(jsonb_typeof(plan_snapshot)='object'),
 state text NOT NULL DEFAULT 'queued' CHECK(state IN('queued','running','succeeded','failed','blocked','canceled')),version integer NOT NULL DEFAULT 1,
 attempt_id uuid,attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 3),lease_until timestamptz(3),next_attempt_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),failure_code text,retryable boolean NOT NULL DEFAULT false,
 decision text CHECK(decision IN('none','event')),event_id uuid,person_context_ref jsonb,world_context_ref jsonb,event_refs jsonb NOT NULL DEFAULT '[]',memory_refs jsonb NOT NULL DEFAULT '[]',provider_provenance jsonb,
 created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(account_id,id),UNIQUE(account_id,person_id,day_key),UNIQUE(account_id,person_id,local_day),
 FOREIGN KEY(account_id,person_id) REFERENCES offline_life_plans(account_id,person_id),FOREIGN KEY(account_id,conversation_id,person_id) REFERENCES conversations(account_id,id,person_id),
 CHECK((state='running')=(attempt_id IS NOT NULL AND lease_until IS NOT NULL)),CHECK(state='running' OR(attempt_id IS NULL AND lease_until IS NULL)),
 CHECK((state='succeeded')=(decision IS NOT NULL)),CHECK((decision='event') IS NOT DISTINCT FROM(event_id IS NOT NULL) OR decision IS NULL),
 CHECK(NOT retryable OR(state='failed' AND attempt_count<3))
);
ALTER TABLE person_world_events ALTER COLUMN job_id DROP NOT NULL;
ALTER TABLE person_world_events ALTER COLUMN source_message_id DROP NOT NULL;
ALTER TABLE person_world_events ALTER COLUMN reply_id DROP NOT NULL;
ALTER TABLE person_world_events ALTER COLUMN source_author DROP NOT NULL;
ALTER TABLE person_world_events DROP CONSTRAINT person_world_events_source_kind_check;
ALTER TABLE person_world_events ADD COLUMN life_run_id uuid UNIQUE;
ALTER TABLE person_world_events ADD CONSTRAINT world_event_source_shape CHECK(
 (source_kind='text' AND source_author='self' AND job_id IS NOT NULL AND source_message_id IS NOT NULL AND reply_id IS NOT NULL AND life_run_id IS NULL)
 OR(source_kind='offline_life' AND source_author IS NULL AND job_id IS NULL AND source_message_id IS NULL AND reply_id IS NULL AND life_run_id IS NOT NULL));
ALTER TABLE person_world_events ADD FOREIGN KEY(account_id,life_run_id) REFERENCES offline_life_runs(account_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE offline_life_runs ADD FOREIGN KEY(account_id,event_id) REFERENCES person_world_events(account_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE OR REPLACE FUNCTION check_world_event_commit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e person_world_events; j generation_jobs; s messages; r offline_life_runs;
BEGIN
 IF TG_TABLE_NAME='person_world_events' THEN SELECT * INTO e FROM person_world_events WHERE id=NEW.id;
 ELSE SELECT * INTO e FROM person_world_events WHERE job_id=NEW.id; END IF;
 IF NOT FOUND THEN
  IF TG_TABLE_NAME='generation_jobs' AND EXISTS(SELECT 1 FROM generation_jobs WHERE id=NEW.id AND state='succeeded' AND world_action_decision='execute') THEN RAISE EXCEPTION 'Missing committed world event'; END IF; RETURN NULL;
 END IF;
 IF e.source_kind='offline_life' THEN
  SELECT * INTO r FROM offline_life_runs WHERE id=e.life_run_id;
  IF r.state<>'succeeded' OR r.decision<>'event' OR r.event_id<>e.id OR r.person_id<>e.person_id OR r.conversation_id<>e.conversation_id OR r.world_context_ref->>'worldId' IS DISTINCT FROM e.world_id::text OR r.world_context_ref->>'worldVersion' IS DISTINCT FROM e.world_version::text THEN RAISE EXCEPTION 'Invalid offline event authority'; END IF;
 ELSE
  SELECT * INTO j FROM generation_jobs WHERE id=e.job_id;SELECT * INTO s FROM messages WHERE id=e.source_message_id;
  IF j.state<>'succeeded' OR j.world_action_decision<>'execute' OR j.world_action_authorization_version IS NULL OR j.world_context_ref->>'worldId' IS DISTINCT FROM e.world_id::text OR j.world_context_ref->>'worldVersion' IS DISTINCT FROM e.world_version::text OR j.world_event_revision+1<>e.sequence OR position(e.request_quote IN s.text)=0 THEN RAISE EXCEPTION 'Invalid world event authority'; END IF;
 END IF;RETURN NULL;
END $$;
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['story_branches','story_messages','story_jobs','story_events','offline_life_plans','offline_life_runs'] LOOP EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION enforce_account_erasure_fence()',t||'_erasure',t); END LOOP; END $$;
CREATE INDEX story_jobs_recovery ON story_jobs(state,next_attempt_at);
CREATE INDEX life_runs_recovery ON offline_life_runs(state,next_attempt_at);
CREATE FUNCTION check_story_commit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE j story_jobs; s story_messages; r story_messages; e story_events;
BEGIN
 IF TG_TABLE_NAME='story_jobs' THEN SELECT * INTO j FROM story_jobs WHERE id=NEW.id;
 ELSE SELECT * INTO j FROM story_jobs WHERE id=NEW.job_id; END IF;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO s FROM story_messages WHERE id=j.source_message_id;
 IF NOT FOUND OR s.account_id<>j.account_id OR s.branch_id<>j.branch_id OR s.author_kind<>'self' OR s.job_id<>j.id THEN RAISE EXCEPTION 'Invalid branch source'; END IF;
 IF j.state='succeeded' THEN
  SELECT * INTO r FROM story_messages WHERE id=j.reply_id;
  IF NOT FOUND OR r.account_id<>j.account_id OR r.branch_id<>j.branch_id OR r.author_kind<>'persona' OR r.job_id<>j.id OR r.reply_to_message_id<>s.id THEN RAISE EXCEPTION 'Invalid branch reply'; END IF;
  SELECT * INTO e FROM story_events WHERE job_id=j.id;
  IF (j.decision='execute')<>FOUND THEN RAISE EXCEPTION 'Invalid branch execution'; END IF;
  IF FOUND AND(e.account_id<>j.account_id OR e.branch_id<>j.branch_id OR e.person_id<>j.person_id OR e.source_message_id<>s.id OR e.reply_id<>r.id OR position(e.request_quote IN s.text)=0) THEN RAISE EXCEPTION 'Invalid branch event'; END IF;
  IF COALESCE(j.provider_provenance->>'provider','')<>'openai' OR COALESCE(j.provider_provenance->>'promptVersion','')<>'person-story-branches-v1' OR COALESCE(length(j.provider_provenance->>'responseId'),0) NOT BETWEEN 1 AND 300 THEN RAISE EXCEPTION 'Invalid branch provenance'; END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER story_job_commit AFTER INSERT OR UPDATE ON story_jobs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_story_commit();
CREATE CONSTRAINT TRIGGER story_event_commit AFTER INSERT OR UPDATE ON story_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_story_commit();
CREATE TRIGGER story_event_immutable BEFORE UPDATE OR DELETE ON story_events FOR EACH ROW EXECUTE FUNCTION protect_world_event();
CREATE FUNCTION protect_story_branch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN IF NOT EXISTS(SELECT 1 FROM account_erasure_fences WHERE account_id=OLD.account_id AND erased_at IS NOT NULL) THEN RAISE EXCEPTION 'Story forks are immutable'; END IF;RETURN OLD;END IF;
 IF(to_jsonb(NEW)-ARRAY['last_sequence','event_revision','version']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['last_sequence','event_revision','version']) THEN RAISE EXCEPTION 'Story forks are immutable'; END IF;RETURN NEW;
END $$;
CREATE TRIGGER story_fork_immutable BEFORE UPDATE OR DELETE ON story_branches FOR EACH ROW EXECUTE FUNCTION protect_story_branch();
CREATE FUNCTION check_offline_commit() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE e person_world_events;BEGIN
 IF NEW.state='succeeded' THEN
  IF COALESCE(NEW.provider_provenance->>'provider','')<>'openai' OR COALESCE(NEW.provider_provenance->>'promptVersion','')<>'person-offline-life-v1' OR COALESCE(length(NEW.provider_provenance->>'responseId'),0) NOT BETWEEN 1 AND 300 THEN RAISE EXCEPTION 'Invalid offline provenance'; END IF;
  SELECT * INTO e FROM person_world_events WHERE life_run_id=NEW.id;
  IF(NEW.decision='event')<>FOUND THEN RAISE EXCEPTION 'Missing offline event'; END IF;
  IF FOUND AND(e.id<>NEW.event_id OR e.account_id<>NEW.account_id OR e.person_id<>NEW.person_id OR e.conversation_id<>NEW.conversation_id) THEN RAISE EXCEPTION 'Invalid offline event owner'; END IF;
 END IF;RETURN NULL;END $$;
CREATE CONSTRAINT TRIGGER offline_run_commit AFTER INSERT OR UPDATE ON offline_life_runs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_offline_commit();
CREATE FUNCTION protect_story_message() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN IF NOT EXISTS(SELECT 1 FROM account_erasure_fences WHERE account_id=OLD.account_id AND erased_at IS NOT NULL) THEN RAISE EXCEPTION 'Story messages retain source receipts'; END IF;RETURN OLD;END IF;
 IF(to_jsonb(NEW)-ARRAY['removed_at','version']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['removed_at','version']) OR OLD.removed_at IS NOT NULL OR NEW.removed_at IS NULL OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Story text is immutable'; END IF;RETURN NEW;
END $$;
CREATE TRIGGER story_message_immutable BEFORE UPDATE OR DELETE ON story_messages FOR EACH ROW EXECUTE FUNCTION protect_story_message();
CREATE FUNCTION protect_story_acceptance() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN IF NOT EXISTS(SELECT 1 FROM account_erasure_fences WHERE account_id=OLD.account_id AND erased_at IS NOT NULL) THEN RAISE EXCEPTION 'Story acceptance is immutable'; END IF;RETURN OLD;END IF;
 IF(to_jsonb(NEW)-ARRAY['state','version','attempt_id','attempt_count','lease_until','next_attempt_at','failure_code','retryable','reply_id','decision','message_refs','event_refs','memory_refs','person_context_ref','world_context_ref','provider_provenance','event_id','updated_at']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['state','version','attempt_id','attempt_count','lease_until','next_attempt_at','failure_code','retryable','reply_id','decision','message_refs','event_refs','memory_refs','person_context_ref','world_context_ref','provider_provenance','event_id','updated_at']) THEN RAISE EXCEPTION 'Story acceptance is immutable'; END IF;RETURN NEW;
END $$;
CREATE TRIGGER story_job_acceptance BEFORE UPDATE OR DELETE ON story_jobs FOR EACH ROW EXECUTE FUNCTION protect_story_acceptance();
CREATE TRIGGER offline_run_acceptance BEFORE UPDATE OR DELETE ON offline_life_runs FOR EACH ROW EXECUTE FUNCTION protect_story_acceptance();
