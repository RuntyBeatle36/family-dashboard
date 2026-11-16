#!/usr/bin/env bash
# ONE-TIME: snapshots db/dashboard.db (calendar events, to-dos, bulletin
# posts) to ~/dashboard-backup-<timestamp>.db, then deletes itself. Run
# automatically by scripts/system-update.sh on the next self-update — a
# safety copy before trying the Wayland switch (scripts/kiosk-display.sh).
#
# Uses SQLite's VACUUM INTO rather than cp — safe while the server is
# running, where a plain copy could catch the file mid-write.
#
# Deleting a tracked file leaves `git status` showing it as deleted; that's
# harmless for `git pull --ff-only` as long as no later commit edits this
# file — only ever delete it from the repo, never modify it.
#
# To restore: sudo systemctl stop dashboard.service, copy the backup over
# db/dashboard.db, then sudo systemctl start dashboard.service.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$REPO_DIR/db/dashboard.db"

if [ -f "$SRC" ]; then
  DEST="$HOME/dashboard-backup-$(date +%Y%m%d-%H%M%S).db"
  node -e '
    const { DatabaseSync } = require("node:sqlite");
    const [src, dest] = process.argv.slice(-2);
    new DatabaseSync(src, { readOnly: true }).prepare("VACUUM INTO ?").run(dest);
  ' "$SRC" "$DEST"
  echo "backup-db: database backed up to $DEST"
else
  echo "backup-db: no database at $SRC yet, nothing to back up"
fi

# Only reached if the backup succeeded (set -e) — a failed run stays put
# and retries on the next update.
rm -f -- "${BASH_SOURCE[0]}"
