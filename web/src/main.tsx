import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

// Note: no React.StrictMode — its dev-only double-mounting tears down and
// restarts the camera stream, which can leave the preview black.
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
