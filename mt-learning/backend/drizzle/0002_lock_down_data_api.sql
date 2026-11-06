-- Keep every table private to the API server.
-- Hosted Postgres such as Supabase can publish tables through an automatic web API
-- (roles "anon" and "authenticated"). This app never uses that route, so:
--  1. Row Level Security is switched on with no policies: other roles see no rows.
--     The API connects as the table owner, which is not affected.
--  2. Those web roles lose all access to the tables, now and for tables added later.
-- On a plain PostgreSQL server step 2 does nothing because the roles do not exist.
DO $$
DECLARE
  t record;
  r text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = current_schema() LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;

  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM %I', current_schema(), r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM %I', current_schema(), r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I REVOKE ALL ON TABLES FROM %I', current_schema(), r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I REVOKE ALL ON SEQUENCES FROM %I', current_schema(), r);
    END IF;
  END LOOP;
END $$;
