// Runs every spec beside this file against a dev server it starts itself.
//
//   npm test              all specs
//   npm test goals cells  just those
//
// Each spec is a plain script that prints PASS/FAIL lines and exits non-zero
// if anything failed — no test framework, so there's nothing to learn before
// reading one.
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const PORT = process.env.PORT || "5199";
const BASE = `http://localhost:${PORT}`;

const wanted = process.argv.slice(2);
const specs = readdirSync(HERE)
  .filter(f => f.endsWith(".spec.mjs"))
  .filter(f => !wanted.length || wanted.some(w => f.startsWith(w)))
  .sort();

if (!specs.length) {
  console.error(wanted.length ? `No spec matches ${wanted.join(", ")}` : "No specs found.");
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  return spawn(cmd, args, { cwd: ROOT, ...opts });
}

async function waitForServer(ms = 40000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const r = await fetch(BASE, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 400));
  }
  return false;
}

// The specs mock every network call, so the keys only have to exist — Vite
// refuses to boot without them and the app renders a config error.
const env = {
  ...process.env,
  VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || "https://test.supabase.co",
  VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY || "test-anon-key",
};

let server = null;
if (!(await waitForServer(1500))) {
  console.log(`Starting dev server on ${PORT}…`);
  server = run("npx", ["vite", "--port", PORT, "--host", "127.0.0.1"], { env, stdio: "ignore" });
  if (!(await waitForServer())) {
    console.error("Dev server never came up.");
    server.kill();
    process.exit(1);
  }
} else {
  console.log(`Reusing the dev server already on ${PORT}.`);
}

const started = Date.now();
const results = [];
for (const spec of specs) {
  const out = await new Promise((resolve) => {
    let buf = "";
    const p = run(process.execPath, [join(HERE, spec)], { env: { ...env, BASE } });
    p.stdout.on("data", d => { buf += d; });
    p.stderr.on("data", d => { buf += d; });
    p.on("close", code => resolve({ code, buf }));
  });
  const pass = (out.buf.match(/^PASS/gm) || []).length;
  const fail = (out.buf.match(/^FAIL/gm) || []).length;
  results.push({ spec, pass, fail, code: out.code, buf: out.buf });
  console.log(`${out.code === 0 ? "ok  " : "FAIL"} ${spec.replace(".spec.mjs", "").padEnd(14)} ${pass} passed${fail ? `, ${fail} failed` : ""}`);
}

server?.kill();

const broken = results.filter(r => r.code !== 0);
for (const r of broken) {
  console.log(`\n--- ${r.spec} ------------------------------------------`);
  console.log(r.buf.split("\n").filter(l => /^FAIL|^-|problem|Error|error:/.test(l)).join("\n") || r.buf.slice(-1500));
}

const totals = results.reduce((a, r) => ({ pass: a.pass + r.pass, fail: a.fail + r.fail }), { pass: 0, fail: 0 });
console.log(`\n${totals.pass} passed, ${totals.fail} failed across ${results.length} specs in ${((Date.now() - started) / 1000).toFixed(0)}s`);
process.exit(broken.length ? 1 : 0);
