ALTER TABLE messages ADD COLUMN kind text NOT NULL DEFAULT 'text' CHECK(kind IN('text','gift'));
ALTER TABLE messages ADD COLUMN gift_delivery_id uuid, ADD COLUMN gift_projection jsonb;
ALTER TABLE messages DROP CONSTRAINT messages_text_check;
ALTER TABLE messages ADD CONSTRAINT messages_text_check CHECK((kind='text' AND char_length(text) BETWEEN 1 AND 4000) OR (kind='gift' AND text=''));
ALTER TABLE messages DROP CONSTRAINT messages_check;
ALTER TABLE messages ADD CONSTRAINT messages_self_client CHECK(kind='gift' OR (author_kind='self')=(client_message_id IS NOT NULL));
ALTER TABLE messages ADD CONSTRAINT messages_gift_shape CHECK(
 (kind='text' AND gift_delivery_id IS NULL AND gift_projection IS NULL) OR
 (kind='gift' AND author_kind='self' AND client_message_id IS NULL AND generation_job_id IS NULL AND reply_to_message_id IS NULL AND speaker_person_id IS NULL AND gift_delivery_id IS NOT NULL AND jsonb_typeof(gift_projection)='object' AND gift_projection->>'id'=gift_delivery_id::text AND gift_projection->>'accountId'=account_id::text AND gift_projection->>'conversationId'=conversation_id::text));
CREATE UNIQUE INDEX messages_gift_delivery ON messages(account_id,gift_delivery_id) WHERE kind='gift';
