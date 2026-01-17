import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import "./i18n";
import { HudApp } from "./app/HudApp";
import { ErrorBoundary } from "./components/ErrorBoundary";

createRoot(document.getElementById("app")!).render(
  <StrictMode>
    <ErrorBoundary windowLabel="hud">
      <HudApp />
    </ErrorBoundary>
  </StrictMode>,
);
