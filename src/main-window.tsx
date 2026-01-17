import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import "./i18n";
import { DashboardApp } from "./app/DashboardApp";

// Disable right-click context menu in production
if (import.meta.env.PROD) {
  document.addEventListener("contextmenu", (e) => e.preventDefault());
}

createRoot(document.getElementById("app")!).render(
  <StrictMode>
    <DashboardApp />
  </StrictMode>,
);
