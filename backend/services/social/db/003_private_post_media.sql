-- Independent Media metadata references; immutable photo bytes remain owned by Media.
-- No FK crosses a service database. Target/source validity is checked by the controlled source interface.
ALTER TABLE posts DROP CONSTRAINT posts_source_shape;
CREATE TABLE post_media(
 account_id uuid NOT NULL REFERENCES social_account_write_gates(account_id),post_id uuid NOT NULL,media_id uuid NOT NULL,position smallint NOT NULL CHECK(position BETWEEN 1 AND 9),
 media_version integer NOT NULL CHECK(media_version>0),mime_type text NOT NULL CHECK(mime_type='image/webp'),byte_size integer NOT NULL CHECK(byte_size BETWEEN 1 AND 1048576),width integer NOT NULL CHECK(width BETWEEN 1 AND 2048),height integer NOT NULL CHECK(height BETWEEN 1 AND 2048),
 created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(account_id,post_id,position),UNIQUE(account_id,post_id,media_id),UNIQUE(account_id,media_id),
 FOREIGN KEY(account_id,post_id) REFERENCES posts(account_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TRIGGER social_post_media_guard BEFORE INSERT OR UPDATE ON post_media FOR EACH ROW EXECUTE FUNCTION social_payload_write_guard();
CREATE FUNCTION social_post_media_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='UPDATE' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Published photo references are immutable.' USING ERRCODE='23514';END IF;
 IF TG_OP='DELETE' AND EXISTS(SELECT 1 FROM posts p WHERE p.account_id=OLD.account_id AND p.id=OLD.post_id AND p.status='active') AND NOT EXISTS(SELECT 1 FROM social_account_write_gates g WHERE g.account_id=OLD.account_id AND g.erased_at IS NOT NULL) THEN RAISE EXCEPTION 'Active post photo references cannot be detached.' USING ERRCODE='23514';END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER social_post_media_immutable BEFORE UPDATE OR DELETE ON post_media FOR EACH ROW EXECUTE FUNCTION social_post_media_immutable();
CREATE FUNCTION social_post_photo_shape() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner uuid;postkey uuid;p posts%ROWTYPE;n integer;firstpos integer;lastpos integer;
BEGIN
 IF TG_TABLE_NAME='posts' THEN owner:=COALESCE(NEW.account_id,OLD.account_id);postkey:=COALESCE(NEW.id,OLD.id);ELSE owner:=COALESCE(NEW.account_id,OLD.account_id);postkey:=COALESCE(NEW.post_id,OLD.post_id);END IF;
 SELECT * INTO p FROM posts WHERE account_id=owner AND id=postkey;
 IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT count(*),min(position),max(position) INTO n,firstpos,lastpos FROM post_media WHERE account_id=owner AND post_id=postkey;
 IF (p.kind<>'user' AND n<>0) OR (p.kind='user' AND ((p.body !~ '[^[:space:]]' AND n=0) OR n>9 OR n>0 AND (firstpos<>1 OR lastpos<>n))) THEN RAISE EXCEPTION 'A private post requires text or an ordered complete photo set.' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER social_post_photo_shape AFTER INSERT OR UPDATE ON posts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION social_post_photo_shape();
CREATE CONSTRAINT TRIGGER social_post_media_shape AFTER INSERT OR UPDATE OR DELETE ON post_media DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION social_post_photo_shape();
ALTER TABLE posts ADD CONSTRAINT posts_source_shape CHECK(COALESCE(
 (kind='user' AND client_post_id IS NOT NULL AND request_hash ~ '^[a-f0-9]{64}$' AND char_length(body) BETWEEN 0 AND 500 AND person_id IS NULL AND world_id IS NULL AND source_movement_id IS NULL AND source_world_version IS NULL AND source_movement IS NULL AND source_hash IS NULL AND source_memory_id IS NULL AND source_memory_version IS NULL AND source_excerpt IS NULL AND generation_job_id IS NULL AND world_context_ref IS NULL)
 OR (kind='world_notice' AND client_post_id IS NULL AND request_hash IS NULL AND body='' AND person_id IS NOT NULL AND world_id IS NOT NULL AND source_movement_id IS NOT NULL AND source_world_version>1 AND source_hash ~ '^[a-f0-9]{64}$' AND jsonb_typeof(source_movement)='object' AND source_movement->>'id'=source_movement_id::text AND (source_movement->>'worldVersion')::integer=source_world_version AND source_movement->'toWorld'->>'id'=world_id::text AND jsonb_typeof(source_movement->'fromWorld')='object' AND jsonb_typeof(source_movement->'toWorld')='object' AND source_memory_id IS NULL AND source_memory_version IS NULL AND source_excerpt IS NULL AND generation_job_id IS NULL AND world_context_ref IS NULL)
 OR (kind='memory_echo' AND client_post_id IS NULL AND request_hash IS NULL AND char_length(body) BETWEEN 1 AND 1200 AND person_id IS NOT NULL AND world_id IS NOT NULL AND source_movement_id IS NULL AND source_world_version IS NULL AND source_movement IS NULL AND source_hash IS NULL AND source_memory_id IS NOT NULL AND source_memory_version>0 AND char_length(source_excerpt) BETWEEN 1 AND 320 AND generation_job_id IS NOT NULL AND jsonb_typeof(world_context_ref)='object' AND world_context_ref->>'reality'='virtual' AND world_context_ref->>'branch'='main' AND world_context_ref->>'personId'=person_id::text AND world_context_ref->'currentWorld'->>'id'=world_id::text),false));
