// Run explicitly with the schema owner before starting restricted app clients.
// Fresh PostgreSQL target only; this never alters an existing SQLite database.
export const postgresSchema = `
CREATE SCHEMA IF NOT EXISTS cch;
CREATE TABLE IF NOT EXISTS cch.schema_version (version integer PRIMARY KEY CHECK (version = 1));
CREATE TABLE IF NOT EXISTS cch.records (
 kind text COLLATE "C" NOT NULL, id text COLLATE "C" NOT NULL,
 data jsonb NOT NULL, version integer NOT NULL CHECK (version > 0),
 PRIMARY KEY(kind,id)
);
CREATE INDEX IF NOT EXISTS session_expiry ON cch.records (((data->>'expiresAt')::bigint)) WHERE kind='session';
CREATE TABLE IF NOT EXISTS cch.summary (
 id integer PRIMARY KEY CHECK(id=1), events integer NOT NULL CHECK(events>=0),
 confirmed integer NOT NULL CHECK(confirmed>=0), waitlisted integer NOT NULL CHECK(waitlisted>=0),
 "activePolls" integer NOT NULL CHECK("activePolls">=0)
);
INSERT INTO cch.summary(id,events,confirmed,waitlisted,"activePolls")
 SELECT 1,0,0,0,0 WHERE NOT EXISTS (SELECT 1 FROM cch.records) ON CONFLICT DO NOTHING;
INSERT INTO cch.schema_version(version) VALUES(1) ON CONFLICT DO NOTHING;
`;
