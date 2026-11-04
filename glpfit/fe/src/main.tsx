import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { seedDemoIfRequested } from "./demo";
import "./styles.css";

seedDemoIfRequested();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
