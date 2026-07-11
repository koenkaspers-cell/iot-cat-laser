#!/usr/bin/env python3
"""
Cat Laser Pi Vitals Monitor
----------------------------
Run once for a snapshot:   python3 vitals.py
Run continuously:          python3 vitals.py --watch
Run with interval:         python3 vitals.py --watch --interval 2
"""

import argparse
import os
import subprocess
import sys
import time

# ── Helpers ────────────────────────────────────────────

def read_file(path, default="N/A"):
    try:
        with open(path) as f:
            return f.read().strip()
    except Exception:
        return default

def run_cmd(cmd, default="N/A"):
    try:
        return subprocess.check_output(cmd, shell=True, stderr=subprocess.DEVNULL).decode().strip()
    except Exception:
        return default

def color(text, code):
    return f"\033[{code}m{text}\033[0m"

def ok(text):    return color(text, "32")   # green
def warn(text):  return color(text, "33")   # yellow
def bad(text):   return color(text, "31")   # red
def bold(text):  return color(text, "1")    # bold
def dim(text):   return color(text, "2")    # dim

def bar(value, max_val, width=20, warn_pct=70, bad_pct=90):
    pct = min(100, value / max_val * 100)
    filled = int(pct / 100 * width)
    empty = width - filled
    bar_str = "█" * filled + "░" * empty
    if pct >= bad_pct:
        bar_str = bad(bar_str)
    elif pct >= warn_pct:
        bar_str = warn(bar_str)
    else:
        bar_str = ok(bar_str)
    return f"[{bar_str}] {pct:5.1f}%"

# ── Measurements ───────────────────────────────────────

def get_cpu_percent():
    """Read CPU usage from /proc/stat over a 200ms window."""
    def read_stat():
        line = read_file("/proc/stat").split("\n")[0].split()
        return [int(x) for x in line[1:]]
    s1 = read_stat()
    time.sleep(0.2)
    s2 = read_stat()
    idle1 = s1[3] + s1[4]
    idle2 = s2[3] + s2[4]
    total1 = sum(s1)
    total2 = sum(s2)
    total_diff = total2 - total1
    idle_diff  = idle2 - idle1
    if total_diff == 0:
        return 0.0
    return (1 - idle_diff / total_diff) * 100

def get_cpu_freq():
    freq = read_file("/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq", "0")
    try:
        return int(freq) // 1000  # MHz
    except Exception:
        return 0

def get_cpu_max_freq():
    freq = read_file("/sys/devices/system/cpu/cpu0/cpufreq/scaling_max_freq", "0")
    try:
        return int(freq) // 1000
    except Exception:
        return 1000

def get_temperature():
    temp = read_file("/sys/class/thermal/thermal_zone0/temp", "0")
    try:
        return int(temp) / 1000
    except Exception:
        val = run_cmd("vcgencmd measure_temp")
        try:
            return float(val.replace("temp=", "").replace("'C", ""))
        except Exception:
            return 0.0

def get_memory():
    meminfo = read_file("/proc/meminfo")
    info = {}
    for line in meminfo.split("\n"):
        parts = line.split()
        if len(parts) >= 2:
            info[parts[0].rstrip(":")] = int(parts[1])
    total = info.get("MemTotal", 0)
    free  = info.get("MemFree", 0)
    buffers = info.get("Buffers", 0)
    cached  = info.get("Cached", 0)
    used = total - free - buffers - cached
    return total // 1024, used // 1024  # MB

def get_swap():
    meminfo = read_file("/proc/meminfo")
    info = {}
    for line in meminfo.split("\n"):
        parts = line.split()
        if len(parts) >= 2:
            info[parts[0].rstrip(":")] = int(parts[1])
    total = info.get("SwapTotal", 0)
    free  = info.get("SwapFree", 0)
    used  = total - free
    return total // 1024, used // 1024  # MB

def get_throttle_status():
    raw = run_cmd("vcgencmd get_throttled")
    try:
        val = int(raw.replace("throttled=", ""), 16)
    except Exception:
        return {"raw": raw, "issues": ["unable to read"]}

    issues = []
    flags = {
        0:  "Under-voltage detected",
        1:  "ARM frequency capped",
        2:  "Currently throttled",
        3:  "Soft temp limit active",
        16: "Under-voltage has occurred",
        17: "ARM frequency capping has occurred",
        18: "Throttling has occurred",
        19: "Soft temp limit has occurred",
    }
    for bit, desc in flags.items():
        if val & (1 << bit):
            issues.append(desc)
    return {"raw": hex(val), "issues": issues}

def get_disk():
    result = run_cmd("df / --output=size,used,avail --block-size=M")
    lines = result.strip().split("\n")
    if len(lines) >= 2:
        parts = lines[1].split()
        try:
            total = int(parts[0].rstrip("M"))
            used  = int(parts[1].rstrip("M"))
            return total, used
        except Exception:
            pass
    return 0, 0

