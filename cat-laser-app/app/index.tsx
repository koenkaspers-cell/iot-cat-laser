import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
const VLCPlayer = require("react-native-vlc-media-player").default;
import React, { useEffect, useRef, useState } from "react";
import {
  GestureResponderEvent,
  Image,
  LayoutChangeEvent,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { io } from "socket.io-client";

// ── Fallback calibration (manual values) ─────────────
// offset: servo position when touchpad is at center (0,0)
// scale:  how far servo moves per unit of touchpad (-1..1)
const DEFAULT_OFFSET_X = 0.02;
const DEFAULT_OFFSET_Y = -0.16;
const DEFAULT_SCALE_X = 0.30;
const DEFAULT_SCALE_Y = 0.16;

export default function Index() {
  const [piIp, setPiIp] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [frameUri, setFrameUri] = useState("");
  const [laser, setLaser] = useState({ active: false, x: 0, y: 0 });

  // Raw touchpad output (-1..1) for display only
  const [touchX, setTouchX] = useState(0);
  const [touchY, setTouchY] = useState(0);

  const [padW, setPadW] = useState(1);
  const [padH, setPadH] = useState(1);

  // Calibration loaded from storage
  const [offsetX, setOffsetX] = useState(DEFAULT_OFFSET_X);
  const [offsetY, setOffsetY] = useState(DEFAULT_OFFSET_Y);
  const [scaleX, setScaleX] = useState(DEFAULT_SCALE_X);
  const [scaleY, setScaleY] = useState(DEFAULT_SCALE_Y);

  // Keep latest servo values in a ref so touchEnd doesn't use stale state
  const servoRef = useRef({ x: DEFAULT_OFFSET_X, y: DEFAULT_OFFSET_Y });

  const socketRef = useRef<any>(null);

  // ── Load IP + calibration ─────────────────────────────
  useEffect(() => {
    AsyncStorage.multiGet([
      "PI_IP",
      "CALIB_OFFSET_X",
      "CALIB_OFFSET_Y",
      "CALIB_SCALE_X",
      "CALIB_SCALE_Y",
    ]).then(pairs => {
      const m = Object.fromEntries(pairs.map(([k, v]) => [k, v]));
      if (m["PI_IP"]) setPiIp(m["PI_IP"]!);
      if (m["CALIB_OFFSET_X"]) setOffsetX(parseFloat(m["CALIB_OFFSET_X"]!));
      if (m["CALIB_OFFSET_Y"]) setOffsetY(parseFloat(m["CALIB_OFFSET_Y"]!));
      if (m["CALIB_SCALE_X"]) setScaleX(parseFloat(m["CALIB_SCALE_X"]!));
      if (m["CALIB_SCALE_Y"]) setScaleY(parseFloat(m["CALIB_SCALE_Y"]!));
    });
  }, []);

  // ── Socket + frame stream ─────────────────────────────
  useEffect(() => {
    if (!piIp) return;
    socketRef.current = io(`http://${piIp}:5001`, { transports: ["polling"] });
    socketRef.current.on("connect", () => setConnected(true));
    socketRef.current.on("disconnect", () => setConnected(false));
    socketRef.current.on("connect_error", () => setConnected(false));
    socketRef.current.on("frame", (data: { data: string }) => {
      setFrameUri(`data:image/jpeg;base64,${data.data}`);
    });
    return () => socketRef.current?.disconnect();
  }, [piIp]);

  // ── Send servo command ────────────────────────────────
  // nx, ny are normalised touchpad values (-1..1)
  // servo = touchpad * scale + offset
  const sendServo = (nx: number, ny: number, laserOn: boolean) => {
    const sx = Math.max(-1, Math.min(1, nx * scaleX + offsetX));
    const sy = Math.max(-1, Math.min(1, ny * scaleY + offsetY));
    servoRef.current = { x: sx, y: sy };
    socketRef.current?.emit("control", { s1: sx, s2: sy, laser: laserOn });
  };

  // ── Touch → normalised pad coords ────────────────────
  // Horizontal (x) → nx: -1 = left, +1 = right
  // Vertical   (y) → ny: -1 = bottom, +1 = top (y inverted)
  const processTouch = (px: number, py: number) => {
    const nx = ((px / padW) * 2 - 1);           // horizontal: left=-1, right=+1
    const ny = -((py / padH) * 2 - 1);           // vertical:   top=+1, bottom=-1
    const clamped_nx = Math.max(-1, Math.min(1, nx));
    const clamped_ny = Math.max(-1, Math.min(1, ny));
    setTouchX(clamped_nx);
    setTouchY(clamped_ny);
    setLaser({ active: true, x: px, y: py });
    sendServo(clamped_nx, clamped_ny, true);
  };

  const touchEnd = () => {
    setLaser(l => ({ ...l, active: false }));
    // Send laser-off at current servo position (don't move servos)
    socketRef.current?.emit("control", {
      s1: servoRef.current.x,
      s2: servoRef.current.y,
      laser: false,
    });
  };

  // ── Platform event handlers ───────────────────────────
  const touchMove = (e: GestureResponderEvent) => {
    const { locationX, locationY } = e.nativeEvent;
    processTouch(locationX, locationY);
  };

  const pointerDown = (e: any) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    processTouch(e.clientX - r.left, e.clientY - r.top);
  };

  const pointerMove = (e: any) => {
    e.stopPropagation();
    if (e.buttons !== 1) return;
    const r = e.currentTarget.getBoundingClientRect();
    processTouch(e.clientX - r.left, e.clientY - r.top);
  };

  const pointerUp = (e: any) => {
    e.stopPropagation();
    touchEnd();
  };

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setPadW(width);
    setPadH(height);
  };

  // ── No IP screen ──────────────────────────────────────
  if (!piIp) {
    return (
      <View style={[styles.container, { justifyContent: "center", alignItems: "center" }]}>
        <Text style={{ color: "#444466", letterSpacing: 2, fontSize: 12, textAlign: "center" }}>
          No device configured.{"\n"}Go to Settings to set your Pi IP.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>CAT LASER</Text>
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: connected ? "#00ff88" : "#ff3366" }]} />
          <Text style={[styles.statusText, { color: connected ? "#00ff88" : "#ff3366" }]}>
            {connected ? "CONNECTED" : "OFFLINE"}
          </Text>
        </View>
      </View>

      {/* Camera feed */}
      <View style={styles.cameraWrapper}>
        {piIp ? (
          <VLCPlayer
            style={styles.camera}
            source={{ uri: `rtsp://${piIp}:8554/stream` }}
            autoplay={true}
            autoAspectRatio={true}
            resizeMode="cover"
          />
        ) : (
          <View style={[styles.camera, { backgroundColor: "#000" }]} />
        )}
        <View style={[styles.corner, styles.cornerTL]} />
        <View style={[styles.corner, styles.cornerTR]} />
        <View style={[styles.corner, styles.cornerBL]} />
        <View style={[styles.corner, styles.cornerBR]} />
        <View style={styles.liveBadge}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>LIVE</Text>
        </View>
      </View>

      {/* Divider */}
      <LinearGradient
        colors={["#ff3366", "#bf00ff", "#00d4ff"]}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
        style={styles.divider}
      />

      {/* Control label */}
      <View style={styles.controlHeader}>
        <Text style={styles.controlLabel}>LASER CONTROL</Text>
        <View style={[styles.laserIndicator, { borderColor: laser.active ? "#ff3366" : "#333" }]}>
          <View style={[styles.laserDot, { backgroundColor: laser.active ? "#ff3366" : "#222" }]} />
          <Text style={[styles.laserText, { color: laser.active ? "#ff3366" : "#555" }]}>
            {laser.active ? "FIRING" : "STANDBY"}
          </Text>
        </View>
      </View>

      {/* Touchpad */}
      <View style={styles.touchpadWrapper}>
        <LinearGradient
          colors={["#0d0d1a", "#0a001a", "#000d1a"]}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.gridH} />
        <View style={styles.gridV} />
        <View style={styles.crosshairH} />
        <View style={styles.crosshairV} />

        <View style={styles.coordsBox} pointerEvents="none">
          <Text style={styles.coordsText}>
            X <Text style={styles.coordsValue}>{touchX.toFixed(2)}</Text>
            {"   "}
            Y <Text style={styles.coordsValue}>{touchY.toFixed(2)}</Text>
          </Text>
        </View>

        {laser.active && (
          <View style={[styles.touchDot, { left: laser.x - 12, top: laser.y - 12 }]}
            pointerEvents="none" />
        )}

        {Platform.OS === "web" ? (
          <View
            style={StyleSheet.absoluteFill}
            onLayout={onLayout}
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={pointerUp}
          />
        ) : (
          <View
            style={StyleSheet.absoluteFill}
            onLayout={onLayout}
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            onResponderStart={touchMove}
            onResponderMove={touchMove}
            onResponderRelease={touchEnd}
          />
        )}
      </View>

    </View>
  );
}

