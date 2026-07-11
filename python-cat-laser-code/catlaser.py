import json, os, sys, subprocess, threading, time
from flask import Flask
from flask_socketio import SocketIO

CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")
try:
    with open(CONFIG_PATH) as f:
        CFG = json.load(f)
except FileNotFoundError:
    print(f"ERROR: config.json not found at {CONFIG_PATH}"); sys.exit(1)
except json.JSONDecodeError as e:
    print(f"ERROR: config.json invalid JSON: {e}"); sys.exit(1)

SERVO_X_PIN    = CFG["gpio"]["servo_x_pin"]
SERVO_Y_PIN    = CFG["gpio"]["servo_y_pin"]
LASER_PIN      = CFG["gpio"]["laser_pin"]
LASER_INVERT   = CFG["gpio"].get("laser_invert", False)
SERVO_MIN      = CFG["servo"]["min_pulse_us"]
SERVO_MAX      = CFG["servo"]["max_pulse_us"]
INVERT_X       = CFG["servo"]["invert_x"]
INVERT_Y       = CFG["servo"]["invert_y"]
CAM_WIDTH      = CFG["camera"]["width"]
CAM_HEIGHT     = CFG["camera"]["height"]
PORT           = CFG["network"]["control_port"]
RTSP_PORT      = CFG["network"].get("rtsp_port", 8554)
LASER_AUTO_OFF = CFG["safety"]["laser_off_on_disconnect"]
MAX_LASER_SECS = CFG["safety"]["max_laser_on_seconds"]

SERVO_MIN_INTERVAL = 0.02
SERVO_DEAD_ZONE    = 0.01

try:
    import pigpio
except ImportError:
    print("ERROR: pigpio not installed."); sys.exit(1)

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

# ── pigpio ──────────────────────────────────────────────
pi = pigpio.pi()
pi_lock = threading.Lock()

def pigpio_watchdog():
    global pi
    while True:
        time.sleep(5)
        with pi_lock:
            if not pi.connected:
                print("pigpio disconnected, reconnecting...")
                try:
                    pi = pigpio.pi()
                    if pi.connected:
                        pi.set_mode(LASER_PIN, pigpio.OUTPUT)
                        pi.set_pull_up_down(LASER_PIN, pigpio.PUD_UP)
                        pi.write(LASER_PIN, 1 if LASER_INVERT else 0)
                        print("pigpio reconnected.")
                except Exception as e:
                    print(f"pigpio reconnect failed: {e}")

threading.Thread(target=pigpio_watchdog, daemon=True).start()

if not pi.connected:
    print("ERROR: Cannot connect to pigpio daemon.")
    sys.exit(1)

pi.set_mode(LASER_PIN, pigpio.OUTPUT)
pi.set_pull_up_down(LASER_PIN, pigpio.PUD_UP)
pi.write(LASER_PIN, 1 if LASER_INVERT else 0)

# ── RTSP stream via libcamera-vid ───────────────────────
rtsp_process = None

