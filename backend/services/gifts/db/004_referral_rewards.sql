ALTER TABLE asset_lots DROP CONSTRAINT asset_lots_source_check;
ALTER TABLE asset_lots ADD CONSTRAINT asset_lots_source_check CHECK(source IN('trial','promotion'));
ALTER TABLE asset_lots ADD CONSTRAINT promotion_voucher_shape CHECK(source<>'promotion' OR(asset_type='voucher' AND asset_id='return-stamp'));
ALTER TABLE ledger_transactions DROP CONSTRAINT ledger_transactions_reason_check;
ALTER TABLE ledger_transactions ADD CONSTRAINT ledger_transactions_reason_check CHECK(reason IN('trial_grant','gift_debit','gift_reversal','referral_reward'));

-- Each account keeps only its own earned benefit. This row deliberately has no
-- FK to the shared award: erasing either participant removes the shared source
-- identifiers without deleting the other participant's already-earned voucher.
CREATE TABLE referral_reward_receipts(
 account_id uuid NOT NULL REFERENCES gifts_account_write_gates(account_id),
 referral_id uuid NOT NULL,receipt_id uuid NOT NULL,role text NOT NULL CHECK(role IN('host','guest')),
 campaign text NOT NULL CHECK(campaign='first-memory-v1'),transaction_id uuid NOT NULL,lot_id uuid NOT NULL,
 qualified_at timestamptz(3) NOT NULL,created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(account_id,referral_id),UNIQUE(referral_id,role),UNIQUE(account_id,receipt_id),UNIQUE(transaction_id),UNIQUE(lot_id),
 FOREIGN KEY(account_id,transaction_id) REFERENCES ledger_transactions(account_id,id),
 FOREIGN KEY(account_id,lot_id) REFERENCES asset_lots(account_id,id),CHECK(created_at>=qualified_at)
);
CREATE TRIGGER referral_receipt_gate BEFORE INSERT ON referral_reward_receipts FOR EACH ROW EXECUTE FUNCTION gifts_write_gate();
CREATE TRIGGER referral_receipt_immutable BEFORE UPDATE OR DELETE ON referral_reward_receipts FOR EACH ROW EXECUTE FUNCTION immutable_gifts_ledger();

CREATE TABLE referral_reward_awards(
 id uuid PRIMARY KEY,referral_id uuid NOT NULL UNIQUE,campaign text NOT NULL CHECK(campaign='first-memory-v1'),
 inviter_account_id uuid NOT NULL REFERENCES gifts_account_write_gates(account_id),
 invitee_account_id uuid NOT NULL REFERENCES gifts_account_write_gates(account_id),
 inviter_access_version integer NOT NULL CHECK(inviter_access_version>0),invitee_access_version integer NOT NULL CHECK(invitee_access_version>0),
 registered_at timestamptz(3) NOT NULL,qualification_event_id uuid NOT NULL,qualified_at timestamptz(3) NOT NULL,
 confirmed_seq bigint NOT NULL CHECK(confirmed_seq>0),qualification_origin text NOT NULL CHECK(qualification_origin IN('manual','ai_candidate')),
 request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CHECK(inviter_account_id<>invitee_account_id),CHECK(qualified_at>=registered_at AND created_at>=qualified_at),
 FOREIGN KEY(inviter_account_id,id) REFERENCES referral_reward_receipts(account_id,receipt_id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(invitee_account_id,id) REFERENCES referral_reward_receipts(account_id,receipt_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE FUNCTION protect_referral_award() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 IF TG_OP='DELETE' AND EXISTS(SELECT 1 FROM gifts_account_write_gates WHERE account_id IN(OLD.inviter_account_id,OLD.invitee_account_id) AND erased_at IS NOT NULL) THEN RETURN OLD;END IF;
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'referral award is immutable outside erasure' USING ERRCODE='42501';END IF;
 PERFORM account_id FROM gifts_account_write_gates WHERE account_id IN(NEW.inviter_account_id,NEW.invitee_account_id) ORDER BY account_id FOR SHARE;
 IF(SELECT count(*) FROM gifts_account_write_gates WHERE account_id IN(NEW.inviter_account_id,NEW.invitee_account_id) AND erased_at IS NULL)<>2 THEN RAISE EXCEPTION 'referral accounts unavailable' USING ERRCODE='42501';END IF;
 RETURN NEW;END$$;
CREATE TRIGGER referral_award_immutable BEFORE INSERT OR UPDATE OR DELETE ON referral_reward_awards FOR EACH ROW EXECUTE FUNCTION protect_referral_award();
CREATE FUNCTION check_referral_award() RETURNS trigger LANGUAGE plpgsql AS $$DECLARE n integer;BEGIN
 SELECT count(*) INTO n FROM referral_reward_receipts r
 JOIN ledger_transactions t ON(t.account_id,t.id)=(r.account_id,r.transaction_id)
 JOIN asset_lots l ON(l.account_id,l.id)=(r.account_id,r.lot_id)
 JOIN ledger_entries e ON(e.account_id,e.transaction_id,e.lot_id)=(r.account_id,r.transaction_id,r.lot_id)
 WHERE r.receipt_id=NEW.id AND r.referral_id=NEW.referral_id AND r.campaign=NEW.campaign
 AND ((r.account_id=NEW.inviter_account_id AND r.role='host') OR(r.account_id=NEW.invitee_account_id AND r.role='guest'))
 AND r.qualified_at=NEW.qualified_at AND t.reason='referral_reward' AND t.policy_version=NEW.campaign
 AND t.source_id='referral:'||NEW.referral_id::text||':'||r.role AND t.request_hash=NEW.request_hash
 AND l.source='promotion' AND l.asset_type='voucher' AND l.asset_id='return-stamp' AND l.expires_at IS NULL
 AND l.issuance_transaction_id=t.id AND l.policy_version=NEW.campaign AND e.line_no=1 AND e.direction='credit' AND e.units=1
 AND (SELECT count(*) FROM ledger_entries extra WHERE extra.transaction_id=t.id)=1;
 IF n<>2 OR(SELECT count(*) FROM referral_reward_receipts WHERE receipt_id=NEW.id)<>2 THEN RAISE EXCEPTION 'referral award requires both exact benefits' USING ERRCODE='23514';END IF;
 RETURN NULL;END$$;
CREATE CONSTRAINT TRIGGER referral_award_complete AFTER INSERT ON referral_reward_awards DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_referral_award();
CREATE FUNCTION check_referral_receipt() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 IF NOT EXISTS(SELECT 1 FROM referral_reward_awards a WHERE a.id=NEW.receipt_id AND a.referral_id=NEW.referral_id
  AND ((NEW.role='host' AND NEW.account_id=a.inviter_account_id) OR(NEW.role='guest' AND NEW.account_id=a.invitee_account_id))) THEN
  RAISE EXCEPTION 'referral receipt requires an accepted paired award' USING ERRCODE='23514';
 END IF;RETURN NULL;END$$;
CREATE CONSTRAINT TRIGGER referral_receipt_complete AFTER INSERT ON referral_reward_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_referral_receipt();
