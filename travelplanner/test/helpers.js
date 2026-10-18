// Shared test setup: a throwaway in-memory MongoDB and the real app on a random port.
// node --test runs each file in its own process, so every file gets a fresh database.
import { MongoMemoryServer } from "mongodb-memory-server";

process.env.NODE_ENV = "test";
const mongo = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongo.getUri("wanderwish");

const { app } = await import("../server.js");
const { resetLimits } = await import("../server/ratelimit.js");
const store = await import("../server/store.js");
await store.connect();

export async function startServer() {
  const server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    close: async () => {
      await new Promise(r => { server.closeAllConnections?.(); server.close(r); });
      await store.close();
      await mongo.stop();
    }
  };
}

// A tiny cookie-keeping client, one per simulated user.
export function client(base) {
  let cookie = "";
  async function req(method, url, body) {
    const res = await fetch(base + url, {
      method,
      headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, body: json, text };
  }
  return {
    get: url => req("GET", url),
    post: (url, body) => req("POST", url, body ?? {}),
    put: (url, body) => req("PUT", url, body ?? {}),
    del: url => req("DELETE", url),
    get cookie() { return cookie; }
  };
}

let n = 0;
export async function signUp(base, name) {
  const c = client(base);
  const username = (name || "user") + (++n);
  const r = await c.post("/api/auth/register", { username, email: `${username}@example.test`, name: username, password: "secret123" });
  if (r.status !== 200) throw new Error("signup failed: " + r.text);
  resetLimits(); // tests create many users from one IP; the sign-up limit itself is tested separately
  return Object.assign(c, { user: r.body.user });
}
