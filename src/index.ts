import http from "http";
import { createApp } from "./app";
import { setupWebSocket } from "./chat/ws.server";
import { env } from "./config/env";

const app = createApp();
const server = http.createServer(app);

setupWebSocket(server);

server.listen(env.PORT, env.HOST, () => {
  const base = env.publicBaseUrl;
  console.log(`Papufy API listening on ${env.HOST}:${env.PORT}`);
  console.log(`Public URL: ${base}`);
  console.log(`WebSocket: ${base.replace(/^http/, "ws")}/ws`);
  console.log(`CORS allowlist: ${env.corsOrigins.join(", ") || "(vercel.app automático)"}`);
});
