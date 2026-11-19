ALTER TABLE memory_generation_jobs
 ADD COLUMN ai_authorization_version integer NOT NULL DEFAULT 0
 CHECK(ai_authorization_version>=0);

COMMENT ON COLUMN memory_generation_jobs.ai_authorization_version IS
 'Accepted ai_text_processing authorization version. Zero marks legacy jobs and never authorizes new model work.';
