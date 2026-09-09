#!/usr/bin/env bash
# Reclaim disk space on the Crostini container, and offload backup ARCHIVES
# to Google Drive.
#
#   bash scripts/reclaim-space.sh            # report only, deletes nothing
#   bash scripts/reclaim-space.sh --clean    # actually reclaim
#   bash scripts/reclaim-space.sh --clean --offload   # ...and copy archives to Drive
#
# IT REPORTS BEFORE IT DELETES, on purpose. On 2026-09-07 the container had
# 70G free of 72G (3% used) while the machine was reported as short on space,
# which means the pressure was on the ChromeOS side, not in here. Deleting
# things in the container would have freed nothing and cost real time. Run it
# with no flags first and read the numbers.
#
# WHAT IS DELIBERATELY *NOT* MOVED TO DRIVE, and why. Ahmed asked to divert
# project storage there. Two parts of it must not go:
#
#   - The git working tree. Drive is a FUSE mount. git does thousands of small
#     reads, writes and lock operations per command; over FUSE that is slow and
#     the locking semantics are not the ones git assumes. This is a known way
#     to corrupt a repository, not a theoretical one.
#   - The Ollama models (~8.6G). Ollama memory-maps model files during
#     inference. Over FUSE that is unusably slow -- the models would load, and
#     every answer would take minutes.
#
# Both are also the wrong target: they are the two things that reproduce for
# free from a manifest (see scripts/backup.sh) and from `ollama pull`. What
# genuinely belongs on Drive is the backup archive, which backup.sh already
# keeps small by excluding venv-ai (3.8G) and the models (8.6G).
#
# And per bootstrap/README.md: /mnt/chromeos may not be mounted at all under
# ChromeOS 143's containerless Crostini. This checks rather than assumes, and
# says how to fix it if absent.
set -uo pipefail

CLEAN=0; OFFLOAD=0
for a in "$@"; do
  [ "$a" = "--clean" ] && CLEAN=1
  [ "$a" = "--offload" ] && OFFLOAD=1
done

hr() { printf '%s\n' "────────────────────────────────────────────────────────"; }

# size_kb MUST NOT be written as `[ -e "$1" ] && du ... | awk ... || echo 0`.
# `set -o pipefail` is on above, so when du hits a directory it cannot read --
# /var/cache/apt/archives/partial is root-only, and this runs as a user -- the
# PIPELINE exits non-zero even though awk printed the total fine. The `|| echo 0`
# then fires as well, and the function returns TWO lines:
#
#   740
#   0
#
# which arrives in kb2h's arithmetic as `$(( 740\n0 * 1024 ))`:
#
#   scripts/reclaim-space.sh: line 43: 740
#   0 * 1024 : syntax error in expression (error token is "0 * 1024 ")
#
# Observed on Ahmed's Chromebook 2026-09-08. Exactly one value out, always.
size_kb() {
  [ -e "$1" ] || { echo 0; return 0; }
  local n
  n=$(du -sk "$1" 2>/dev/null | awk 'NR==1{print $1}')
  case "$n" in
    ''|*[!0-9]*) n=0 ;;      # unreadable, or du printed something unexpected
  esac
  echo "$n"
}

# Defensive for the same reason: never let a non-numeric reach the arithmetic.
kb2h() {
  local k="${1:-0}"
  case "$k" in
    ''|*[!0-9]*) k=0 ;;
  esac
  numfmt --to=iec --suffix=B "$(( k * 1024 ))" 2>/dev/null || echo "${k}K"
}

avail_kb() { df -Pk / | awk 'NR==2{print $4}'; }

BEFORE=$(avail_kb)

hr; echo "DISK — container"; hr
df -h / | sed 's/^/  /'
echo
echo "  NOTE: this is the Crostini container's disk, not ChromeOS's."
echo "  If this shows plenty free but your Chromebook says it is full, the"
echo "  pressure is ChromeOS-side. Fix it there instead:"
echo "    Settings > About ChromeOS > Storage management"
echo "    ChromeOS also caps the Linux disk; Settings > Advanced > Developers"
echo "    > Linux development environment > Disk size lets you resize it."
echo

hr; echo "LARGEST DIRECTORIES IN \$HOME"; hr
du -h --max-depth=2 "$HOME" 2>/dev/null | sort -rh | head -15 | sed 's/^/  /'
echo

hr; echo "RECLAIMABLE"; hr
declare -a LABEL PATHS BYTES
add() { LABEL+=("$1"); PATHS+=("$2"); BYTES+=("$(size_kb "$2")"); }
add "apt package cache"        "/var/cache/apt/archives"
add "systemd journal"          "/var/log/journal"
add "npm cache"                "$HOME/.npm/_cacache"
add "pip cache"                "$HOME/.cache/pip"
add "generic user cache"       "$HOME/.cache"
add "old venv-ai (rebuildable)" "$HOME/venv-ai"
add "Ollama models"            "/usr/share/ollama/.ollama/models"

