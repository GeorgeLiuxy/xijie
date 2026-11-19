-- Selection is a fixed routing hint, never an asserted external identity or email link.
ALTER TABLE auth_attempts ADD COLUMN social_provider text CHECK(social_provider IN ('apple','wechat'));
