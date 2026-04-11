import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { PermissionsGate } from "./components/PermissionsGate";
import "./globals.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error('Root element "#root" not found');
}

createRoot(root).render(
  <StrictMode>
    <PermissionsGate>
      <App />
    </PermissionsGate>
  </StrictMode>,
);