def start_rtsp():
    global rtsp_process
    cmd = [
        "libcamera-vid",
        "-t",       "0",           # stream forever
        "--width",  str(CAM_WIDTH),
        "--height", str(CAM_HEIGHT),
        "--framerate", "15",
        "--bitrate", "1000000",    # 1Mbps — good for LAN/Tailscale
        "--profile", "baseline",   # most compatible H.264 profile
        "--level",  "4.0",
        "--inline",                # put SPS/PPS in every keyframe
        "--listen",                # wait for client connections
        "-o",  f"rtsp://0.0.0.0:{RTSP_PORT}/stream",
    ]
    print(f"Starting RTSP stream on rtsp://0.0.0.0:{RTSP_PORT}/stream")
    try:
        rtsp_process = subprocess.Popen(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        # Log any errors from libcamera-vid
        def log_stderr():
            for line in rtsp_process.stderr:
                decoded = line.decode("utf-8", errors="ignore").strip()
                if decoded:
                    print(f"[rtsp] {decoded}")
        threading.Thread(target=log_stderr, daemon=True).start()
    except FileNotFoundError:
        print("WARNING: libcamera-vid not found. RTSP stream unavailable.")
        print("Install with: sudo apt install libcamera-apps")
        rtsp_process = None

def rtsp_watchdog():
    """Restart RTSP stream if it dies."""
    while True:
        time.sleep(10)
        if rtsp_process and rtsp_process.poll() is not None:
            print("RTSP stream died, restarting...")
            start_rtsp()

start_rtsp()
threading.Thread(target=rtsp_watchdog, daemon=True).start()

# ── Servo ───────────────────────────────────────────────
servo_state       = {"x": 0.0, "y": 0.0}
servo_last_update = {"x": 0.0, "y": 0.0}
servo_lock        = threading.Lock()

def map_to_pulse(value, invert=False):
    value = max(-1.0, min(1.0, value))
    if invert:
        value = -value
    return int(SERVO_MIN + (value + 1) / 2 * (SERVO_MAX - SERVO_MIN))

def set_servo_safe(pin, key, value, invert=False):
    now = time.time()
    with servo_lock:
        delta   = abs(value - servo_state[key])
        elapsed = now - servo_last_update[key]
        if delta < SERVO_DEAD_ZONE and elapsed < SERVO_MIN_INTERVAL:
            return
        servo_state[key]       = value
        servo_last_update[key] = now
    pulse = map_to_pulse(value, invert)
    with pi_lock:
        if pi.connected:
            pi.set_servo_pulsewidth(pin, pulse)

# ── Laser ───────────────────────────────────────────────
laser_on_since    = None
laser_lock        = threading.Lock()
connected_clients = 0
clients_lock      = threading.Lock()

def laser_on():
    global laser_on_since
    with laser_lock:
        with pi_lock:
            if pi.connected:
                pi.write(LASER_PIN, 0 if LASER_INVERT else 1)
        laser_on_since = time.time()

def laser_off():
    global laser_on_since
    with laser_lock:
        with pi_lock:
            if pi.connected:
                pi.write(LASER_PIN, 1 if LASER_INVERT else 0)
        laser_on_since = None

def laser_safety_loop():
    global laser_on_since
    while True:
        time.sleep(1)
        with laser_lock:
            if laser_on_since and (time.time() - laser_on_since) > MAX_LASER_SECS:
                print("Safety: laser on too long, turning off.")
                with pi_lock:
                    if pi.connected:
                        pi.write(LASER_PIN, 1 if LASER_INVERT else 0)
                laser_on_since = None
            with clients_lock:
                no_clients = connected_clients == 0
            if no_clients and laser_on_since is not None:
                print("Safety: no clients, turning off laser.")
                with pi_lock:
                    if pi.connected:
                        pi.write(LASER_PIN, 1 if LASER_INVERT else 0)
                laser_on_since = None

threading.Thread(target=laser_safety_loop, daemon=True).start()

# ── HTTP health ─────────────────────────────────────────
@app.route("/health")
def health():
    with clients_lock:
        clients = connected_clients
    return {
        "status":           "ok",
        "pigpio":           pi.connected,
        "connected_clients": clients,
        "laser_on":         laser_on_since is not None,
        "rtsp_url":         f"rtsp://[pi-ip]:{RTSP_PORT}/stream",
        "rtsp_running":     rtsp_process is not None and rtsp_process.poll() is None,
    }

# ── Socket.IO events ────────────────────────────────────
@socketio.on("connect")
def on_connect():
    global connected_clients
    with clients_lock:
        connected_clients += 1
    print(f"App connected! Clients: {connected_clients}")

@socketio.on("disconnect")
def on_disconnect():
    global connected_clients
    with clients_lock:
        connected_clients = max(0, connected_clients - 1)
        remaining = connected_clients
    print(f"App disconnected. Clients: {remaining}")
    if LASER_AUTO_OFF and remaining == 0:
        laser_off()

@socketio.on("control")
def on_control(data):
    try:
        s1   = float(data.get("s1", 0))
        s2   = float(data.get("s2", 0))
        fire = bool(data.get("laser", False))
    except (TypeError, ValueError):
        print(f"Ignoring malformed control: {data}")
        return
    set_servo_safe(SERVO_X_PIN, "x", s1, INVERT_X)
    set_servo_safe(SERVO_Y_PIN, "y", s2, INVERT_Y)
    if fire:
        laser_on()
    else:
        laser_off()

# ── Cleanup ─────────────────────────────────────────────
def cleanup():
    print("Shutting down...")
    laser_off()
    if rtsp_process:
        rtsp_process.terminate()
    with pi_lock:
        if pi.connected:
            pi.set_servo_pulsewidth(SERVO_X_PIN, 0)
            pi.set_servo_pulsewidth(SERVO_Y_PIN, 0)
            pi.stop()

import atexit
atexit.register(cleanup)

if __name__ == "__main__":
    print("=" * 50)
    print("  Cat Laser Control Server")
    print("=" * 50)
    print(f"  Servo X:  GPIO{SERVO_X_PIN}")
    print(f"  Servo Y:  GPIO{SERVO_Y_PIN}")
    print(f"  Laser:    GPIO{LASER_PIN} (invert={LASER_INVERT})")
    print(f"  Camera:   {CAM_WIDTH}x{CAM_HEIGHT}")
    print(f"  RTSP:     rtsp://[ip]:{RTSP_PORT}/stream")
    print(f"  Control:  socket.io on port {PORT}")
    print("=" * 50)
    socketio.run(app, host="0.0.0.0", port=PORT, allow_unsafe_werkzeug=True)