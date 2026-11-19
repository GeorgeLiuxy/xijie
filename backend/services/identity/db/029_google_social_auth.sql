-- Keep existing provider-subject ownership; Google is an explicit routing hint.
ALTER TABLE auth_attempts DROP CONSTRAINT auth_attempts_social_provider_check;
ALTER TABLE auth_attempts ADD CONSTRAINT auth_attempts_social_provider_check
  CHECK (social_provider IN ('apple', 'google', 'wechat'));
