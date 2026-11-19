-- Explicitly reject NULL or missing identity attributes in gift projections.
ALTER TABLE messages DROP CONSTRAINT messages_gift_shape;
ALTER TABLE messages ADD CONSTRAINT messages_gift_shape CHECK(COALESCE(
 (kind='text' AND gift_delivery_id IS NULL AND gift_projection IS NULL) OR
 (kind='gift' AND author_kind='self' AND client_message_id IS NULL AND generation_job_id IS NULL AND reply_to_message_id IS NULL AND speaker_person_id IS NULL AND gift_delivery_id IS NOT NULL AND gift_projection IS NOT NULL AND jsonb_typeof(gift_projection)='object' AND gift_projection->>'id'=gift_delivery_id::text AND gift_projection->>'accountId'=account_id::text AND gift_projection->>'conversationId'=conversation_id::text),false));
