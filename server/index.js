// Starts hire or pass. Settings come from the environment, or from a .env file next to package.json.

import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = process.env.ENV_FILE || join(root, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const { openDb } = await import("./db.js");
const { createRenderer } = await import("./render.js");
const { createApp, ratesFromEnv } = await import("./app.js");
const { defaultClient, MODEL, EFFORT } = await import("./ai.js");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 8853);
const PUBLIC_URL = process.env.PUBLIC_URL || `http://${HOST}:${PORT}`;
const DATA = process.env.DATA_DIR || join(root, "data");

const db = openDb(join(DATA, "hire-or-pass.db"));
const renderer = createRenderer({ dir: join(DATA, "images"), baseUrl: `http://${HOST}:${PORT}` });
const aiClient = defaultClient();
// Limits: HOP_CARDS_PER_IP_HOUR (default 5), HOP_CARDS_PER_DAY (default 300), HOP_VOTES_PER_IP_CARD (default 10).
// Set HOP_TRUST_PROXY=1 only when a proxy in front of the app sets X-Forwarded-For.
// Umami analytics is off by default. Set both UMAMI_SRC (the script URL) and UMAMI_ID to turn it on.
const app = createApp({
  db, renderer, aiClient, publicUrl: PUBLIC_URL, umami: process.env.UMAMI_ID || null, umamiSrc: process.env.UMAMI_SRC || null,
  rates: ratesFromEnv(process.env), trustProxy: process.env.HOP_TRUST_PROXY === "1",
});

const server = createServer(app);
server.listen(PORT, HOST, () => {
  console.log(`hire or pass on ${PUBLIC_URL} (listening on ${HOST}:${PORT})`);
  console.log(aiClient ? `AI step: OpenAI ${MODEL}, reasoning effort ${EFFORT}` : "AI step is off: OPENAI_API_KEY is not set");
});

const stop = async () => { server.close(); await renderer.close(); process.exit(0); };
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
