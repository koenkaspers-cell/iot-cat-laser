import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

export default function Layout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: "#0f0f1e",
          borderTopColor: "#1a1a2e",
        },
        tabBarActiveTintColor: "#00d4ff",
        tabBarInactiveTintColor: "#444466",
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Control",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="radio-button-on" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="calibrate"
        options={{
          href: null,  // hidden from tab bar — navigated to programmatically
        }}
      />
    </Tabs>
  );
}