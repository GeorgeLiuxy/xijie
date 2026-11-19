CREATE TABLE content_reports(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),account_id uuid NOT NULL REFERENCES accounts(id),owner_account_id uuid NOT NULL REFERENCES accounts(id),
 subject_type text NOT NULL CHECK(subject_type IN('message','post','contribution')),subject_id uuid NOT NULL,container_id uuid NOT NULL,
 source_domain text NOT NULL CHECK(source_domain IN('conversations','social')),source_kind text NOT NULL,source_version integer NOT NULL CHECK(source_version>0),
 source_hash text NOT NULL CHECK(source_hash~'^[a-f0-9]{64}$'),reason text NOT NULL CHECK(reason IN('harmful','privacy','impersonation','spam','other')),
 note text NOT NULL DEFAULT '' CHECK(char_length(note)<=500),state text NOT NULL DEFAULT 'open' CHECK(state IN('open','reviewing','resolved')),
 resolution text,decision text CHECK(decision IN('dismiss','restrict_visibility')),reason_code text,reviewer_id text,
 action_key uuid,version integer NOT NULL DEFAULT 1 CHECK(version>0),recovery_blocked boolean NOT NULL DEFAULT false,
 created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),resolved_at timestamptz(3),
 CHECK((state='resolved')=(resolved_at IS NOT NULL)),CHECK(state='open' OR(action_key IS NOT NULL AND decision IS NOT NULL AND reviewer_id IS NOT NULL))
);
CREATE TABLE content_report_commands(
 account_id uuid NOT NULL REFERENCES accounts(id),operation text NOT NULL CHECK(operation IN('create','resolve')),idempotency_key uuid NOT NULL,
 request_hash text NOT NULL CHECK(request_hash~'^[a-f0-9]{64}$'),report_id uuid NOT NULL REFERENCES content_reports(id) ON DELETE CASCADE,
 created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(account_id,operation,idempotency_key)
);
CREATE TABLE content_report_audit(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),account_id uuid NOT NULL REFERENCES accounts(id),report_id uuid NOT NULL REFERENCES content_reports(id) ON DELETE CASCADE,
 actor text NOT NULL,action text NOT NULL CHECK(action IN('created','reviewing','resolved','evidence_read')),reason_code text,created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX content_reports_owner ON content_reports(account_id,created_at DESC,id DESC);
CREATE INDEX content_reports_pending ON content_reports(state,id) WHERE state<>'resolved';
