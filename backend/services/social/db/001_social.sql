CREATE TABLE social_account_write_gates(
 account_id uuid PRIMARY KEY,request_id uuid,erased_at timestamptz(3),created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),version integer NOT NULL DEFAULT 1 CHECK(version>0),
 CHECK((erased_at IS NULL)=(request_id IS NULL)),CHECK(created_at<=updated_at)
);
CREATE TABLE social_person_sync(
 account_id uuid NOT NULL REFERENCES social_account_write_gates(account_id),person_id uuid NOT NULL,last_projected_world_version integer NOT NULL DEFAULT 1 CHECK(last_projected_world_version>0),person_access_version integer NOT NULL CHECK(person_access_version>0),version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(account_id,person_id),CHECK(created_at<=updated_at)
);
CREATE TABLE posts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),account_id uuid NOT NULL REFERENCES social_account_write_gates(account_id),kind text NOT NULL CHECK(kind IN ('user','world_notice')),status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','removed')),client_post_id uuid,request_hash text,
 body text NOT NULL,person_id uuid,world_id uuid,source_movement_id uuid,source_world_version integer,source_movement jsonb,source_hash text,
 reaction_count integer NOT NULL DEFAULT 0 CHECK(reaction_count>=0),comment_count integer NOT NULL DEFAULT 0 CHECK(comment_count>=0),version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),removed_at timestamptz(3),
 UNIQUE(account_id,id),UNIQUE(account_id,client_post_id),UNIQUE(account_id,source_movement_id),UNIQUE(account_id,person_id,source_world_version),
 CHECK((status='removed')=(removed_at IS NOT NULL)),CHECK(created_at<=updated_at),CHECK(removed_at IS NULL OR (removed_at>=created_at AND removed_at<=updated_at)),
 CHECK(COALESCE((kind='user' AND client_post_id IS NOT NULL AND request_hash ~ '^[a-f0-9]{64}$' AND char_length(body) BETWEEN 1 AND 500 AND person_id IS NULL AND world_id IS NULL AND source_movement_id IS NULL AND source_world_version IS NULL AND source_movement IS NULL AND source_hash IS NULL)
 OR (kind='world_notice' AND client_post_id IS NULL AND request_hash IS NULL AND body='' AND person_id IS NOT NULL AND world_id IS NOT NULL AND source_movement_id IS NOT NULL AND source_world_version>1 AND source_hash ~ '^[a-f0-9]{64}$' AND COALESCE(jsonb_typeof(source_movement)='object' AND source_movement->>'id'=source_movement_id::text AND (source_movement->>'worldVersion')::integer=source_world_version AND source_movement->'toWorld'->>'id'=world_id::text AND jsonb_typeof(source_movement->'fromWorld')='object' AND jsonb_typeof(source_movement->'toWorld')='object',false)),false))
);
CREATE INDEX posts_feed ON posts(account_id,created_at DESC,id DESC) WHERE status='active';
CREATE TABLE post_reactions(
 account_id uuid NOT NULL,post_id uuid NOT NULL,active boolean NOT NULL DEFAULT true,version integer NOT NULL DEFAULT 1 CHECK(version>0),created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(account_id,post_id),FOREIGN KEY(account_id,post_id) REFERENCES posts(account_id,id),CHECK(created_at<=updated_at)
);
CREATE TABLE post_comments(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),account_id uuid NOT NULL,post_id uuid NOT NULL,client_comment_id uuid NOT NULL,request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),body text NOT NULL CHECK(char_length(body) BETWEEN 1 AND 1000),reply_to_comment_id uuid,status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','removed')),version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),removed_at timestamptz(3),
 UNIQUE(account_id,post_id,id),UNIQUE(account_id,client_comment_id),FOREIGN KEY(account_id,post_id) REFERENCES posts(account_id,id),FOREIGN KEY(account_id,post_id,reply_to_comment_id) REFERENCES post_comments(account_id,post_id,id),CHECK(reply_to_comment_id IS DISTINCT FROM id),CHECK((status='removed')=(removed_at IS NOT NULL)),CHECK(created_at<=updated_at),CHECK(removed_at IS NULL OR (removed_at>=created_at AND removed_at<=updated_at))
);
CREATE INDEX post_comments_page ON post_comments(account_id,post_id,created_at,id) WHERE status='active';
CREATE TABLE social_commands(
 account_id uuid NOT NULL REFERENCES social_account_write_gates(account_id),operation text NOT NULL CHECK(operation IN ('create','remove','react','comment','remove_comment')),target text NOT NULL,idempotency_key uuid NOT NULL,request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),resource_id uuid NOT NULL,created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(account_id,operation,target,idempotency_key)
);
CREATE TABLE outbox_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),type text NOT NULL CHECK(type IN ('PostPublished.v1','PostRemoved.v1','PostReactionChanged.v1','PostCommentCreated.v1','PostCommentRemoved.v1')),schema_version integer NOT NULL DEFAULT 1 CHECK(schema_version=1),account_id uuid NOT NULL REFERENCES social_account_write_gates(account_id),aggregate_id uuid NOT NULL,aggregate_version integer NOT NULL CHECK(aggregate_version>0),request_id uuid NOT NULL,payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),occurred_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),UNIQUE(account_id,type,aggregate_id,aggregate_version)
);
CREATE FUNCTION social_payload_write_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE gate social_account_write_gates%ROWTYPE;
BEGIN
 SELECT * INTO gate FROM social_account_write_gates WHERE account_id=NEW.account_id FOR SHARE;
 IF NOT FOUND OR gate.erased_at IS NOT NULL THEN RAISE EXCEPTION 'Account data has been erased.' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER social_sync_write_guard BEFORE INSERT OR UPDATE ON social_person_sync FOR EACH ROW EXECUTE FUNCTION social_payload_write_guard();
