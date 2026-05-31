// Add (or update) an authorized user for the WP_AI app.
//   node scripts/add-user.mjs <email> <password> [name]
// Hashes the password with scrypt (same params as src/lib/auth.ts) and upserts
// into authorized_users via the service-role key.
import { readFileSync } from "fs";
import { randomBytes, scryptSync } from "crypto";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] = m[2];
}

const [, , email, password, name] = process.argv;
if (!email || !password) {
  console.error("usage: node scripts/add-user.mjs <email> <password> [name]");
  process.exit(1);
}

function hashPassword(pw) {
  const salt = randomBytes(16);
  const derived = scryptSync(pw, salt, 64);
  return salt.toString("hex") + ":" + derived.toString("hex");
}

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { error } = await sb.from("authorized_users").upsert({
  email: email.toLowerCase().trim(),
  password_hash: hashPassword(password),
  name: name || null,
});
if (error) {
  console.error("failed:", error.message);
  process.exit(1);
}
console.log("✓ authorized:", email.toLowerCase().trim());
