ALTER TABLE social_commands DROP CONSTRAINT social_commands_operation_check;
ALTER TABLE social_commands ADD CONSTRAINT social_commands_operation_check CHECK(operation IN('create','remove','react','comment','remove_comment','generation_retry','generation_cancel','moderate'));
ALTER TABLE shared_album_decisions DROP CONSTRAINT shared_album_decisions_decision_check;
ALTER TABLE shared_album_decisions ADD CONSTRAINT shared_album_decisions_decision_check CHECK(decision IN('create','submit_allow_adoption','approve','reject','withdraw','close','adopt','claim_reward','moderate'));
