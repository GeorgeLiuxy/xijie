ALTER TABLE messages ADD COLUMN input_mode text CHECK(input_mode IN('typed','transcribed'));
UPDATE messages SET input_mode='typed' WHERE kind='text' AND author_kind='self';
ALTER TABLE story_messages ADD COLUMN input_mode text CHECK(input_mode IN('typed','transcribed'));
UPDATE story_messages SET input_mode='typed' WHERE author_kind='self';
