// Startup configuration: read once, validate, fail fast with a clear message. Never logs secret values.
const env = process.env;
const isProd = env.NODE_ENV === "production";
const errors = [];

function int(name, def, min, max) {
  if (env[name] === undefined || env[name] === "") return def;
  const n = Number(env[name]);
  if (!Number.isInteger(n) || n < min || n > max) { errors.push(`${name} must be an integer between ${min} and ${max}`); return def; }
  return n;
}

export const config = {
  env: env.NODE_ENV || "development",
  isProd,
  isTest: env.NODE_ENV === "test",
  port: int("PORT", 3000, 1, 65535),
  // Local MongoDB by default; any mongodb:// or mongodb+srv:// URI works (e.g. a free MongoDB Atlas cluster).
  mongodbUri: env.MONGODB_URI || "mongodb://127.0.0.1:27017/wanderwish",
  geoapifyConfigured: !!(env.GEOAPIFY_API_KEY || env.VITE_GEOAPIFY_API_KEY),
  // Extra origins allowed to make cross-origin API calls (comma-separated). Normally empty: the site is same-origin.
  allowedOrigins: (env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean)
};

if (!/^mongodb(\+srv)?:\/\/\S+$/.test(config.mongodbUri)) errors.push("MONGODB_URI must start with mongodb:// or mongodb+srv://");
for (const o of config.allowedOrigins) if (!/^https?:\/\/[^/]+$/.test(o)) errors.push(`ALLOWED_ORIGINS entry "${o}" must look like https://example.com`);
if (isProd && !config.geoapifyConfigured) errors.push("GEOAPIFY_API_KEY is required when NODE_ENV=production (get a free key at https://myprojects.geoapify.com/)");

export function assertConfig() {
  if (!errors.length) {
    if (!config.geoapifyConfigured && !config.isTest) console.warn("[config] GEOAPIFY_API_KEY is not set: itineraries will use generic fallback activities.");
    return;
  }
  console.error("[config] Invalid configuration:\n  - " + errors.join("\n  - ") + "\nSee .env.example.");
  process.exit(1);
}
