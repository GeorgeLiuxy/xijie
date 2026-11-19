/** SQL for a dedicated role; callers supply only current_user or a fixed trusted literal. */
export function readerViolationSql(role){
 return `SELECT
 EXISTS(SELECT 1 FROM pg_roles WHERE oid=(${role})::regrole AND(rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls OR rolreplication))
 OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member=(${role})::regrole)
 OR EXISTS(SELECT 1 FROM pg_class WHERE relowner=(${role})::regrole)
 OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspowner=(${role})::regrole)
 OR EXISTS(SELECT 1 FROM pg_database WHERE datdba=(${role})::regrole)
 OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname NOT IN('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN('r','p','v','m','f') AND
   CASE WHEN n.nspname='xijie_auth_reader' AND c.relname='bound_phones'
   THEN has_table_privilege((${role})::regrole,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege((${role})::regrole,c.oid,'INSERT,UPDATE,REFERENCES')
   ELSE has_table_privilege((${role})::regrole,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege((${role})::regrole,c.oid,'SELECT,INSERT,UPDATE,REFERENCES') END)
 OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='xijie_auth_reader' AND c.relname='bound_phones' AND
   (c.relkind<>'v' OR NOT COALESCE('security_barrier=true'=ANY(c.reloptions),false) OR
   (SELECT array_agg(a.attname::text ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)<>ARRAY['subject','phone']))
 AS violation`
}
