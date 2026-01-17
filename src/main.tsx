import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import { HudApp } from "./app/HudApp";

createRoot(document.getElementById("app")!).render(
  <StrictMode>
    <HudApp />
  </StrictMode>,
);
