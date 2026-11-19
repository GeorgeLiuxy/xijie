ALTER TABLE ledger_transactions DROP CONSTRAINT ledger_transactions_reason_check;
ALTER TABLE ledger_transactions ADD CONSTRAINT ledger_transactions_reason_check CHECK(reason IN('trial_grant','gift_debit','gift_reversal','referral_reward','album_reward'));
CREATE TABLE album_reward_receipts(
 account_id uuid NOT NULL REFERENCES gifts_account_write_gates(account_id),album_id uuid NOT NULL,id uuid NOT NULL UNIQUE,
 transaction_id uuid NOT NULL UNIQUE,lot_id uuid NOT NULL UNIQUE,campaign text NOT NULL DEFAULT 'shared-album-v1' CHECK(campaign='shared-album-v1'),
 account_access_version integer NOT NULL CHECK(account_access_version>0),created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(account_id,album_id),FOREIGN KEY(account_id,transaction_id) REFERENCES ledger_transactions(account_id,id),FOREIGN KEY(account_id,lot_id) REFERENCES asset_lots(account_id,id)
);
CREATE TRIGGER album_reward_gate BEFORE INSERT ON album_reward_receipts FOR EACH ROW EXECUTE FUNCTION gifts_write_gate();
CREATE TRIGGER album_reward_immutable BEFORE UPDATE OR DELETE ON album_reward_receipts FOR EACH ROW EXECUTE FUNCTION immutable_gifts_ledger();
CREATE FUNCTION check_album_reward() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 IF NOT EXISTS(SELECT 1 FROM ledger_transactions t JOIN asset_lots l ON(l.account_id,l.id)=(t.account_id,NEW.lot_id)
 JOIN ledger_entries e ON(e.account_id,e.transaction_id,e.lot_id)=(t.account_id,t.id,l.id)
 WHERE(t.account_id,t.id)=(NEW.account_id,NEW.transaction_id) AND t.reason='album_reward' AND t.policy_version=NEW.campaign
 AND t.source_id='album:'||NEW.album_id::text||':participant:'||NEW.account_id::text
 AND l.source='promotion' AND l.asset_type='voucher' AND l.asset_id='return-stamp' AND l.expires_at IS NULL
 AND l.issuance_transaction_id=t.id AND l.policy_version=NEW.campaign AND e.line_no=1 AND e.direction='credit' AND e.units=1
 AND(SELECT count(*) FROM ledger_entries WHERE transaction_id=t.id)=1) THEN
 RAISE EXCEPTION 'album reward requires one exact benefit' USING ERRCODE='23514';END IF;RETURN NULL;END$$;
CREATE CONSTRAINT TRIGGER album_reward_complete AFTER INSERT ON album_reward_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_album_reward();
