ALTER TABLE messages ADD COLUMN gift_received_id uuid;
ALTER TABLE messages DROP CONSTRAINT messages_check1;
ALTER TABLE messages ADD CONSTRAINT messages_text_persona_source CHECK(kind<>'text' OR author_kind<>'persona' OR (reply_to_message_id IS NOT NULL AND generation_job_id IS NOT NULL AND speaker_person_id IS NOT NULL AND display_name IS NOT NULL));
ALTER TABLE messages DROP CONSTRAINT messages_gift_shape;
ALTER TABLE messages ADD CONSTRAINT messages_gift_shape CHECK(COALESCE(
 (kind='text' AND gift_delivery_id IS NULL AND gift_received_id IS NULL AND gift_projection IS NULL) OR
 (kind='gift' AND client_message_id IS NULL AND generation_job_id IS NULL AND reply_to_message_id IS NULL
  AND gift_projection IS NOT NULL AND jsonb_typeof(gift_projection)='object'
  AND gift_projection->>'accountId'=account_id::text AND gift_projection->>'conversationId'=conversation_id::text
  AND ((author_kind='self' AND gift_delivery_id IS NOT NULL AND gift_received_id IS NULL AND speaker_person_id IS NULL AND display_name IS NULL AND gift_projection->>'id'=gift_delivery_id::text)
    OR (author_kind='persona' AND gift_received_id IS NOT NULL AND gift_delivery_id IS NULL AND speaker_person_id IS NOT NULL AND display_name IS NOT NULL
      AND gift_projection->>'id'=gift_received_id::text AND gift_projection->>'personId'=speaker_person_id::text
      AND gift_projection->'origin'->>'kind'='persona_return' AND gift_projection->'origin'->>'contentOrigin'='ai_generated'
      AND gift_projection->'origin'->>'policyVersion'='person-gift-returns-v1'))),false));
CREATE UNIQUE INDEX messages_received_gift ON messages(account_id,gift_received_id) WHERE kind='gift';