TOTAL_SAFE=0
for i in "${!LABEL[@]}"; do
  printf '  %-30s %10s  %s\n' "${LABEL[$i]}" "$(kb2h "${BYTES[$i]}")" "${PATHS[$i]}"
  case "${LABEL[$i]}" in
    "apt package cache"|"systemd journal"|"npm cache"|"pip cache")
      TOTAL_SAFE=$(( TOTAL_SAFE + BYTES[i] )) ;;
  esac
done
echo
echo "  Safe to clear now: $(kb2h "$TOTAL_SAFE")"
echo "  venv-ai and the Ollama models are NOT auto-deleted: both are large and"
echo "  both are rebuildable, but deleting them means a long re-download. Do it"
echo "  by hand only if you are actually out of space:"
echo "    rm -rf ~/venv-ai            # bootstrap/install.sh step 4 rebuilds it"
echo "    ollama rm <model>           # 'ollama list' first; re-pull is step 3"
echo

hr; echo "BACKUP ARCHIVES IN \$HOME"; hr
mapfile -t ARCHIVES < <(find "$HOME" -maxdepth 1 -name 'jarvis-x-backup-*.tar.gz' 2>/dev/null | sort)
if [ "${#ARCHIVES[@]}" -eq 0 ]; then
  echo "  (none — scripts/backup.sh makes one)"
else
  for f in "${ARCHIVES[@]}"; do printf '  %10s  %s\n' "$(kb2h "$(size_kb "$f")")" "$(basename "$f")"; done
fi
echo

# ── Google Drive ──────────────────────────────────────────────────────────
DRIVE=""
for cand in /mnt/chromeos/GoogleDrive/MyDrive /mnt/chromeos/GoogleDrive/root; do
  [ -d "$cand" ] && { DRIVE="$cand"; break; }
done
hr; echo "GOOGLE DRIVE"; hr
if [ -n "$DRIVE" ]; then
  echo "  mounted at: $DRIVE"
else
  echo "  NOT MOUNTED."
  echo "  ChromeOS 143's containerless Crostini does not share it by default."
  echo "  To enable: Files app > right-click 'Google Drive' > 'Share with Linux'."
  echo "  Then re-run. (Same reason your ~/Downloads .tar.gz was unreachable.)"
fi
echo

# ── actions ───────────────────────────────────────────────────────────────
if [ "$CLEAN" -eq 0 ]; then
  hr; echo "REPORT ONLY — nothing was deleted."; hr
  echo "  Re-run with --clean to reclaim, and --offload to copy archives to Drive."
  exit 0
fi

hr; echo "CLEANING"; hr
echo "==> apt: broken/half-configured packages"
sudo dpkg --configure -a 2>&1 | sed 's/^/    /' || true
sudo apt-get --fix-broken install -y 2>&1 | tail -3 | sed 's/^/    /' || true
echo "==> apt: orphans and cache"
sudo apt-get autoremove --purge -y 2>&1 | tail -3 | sed 's/^/    /' || true
sudo apt-get clean 2>&1 | sed 's/^/    /' || true
echo "==> purging config-only (rc) packages"
RC=$(dpkg -l 2>/dev/null | awk '/^rc/{print $2}')
if [ -n "$RC" ]; then
  # shellcheck disable=SC2086
  sudo apt-get purge -y $RC 2>&1 | tail -3 | sed 's/^/    /' || true
else
  echo "    (none)"
fi
echo "==> journal logs older than 3 days"
sudo journalctl --vacuum-time=3d 2>&1 | tail -2 | sed 's/^/    /' || true
echo "==> npm and pip caches"
npm cache clean --force 2>/dev/null && echo "    npm cache cleared" || echo "    (npm not present)"
rm -rf "$HOME/.cache/pip" 2>/dev/null && echo "    pip cache cleared" || true
echo

if [ "$OFFLOAD" -eq 1 ]; then
  hr; echo "OFFLOAD TO DRIVE"; hr
  if [ -z "$DRIVE" ]; then
    echo "  SKIPPED — Drive is not mounted (see above)."
  elif [ "${#ARCHIVES[@]}" -eq 0 ]; then
    echo "  Nothing to move. Make one first:  bash scripts/backup.sh"
  else
    DEST="$DRIVE/jarvis-x-backups"
    mkdir -p "$DEST"
    for f in "${ARCHIVES[@]}"; do
      echo "  copying $(basename "$f") ..."
      # Copy, verify, THEN delete. Never move: a truncated copy over FUSE with
      # the local original already gone is how a backup strategy becomes a
      # data-loss strategy.
      if cp "$f" "$DEST/" && cmp -s "$f" "$DEST/$(basename "$f")"; then
        rm -f "$f"
        echo "    verified and removed local copy"
        [ -f "$f.sha256" ] && cp "$f.sha256" "$DEST/" && rm -f "$f.sha256"
      else
        echo "    COPY FAILED OR MISMATCHED — local copy kept" >&2
      fi
    done
  fi
  echo
fi

AFTER=$(avail_kb)
hr; echo "RESULT"; hr
printf '  free before : %s\n' "$(kb2h "$BEFORE")"
printf '  free after  : %s\n' "$(kb2h "$AFTER")"
printf '  reclaimed   : %s\n' "$(kb2h "$(( AFTER - BEFORE ))")"
echo
echo "  If that did not help, the space is on the ChromeOS side, not in here."
