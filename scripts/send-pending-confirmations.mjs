#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

function parseDotenv(content) {
  const out = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function loadEnvFromFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const parsed = parseDotenv(fs.readFileSync(filePath, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (!process.env[key]) process.env[key] = value;
  }
}

function normalizeProjectUrl(raw) {
  return raw.trim().replace(/\/+$/, "").replace(/\/rest\/v1\/?$/i, "");
}

function resolveConfig() {
  const root = process.cwd();
  loadEnvFromFile(path.join(root, ".env"));
  loadEnvFromFile(path.join(root, ".env.local"));

  const projectUrlRaw = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? "";
  const requestKey = serviceRoleKey || anonKey;

  if (!projectUrlRaw) {
    throw new Error("Missing SUPABASE_URL / VITE_SUPABASE_URL.");
  }
  if (!requestKey) {
    throw new Error(
      "Missing key. Provide SUPABASE_SERVICE_ROLE_KEY (preferred) or SUPABASE_ANON_KEY / VITE_SUPABASE_ANON_KEY.",
    );
  }

  return {
    projectUrl: normalizeProjectUrl(projectUrlRaw),
    requestKey,
    usingServiceRole: Boolean(serviceRoleKey),
  };
}

async function fetchPendingEmails(projectUrl, key) {
  const restUrl = new URL("/rest/v1/waitlist_entries", projectUrl);
  restUrl.searchParams.set("select", "email");
  restUrl.searchParams.set("status", "eq.pending_confirmation");
  restUrl.searchParams.set("email_confirmed_at", "is.null");

  const res = await fetch(restUrl, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    throw new Error(`Could not load pending emails (${res.status}): ${JSON.stringify(data)}`);
  }

  if (!Array.isArray(data)) return [];
  return data
    .map((row) => (row && typeof row.email === "string" ? row.email.trim().toLowerCase() : ""))
    .filter(Boolean);
}

async function triggerConfirmation(projectUrl, key, email) {
  const endpoint = `${projectUrl}/functions/v1/waitlist-send-confirmation`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ email }),
  });

  const text = await res.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  return { ok: res.ok, status: res.status, payload };
}

async function main() {
  const { projectUrl, requestKey, usingServiceRole } = resolveConfig();
  console.log(`Project: ${projectUrl}`);
  console.log(`Auth key: ${usingServiceRole ? "service_role" : "anon/fallback"}`);

  const emails = await fetchPendingEmails(projectUrl, requestKey);
  console.log(`Pending confirmations found: ${emails.length}`);
  if (emails.length === 0) return;

  let success = 0;
  let failed = 0;
  for (const email of emails) {
    const result = await triggerConfirmation(projectUrl, requestKey, email);
    if (result.ok) {
      success += 1;
      console.log(`[OK] ${email} -> ${JSON.stringify(result.payload)}`);
    } else {
      failed += 1;
      console.log(`[FAIL] ${email} (${result.status}) -> ${JSON.stringify(result.payload)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  console.log(`Done. Success: ${success}, Failed: ${failed}`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Script failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
