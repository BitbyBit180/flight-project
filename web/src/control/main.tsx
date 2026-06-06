import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Control } from "./Control.js";
import "../styles/control.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Control />
  </StrictMode>,
);
