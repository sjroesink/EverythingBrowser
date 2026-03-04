import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import DetachedWindow from "./DetachedWindow";
import "./styles/globals.css";

const windowLabel = getCurrentWindow().label;
const isDetached = windowLabel.startsWith("detached-");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isDetached ? <DetachedWindow /> : <App />}
  </React.StrictMode>
);
