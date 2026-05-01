import { auth } from "@test-evals/auth";
import { env } from "@test-evals/env/server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { runsRoutes } from "./routes/runs";

const app = new Hono();

app.use(logger());
app.use(
  "/*",
  cors({
    origin: env.CORS_ORIGIN,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

app.route("/api/v1/runs", runsRoutes);

app.get("/", (c) => {
  return c.text("HEALOSBENCH API Server");
});

const port = Number(process.env.PORT) || 3000;

console.log("Starting server on port:", port);

Bun.serve({
  port,
  fetch: app.fetch,
});