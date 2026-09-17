import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Startup } from "./startup";
import { createHost } from "@host";

createRoot(document.getElementById("root")!).render(
  <StrictMode><Startup loadHost={createHost} /></StrictMode>,
);
