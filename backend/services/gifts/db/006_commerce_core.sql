ALTER TABLE asset_lots DROP CONSTRAINT asset_lots_source_check;
ALTER TABLE asset_lots ADD CONSTRAINT asset_lots_source_check CHECK(source IN('trial','promotion','paid'));
ALTER TABLE asset_lots ADD COLUMN reserved_units integer NOT NULL DEFAULT 0 CHECK(reserved_units>=0 AND reserved_units<=balance_units);
ALTER TABLE ledger_transactions DROP CONSTRAINT ledger_transactions_reason_check;
ALTER TABLE ledger_transactions ADD CONSTRAINT ledger_transactions_reason_check CHECK(reason IN('trial_grant','gift_debit','gift_reversal','referral_reward','album_reward','purchase_credit','purchase_refund'));
ALTER TABLE ledger_transactions DROP CONSTRAINT ledger_transactions_check;
ALTER TABLE ledger_transactions ADD CONSTRAINT ledger_original_shape CHECK((reason IN('gift_reversal','purchase_refund'))=(original_transaction_id IS NOT NULL));

CREATE TABLE commerce_quotes(
 id uuid PRIMARY KEY,account_id uuid NOT NULL REFERENCES gifts_account_write_gates(account_id),acceptance_key uuid NOT NULL,
 request_hash text NOT NULL CHECK(request_hash~'^[a-f0-9]{64}$'),product_snapshot jsonb NOT NULL,
 channel text NOT NULL,price_amount integer NOT NULL CHECK(price_amount>0),currency text NOT NULL CHECK(currency~'^[A-Z]{3}$'),
 created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz(3) NOT NULL,
 UNIQUE(account_id,id),UNIQUE(account_id,acceptance_key),CHECK(expires_at>created_at)
);
CREATE TABLE commerce_orders(
 id uuid PRIMARY KEY,account_id uuid NOT NULL REFERENCES gifts_account_write_gates(account_id),quote_id uuid NOT NULL UNIQUE,
 acceptance_key uuid NOT NULL,request_hash text NOT NULL CHECK(request_hash~'^[a-f0-9]{64}$'),
 payment_state text NOT NULL DEFAULT 'awaiting_payment' CHECK(payment_state IN('awaiting_payment','confirming','paid','closed')),
 fulfillment_state text NOT NULL DEFAULT 'not_eligible' CHECK(fulfillment_state IN('not_eligible','fulfilled')),
 credit_transaction_id uuid,paid_at timestamptz(3),closed_at timestamptz(3),version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(account_id,id),UNIQUE(account_id,acceptance_key),FOREIGN KEY(account_id,quote_id) REFERENCES commerce_quotes(account_id,id),
 FOREIGN KEY(account_id,credit_transaction_id) REFERENCES ledger_transactions(account_id,id),
 CHECK((payment_state='paid')=(paid_at IS NOT NULL)),CHECK((payment_state='closed')=(closed_at IS NOT NULL)),
 CHECK((fulfillment_state='fulfilled')=(credit_transaction_id IS NOT NULL)),CHECK(fulfillment_state<>'fulfilled' OR payment_state='paid')
);
CREATE TABLE commerce_payment_attempts(
 id uuid PRIMARY KEY,account_id uuid NOT NULL,order_id uuid NOT NULL,acceptance_key uuid NOT NULL,
 request_hash text NOT NULL CHECK(request_hash~'^[a-f0-9]{64}$'),provider text NOT NULL,
 state text NOT NULL DEFAULT 'preparing' CHECK(state IN('preparing','pending','succeeded','failed','closed')),
 started_at timestamptz(3),finished_at timestamptz(3),created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(account_id,id),UNIQUE(account_id,acceptance_key),FOREIGN KEY(account_id,order_id) REFERENCES commerce_orders(account_id,id),
 CHECK(state NOT IN('succeeded','failed','closed') OR finished_at IS NOT NULL)
);
CREATE UNIQUE INDEX commerce_payment_active ON commerce_payment_attempts(order_id) WHERE state IN('preparing','pending','succeeded');
CREATE TABLE commerce_refunds(
 id uuid PRIMARY KEY,account_id uuid NOT NULL,order_id uuid NOT NULL,acceptance_key uuid NOT NULL,
 request_hash text NOT NULL CHECK(request_hash~'^[a-f0-9]{64}$'),provider text NOT NULL,amount integer NOT NULL CHECK(amount>0),currency text NOT NULL CHECK(currency~'^[A-Z]{3}$'),
 state text NOT NULL DEFAULT 'reserved' CHECK(state IN('reserved','pending','refunded','failed','review')),
 debit_transaction_id uuid,started_at timestamptz(3),finished_at timestamptz(3),failure_code text,
 created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(account_id,id),UNIQUE(account_id,acceptance_key),FOREIGN KEY(account_id,order_id) REFERENCES commerce_orders(account_id,id),
 FOREIGN KEY(account_id,debit_transaction_id) REFERENCES ledger_transactions(account_id,id),
 CHECK((state='refunded')=(debit_transaction_id IS NOT NULL)),CHECK(state NOT IN('refunded','failed','review') OR finished_at IS NOT NULL)
);
CREATE UNIQUE INDEX commerce_refund_active ON commerce_refunds(order_id) WHERE state IN('reserved','pending','refunded','review');
CREATE TABLE commerce_refund_reservations(
 account_id uuid NOT NULL,refund_id uuid NOT NULL,lot_id uuid NOT NULL,units integer NOT NULL CHECK(units>0),
 state text NOT NULL DEFAULT 'held' CHECK(state IN('held','released','captured')),
 created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(refund_id,lot_id),FOREIGN KEY(account_id,refund_id) REFERENCES commerce_refunds(account_id,id),FOREIGN KEY(account_id,lot_id) REFERENCES asset_lots(account_id,id)
);
CREATE TABLE commerce_verified_evidence(
 id uuid PRIMARY KEY,account_id uuid NOT NULL,order_id uuid NOT NULL,payment_attempt_id uuid,refund_id uuid,
 provider text NOT NULL,event_id text NOT NULL CHECK(length(event_id) BETWEEN 1 AND 200),transaction_id text NOT NULL CHECK(length(transaction_id) BETWEEN 1 AND 200),
 outcome text NOT NULL CHECK(outcome IN('paid','unpaid','refunded','refund_failed')),
 amount integer NOT NULL CHECK(amount>0),currency text NOT NULL CHECK(currency~'^[A-Z]{3}$'),
 evidence_hash text NOT NULL CHECK(evidence_hash~'^[a-f0-9]{64}$'),occurred_at timestamptz(3) NOT NULL,verified_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(provider,event_id),FOREIGN KEY(account_id,order_id) REFERENCES commerce_orders(account_id,id),
 FOREIGN KEY(account_id,payment_attempt_id) REFERENCES commerce_payment_attempts(account_id,id),FOREIGN KEY(account_id,refund_id) REFERENCES commerce_refunds(account_id,id),
 CHECK((payment_attempt_id IS NOT NULL)<>(refund_id IS NOT NULL)),CHECK((outcome IN('paid','unpaid'))=(payment_attempt_id IS NOT NULL))
);
CREATE UNIQUE INDEX commerce_paid_transaction ON commerce_verified_evidence(provider,transaction_id) WHERE outcome='paid';
CREATE UNIQUE INDEX commerce_refunded_transaction ON commerce_verified_evidence(provider,transaction_id) WHERE outcome='refunded';
CREATE TABLE commerce_commands(
 account_id uuid NOT NULL REFERENCES gifts_account_write_gates(account_id),acceptance_key uuid NOT NULL,operation text NOT NULL CHECK(operation='close'),
 request_hash text NOT NULL CHECK(request_hash~'^[a-f0-9]{64}$'),order_id uuid NOT NULL,created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(account_id,acceptance_key),FOREIGN KEY(account_id,order_id) REFERENCES commerce_orders(account_id,id)
);
CREATE TABLE commerce_reconciliation_jobs(
 id uuid PRIMARY KEY,account_id uuid NOT NULL,order_id uuid NOT NULL,kind text NOT NULL CHECK(kind IN('payment','refund')),resource_id uuid NOT NULL,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN('queued','running','failed','succeeded','blocked')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),attempt_id uuid,lease_until timestamptz(3),attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 3),
 retry_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),failure_code text,
 created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),finished_at timestamptz(3),
 UNIQUE(kind,resource_id),FOREIGN KEY(account_id,order_id) REFERENCES commerce_orders(account_id,id),
 CHECK((state='running')=(attempt_id IS NOT NULL AND lease_until IS NOT NULL)),CHECK(state='running' OR(attempt_id IS NULL AND lease_until IS NULL)),
 CHECK(state NOT IN('succeeded','blocked') OR finished_at IS NOT NULL)
);
DO $$DECLARE n text;BEGIN
 FOREACH n IN ARRAY ARRAY['commerce_quotes','commerce_orders','commerce_payment_attempts','commerce_refunds','commerce_refund_reservations','commerce_verified_evidence','commerce_commands','commerce_reconciliation_jobs'] LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION gifts_write_gate()',n||'_gate',n);
 END LOOP;
 FOREACH n IN ARRAY ARRAY['commerce_quotes','commerce_verified_evidence','commerce_commands'] LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION immutable_gifts_ledger()',n||'_immutable',n);
 END LOOP;
