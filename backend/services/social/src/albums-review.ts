import {Pool} from 'pg'
import {readConfig} from './config.js'
import {Dependencies} from './dependencies.js'
import {SocialStore} from './store.js'
import {AlbumStore} from './albums.js'
import {identifier} from './contracts.js'
// An operator must read the private pending submission and supply a real decision.
// No model or successful-save callback is used as an approval.
const [id,decision,reviewer,reason]=process.argv.slice(2),config=readConfig(),pool=new Pool({connectionString:config.databaseUrl,statement_timeout:10000})
try{if(!['approved','rejected'].includes(decision)||!reviewer)throw new Error('Supply contribution UUID, approved|rejected, reviewer and rejection category if applicable.');const deps=new Dependencies(config),store=new AlbumStore(new SocialStore(pool,deps),config.albums,deps);await store.review(identifier(id),decision as 'approved'|'rejected',reason,reviewer);console.log(JSON.stringify({reviewRecorded:true}))}catch{console.error('Shared album review was not completed.');process.exitCode=1}finally{await pool.end()}
