# Operating AgentOS

How to back up, restore and keep a self-hosted AgentOS healthy. Commands assume the Docker
Compose setup from the README (services `postgres`, `redis`, `migrate`, `worker`, `web`); with
your own Postgres and Redis, run the same `pg_dump` / `psql` commands against them.

## What holds state

| What | Holds | Back up? |
|------|-------|----------|
| PostgreSQL | Everything: workspaces, users, agents, tasks, runs, logs, audit trail, knowledge chunks and embeddings, memories, workflows, schedules, and every API key / MCP credential (encrypted) | **Yes**: the only data store |
| `AGENTOS_MASTER_KEY` | The key that encrypts provider API keys, MCP credentials and OAuth tokens | **Yes, separately** from the database backup |
| `.env` | Configuration | Yes (it contains the master key) |
| Redis | Job queues only (runs waiting for the worker, schedule timers, rate-limit counters) | No: rebuilt from Postgres |

Nothing is written to local disk: uploaded knowledge files are stored as text and embeddings
in Postgres.

> **The master key is not recoverable.** A database backup without the matching
> `AGENTOS_MASTER_KEY` restores everything except stored secrets: every provider API key
> and MCP credential would have to be entered again. Keep the key in a password manager
> or secret store, not next to the database dumps.

## Back up

A consistent online dump (safe while AgentOS runs):

```sh
docker compose exec -T postgres pg_dump -U agentos -d agentos --format=custom \
  > agentos-$(date +%Y%m%d-%H%M).dump
```

Run it daily (cron, systemd timer or your platform's scheduler), keep several generations, and
copy the files off the machine. The custom format is compressed and lets `pg_restore` restore
selectively.

Check a dump is readable:

```sh
pg_restore --list agentos-YYYYMMDD-HHMM.dump | head
```

## Restore

1. Stop what writes to the database:

   ```sh
   docker compose stop web worker
   ```

2. Recreate the database and load the dump. The `vector` extension comes from the
   `pgvector/pgvector` image; on your own Postgres install pgvector first.

   ```sh
   docker compose exec -T postgres dropdb -U agentos --if-exists agentos
   docker compose exec -T postgres createdb -U agentos agentos
   docker compose exec -T postgres pg_restore -U agentos -d agentos --no-owner \
     < agentos-YYYYMMDD-HHMM.dump
   ```

3. Make sure `.env` has the **same** `AGENTOS_MASTER_KEY` the backup was taken with.

4. Bring the schema up to date (a dump from an older version gets its missing migrations), then
   start the app:

   ```sh
   docker compose run --rm migrate
   docker compose up -d worker web
   ```

5. Clear queue state that no longer matches the database (optional but tidy after restoring an
   older backup):

   ```sh
   docker compose exec redis redis-cli FLUSHDB
   docker compose restart worker
   ```

When the worker starts it rebuilds what lived in Redis:

- **Schedules** are re-registered from the database; a one-time schedule whose time passed
  while AgentOS was down fires once.
- **Runs the database still calls "queued"** for more than 45 minutes are put back on the
  queue.
- **Runs that were "running"** when the old worker stopped resume from their saved state
  within a couple of minutes (they show "Resumed after a restart" in the run log).

### Check the restore

- Sign in and open **Dashboard** and **Logs**: recent activity should match the backup time.
- Open **Settings → AI Providers** and press **Test** on a provider. A decryption error means
  the master key doesn't match the backup.
- `curl http://localhost:3000/api/health` returns `"ok": true` (database and Redis).

## Limits and backpressure

AgentOS protects itself from bursts and from one workspace starving the others:

| Setting (`.env`) | Default | What it does |
|------------------|---------|--------------|
| `AGENTOS_RATE_LIMITS` | `on` in production, `off` otherwise | Sign-in attempts (10 per email and 50 per client address per 15 min), sign-ups (10 per address per hour) and new chats/tasks (30 per person per minute). Over the limit, people see "Too many attempts". |
| `AGENTOS_MAX_QUEUED_RUNS` | `100` | Queued runs per workspace before new chats and tasks are refused ("This workspace already has a lot of work queued"). Schedules, delegation and workflows are never refused; they wait. |
| `AGENTOS_MAX_RUNNING_RUNS` | `3` | Runs one workspace executes at once. Others wait for a free slot, so a busy workspace can't take every worker slot. |

Behind a reverse proxy, make sure it sets `X-Forwarded-For`; the per-address limits use its
first entry. Rate-limit counters live in Redis and are shared by every web server.

Models and MCP servers that keep failing are paused automatically: after three outages,
rate limits or timeouts in a row, a model is tried after the agent's other models for a minute,
and calls to an MCP server fail immediately for a minute with a message the agent can act on.
Both show in the run log. This memory is per process, so each worker learns on its own.

## Health

- `GET /api/health`: `200` with `"ok": true` when the web app reaches the database and Redis,
  `503` otherwise.
- Worker: `http://<worker>:4030` answers when the worker is up.
- **Analytics** shows failure rates per agent, model and tool. A model with many
  "Fallbacks" or a tool with many failures is the first place to look.