END$$;
CREATE FUNCTION check_commerce_reservations() RETURNS trigger LANGUAGE plpgsql AS $$DECLARE a uuid;l uuid;BEGIN
 a=NEW.account_id;IF TG_TABLE_NAME='asset_lots' THEN l=NEW.id;ELSE l=NEW.lot_id;END IF;
 IF EXISTS(SELECT 1 FROM asset_lots WHERE account_id=a AND id=l AND reserved_units<>(SELECT COALESCE(sum(units),0) FROM commerce_refund_reservations WHERE account_id=a AND lot_id=l AND state='held')) THEN
  RAISE EXCEPTION 'refund reservation balance mismatch' USING ERRCODE='23514';END IF;RETURN NULL;END$$;
CREATE CONSTRAINT TRIGGER commerce_lot_reservation_balance AFTER INSERT OR UPDATE ON asset_lots DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_commerce_reservations();
CREATE CONSTRAINT TRIGGER commerce_refund_reservation_balance AFTER INSERT OR UPDATE ON commerce_refund_reservations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_commerce_reservations();
CREATE FUNCTION protect_commerce_fact() RETURNS trigger LANGUAGE plpgsql AS $$DECLARE mutable text[];BEGIN
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM gifts_account_write_gates WHERE account_id=OLD.account_id AND erased_at IS NOT NULL) THEN RETURN OLD;END IF;
  RAISE EXCEPTION 'commerce facts require account erasure' USING ERRCODE='42501';
 END IF;
 mutable=CASE TG_TABLE_NAME
 WHEN 'commerce_orders' THEN ARRAY['payment_state','fulfillment_state','credit_transaction_id','paid_at','closed_at','version','updated_at']
 WHEN 'commerce_payment_attempts' THEN ARRAY['state','started_at','finished_at','updated_at']
 WHEN 'commerce_refunds' THEN ARRAY['state','debit_transaction_id','started_at','finished_at','failure_code','updated_at']
 WHEN 'commerce_refund_reservations' THEN ARRAY['state','updated_at']
 WHEN 'commerce_reconciliation_jobs' THEN ARRAY['state','version','attempt_id','lease_until','attempt_count','retry_at','failure_code','updated_at','finished_at'] END;
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
 IF TG_TABLE_NAME='commerce_reconciliation_jobs' THEN
  IF NEW.attempt_count<OLD.attempt_count OR NEW.attempt_count>OLD.attempt_count+1 THEN RAISE EXCEPTION 'reconciliation attempt budget is monotonic' USING ERRCODE='42501';END IF;
 END IF;RETURN NEW;END$$;
