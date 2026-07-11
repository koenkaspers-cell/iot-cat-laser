#!/bin/bash
set -e

echo "=================================================="
echo "  Cat Laser - Raspberry Pi Setup"
echo "=================================================="

PROJECT_DIR="$HOME/catlaser"
VENV_DIR="$HOME/catlazer-env"

# ── 1. System update ──────────────────────────────────
echo ""
echo "[1/8] Updating package lists..."
sudo apt update

# ── 2. System dependencies ────────────────────────────
echo ""
echo "[2/8] Installing system dependencies..."
sudo apt install -y \
    python3-venv \
    python3-full \
    libcap-dev \
    i2c-tools \
    pigpio \
    python3-pigpio \
    python3-picamera2 \
    python3-numpy \
    python3-opencv \
    python3-simplejpeg \
    git

# ── 3. Enable camera, I2C, SPI ────────────────────────
echo ""
echo "[3/8] Enabling camera, I2C and SPI interfaces..."
sudo raspi-config nonint do_camera 0 2>/dev/null || true
sudo raspi-config nonint do_i2c 0
sudo raspi-config nonint do_spi 0

CONFIG_FILE="/boot/firmware/config.txt"
if [ ! -f "$CONFIG_FILE" ]; then
    CONFIG_FILE="/boot/config.txt"
fi

if ! grep -q "camera_auto_detect=1" "$CONFIG_FILE"; then
    echo "camera_auto_detect=1" | sudo tee -a "$CONFIG_FILE" > /dev/null
fi

# ── 4. pigpio daemon ───────────────────────────────────
echo ""
echo "[4/8] Enabling pigpio daemon (required for servo PWM)..."
sudo systemctl enable pigpiod
sudo systemctl start pigpiod

# ── 5. Python virtual environment ─────────────────────
echo ""
echo "[5/8] Creating Python virtual environment..."
echo "      (using --system-site-packages so picamera2/pigpio/libcamera"
echo "       from apt are visible inside the venv)"
if [ -d "$VENV_DIR" ]; then
    echo "      Existing venv found, removing it for a clean install..."
    rm -rf "$VENV_DIR"
fi
python3 -m venv "$VENV_DIR" --system-site-packages

# ── 6. Python packages ─────────────────────────────────
echo ""
echo "[6/8] Installing Python packages into venv..."
"$VENV_DIR/bin/pip" install --upgrade pip
"$VENV_DIR/bin/pip" install flask flask-socketio pigpio

# ── 7. Project files ───────────────────────────────────
echo ""
echo "[7/8] Setting up project directory at $PROJECT_DIR ..."
mkdir -p "$PROJECT_DIR"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp "$SCRIPT_DIR/catlaser.py" "$PROJECT_DIR/"
cp "$SCRIPT_DIR/calibration.py" "$PROJECT_DIR/"
if [ ! -f "$PROJECT_DIR/config.json" ]; then
    cp "$SCRIPT_DIR/config.json" "$PROJECT_DIR/"
else
    echo "      Existing config.json found, keeping your settings."
fi

# ── Optional: Tailscale ────────────────────────────────
echo ""
read -p "Install Tailscale now? [y/N] " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    curl -fsSL https://tailscale.com/install.sh | sh
    sudo systemctl enable tailscaled
    echo ""
    echo "Run 'sudo tailscale up' to authenticate with your own account."
    echo "(Not run automatically — this needs your personal login.)"
fi

# ── 8. systemd service (auto-start on boot) ───────────
echo ""
echo "[8/8] Installing systemd service so the server auto-starts on boot..."
SERVICE_FILE="/etc/systemd/system/catlaser.service"
sudo bash -c "cat > $SERVICE_FILE" <<EOF
[Unit]
Description=Cat Laser Control Server
After=network-online.target pigpiod.service
Wants=network-online.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$PROJECT_DIR
ExecStart=$VENV_DIR/bin/python $PROJECT_DIR/catlaser.py
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable catlaser.service

echo ""
echo "=================================================="
echo "  Setup complete!"
echo "=================================================="
echo ""
echo "  Project files:   $PROJECT_DIR"
echo "  Edit settings:   nano $PROJECT_DIR/config.json"
echo ""
echo "  A reboot is required for camera/I2C/SPI changes"
echo "  to take effect."
echo ""
echo "  After reboot the server starts automatically."
echo "  Useful commands:"
echo "    sudo systemctl status catlaser   # check if running"
echo "    sudo systemctl restart catlaser  # restart after config change"
echo "    journalctl -u catlaser -f        # view live logs"
echo ""
read -p "Reboot now? [y/N] " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    sudo reboot
fi
