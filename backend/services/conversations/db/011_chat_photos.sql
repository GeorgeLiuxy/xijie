-- Chat photos and visual replies retain an independent source and task lineage.
ALTER TABLE messages ADD COLUMN photo_reply_job_id uuid;
ALTER TABLE messages DROP CONSTRAINT messages_kind_check;
ALTER TABLE messages ADD CONSTRAINT messages_kind_check CHECK(kind IN('text','gift','photo'));
ALTER TABLE messages DROP CONSTRAINT messages_text_check;
ALTER TABLE messages ADD CONSTRAINT messages_text_check CHECK((kind='text' AND char_length(text) BETWEEN 1 AND 4000) OR(kind IN('gift','photo') AND text=''));
ALTER TABLE messages DROP CONSTRAINT messages_gift_shape;
ALTER TABLE messages ADD CONSTRAINT messages_gift_shape CHECK(COALESCE(
 (kind IN('text','photo') AND gift_delivery_id IS NULL AND gift_received_id IS NULL AND gift_projection IS NULL) OR
 (kind='gift' AND client_message_id IS NULL AND generation_job_id IS NULL AND reply_to_message_id IS NULL AND photo_reply_job_id IS NULL
  AND gift_projection IS NOT NULL AND jsonb_typeof(gift_projection)='object'
  AND gift_projection->>'accountId'=account_id::text AND gift_projection->>'conversationId'=conversation_id::text
  AND ((author_kind='self' AND gift_delivery_id IS NOT NULL AND gift_received_id IS NULL AND speaker_person_id IS NULL AND display_name IS NULL AND gift_projection->>'id'=gift_delivery_id::text)
    OR(author_kind='persona' AND gift_received_id IS NOT NULL AND gift_delivery_id IS NULL AND speaker_person_id IS NOT NULL AND display_name IS NOT NULL
      AND gift_projection->>'id'=gift_received_id::text AND gift_projection->>'personId'=speaker_person_id::text
      AND gift_projection->'origin'->>'kind'='persona_return' AND gift_projection->'origin'->>'contentOrigin'='ai_generated'
      AND gift_projection->'origin'->>'policyVersion'='person-gift-returns-v1'))),false));
ALTER TABLE messages DROP CONSTRAINT messages_text_persona_source;
ALTER TABLE messages ADD CONSTRAINT messages_text_persona_source CHECK(kind<>'text' OR author_kind<>'persona' OR(reply_to_message_id IS NOT NULL AND speaker_person_id IS NOT NULL AND display_name IS NOT NULL AND
 ((conversation_kind='direct' AND gather_reply_job_id IS NULL AND ((generation_job_id IS NOT NULL AND photo_reply_job_id IS NULL) OR(generation_job_id IS NULL AND photo_reply_job_id IS NOT NULL)))
 OR(conversation_kind='gather' AND gather_reply_job_id IS NOT NULL AND generation_job_id IS NULL AND photo_reply_job_id IS NULL))));
ALTER TABLE messages ADD CONSTRAINT messages_photo_shape CHECK(
 (kind='photo' AND author_kind='self' AND conversation_kind='direct' AND client_message_id IS NOT NULL AND photo_reply_job_id IS NOT NULL AND generation_job_id IS NULL AND gather_reply_job_id IS NULL AND reply_to_message_id IS NULL AND speaker_person_id IS NULL AND display_name IS NULL)
 OR(kind='text' AND author_kind='persona' AND conversation_kind='direct' AND photo_reply_job_id IS NOT NULL AND generation_job_id IS NULL AND gather_reply_job_id IS NULL)
 OR(kind<>'photo' AND photo_reply_job_id IS NULL));
ALTER TABLE messages ADD UNIQUE(account_id,conversation_id,id,client_message_id);
ALTER TABLE messages ADD UNIQUE(account_id,conversation_id,id,author_kind,kind);
ALTER TABLE messages ADD UNIQUE(account_id,conversation_id,id,photo_reply_job_id);
ALTER TABLE messages ADD UNIQUE(account_id,conversation_id,id,photo_reply_job_id,reply_to_message_id,speaker_person_id);
ALTER TABLE conversations ADD UNIQUE(account_id,id,person_id);

