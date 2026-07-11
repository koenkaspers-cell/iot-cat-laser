# Cat Laser - Raspberry Pi Setup

This folder contains everything needed to set up the Pi side of the
cat laser project from a fresh Raspberry Pi OS install.

## Files

- **setup.sh** - one-time install script. Installs all system and
  Python dependencies, enables camera/I2C/SPI, and registers the
  server as a systemd service so it starts automatically on boot.
- **catlaser.py** - the control server (camera + servo + laser).
- **config.json** - all the settings you're likely to want to change
  (GPIO pins, servo range, camera resolution/quality). Edit this
  instead of the Python file.

## First-time setup

1. Flash Raspberry Pi OS (Bookworm or newer) with SSH enabled via
   Raspberry Pi Imager.
2. Copy this whole folder onto the Pi, e.g. with `scp`:
   ```bash
   scp -r catlaser-pi koenk@<pi-ip>:~/catlaser-pi
   ```
3. SSH in and run the installer:
   ```bash
   ssh koenk@<pi-ip>
   cd ~/catlaser-pi
   chmod +x setup.sh
   ./setup.sh
   ```
4. Reboot when prompted (needed for camera/I2C/SPI to activate).
5. After reboot, the server starts automatically. Check it's running:
   ```bash
   sudo systemctl status catlaser
   ```

## Changing settings (pins, camera quality, etc.)

Edit the config file, then restart the service - no need to touch
`catlaser.py` or reinstall anything:

```bash
nano ~/catlaser/config.json
sudo systemctl restart catlaser
```

## Useful commands

```bash
sudo systemctl status catlaser     # is it running?
sudo systemctl restart catlaser    # restart after a config change
sudo systemctl stop catlaser       # stop it
journalctl -u catlaser -f          # live logs (Ctrl+C to exit)
```

## Manual run (for debugging)

If you want to run it directly in a terminal instead of as a service
(useful to see print() output live, or while testing wiring changes):

```bash
sudo systemctl stop catlaser     # stop the auto-started one first
source ~/catlazer-env/bin/activate
python ~/catlaser/catlaser.py
```

Press `Ctrl+C` to stop, then `sudo systemctl start catlaser` to hand
control back to the service.

## What setup.sh actually does

This script bakes in the fixes from everything we ran into during
development, so you shouldn't hit them again:

- Installs `libcap-dev` before anything tries to build `picamera2`
  dependencies (missing this causes a build error).
- Creates the virtual environment with `--system-site-packages` so it
  can see `picamera2` / `libcamera` (these are apt-installed, not
  pip-installable, and a plain `venv` can't see them).
- Enables the `pigpiod` daemon and starts it (required for servo PWM
  - the script will refuse to start without it).
- Registers a systemd service so the Pi recovers automatically after
  a reboot or power loss, with no manual restart needed.
