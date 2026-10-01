// Production server for a machine of our own (VPS, see deploy/PINDAH-VPS.md): the same Express API
// that runs on Vercel (api/index.ts) plus the built frontend (`npm run build` -> dist/), on one port
// behind Nginx. Vercel keeps using api/index.ts; this file is not used there.
import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import { app } from "./app.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dist = path.join(root, "dist");
const port = Number(process.env.PORT) || 3000;

// Nginx terminates HTTPS and forwards to us: trust its X-Forwarded-* headers (client IP, https).
app.set("trust proxy", 1);

// Hashed assets never change under the same name; index.html must always be fresh so a new deploy
// is picked up on the next load.
app.use("/assets", express.static(path.join(dist, "assets"), { immutable: true, maxAge: "1y" }));
app.use(express.static(dist, { index: false, maxAge: "1h" }));
// Every other non-API path is a page of the single-page app.
app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, "index.html"), { headers: { "Cache-Control": "no-cache" } }));

app.listen(port, "127.0.0.1", () => console.log(`Inventory dashboard on http://127.0.0.1:${port}`));
