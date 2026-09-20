#!/bin/sh
set -e

# Start the in-container cron scheduler only when CRON_SECRET is set — the cron
# routes reject unauthenticated calls in production, so without it there is
# nothing to run. Backgrounded; the web server is the container's main process.
if [ -n "$CRON_SECRET" ]; then
  node scheduler.mjs &
fi

exec node server.js