CREATE TRIGGER social_posts_write_guard BEFORE INSERT OR UPDATE ON posts FOR EACH ROW EXECUTE FUNCTION social_payload_write_guard();
CREATE TRIGGER social_reactions_write_guard BEFORE INSERT OR UPDATE ON post_reactions FOR EACH ROW EXECUTE FUNCTION social_payload_write_guard();
CREATE TRIGGER social_comments_write_guard BEFORE INSERT OR UPDATE ON post_comments FOR EACH ROW EXECUTE FUNCTION social_payload_write_guard();
CREATE TRIGGER social_commands_write_guard BEFORE INSERT OR UPDATE ON social_commands FOR EACH ROW EXECUTE FUNCTION social_payload_write_guard();
CREATE TRIGGER social_events_write_guard BEFORE INSERT OR UPDATE ON outbox_events FOR EACH ROW EXECUTE FUNCTION social_payload_write_guard();
CREATE FUNCTION social_immutable_movement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.kind='world_notice' AND (NEW.kind,NEW.account_id,NEW.person_id,NEW.world_id,NEW.source_movement_id,NEW.source_world_version,NEW.source_movement,NEW.source_hash,NEW.body,NEW.created_at) IS DISTINCT FROM (OLD.kind,OLD.account_id,OLD.person_id,OLD.world_id,OLD.source_movement_id,OLD.source_world_version,OLD.source_movement,OLD.source_hash,OLD.body,OLD.created_at) THEN RAISE EXCEPTION 'Committed movement projection is immutable.' USING ERRCODE='23514'; END IF;
 IF OLD.status='removed' AND NEW.status<>'removed' THEN RAISE EXCEPTION 'Removed content cannot be revived.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER social_immutable_world BEFORE UPDATE ON posts FOR EACH ROW EXECUTE FUNCTION social_immutable_movement();
CREATE FUNCTION social_validate_counts() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE postkey uuid;owner uuid;p posts%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='posts' THEN postkey:=NEW.id;owner:=NEW.account_id;ELSE postkey:=COALESCE(NEW.post_id,OLD.post_id);owner:=COALESCE(NEW.account_id,OLD.account_id);END IF;
 SELECT * INTO p FROM posts WHERE account_id=owner AND id=postkey;
 IF FOUND AND (p.reaction_count<>(SELECT count(*) FROM post_reactions WHERE account_id=owner AND post_id=postkey AND active) OR p.comment_count<>(SELECT count(*) FROM post_comments WHERE account_id=owner AND post_id=postkey AND status='active')) THEN RAISE EXCEPTION 'Social aggregate counts are inconsistent.' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER social_post_counts AFTER INSERT OR UPDATE ON posts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION social_validate_counts();
CREATE CONSTRAINT TRIGGER social_reaction_counts AFTER INSERT OR UPDATE OR DELETE ON post_reactions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION social_validate_counts();
CREATE CONSTRAINT TRIGGER social_comment_counts AFTER INSERT OR UPDATE OR DELETE ON post_comments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION social_validate_counts();

CREATE FUNCTION social_comment_no_revival() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.status='removed' AND NEW.status<>'removed' THEN RAISE EXCEPTION 'Removed comment cannot be revived.' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER social_comment_terminal BEFORE UPDATE ON post_comments FOR EACH ROW EXECUTE FUNCTION social_comment_no_revival();
