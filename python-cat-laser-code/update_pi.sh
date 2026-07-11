#!/bin/bash
set -euo pipefail

echo "=================================================="
echo "  Cat Laser - Raspberry Pi Update"
echo "=================================================="

PI_HOST="${PI_HOST:-koenk@100.105.79.33}"
PI_DIR="${PI_DIR:-~/catlaser}"
COPY_CONFIG="no"
RESTART="yes"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --host)       PI_HOST="$2";  shift 2 ;;
        --dir)        PI_DIR="$2";   shift 2 ;;
        --with-config) COPY_CONFIG="yes"; shift ;;
        --no-restart) RESTART="no";  shift ;;
        -h|--help)
            echo "Usage: ./update_pi.sh [options]"
            echo ""
            echo "Options:"
            echo "  --host <user@ip>   Pi SSH target (default: koenk@100.105.79.33)"
            echo "  --dir  <path>      Remote directory (default: ~/catlaser)"
            echo "  --with-config      Also copy config.json (skipped by default to"
            echo "                     preserve your GPIO/servo/camera settings)"
            echo "  --no-restart       Copy files but don't restart the service"
            exit 0
            ;;
        *)
            echo "Unknown option: $1 — run ./update_pi.sh --help"
            exit 1
            ;;
    esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Files that always get updated ─────────────────────
PI_FILES=(
    "catlaser.py"
)

# ── Config only when explicitly requested ──────────────
if [[ "$COPY_CONFIG" == "yes" ]]; then
    PI_FILES+=("config.json")
fi

# ── Verify all files exist locally ────────────────────
echo "Checking local files..."
missing=0
for f in "${PI_FILES[@]}"; do
    if [[ ! -f "$SCRIPT_DIR/$f" ]]; then
        echo "  MISSING: $SCRIPT_DIR/$f"
        missing=1
    else
        echo "  OK:      $f"
    fi
done
if [[ "$missing" == "1" ]]; then
    echo ""
    echo "ERROR: One or more files are missing. Aborting."
    exit 1
fi

echo ""
echo "Target: $PI_HOST:$PI_DIR"
echo ""

# ── Ensure remote directory exists ────────────────────
echo "Ensuring remote directory exists..."
ssh "$PI_HOST" "mkdir -p $PI_DIR"

# ── Copy files ─────────────────────────────────────────
echo "Copying files..."
for f in "${PI_FILES[@]}"; do
    echo "  → $f"
    scp "$SCRIPT_DIR/$f" "$PI_HOST:$PI_DIR/$f"
done

# ── Syntax check on Pi before restarting ──────────────
echo ""
echo "Checking Python syntax on Pi..."
ssh "$PI_HOST" "python3 -m py_compile $PI_DIR/catlaser.py && echo '  catlaser.py OK'"
ssh "$PI_HOST" "python3 -m py_compile $PI_DIR/calibration.py && echo '  calibration.py OK'"

# ── Restart service ────────────────────────────────────
if [[ "$RESTART" == "yes" ]]; then
    echo ""
    echo "Restarting catlaser service..."
    ssh "$PI_HOST" "sudo systemctl restart catlaser"
    sleep 2
    ssh "$PI_HOST" "sudo systemctl --no-pager --lines=15 status catlaser"
else
    echo ""
    echo "Skipping service restart (--no-restart)."
fi

echo ""
echo "=================================================="
echo "  Update complete!"
echo "=================================================="
echo ""
echo "Useful commands:"
echo "  Live logs:  ssh $PI_HOST 'journalctl -u catlaser -f'"
echo "  Vitals:     ssh $PI_HOST 'python3 $PI_DIR/vitals.py --watch'"
echo "  Health:     curl http://$(echo $PI_HOST | cut -d@ -f2):5001/health"