DO $$DECLARE n text;BEGIN
 FOREACH n IN ARRAY ARRAY['commerce_orders','commerce_payment_attempts','commerce_refunds','commerce_refund_reservations','commerce_reconciliation_jobs'] LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION protect_commerce_fact()',n||'_acceptance',n);
 END LOOP;
END$$;
CREATE FUNCTION check_commerce_evidence() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 IF NOT EXISTS(SELECT 1 FROM commerce_orders o JOIN commerce_quotes q ON q.id=o.quote_id WHERE o.id=NEW.order_id AND o.account_id=NEW.account_id AND q.price_amount=NEW.amount AND q.currency=NEW.currency) THEN
  RAISE EXCEPTION 'evidence quote mismatch' USING ERRCODE='23514';END IF;
 IF NEW.payment_attempt_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM commerce_payment_attempts WHERE id=NEW.payment_attempt_id AND order_id=NEW.order_id AND account_id=NEW.account_id AND provider=NEW.provider) OR
 NEW.refund_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM commerce_refunds WHERE id=NEW.refund_id AND order_id=NEW.order_id AND account_id=NEW.account_id AND provider=NEW.provider AND amount=NEW.amount AND currency=NEW.currency) THEN
  RAISE EXCEPTION 'evidence operation mismatch' USING ERRCODE='23514';END IF;RETURN NULL;END$$;
