import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { StudioApp } from "@/components/studio/StudioApp";
import "@/styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("KILN could not find its page root.");
createRoot(root).render(
  <StrictMode>
    <StudioApp />
  </StrictMode>,
);
