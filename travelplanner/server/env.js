// Load .env before anything else reads process.env. Tests never load .env (no real keys, no network).
// DOTENV_PATH points at a different file (or a missing one, to load nothing).
import dotenv from "dotenv";
if (process.env.NODE_ENV !== "test") dotenv.config({ quiet: true, ...(process.env.DOTENV_PATH ? { path: process.env.DOTENV_PATH } : {}) });