CREATE CONSTRAINT TRIGGER commerce_evidence_source AFTER INSERT ON commerce_verified_evidence DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_commerce_evidence();
CREATE FUNCTION check_commerce_order() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 IF NEW.payment_state='paid' AND NOT EXISTS(SELECT 1 FROM commerce_verified_evidence e JOIN commerce_payment_attempts a ON a.id=e.payment_attempt_id
  JOIN ledger_transactions t ON(t.account_id,t.id)=(NEW.account_id,NEW.credit_transaction_id)
  WHERE e.account_id=NEW.account_id AND e.order_id=NEW.id AND e.outcome='paid' AND a.state='succeeded'
  AND t.reason='purchase_credit' AND t.source_id=NEW.id::text AND t.request_hash=e.evidence_hash) THEN
  RAISE EXCEPTION 'paid order requires verified evidence and one credit' USING ERRCODE='23514';END IF;RETURN NULL;END$$;
CREATE CONSTRAINT TRIGGER commerce_order_paid AFTER INSERT OR UPDATE ON commerce_orders DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_commerce_order();
CREATE FUNCTION check_commerce_refund() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 IF NEW.state='refunded' AND NOT EXISTS(SELECT 1 FROM commerce_verified_evidence e JOIN commerce_orders o ON o.id=NEW.order_id JOIN ledger_transactions t ON(t.account_id,t.id)=(NEW.account_id,NEW.debit_transaction_id)
 WHERE e.refund_id=NEW.id AND e.outcome='refunded' AND t.reason='purchase_refund' AND t.source_id=NEW.id::text AND t.original_transaction_id=o.credit_transaction_id AND t.request_hash=e.evidence_hash) THEN
 RAISE EXCEPTION 'refund requires verified evidence and original credit reversal' USING ERRCODE='23514';END IF;RETURN NULL;END$$;
CREATE CONSTRAINT TRIGGER commerce_refund_captured AFTER INSERT OR UPDATE ON commerce_refunds DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_commerce_refund();
CREATE FUNCTION check_commerce_job() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 IF NEW.kind='payment' THEN
  IF NOT EXISTS(SELECT 1 FROM commerce_payment_attempts WHERE id=NEW.resource_id AND account_id=NEW.account_id AND order_id=NEW.order_id) THEN RAISE EXCEPTION 'payment job source mismatch' USING ERRCODE='23514';END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM commerce_refunds WHERE id=NEW.resource_id AND account_id=NEW.account_id AND order_id=NEW.order_id) THEN RAISE EXCEPTION 'refund job source mismatch' USING ERRCODE='23514';END IF;
 END IF;RETURN NULL;END$$;
CREATE CONSTRAINT TRIGGER commerce_job_source AFTER INSERT ON commerce_reconciliation_jobs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_commerce_job();
