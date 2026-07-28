#!/usr/bin/env bash
###############################################################################
# Replit -> GitHub backup (universal - same script for every Repl)
#
# ONE-TIME SETUP: In Replit, add an ACCOUNT-level secret named GH_TOKEN
#   (Account -> Secrets) containing your fine-grained PAT. It becomes
#   available in every Repl automatically.
#
# THEN, in each Repl's Shell tab, run:   bash backup.sh
#   (optional: REPO_NAME=custom-name bash backup.sh)
#
# What it does:
#   1. Creates the private GitHub repo if it doesn't exist
#   2. If the repo ALREADY HAS CODE (e.g. Podlever), pushes to a dated
#      replit-backup-YYYYMMDD branch so main/PR history is never clobbered.
#      Empty or new repos get pushed straight to main.
#   3. Auto-ignores files >95MB (GitHub hard limit is 100MB) and lists them
#   4. Writes SECRETS_MANIFEST.txt - the NAMES of your env vars/secrets
#      (never the values) so you know what to re-enter after a migration
#   5. Reminds you about the database if DATABASE_URL exists
###############################################################################
set -euo pipefail

GH_USER="russellnomer"
TOKEN="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
if [ -z "$TOKEN" ]; then
  echo "ERROR: GH_TOKEN is not set. Add it as a Replit ACCOUNT secret first."; exit 1
fi

sanitize() { echo "$1" | tr ' ' '-' | tr -cd 'A-Za-z0-9._-'; }
is_generic() { case "$(echo "$1" | tr 'A-Z' 'a-z')" in workspace|runner|theappname|"") return 0;; *) return 1;; esac; }

NAME=$(sanitize "${REPO_NAME:-${REPL_SLUG:-$(basename "$PWD")}}")

# Modern Replit shells always live in ~/workspace and REPL_SLUG is usually unset,
# so try to guess the app name from project files, then confirm interactively.
if is_generic "$NAME"; then
  GUESS=""
  # guess 1: package.json "name"
  [ -f package.json ] && GUESS=$(sed -n 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' package.json | head -1)
  # guess 2: first heading of replit.md
  if { [ -z "$GUESS" ] || is_generic "$(sanitize "$GUESS")"; } && [ -f replit.md ]; then
    GUESS=$(sed -n 's/^#[[:space:]]*//p' replit.md | head -1 | cut -c1-60)
  fi
  GUESS=$(sanitize "$GUESS")
  if [ -t 0 ]; then
    echo ""
    [ -n "$GUESS" ] && ! is_generic "$GUESS" && echo "Best guess for this app's name: $GUESS"
    printf "Type the GitHub repo name to back up to (Enter = use guess): "
    read -r ANSWER
    ANSWER=$(sanitize "$ANSWER")
    if [ -n "$ANSWER" ]; then NAME="$ANSWER"; elif [ -n "$GUESS" ] && ! is_generic "$GUESS"; then NAME="$GUESS"; fi
  fi
  if is_generic "$NAME"; then
    echo "ERROR: Could not determine the app name."
    echo "Re-run with:  REPO_NAME=MyAppName bash gitbackup/backup.sh"
    exit 1
  fi
fi
echo "==> Backing up this Repl to github.com/$GH_USER/$NAME"

api() { curl -fsS -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" "$@"; }

# --- 1. ensure repo exists ---------------------------------------------------
if api "https://api.github.com/repos/$GH_USER/$NAME" >/dev/null 2>&1; then
  echo "    repo exists"
else
  echo "    creating private repo $NAME ..."
  api -X POST "https://api.github.com/user/repos" \
      -d "{\"name\":\"$NAME\",\"private\":true,\"description\":\"Replit backup\"}" >/dev/null
fi

# --- 2. does it already have commits? ---------------------------------------
EMPTY=yes
if api "https://api.github.com/repos/$GH_USER/$NAME/branches" 2>/dev/null | grep -q '"name"'; then
  EMPTY=no
fi

# --- 3. git init + big-file guard --------------------------------------------
git init -q 2>/dev/null || true
git config user.email "russell@russellnomer.com"
git config user.name  "Russell Nomer"

touch .gitignore
grep -qxF ".env" .gitignore || echo ".env" >> .gitignore
BIG=0
while IFS= read -r f; do
  rel="${f#./}"
  if ! grep -qxF "$rel" .gitignore; then
    echo "$rel" >> .gitignore
    echo "    SKIPPED (>95MB, over GitHub limit): $rel"
    BIG=1
  fi
done < <(find . -path ./.git -prune -o -type f -size +95M -print 2>/dev/null)
[ "$BIG" = 1 ] && echo "    (large files listed above are NOT in the backup - download them separately)"

# --- 4. secrets manifest (names only, NEVER values) --------------------------
env | cut -d= -f1 \
  | grep -E '^[A-Za-z_][A-Za-z0-9_]*$' \
  | grep -vE '^(REPL_|REPLIT_|NIX_|XDG_|LC_|GH_TOKEN$|GITHUB_TOKEN$|HOME$|PATH$|PWD$|OLDPWD$|SHELL$|SHLVL$|USER$|LOGNAME$|LANG$|TERM$|HOSTNAME$|_$)' \
  | sort -u > SECRETS_MANIFEST.txt || true
echo "    wrote SECRETS_MANIFEST.txt (env var NAMES only - values must be re-entered by hand on restore)"

# --- 5. commit ----------------------------------------------------------------
git add -A
git commit -q -m "Replit backup $(date +%F)" 2>/dev/null || echo "    nothing new to commit"

# --- 6. push ------------------------------------------------------------------
BRANCH="main"
if [ "$EMPTY" = "no" ]; then
  BRANCH="replit-backup-$(date +%Y%m%d)"
  echo "    repo already has code -> pushing to safe branch '$BRANCH' (main untouched)"
fi
git remote remove _backup 2>/dev/null || true
git remote add _backup "https://x-access-token:${TOKEN}@github.com/$GH_USER/$NAME.git"
git push -f _backup "HEAD:refs/heads/$BRANCH"
git remote remove _backup   # never leave the token in .git/config

echo ""
echo "==> DONE: https://github.com/$GH_USER/$NAME/tree/$BRANCH"

# --- 7. database reminder ------------------------------------------------------
if [ -n "${DATABASE_URL:-}" ]; then
  echo ""
  echo "!! This Repl has a database. Code is backed up, DATA is not."
  echo "!! To export it, run:  pg_dump \"\$DATABASE_URL\" > \"${NAME}_$(date +%F).sql\""
  echo "!! then download that .sql file to your computer. Do NOT commit it to git."
fi
