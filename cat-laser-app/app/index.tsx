import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useState } from "react";
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
import { PI_IP } from "../src/config";

export default function Index() {
  const [touchX, setTouchX] = useState(0);
  const [touchY, setTouchY] = useState(0);
  const [padW, setPadW] = useState(1);
  const [padH, setPadH] = useState(1);
  const [connected, setConnected] = useState(false);
  const [frameUri, setFrameUri] = useState(`http://${PI_IP}:5001/frame?t=0`);
  const rawXRef = React.useRef(0);
  const rawYRef = React.useRef(0);
  const [laser, setLaser] = useState({ active: false, x: 0, y: 0 });

  const socketRef = React.useRef<any>(null);

  useEffect(() => {
    socketRef.current = io(`http://${PI_IP}:5001`);
    socketRef.current.on("connect", () => setConnected(true));
    socketRef.current.on("disconnect", () => setConnected(false));
    socketRef.current.on("connect_error", () => setConnected(false));
    return () => socketRef.current?.disconnect();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setFrameUri(`http://${PI_IP}:5001/frame?t=${Date.now()}`);
    }, 200);
    return () => clearInterval(interval);
  }, []);

  const send = (s1: number, s2: number, laser: boolean) => {
    socketRef.current?.emit("control", { s1, s2, laser });
  };

  const processTouch = (x: number, y: number) => {
    const nx = Math.max(-1, Math.min(1, (x / padW) * 2 - 1));
    const ny = Math.max(-1, Math.min(1, -((y / padH) * 2 - 1)));
    setTouchX(ny);
    setTouchY(nx);
    setLaser({ active: true, x, y });
    send(nx, ny, true);
  };

  const touchMove = (e: GestureResponderEvent) => {
    const { locationX, locationY } = e.nativeEvent;
    processTouch(locationX, locationY);
  };

  const touchEnd = () => {
    setLaser(l => ({ ...l, active: false }));
    send(touchY, touchX, false);
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
    setLaser(l => ({ ...l, active: false }));
    send(touchY, touchX, false);
  };

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setPadW(width);
    setPadH(height);
  };

  return (
  <View style={styles.container}>

    {/* ── Header bar ── */}
    <View style={styles.header}>
      <Text style={styles.headerTitle}>CAT LASER</Text>
      <View style={styles.statusRow}>
        <View style={[styles.statusDot, { backgroundColor: connected ? "#00ff88" : "#ff3366" }]} />
        <Text style={[styles.statusText, { color: connected ? "#00ff88" : "#ff3366" }]}>
          {connected ? "CONNECTED" : "OFFLINE"}
        </Text>
      </View>
    </View>

    {/* ── Camera feed ── */}
    <View style={styles.cameraWrapper}>
      <Image
        style={styles.camera}
        source={{ uri: frameUri }}
        resizeMode="cover"
      />
      <View style={[styles.corner, styles.cornerTL]} />
      <View style={[styles.corner, styles.cornerTR]} />
      <View style={[styles.corner, styles.cornerBL]} />
      <View style={[styles.corner, styles.cornerBR]} />
      <View style={styles.liveBadge}>
        <View style={styles.liveDot} />
        <Text style={styles.liveText}>LIVE</Text>
      </View>
    </View>

    {/* ── Divider ── */}
    <LinearGradient
      colors={["#ff3366", "#bf00ff", "#00d4ff"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
      style={styles.divider}
    />

    {/* ── Control label ── */}
    <View style={styles.controlHeader}>
      <Text style={styles.controlLabel}>LASER CONTROL</Text>
      <View style={[styles.laserIndicator, { borderColor: laser.active ? "#ff3366" : "#333" }]}>
        <View style={[styles.laserDot, { backgroundColor: laser.active ? "#ff3366" : "#222" }]} />
        <Text style={[styles.laserText, { color: laser.active ? "#ff3366" : "#555" }]}>
          {laser.active ? "FIRING" : "STANDBY"}
        </Text>
      </View>
    </View>

    {/* ── Touchpad ── */}
    <View style={styles.touchpadWrapper}>
      <LinearGradient
        colors={["#0d0d1a", "#0a001a", "#000d1a"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      {/* Grid lines */}
      <View style={styles.gridH} />
      <View style={styles.gridV} />

      {/* Center crosshair */}
      <View style={styles.crosshairH} />
      <View style={styles.crosshairV} />

      {/* Coords */}
      <View style={styles.coordsBox}>
        <Text style={styles.coordsText}>
          X <Text style={styles.coordsValue}>{touchX.toFixed(2)}</Text>
          {"   "}
          Y <Text style={styles.coordsValue}>{touchY.toFixed(2)}</Text>
        </Text>
      </View>

      {/* Touch position dot */}
      {laser.active && (
        <View style={[styles.touchDot, {
          left: laser.x - 12,
          top: laser.y - 12,
        }]} />
      )}

      {/* Invisible event capture layer - web only */}
      {Platform.OS === "web" && (
        <View
          style={StyleSheet.absoluteFill}
          onLayout={onLayout}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
        />
      )}

      {/* Invisible event capture layer - mobile only */}
      {Platform.OS !== "web" && (
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
const NEON_PURPLE = "#bf00ff";
const NEON_CYAN = "#00d4ff";
const NEON_GREEN = "#00ff88";
const BG = "#08080f";
const SURFACE = "#0f0f1e";

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },

  // Header
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 54,
    paddingBottom: 10,
    backgroundColor: SURFACE,
    borderBottomWidth: 1,
    borderBottomColor: "#1a1a2e",
  },
  headerTitle: {
    color: NEON_CYAN,
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: 6,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 2,
  },

  // Camera
  cameraWrapper: {
    width: "100%",
    height: "38%",
    backgroundColor: "#000",
    position: "relative",
  },
  camera: {
    width: "100%",
    height: "100%",
  },
  corner: {
    position: "absolute",
    width: 20,
    height: 20,
    borderColor: NEON_CYAN,
    borderWidth: 2,
  },
  cornerTL: { top: 10, left: 10, borderRightWidth: 0, borderBottomWidth: 0 },
  cornerTR: { top: 10, right: 10, borderLeftWidth: 0, borderBottomWidth: 0 },
  cornerBL: { bottom: 10, left: 10, borderRightWidth: 0, borderTopWidth: 0 },
  cornerBR: { bottom: 10, right: 10, borderLeftWidth: 0, borderTopWidth: 0 },
  liveBadge: {
    position: "absolute",
    top: 14,
    right: 40,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    gap: 5,
    borderWidth: 1,
    borderColor: NEON_PINK,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: NEON_PINK,
  },
  liveText: {
    color: NEON_PINK,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 2,
  },

  // Divider
  divider: {
    height: 2,
    width: "100%",
  },

  // Control header
  controlHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: SURFACE,
  },
  controlLabel: {
    color: "#444466",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 4,
  },
  laserIndicator: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  laserDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  laserText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 2,
  },

  // Touchpad
  touchpadWrapper: {
    flex: 1,
    position: "relative",
    justifyContent: "center",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: "#1a1a2e",
  },
  gridH: {
    position: "absolute",
    width: "100%",
    height: 1,
    backgroundColor: "#1a1a2e",
    top: "50%",
  },
  gridV: {
    position: "absolute",
    height: "100%",
    width: 1,
    backgroundColor: "#1a1a2e",
    left: "50%",
  },
  crosshairH: {
    position: "absolute",
    width: 40,
    height: 1,
    backgroundColor: "#333355",
  },
  crosshairV: {
    position: "absolute",
    width: 1,
    height: 40,
    backgroundColor: "#333355",
  },
  touchDot: {
    position: "absolute",
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "rgba(255, 51, 102, 0.3)",
    borderWidth: 2,
    borderColor: NEON_PINK,
  },
  coordsBox: {
    position: "absolute",
    bottom: 16,
    backgroundColor: "rgba(0,0,0,0.5)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#1a1a2e",
  },
  coordsText: {
    color: "#444466",
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 2,
  },
  coordsValue: {
    color: NEON_CYAN,
    fontWeight: "700",
  },
});