const NEON_PINK = "#ff3366";
const NEON_CYAN = "#00d4ff";
const BG = "#08080f";
const SURFACE = "#0f0f1e";

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 20, paddingTop: 54, paddingBottom: 10,
    backgroundColor: SURFACE, borderBottomWidth: 1, borderBottomColor: "#1a1a2e",
  },
  headerTitle: { color: NEON_CYAN, fontSize: 20, fontWeight: "800", letterSpacing: 6 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 11, fontWeight: "700", letterSpacing: 2 },
  cameraWrapper: { width: "100%", height: "38%", backgroundColor: "#000", position: "relative" },
  camera: { width: "100%", height: "100%" },
  corner: { position: "absolute", width: 20, height: 20, borderColor: NEON_CYAN, borderWidth: 2 },
  cornerTL: { top: 10, left: 10, borderRightWidth: 0, borderBottomWidth: 0 },
  cornerTR: { top: 10, right: 10, borderLeftWidth: 0, borderBottomWidth: 0 },
  cornerBL: { bottom: 10, left: 10, borderRightWidth: 0, borderTopWidth: 0 },
  cornerBR: { bottom: 10, right: 10, borderLeftWidth: 0, borderTopWidth: 0 },
  liveBadge: {
    position: "absolute", top: 14, right: 40, flexDirection: "row", alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.6)", paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 4, gap: 5, borderWidth: 1, borderColor: NEON_PINK,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: NEON_PINK },
  liveText: { color: NEON_PINK, fontSize: 10, fontWeight: "700", letterSpacing: 2 },
  divider: { height: 2, width: "100%" },
  controlHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 20, paddingVertical: 10, backgroundColor: SURFACE,
  },
  controlLabel: { color: "#444466", fontSize: 11, fontWeight: "700", letterSpacing: 4 },
  laserIndicator: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 4, paddingHorizontal: 8, paddingVertical: 4 },
  laserDot: { width: 6, height: 6, borderRadius: 3 },
  laserText: { fontSize: 10, fontWeight: "700", letterSpacing: 2 },
  touchpadWrapper: { flex: 1, position: "relative", justifyContent: "center", alignItems: "center", borderTopWidth: 1, borderTopColor: "#1a1a2e" },
  gridH: { position: "absolute", width: "100%", height: 1, backgroundColor: "#1a1a2e", top: "50%" },
  gridV: { position: "absolute", height: "100%", width: 1, backgroundColor: "#1a1a2e", left: "50%" },
  crosshairH: { position: "absolute", width: 40, height: 1, backgroundColor: "#333355" },
  crosshairV: { position: "absolute", width: 1, height: 40, backgroundColor: "#333355" },
  touchDot: { position: "absolute", width: 24, height: 24, borderRadius: 12, backgroundColor: "rgba(255,51,102,0.3)", borderWidth: 2, borderColor: NEON_PINK },
  coordsBox: { position: "absolute", bottom: 16, backgroundColor: "rgba(0,0,0,0.5)", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: "#1a1a2e" },
  coordsText: { color: "#444466", fontSize: 12, fontWeight: "600", letterSpacing: 2 },
  coordsValue: { color: NEON_CYAN, fontWeight: "700" },
});