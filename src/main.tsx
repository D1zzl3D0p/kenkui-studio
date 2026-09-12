import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { KenkuiServerClient } from "./api/client";
import { createHost } from "@host";

const host = await createHost();
const server = await host.servers.selected();
const client = new KenkuiServerClient(server.baseUrl, host.transport(server.baseUrl));

createRoot(document.getElementById("root")!).render(
  <StrictMode><App client={client} host={host} /></StrictMode>,
);
