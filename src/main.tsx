import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import DetachedWindow from "./DetachedWindow";
import SettingsWindow from "./SettingsWindow";
import "./styles/globals.css";

const windowLabel = getCurrentWindow().label;
const isDetached = windowLabel.startsWith("detached-");
const isSettings = windowLabel === "settings";

function Root() {
  if (isSettings) return <SettingsWindow />;
  if (isDetached) return <DetachedWindow />;
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
