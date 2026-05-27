import http from "http";
import { createApp } from "./app";
import { setupWebSocket } from "./chat/ws.server";
import { env } from "./config/env";
import { ensureDatabaseSchema } from "./lib/ensureSchema";

async function bootstrap() {
  await ensureDatabaseSchema();

  const app = createApp();
  const server = http.createServer(app);

  setupWebSocket(server);

  server.listen(env.PORT, env.HOST, () => {
    const base = env.publicBaseUrl;
    console.log(`Papufy API listening on ${env.HOST}:${env.PORT}`);
    console.log(`Public URL: ${base}`);
    console.log(`WebSocket: ${base.replace(/^http/, "ws")}/ws`);
    console.log(
      `CORS: ${env.corsOrigins.join(", ")} (+ *.vercel.app em produção)`
    );
    if (env.paymentsEnabled) {
      console.log("Pagamentos Asaas: habilitado");
    }
  });
}

bootstrap().catch((err) => {
  console.error("Falha ao iniciar API:", err);
  process.exit(1);
});
