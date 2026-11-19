ALTER TABLE shared_albums ADD COLUMN kind text NOT NULL DEFAULT 'album',ADD COLUMN rules_version integer NOT NULL DEFAULT 1,ADD COLUMN capacity integer NOT NULL DEFAULT 5;
ALTER TABLE shared_albums ADD CONSTRAINT shared_goal_rules CHECK((kind='album' AND rules_version IN(1,2) AND capacity=5) OR(kind='home' AND rules_version=2 AND capacity=5) OR(kind='flight' AND rules_version=2 AND capacity=8));
ALTER TABLE shared_album_contributions DROP CONSTRAINT shared_album_contributions_seat_check;
ALTER TABLE shared_album_contributions ADD CONSTRAINT shared_album_contributions_seat_check CHECK(seat BETWEEN 1 AND 8);
ALTER TABLE shared_album_decisions DROP CONSTRAINT shared_album_decisions_decision_check;
ALTER TABLE shared_album_decisions ADD CONSTRAINT shared_album_decisions_decision_check CHECK(decision IN('create','submit_allow_adoption','approve','reject','owner_approve','owner_reject','withdraw','close','adopt','claim_reward','moderate'));
ALTER TABLE shared_album_decisions DROP CONSTRAINT shared_album_decisions_rules_version_check;
ALTER TABLE shared_album_decisions ADD CONSTRAINT shared_album_decisions_rules_version_check CHECK(rules_version IN(1,2));
CREATE FUNCTION shared_goal_capacity_guard() RETURNS trigger LANGUAGE plpgsql AS $$DECLARE maximum integer;BEGIN
 SELECT capacity INTO maximum FROM shared_albums WHERE id=NEW.album_id FOR SHARE;
 IF NEW.seat IS NOT NULL AND(NEW.seat<1 OR NEW.seat>maximum) THEN RAISE EXCEPTION 'goal contribution exceeds capacity' USING ERRCODE='23514';END IF;RETURN NEW;END$$;
CREATE TRIGGER shared_goal_capacity BEFORE INSERT OR UPDATE ON shared_album_contributions FOR EACH ROW EXECUTE FUNCTION shared_goal_capacity_guard();
CREATE FUNCTION shared_goal_rules_immutable() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 IF(NEW.kind,NEW.rules_version,NEW.capacity) IS DISTINCT FROM(OLD.kind,OLD.rules_version,OLD.capacity) THEN RAISE EXCEPTION 'accepted goal rules are immutable' USING ERRCODE='23514';END IF;RETURN NEW;END$$;
CREATE TRIGGER shared_goal_rules_no_update BEFORE UPDATE ON shared_albums FOR EACH ROW EXECUTE FUNCTION shared_goal_rules_immutable();
