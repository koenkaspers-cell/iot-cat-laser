import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  GestureResponderEvent,
  Image,
  LayoutChangeEvent,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { io } from "socket.io-client";

// ── Calibration target points ─────────────────────────
// These are in normalised touchpad space (-1..1)
// same convention as index.tsx: right=+x, up=+y
const TARGETS = [
  { x:  0.0,  y:  0.0,  label: "Center" },
  { x: -0.75, y:  0.75, label: "Top left" },
  { x:  0.75, y:  0.75, label: "Top right" },
  { x: -0.75, y: -0.75, label: "Bottom left" },
  { x:  0.75, y: -0.75, label: "Bottom right" },
];

// ── Physical servo limits ─────────────────────────────
// Your manual calibration center + 20% safety margin
// X is symmetric around 0, Y is offset because of physical mount
const SERVO_LIMIT_X  = 0.36;   // ±0.36 around x=0
const SERVO_CENTER_Y = -0.16;  // physical center (negated because servo Y is inverted)
const SERVO_LIMIT_Y  = 0.20;   // ±0.20 around center
const SERVO_MIN_Y    = SERVO_CENTER_Y - SERVO_LIMIT_Y;  // -0.36
const SERVO_MAX_Y    = SERVO_CENTER_Y + SERVO_LIMIT_Y;  //  0.04

type CalibPoint = {
  nx: number;      // normalised touchpad x (-1..1)
  ny: number;      // normalised touchpad y (-1..1)
  servoX: number;  // actual servo value sent
  servoY: number;  // actual servo value sent
  targetX: number; // target point x (-1..1)
  targetY: number; // target point y (-1..1)
};

// ── Least squares: servo = target * scale + offset ────
// We fit directly from target coords to servo coords
// so the result plugs straight into index.tsx's sendServo:
//   servo = nx * scale + offset
function computeCalibration(points: CalibPoint[]) {
  const fit = (xs: number[], ys: number[]) => {
    const n = xs.length;
    const sx  = xs.reduce((a, b) => a + b, 0);
    const sy  = ys.reduce((a, b) => a + b, 0);
    const sxy = xs.reduce((a, x, i) => a + x * ys[i], 0);
    const sx2 = xs.reduce((a, x) => a + x * x, 0);
    const d   = n * sx2 - sx * sx;
    if (Math.abs(d) < 1e-9) return { scale: 1, offset: 0 };
    return {
      scale:  (n * sxy - sx * sy) / d,
      offset: (sy - ((n * sxy - sx * sy) / d) * sx) / n,
    };
  };

  // target x → servo x
  const fx = fit(points.map(p => p.targetX), points.map(p => p.servoX));
  // target y → servo y
  const fy = fit(points.map(p => p.targetY), points.map(p => p.servoY));

  return {
    offset_x: parseFloat(fx.offset.toFixed(4)),
    offset_y: parseFloat(fy.offset.toFixed(4)),
    scale_x:  parseFloat(fx.scale.toFixed(4)),
    scale_y:  parseFloat(fy.scale.toFixed(4)),
  };
}

