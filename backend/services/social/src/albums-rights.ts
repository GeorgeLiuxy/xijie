import type {PoolClient} from 'pg'
// No share/visitor token, cookie hash, peer account ID or other author's revoked
// text is included in a private account export.
export async function albumExport(db:Pick<PoolClient,'query'>,accountId:string,validAuthorIds:string[]){
 if(!(await db.query("SELECT to_regclass('shared_albums') AS present")).rows[0].present)return{}
 const albums=(await db.query("SELECT id,person_id AS \"personId\",title,message,status,version,COALESCE(to_jsonb(a)->>'kind','album') AS kind,COALESCE((to_jsonb(a)->>'rules_version')::int,1) AS \"rulesVersion\",COALESCE((to_jsonb(a)->>'capacity')::int,5) AS capacity,created_at AS \"createdAt\",closed_at AS \"closedAt\" FROM shared_albums a WHERE account_id=$1 ORDER BY id",[accountId])).rows
 const contributions=(await db.query(`SELECT c.id,c.album_id AS "albumId",CASE WHEN c.status='withdrawn' OR c.author_account_id IS NOT NULL AND c.author_account_id<>$1 AND NOT(c.author_account_id=ANY($2::uuid[])) THEN '' ELSE c.body END AS text,
 c.status,c.seat,c.version,c.allow_adoption AS "allowAdoption",c.created_at AS "createdAt",c.updated_at AS "updatedAt",(c.author_account_id=$1) AS "authoredByMe"
 FROM shared_album_contributions c JOIN shared_albums a ON a.id=c.album_id WHERE a.account_id=$1 OR c.author_account_id=$1 ORDER BY c.id`,[accountId,validAuthorIds])).rows
 const decisions=(await db.query('SELECT id,album_id AS "albumId",contribution_id AS "contributionId",decision,rules_version AS "rulesVersion",created_at AS "createdAt" FROM shared_album_decisions WHERE actor_account_id=$1 ORDER BY created_at,id',[accountId])).rows
 const rewards=(await db.query('SELECT album_id AS "albumId",contribution_id AS "contributionId",status,receipt_id AS "receiptId",granted_at AS "grantedAt",created_at AS "createdAt" FROM shared_album_rewards WHERE account_id=$1 ORDER BY album_id',[accountId])).rows
 const adoptions=(await db.query('SELECT album_id AS "albumId",contribution_id AS "contributionId",source_version AS "sourceVersion",status,memory_id AS "memoryId",created_at AS "createdAt" FROM shared_album_adoptions WHERE account_id=$1 ORDER BY contribution_id',[accountId])).rows
 return{sharedAlbums:{albums,contributions,decisions,rewards,adoptions}}
}
export async function eraseAlbums(db:PoolClient,accountId:string){
 if(!(await db.query("SELECT to_regclass('shared_albums') AS present")).rows[0].present)return
 // Keep only an opaque cleanup reference while revocation is delivered; no author
 // identity or contribution text survives in that queue.
 await db.query(`INSERT INTO shared_album_source_cleanup(contribution_id,album_id,account_id,erasing_account_ids)
 SELECT c.id,c.album_id,a.account_id,ARRAY[$1::uuid] FROM shared_album_contributions c JOIN shared_albums a ON a.id=c.album_id
 WHERE a.account_id=$1 OR c.author_account_id=$1 ON CONFLICT(contribution_id) DO UPDATE SET erasing_account_ids=ARRAY(SELECT DISTINCT unnest(shared_album_source_cleanup.erasing_account_ids||EXCLUDED.erasing_account_ids))`,[accountId])
 await db.query("UPDATE shared_album_adoptions SET status='revoked',updated_at=clock_timestamp() WHERE contribution_id IN (SELECT id FROM shared_album_contributions WHERE author_account_id=$1)",[accountId])
 await db.query('DELETE FROM shared_album_commands WHERE actor=$1 OR actor IN (SELECT \'visitor:\'||visitor_hash FROM shared_album_contributions WHERE author_account_id=$2)',['owner:'+accountId,accountId])
 await db.query('DELETE FROM shared_album_decisions WHERE actor_account_id=$1 OR contribution_id IN (SELECT id FROM shared_album_contributions WHERE author_account_id=$1)',[accountId])
 await db.query('DELETE FROM shared_album_rewards WHERE account_id=$1',[accountId])
 await db.query("UPDATE shared_album_contributions SET status='withdrawn',body='',seat=NULL,author_account_id=NULL,visitor_hash=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''),version=version+1,updated_at=clock_timestamp() WHERE author_account_id=$1",[accountId])
 await db.query('DELETE FROM shared_albums WHERE account_id=$1',[accountId])
}