CREATE TABLE message_media(
 account_id uuid NOT NULL,conversation_id uuid NOT NULL,message_id uuid PRIMARY KEY,client_message_id uuid NOT NULL,
 message_version integer NOT NULL DEFAULT 1 CHECK(message_version=1),media_id uuid NOT NULL,media_version integer NOT NULL CHECK(media_version>0),
 mime_type text NOT NULL CHECK(mime_type='image/webp'),width integer NOT NULL CHECK(width BETWEEN 1 AND 8000),height integer NOT NULL CHECK(height BETWEEN 1 AND 8000),byte_size integer NOT NULL CHECK(byte_size BETWEEN 1 AND 1048576),
 source_kind text NOT NULL DEFAULT 'photo' CHECK(source_kind='photo'),source_author text NOT NULL DEFAULT 'self' CHECK(source_author='self'),
 created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(account_id,conversation_id,client_message_id),UNIQUE(account_id,conversation_id,message_id,media_id,media_version),
 FOREIGN KEY(account_id,conversation_id,message_id,client_message_id) REFERENCES messages(account_id,conversation_id,id,client_message_id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(account_id,conversation_id,message_id,source_author,source_kind) REFERENCES messages(account_id,conversation_id,id,author_kind,kind) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE photo_reply_jobs(
 id uuid PRIMARY KEY,account_id uuid NOT NULL,conversation_id uuid NOT NULL,person_id uuid NOT NULL,
 conversation_kind text NOT NULL DEFAULT 'direct' CHECK(conversation_kind='direct'),source_message_id uuid NOT NULL UNIQUE,source_version integer NOT NULL CHECK(source_version=1),source_kind text NOT NULL DEFAULT 'photo' CHECK(source_kind='photo'),source_author text NOT NULL DEFAULT 'self' CHECK(source_author='self'),
 media_id uuid NOT NULL,media_version integer NOT NULL CHECK(media_version>0),
 account_access_version integer NOT NULL CHECK(account_access_version>0),person_version integer NOT NULL CHECK(person_version>0),person_access_version integer NOT NULL CHECK(person_access_version>0),world_version integer NOT NULL CHECK(world_version>0),
 story_authorization_version integer NOT NULL CHECK(story_authorization_version>0),photo_authorization_version integer NOT NULL CHECK(photo_authorization_version>0),image_authorization_version integer NOT NULL CHECK(image_authorization_version>0),
 state text NOT NULL DEFAULT 'queued' CHECK(state IN('queued','running','succeeded','failed','blocked','canceled')),version integer NOT NULL DEFAULT 1 CHECK(version>0),
 attempt_id uuid,attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 3),lease_until timestamptz(3),next_attempt_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),failure_code text,retryable boolean NOT NULL DEFAULT false,reply_id uuid,
 person_context_ref jsonb,world_context_ref jsonb,provider_provenance jsonb,
 created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(account_id,id),UNIQUE(account_id,conversation_id,id),
 FOREIGN KEY(account_id,conversation_id,conversation_kind) REFERENCES conversations(account_id,id,kind),
 FOREIGN KEY(account_id,conversation_id,person_id) REFERENCES conversations(account_id,id,person_id),
 FOREIGN KEY(account_id,conversation_id,source_message_id,source_author,source_kind) REFERENCES messages(account_id,conversation_id,id,author_kind,kind) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(account_id,conversation_id,source_message_id,id) REFERENCES messages(account_id,conversation_id,id,photo_reply_job_id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(account_id,conversation_id,source_message_id,media_id,media_version) REFERENCES message_media(account_id,conversation_id,message_id,media_id,media_version) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(account_id,conversation_id,reply_id,id,source_message_id,person_id) REFERENCES messages(account_id,conversation_id,id,photo_reply_job_id,reply_to_message_id,speaker_person_id) DEFERRABLE INITIALLY DEFERRED,
 CHECK((state='running' AND attempt_id IS NOT NULL AND lease_until IS NOT NULL) OR(state<>'running' AND attempt_id IS NULL AND lease_until IS NULL)),
 CHECK((state='succeeded')=(reply_id IS NOT NULL)),CHECK(NOT retryable OR(state='failed' AND attempt_count<3)),CHECK(created_at<=updated_at),
 CHECK(state<>'succeeded' OR COALESCE(jsonb_typeof(person_context_ref)='object' AND person_context_ref->>'id'=person_id::text AND person_context_ref->>'version'=person_version::text AND person_context_ref->>'accessVersion'=person_access_version::text AND person_context_ref->>'worldVersion'=world_version::text AND jsonb_typeof(world_context_ref)='object' AND world_context_ref->>'personId'=person_id::text AND world_context_ref->>'worldVersion'=world_version::text AND jsonb_typeof(provider_provenance)='object' AND provider_provenance->>'provider'='openai' AND provider_provenance->>'promptVersion'='person-chat-image-replies-v1',false))
);
ALTER TABLE messages ADD CONSTRAINT messages_photo_job_fk FOREIGN KEY(account_id,conversation_id,photo_reply_job_id) REFERENCES photo_reply_jobs(account_id,conversation_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE UNIQUE INDEX messages_photo_one_reply ON messages(photo_reply_job_id) WHERE author_kind='persona' AND photo_reply_job_id IS NOT NULL;
CREATE INDEX photo_jobs_recovery ON photo_reply_jobs(state,next_attempt_at,updated_at);
CREATE TRIGGER photo_jobs_erasure BEFORE INSERT OR UPDATE ON photo_reply_jobs FOR EACH ROW EXECUTE FUNCTION enforce_account_erasure_fence();
CREATE TRIGGER message_media_erasure BEFORE INSERT OR UPDATE ON message_media FOR EACH ROW EXECUTE FUNCTION enforce_account_erasure_fence();
CREATE FUNCTION protect_photo_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF NOT EXISTS(SELECT 1 FROM account_erasure_fences WHERE account_id=OLD.account_id AND erased_at IS NOT NULL) THEN RAISE EXCEPTION 'Photo sources are immutable'; END IF;
  RETURN OLD;
 END IF;
 IF TG_TABLE_NAME='message_media' OR (to_jsonb(NEW)-ARRAY['state','version','attempt_id','attempt_count','lease_until','next_attempt_at','failure_code','retryable','reply_id','person_context_ref','world_context_ref','provider_provenance','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','version','attempt_id','attempt_count','lease_until','next_attempt_at','failure_code','retryable','reply_id','person_context_ref','world_context_ref','provider_provenance','updated_at']) THEN RAISE EXCEPTION 'Photo acceptance is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER photo_source_immutable BEFORE UPDATE OR DELETE ON message_media FOR EACH ROW EXECUTE FUNCTION protect_photo_source();
CREATE TRIGGER photo_job_acceptance_immutable BEFORE UPDATE OR DELETE ON photo_reply_jobs FOR EACH ROW EXECUTE FUNCTION protect_photo_source();