export default function Calibrate() {
  const router = useRouter();

  const [piIp, setPiIp]           = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [frameUri, setFrameUri]   = useState("");

  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);

  // Servo values being sent right now
  const [servoX, setServoX] = useState(0);
  const [servoY, setServoY] = useState(SERVO_CENTER_Y);

  const [padW, setPadW] = useState(1);
  const [padH, setPadH] = useState(1);
  const [camW, setCamW] = useState(1);
  const [camH, setCamH] = useState(1);

  const points    = useRef<CalibPoint[]>([]);
  const servoRef  = useRef({ x: 0, y: SERVO_CENTER_Y });
  const socketRef = useRef<any>(null);

  // ── Load IP ──────────────────────────────────────────
  useEffect(() => {
    AsyncStorage.getItem("PI_IP").then(v => { if (v) setPiIp(v); });
  }, []);

  // ── Socket ───────────────────────────────────────────
  useEffect(() => {
    if (!piIp) return;
    socketRef.current = io(`http://${piIp}:5001`, { transports: ["polling"] });
    socketRef.current.on("connect",       () => setConnected(true));
    socketRef.current.on("disconnect",    () => setConnected(false));
    socketRef.current.on("connect_error", () => setConnected(false));
    socketRef.current.on("frame", (d: { data: string }) =>
      setFrameUri(`data:image/jpeg;base64,${d.data}`)
    );
    return () => {
      socketRef.current?.emit("control", { s1: 0, s2: 0, laser: false });
      socketRef.current?.disconnect();
    };
  }, [piIp]);

  // ── Keep laser on continuously ────────────────────────
  useEffect(() => {
    if (!connected || done) return;
    const id = setInterval(() => {
      socketRef.current?.emit("control", {
        s1: servoRef.current.x,
        s2: servoRef.current.y,
        laser: true,
      });
    }, 80);
    return () => clearInterval(id);
  }, [connected, done]);

  // ── Touch → servo (same convention as index.tsx) ─────
  // nx: right=+1, left=-1
  // ny: up=+1, down=-1
  // Then map to servo limits
  const processTouch = (px: number, py: number) => {
    const nx =  ((px / padW) * 2 - 1);  // horizontal
    const ny = -((py / padH) * 2 - 1);  // vertical (inverted)

    // Map nx (-1..1) → servo x clamped to physical limits
    const sx = Math.max(-SERVO_LIMIT_X,
                Math.min( SERVO_LIMIT_X, nx * SERVO_LIMIT_X));

    // Map ny (-1..1) → servo y around physical center
    const sy = Math.max(SERVO_MIN_Y,
                Math.min(SERVO_MAX_Y, SERVO_CENTER_Y + ny * SERVO_LIMIT_Y));

    setServoX(sx);
    setServoY(sy);
    servoRef.current = { x: sx, y: sy };
  };

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
    if (e.buttons !== 1) return;
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    processTouch(e.clientX - r.left, e.clientY - r.top);
  };

  const onPadLayout  = (e: LayoutChangeEvent) => { const {width,height}=e.nativeEvent.layout; setPadW(width); setPadH(height); };
  const onCamLayout  = (e: LayoutChangeEvent) => { const {width,height}=e.nativeEvent.layout; setCamW(width); setCamH(height); };

  // ── SET pressed ──────────────────────────────────────
  const handleSet = async () => {
    const target = TARGETS[step];

    // The touchpad position that produced this servo output
    // We back-calculate nx/ny from servo so the least-squares
    // fit is in the same space as index.tsx uses
    const nx = servoRef.current.x / SERVO_LIMIT_X;
    const ny = (servoRef.current.y - SERVO_CENTER_Y) / SERVO_LIMIT_Y;

    const pt: CalibPoint = {
      nx,
      ny,
      servoX: servoRef.current.x,
      servoY: servoRef.current.y,
      targetX: target.x,
      targetY: target.y,
    };

    const newPoints = [...points.current, pt];
    points.current  = newPoints;

    if (step < TARGETS.length - 1) {
      setStep(step + 1);
    } else {
      const result = computeCalibration(newPoints);
      await AsyncStorage.multiSet([
        ["CALIB_OFFSET_X", String(result.offset_x)],
        ["CALIB_OFFSET_Y", String(result.offset_y)],
        ["CALIB_SCALE_X",  String(result.scale_x)],
        ["CALIB_SCALE_Y",  String(result.scale_y)],
      ]);
      setDone(true);
      socketRef.current?.emit("control", { s1: 0, s2: 0, laser: false });
      setTimeout(() => router.push("/"), 1500);
    }
  };

  // ── Target crosshair on camera ────────────────────────
  // Target uses same -1..1 coords: right=+x, up=+y
  // Camera pixels: 0,0 = top-left, so y must be flipped
  const target = TARGETS[step];
  const crossX = ((target.x + 1) / 2) * camW;
  const crossY = ((1 - (target.y + 1) / 2)) * camH;

  if (!piIp) {
    return (
      <View style={[styles.container, { justifyContent: "center", alignItems: "center" }]}>
        <Text style={styles.noIp}>No device configured.{"\n"}Go to Settings to set your Pi IP.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>CALIBRATION</Text>
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: connected ? "#00ff88" : "#ff3366" }]} />
          <Text style={[styles.statusText, { color: connected ? "#00ff88" : "#ff3366" }]}>
            {connected ? "CONNECTED" : "OFFLINE"}
          </Text>
        </View>
      </View>

      {/* Step dots */}
      <View style={styles.stepBar}>
        {TARGETS.map((_, i) => (
          <View key={i} style={[
            styles.stepDot,
            i < step && styles.stepDone,
            i === step && !done && styles.stepActive,
            done && styles.stepDone,
          ]} />
        ))}
      </View>

      {/* Instruction */}
      <View style={styles.instruction}>
        {done ? (
          <Text style={styles.doneText}>✓ Calibration saved!</Text>
        ) : (
          <>
            <Text style={styles.stepLabel}>Point {step + 1} / {TARGETS.length} — {target.label}</Text>
            <Text style={styles.stepHint}>Move the laser onto the crosshair, then press SET</Text>
          </>
        )}
      </View>

      {/* Camera feed */}
      <View style={styles.cameraWrapper} onLayout={onCamLayout}>
        {frameUri ? (
          <Image style={styles.camera} source={{ uri: frameUri }} resizeMode="cover" />
        ) : (
          <View style={[styles.camera, { backgroundColor: "#000" }]} />
        )}
        {!done && (
          <View pointerEvents="none"
                style={[styles.crosshairContainer, { left: crossX, top: crossY }]}>
            <View style={styles.crossH} />
            <View style={styles.crossV} />
            <View style={styles.crossCircle} />
          </View>
        )}
        <View style={[styles.corner, styles.cornerTL]} />
        <View style={[styles.corner, styles.cornerTR]} />
        <View style={[styles.corner, styles.cornerBL]} />
        <View style={[styles.corner, styles.cornerBR]} />
      </View>

      {/* Divider */}
      <LinearGradient
        colors={["#ff3366", "#bf00ff", "#00d4ff"]}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
        style={styles.divider}
      />

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
            X <Text style={styles.coordsValue}>{servoX.toFixed(3)}</Text>
            {"   "}
            Y <Text style={styles.coordsValue}>{servoY.toFixed(3)}</Text>
          </Text>
        </View>

        {/* Event capture — below SET button */}
        {Platform.OS === "web" ? (
          <View style={[StyleSheet.absoluteFill, { zIndex: 1 }]}
                onLayout={onPadLayout}
                onPointerDown={pointerDown}
                onPointerMove={pointerMove}
                onPointerUp={(e: any) => e.stopPropagation()} />
        ) : (
          <View style={[StyleSheet.absoluteFill, { zIndex: 1 }]}
                onLayout={onPadLayout}
                onStartShouldSetResponder={() => true}
                onMoveShouldSetResponder={() => true}
                onResponderStart={touchMove}
                onResponderMove={touchMove} />
        )}

        {/* SET button — above event capture */}
        {!done && (
          <TouchableOpacity style={[styles.setButton, { zIndex: 10 }]}
                            onPress={handleSet} activeOpacity={0.8}>
            <LinearGradient
              colors={["#00d4ff", "#0099bb"]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={styles.setButtonInner}>
              <Text style={styles.setButtonText}>SET</Text>
            </LinearGradient>
          </TouchableOpacity>
        )}
      </View>

    </View>
  );
}

