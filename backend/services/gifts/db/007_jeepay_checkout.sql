ALTER TABLE commerce_payment_attempts ADD COLUMN launch_url text;
ALTER TABLE commerce_payment_attempts ADD COLUMN launch_expires_at timestamptz(3);
ALTER TABLE commerce_payment_attempts ADD COLUMN provider_binding text CHECK(provider_binding IS NULL OR provider_binding~'^[a-f0-9]{64}$');
ALTER TABLE commerce_refunds ADD COLUMN provider_binding text CHECK(provider_binding IS NULL OR provider_binding~'^[a-f0-9]{64}$');
ALTER TABLE commerce_payment_attempts ADD CONSTRAINT commerce_launch_shape CHECK(
 (launch_url IS NULL AND launch_expires_at IS NULL) OR
 (launch_url IS NOT NULL AND length(launch_url) BETWEEN 1 AND 8192 AND launch_url ~ '^(https://|http://(127[.]0[.]0[.]1|localhost|\[::1\])(:[0-9]+)?/)' AND launch_expires_at IS NOT NULL AND started_at IS NOT NULL)
);
ALTER TABLE commerce_reconciliation_jobs DROP CONSTRAINT commerce_reconciliation_jobs_attempt_count_check;
ALTER TABLE commerce_reconciliation_jobs ADD CONSTRAINT commerce_attempt_budget CHECK(attempt_count BETWEEN 0 AND 1500);
ALTER TABLE commerce_reconciliation_jobs ADD COLUMN error_count integer NOT NULL DEFAULT 0 CHECK(error_count BETWEEN 0 AND 3);
ALTER TABLE commerce_reconciliation_jobs ADD COLUMN deadline_at timestamptz(3);
ALTER TABLE commerce_reconciliation_jobs DISABLE TRIGGER commerce_reconciliation_jobs_acceptance;
UPDATE commerce_reconciliation_jobs SET deadline_at=created_at+CASE WHEN kind='payment' THEN interval '30 minutes' ELSE interval '24 hours' END,error_count=LEAST(attempt_count,3);
ALTER TABLE commerce_reconciliation_jobs ENABLE TRIGGER commerce_reconciliation_jobs_acceptance;
ALTER TABLE commerce_reconciliation_jobs ALTER COLUMN deadline_at SET NOT NULL;
ALTER TABLE commerce_reconciliation_jobs ADD CONSTRAINT commerce_deadline_shape CHECK(deadline_at>created_at AND deadline_at<=created_at+CASE WHEN kind='payment' THEN interval '30 minutes 1 second' ELSE interval '24 hours 1 second' END);

CREATE OR REPLACE FUNCTION protect_commerce_fact() RETURNS trigger LANGUAGE plpgsql AS $$DECLARE mutable text[];BEGIN
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM gifts_account_write_gates WHERE account_id=OLD.account_id AND erased_at IS NOT NULL) THEN RETURN OLD;END IF;
  RAISE EXCEPTION 'commerce facts require account erasure' USING ERRCODE='42501';
 END IF;
 mutable=CASE TG_TABLE_NAME
 WHEN 'commerce_orders' THEN ARRAY['payment_state','fulfillment_state','credit_transaction_id','paid_at','closed_at','version','updated_at']
 WHEN 'commerce_payment_attempts' THEN ARRAY['state','started_at','finished_at','updated_at','launch_url','launch_expires_at']
 WHEN 'commerce_refunds' THEN ARRAY['state','debit_transaction_id','started_at','finished_at','failure_code','updated_at']
 WHEN 'commerce_refund_reservations' THEN ARRAY['state','updated_at']
 WHEN 'commerce_reconciliation_jobs' THEN ARRAY['state','version','attempt_id','lease_until','attempt_count','error_count','retry_at','failure_code','updated_at','finished_at'] END;
 IF(to_jsonb(NEW)-mutable)<>(to_jsonb(OLD)-mutable) THEN RAISE EXCEPTION 'commerce acceptance is immutable' USING ERRCODE='42501';END IF;
 IF TG_TABLE_NAME='commerce_orders' THEN
  IF OLD.payment_state IN('paid','closed') AND NEW.payment_state<>OLD.payment_state THEN RAISE EXCEPTION 'terminal order' USING ERRCODE='42501';END IF;
 END IF;
 IF TG_TABLE_NAME IN('commerce_payment_attempts','commerce_refunds','commerce_refund_reservations') THEN
  IF OLD.state IN('succeeded','failed','closed','refunded','review','released','captured') AND NEW.state<>OLD.state THEN RAISE EXCEPTION 'terminal commerce resource' USING ERRCODE='42501';END IF;
 END IF;
 IF TG_TABLE_NAME IN('commerce_payment_attempts','commerce_refunds') THEN
  IF OLD.started_at IS NOT NULL AND NEW.started_at IS DISTINCT FROM OLD.started_at THEN RAISE EXCEPTION 'outbound operation already dispatched' USING ERRCODE='42501';END IF;
 END IF;
 IF TG_TABLE_NAME='commerce_payment_attempts' THEN
  IF OLD.launch_url IS NOT NULL AND (NEW.launch_url IS DISTINCT FROM OLD.launch_url OR NEW.launch_expires_at IS DISTINCT FROM OLD.launch_expires_at) THEN
   RAISE EXCEPTION 'payment launch is immutable' USING ERRCODE='42501';
  END IF;
 END IF;
 IF TG_TABLE_NAME='commerce_reconciliation_jobs' THEN
  IF NEW.attempt_count<OLD.attempt_count OR NEW.attempt_count>OLD.attempt_count+1 OR NEW.error_count<OLD.error_count OR NEW.error_count>OLD.error_count+1 THEN RAISE EXCEPTION 'reconciliation budget is monotonic' USING ERRCODE='42501';END IF;
 END IF;RETURN NEW;END$$;
