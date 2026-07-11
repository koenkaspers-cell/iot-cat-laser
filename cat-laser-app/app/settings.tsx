import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";

const NEON_CYAN  = "#00d4ff";
const NEON_GREEN = "#00ff88";
const BG         = "#08080f";
const SURFACE    = "#0f0f1e";

export default function Settings() {
  const router = useRouter();
  const [ip, setIp]     = useState("");
  const [saved, setSaved] = useState(false);
  const [calibrated, setCalibrated] = useState(false);

  useEffect(() => {
    AsyncStorage.multiGet(["PI_IP", "CALIB_SCALE_X"]).then(pairs => {
      const map = Object.fromEntries(pairs.map(([k, v]) => [k, v]));
      if (map["PI_IP"])         setIp(map["PI_IP"]!);
      if (map["CALIB_SCALE_X"]) setCalibrated(true);
    });
  }, []);

  const save = async () => {
    if (!ip.trim()) {
      Alert.alert("Error", "Please enter an IP address");
      return;
    }
    await AsyncStorage.setItem("PI_IP", ip.trim());
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      router.push("/");
    }, 800);
  };

  const startCalibration = () => {
    router.push("/calibrate");
  };

  return (
    <View style={styles.container}>

      <View style={styles.header}>
        <Text style={styles.headerTitle}>SETTINGS</Text>
      </View>

      <LinearGradient
        colors={["#ff3366", "#bf00ff", "#00d4ff"]}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
        style={styles.divider}
      />

      <View style={styles.content}>

        {/* IP setting */}
        <View style={styles.settingBlock}>
          <Text style={styles.settingLabel}>DEVICE IP ADDRESS</Text>
          <Text style={styles.settingHint}>
            Tailscale IP of your Raspberry Pi (100.x.x.x)
          </Text>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={ip}
              onChangeText={setIp}
              placeholder="100.x.x.x"
              placeholderTextColor="#333355"
              keyboardType="default"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
        </View>

        {/* Save button */}
        <TouchableOpacity onPress={save} activeOpacity={0.8}>
          <LinearGradient
            colors={saved ? ["#00ff88", "#00cc66"] : ["#ff3366", "#bf00ff"]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={styles.button}
          >
            <Text style={styles.buttonText}>{saved ? "SAVED!" : "SAVE"}</Text>
          </LinearGradient>
        </TouchableOpacity>

        {/* Divider */}
        <View style={styles.sectionDivider} />

        {/* Calibration */}
        <View style={styles.settingBlock}>
          <Text style={styles.settingLabel}>LASER CALIBRATION</Text>
          <Text style={styles.settingHint}>
            Align the laser with 5 reference points on the camera feed to calibrate offset and range.
          </Text>
          {calibrated && (
            <View style={styles.calibratedBadge}>
              <View style={styles.calibratedDot} />
              <Text style={styles.calibratedText}>Calibration saved</Text>
            </View>
          )}
        </View>

        <TouchableOpacity onPress={startCalibration} activeOpacity={0.8}>
          <LinearGradient
            colors={["#00d4ff", "#0099bb"]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={styles.button}
          >
            <Text style={styles.buttonText}>
              {calibrated ? "RECALIBRATE" : "CALIBRATE"}
            </Text>
          </LinearGradient>
        </TouchableOpacity>

      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container:       { flex: 1, backgroundColor: BG },
  header: {
    paddingHorizontal: 20, paddingTop: 54, paddingBottom: 10,
    backgroundColor: SURFACE, borderBottomWidth: 1, borderBottomColor: "#1a1a2e",
  },
  headerTitle:     { color: NEON_CYAN, fontSize: 20, fontWeight: "800", letterSpacing: 6 },
  divider:         { height: 2, width: "100%" },
  content:         { padding: 24, gap: 16 },
  settingBlock:    { gap: 8 },
  settingLabel:    { color: "#444466", fontSize: 11, fontWeight: "700", letterSpacing: 4 },
  settingHint:     { color: "#333355", fontSize: 12 },
  inputRow: {
    borderWidth: 1, borderColor: "#1a1a2e", borderRadius: 8,
    backgroundColor: SURFACE, marginTop: 4,
  },
  input: {
    color: NEON_CYAN, fontSize: 16, fontWeight: "600",
    padding: 14, letterSpacing: 2,
  },
  button:          { borderRadius: 8, padding: 16, alignItems: "center" },
  buttonText:      { color: "white", fontSize: 14, fontWeight: "800", letterSpacing: 4 },
  sectionDivider:  { height: 1, backgroundColor: "#1a1a2e", marginVertical: 8 },
  calibratedBadge: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  calibratedDot:   { width: 6, height: 6, borderRadius: 3, backgroundColor: NEON_GREEN },
  calibratedText:  { color: NEON_GREEN, fontSize: 11, fontWeight: "700", letterSpacing: 2 },
});