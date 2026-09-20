-- Base group rows, mirroring GROUP_ORDER in src/lib/types.ts (and the seed loop
-- in scripts/db-push.ts). Runs after 01-schema.sql on a fresh Postgres volume
-- via /docker-entrypoint-initdb.d. Idempotent: re-running never duplicates.
insert into groups (name, sort_order) values
  ('AKB48', 0),
  ('Nogizaka46', 1),
  ('≒JOY', 2),
  ('=LOVE', 3),
  ('≠ME', 4),
  ('NMB48', 5)
on conflict (name) do nothing;