def get_service_status(name):
    status = run_cmd(f"systemctl is-active {name}")
    pid    = run_cmd(f"systemctl show {name} --property=MainPID --value")
    mem    = "N/A"
    cpu    = "N/A"
    if pid and pid != "0":
        mem = run_cmd(f"ps -p {pid} -o rss= 2>/dev/null")
        try:
            mem = f"{int(mem.strip()) // 1024} MB"
        except Exception:
            mem = "N/A"
    return status, pid, mem

def get_pigpio_status():
    result = run_cmd("systemctl is-active pigpiod")
    return result

def get_uptime():
    uptime = read_file("/proc/uptime").split()[0]
    try:
        secs = float(uptime)
        h = int(secs // 3600)
        m = int((secs % 3600) // 60)
        s = int(secs % 60)
        return f"{h}h {m}m {s}s"
    except Exception:
        return uptime

def get_network():
    result = run_cmd("ip addr show wlan0 | grep 'inet '")
    if result != "N/A" and result:
        parts = result.strip().split()
        return parts[1] if len(parts) > 1 else "N/A"
    return "N/A"

def get_tailscale_ip():
    return run_cmd("tailscale ip -4 2>/dev/null")

# ── Display ────────────────────────────────────────────

def print_vitals():
    os.system("clear")
    print(bold("=" * 54))
    print(bold("  Cat Laser Pi Vitals"))
    print(bold("=" * 54))
    print(f"  {dim('Uptime:')} {get_uptime()}")
    print()

    # CPU
    cpu_pct  = get_cpu_percent()
    cpu_freq = get_cpu_freq()
    cpu_max  = get_cpu_max_freq()
    throttle = cpu_freq < cpu_max * 0.8 and cpu_max > 0
    freq_str = f"{cpu_freq} MHz"
    if throttle:
        freq_str = warn(freq_str + " (throttled!)")
    print(bold("  CPU"))
    print(f"  Usage:  {bar(cpu_pct, 100)}")
    print(f"  Freq:   {freq_str} / {cpu_max} MHz")
    print()

    # Temperature
    temp = get_temperature()
    temp_str = f"{temp:.1f}°C"
    if temp >= 80:
        temp_label = bad(f"  {temp_str}  ← THROTTLING")
    elif temp >= 70:
        temp_label = warn(f"  {temp_str}  ← Getting hot")
    else:
        temp_label = ok(f"  {temp_str}  ← OK")
    print(bold("  Temperature"))
    print(f"  {temp_label}")
    print(f"  {bar(temp, 100, warn_pct=70, bad_pct=80)}")
    print()

    # Memory
    mem_total, mem_used = get_memory()
    swap_total, swap_used = get_swap()
    print(bold("  Memory"))
    print(f"  RAM:  {bar(mem_used, mem_total if mem_total else 1)}  {mem_used}/{mem_total} MB")
    if swap_total > 0:
        print(f"  Swap: {bar(swap_used, swap_total, warn_pct=50, bad_pct=80)}  {swap_used}/{swap_total} MB")
        if swap_used > swap_total * 0.5:
            print(f"  {warn('High swap usage - Pi may be struggling')}")
    print()

    # Disk
    disk_total, disk_used = get_disk()
    if disk_total > 0:
        print(bold("  Disk (SD card)"))
        print(f"  {bar(disk_used, disk_total, warn_pct=80, bad_pct=95)}  {disk_used}/{disk_total} MB")
        print()

    # Throttle flags
    throttle_info = get_throttle_status()
    print(bold("  Throttle flags"))
    if not throttle_info["issues"]:
        print(f"  {ok('No issues')}  (raw: {throttle_info['raw']})")
    else:
        for issue in throttle_info["issues"]:
            if "has occurred" in issue:
                print(f"  {warn('⚠ ' + issue)}")
            else:
                print(f"  {bad('✗ ' + issue)}")
    print()

    # Services
    print(bold("  Services"))
    cat_status, cat_pid, cat_mem = get_service_status("catlaser")
    pig_status = get_pigpio_status()

    cat_str = ok("running") if cat_status == "active" else bad(cat_status)
    pig_str = ok("running") if pig_status == "active" else bad(pig_status)

    print(f"  catlaser:  {cat_str}  (PID {cat_pid}, {cat_mem})")
    print(f"  pigpiod:   {pig_str}")
    print()

    # Network
    local_ip = get_network()
    ts_ip    = get_tailscale_ip()
    print(bold("  Network"))
    print(f"  WiFi:      {local_ip}")
    print(f"  Tailscale: {ts_ip}")
    print()

    print(bold("=" * 54))
    print(dim("  Press Ctrl+C to exit"))

# ── Main ───────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Cat Laser Pi Vitals")
    parser.add_argument("--watch",    action="store_true", help="Refresh continuously")
    parser.add_argument("--interval", type=float, default=3.0, help="Refresh interval in seconds (default: 3)")
    args = parser.parse_args()

    if args.watch:
        try:
            while True:
                print_vitals()
                time.sleep(args.interval)
        except KeyboardInterrupt:
            print("\nExiting.")
    else:
        print_vitals()

if __name__ == "__main__":
    main()