const NEON_CYAN = "#00d4ff";
const NEON_PINK = "#ff3366";
const BG        = "#08080f";
const SURFACE   = "#0f0f1e";

const styles = StyleSheet.create({
  container:          { flex: 1, backgroundColor: BG },
  noIp:               { color: "#444466", letterSpacing: 2, fontSize: 12, textAlign: "center" },
  header: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 20, paddingTop: 54, paddingBottom: 10,
    backgroundColor: SURFACE, borderBottomWidth: 1, borderBottomColor: "#1a1a2e",
  },
  headerTitle:        { color: NEON_CYAN, fontSize: 20, fontWeight: "800", letterSpacing: 6 },
  statusRow:          { flexDirection: "row", alignItems: "center", gap: 6 },
  statusDot:          { width: 8, height: 8, borderRadius: 4 },
  statusText:         { fontSize: 11, fontWeight: "700", letterSpacing: 2 },
  stepBar: {
    flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 10,
    paddingVertical: 10, backgroundColor: SURFACE,
    borderBottomWidth: 1, borderBottomColor: "#1a1a2e",
  },
  stepDot:            { width: 10, height: 10, borderRadius: 5, backgroundColor: "#1a1a2e", borderWidth: 1, borderColor: "#333" },
  stepDone:           { backgroundColor: "#00ff88", borderColor: "#00cc66" },
  stepActive:         { backgroundColor: NEON_CYAN, borderColor: "#0099bb", transform: [{ scale: 1.3 }] },
  instruction: {
    paddingHorizontal: 20, paddingVertical: 10,
    backgroundColor: "#0a0a18", borderBottomWidth: 1, borderBottomColor: "#1a1a2e",
    alignItems: "center",
  },
  stepLabel:          { color: NEON_CYAN, fontSize: 13, fontWeight: "700", letterSpacing: 2 },
  stepHint:           { color: "#444466", fontSize: 11, marginTop: 4, textAlign: "center" },
  doneText:           { color: "#00ff88", fontSize: 16, fontWeight: "800", letterSpacing: 3 },
  cameraWrapper:      { width: "100%", height: "35%", backgroundColor: "#000", position: "relative" },
  camera:             { width: "100%", height: "100%" },
  crosshairContainer: { position: "absolute", width: 0, height: 0, alignItems: "center", justifyContent: "center" },
  crossH:             { position: "absolute", width: 30, height: 1.5, backgroundColor: NEON_CYAN },
  crossV:             { position: "absolute", width: 1.5, height: 30, backgroundColor: NEON_CYAN },
  crossCircle:        { position: "absolute", width: 14, height: 14, borderRadius: 7, borderWidth: 1.5, borderColor: NEON_CYAN },
  corner:             { position: "absolute", width: 20, height: 20, borderColor: NEON_CYAN, borderWidth: 2 },
  cornerTL:           { top: 10, left: 10, borderRightWidth: 0, borderBottomWidth: 0 },
  cornerTR:           { top: 10, right: 10, borderLeftWidth: 0, borderBottomWidth: 0 },
  cornerBL:           { bottom: 10, left: 10, borderRightWidth: 0, borderTopWidth: 0 },
  cornerBR:           { bottom: 10, right: 10, borderLeftWidth: 0, borderTopWidth: 0 },
  divider:            { height: 2, width: "100%" },
  touchpadWrapper:    { flex: 1, position: "relative", justifyContent: "center", alignItems: "center", borderTopWidth: 1, borderTopColor: "#1a1a2e" },
  gridH:              { position: "absolute", width: "100%", height: 1, backgroundColor: "#1a1a2e", top: "50%" },
  gridV:              { position: "absolute", height: "100%", width: 1, backgroundColor: "#1a1a2e", left: "50%" },
  crosshairH:         { position: "absolute", width: 40, height: 1, backgroundColor: "#333355" },
  crosshairV:         { position: "absolute", width: 1, height: 40, backgroundColor: "#333355" },
  coordsBox:          { position: "absolute", bottom: 80, backgroundColor: "rgba(0,0,0,0.5)", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: "#1a1a2e" },
  coordsText:         { color: "#444466", fontSize: 12, fontWeight: "600", letterSpacing: 2 },
  coordsValue:        { color: NEON_CYAN, fontWeight: "700" },
  setButton:          { position: "absolute", bottom: 24, borderRadius: 12, overflow: "hidden" },
  setButtonInner:     { paddingHorizontal: 48, paddingVertical: 16, alignItems: "center" },
  setButtonText:      { color: "#000", fontSize: 18, fontWeight: "900", letterSpacing: 6 },
});