#!/usr/bin/env node

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const mode = process.argv.includes("--all") ? "all" : "staged";
const repoRoot = process.cwd();

const binaryFileExts = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".ico",
  ".pdf",
  ".zip",
  ".gz",
  ".mp4",
  ".mov",
  ".lock",
]);

const pathAllowlist = [
  /^package-lock\.json$/,
  /^pnpm-lock\.yaml$/,
  /^yarn\.lock$/,
  /^dist\//,
  /^node_modules\//,
];

const secretMatchers = [
  {
    id: "aws-access-key-id",
    regex: /\bAKIA[0-9A-Z]{16}\b/g,
  },
  {
    id: "openai-key",
    regex: /\bsk-[A-Za-z0-9]{20,}\b/g,
  },
  {
    id: "github-token",
    regex: /\bghp_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  },
  {
    id: "slack-token",
    regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  },
  {
    id: "private-key-block",
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/g,
  },
  {
    id: "explicit-secret-assignment",
    regex:
      /\b(?:SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY|DATABASE_URL|OPENAI_API_KEY|RESEND_API_KEY|SECRET|PRIVATE_KEY|PASSWORD|TOKEN)\b\s*[=:]\s*["']?[A-Za-z0-9_\-./:+]{8,}/g,
  },
  {
    id: "url-with-basic-auth",
    regex: /\b(?:postgres|mongodb(?:\+srv)?):\/\/[^/\s:]+:[^@\s]+@/g,
  },
];

function getFiles() {
  const cmd =
    mode === "all"
      ? "git ls-files"
      : "git diff --cached --name-only --diff-filter=ACMR";
  const out = execSync(cmd, { encoding: "utf8" }).trim();
  if (!out) return [];
  return out.split("\n").map((x) => x.trim()).filter(Boolean);
}

function shouldSkip(relPath) {
  if (pathAllowlist.some((r) => r.test(relPath))) return true;
  const ext = path.extname(relPath).toLowerCase();
  return binaryFileExts.has(ext);
}

function scanFile(relPath) {
  const abs = path.join(repoRoot, relPath);
  if (!fs.existsSync(abs)) return [];
  const content = fs.readFileSync(abs, "utf8");
  const findings = [];
  for (const matcher of secretMatchers) {
    const hits = [...content.matchAll(matcher.regex)];
    for (const hit of hits) {
      const snippet = String(hit[0]).slice(0, 120);
      findings.push({
        rule: matcher.id,
        snippet,
      });
    }
  }
  return findings;
}

const files = getFiles().filter((f) => !shouldSkip(f));
const results = [];
for (const file of files) {
  const findings = scanFile(file);
  if (findings.length > 0) {
    results.push({ file, findings });
  }
}

if (results.length > 0) {
  console.error("\nSecret scan failed. Potential sensitive data detected:\n");
  for (const entry of results) {
    console.error(`- ${entry.file}`);
    for (const finding of entry.findings) {
      console.error(`  - [${finding.rule}] ${finding.snippet}`);
    }
  }
  console.error(
    "\nIf this is a false positive, replace with placeholders or adjust scripts/secret-scan.mjs allowlist intentionally.\n",
  );
  process.exit(1);
}

console.log(
  mode === "all"
    ? "Secret scan passed for tracked files."
    : "Secret scan passed for staged files.",
);
