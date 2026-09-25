// Auto-status: when a Claude Code session goes idle, distill what just happened
// into a short project status and upsert it into shared memory as
// `status:<project>/<person>`. Triggered by Claude Code hooks
// (Notification:idle_prompt + SessionEnd) — `watercooler autostatus` prints them.
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync, execSync } from "node:child_process";
import { paths, readConfig, origins, authHeaders } from "./lib.mjs";

const STATE = path.join(paths.home, "checkpoints.json");
const LOG = path.join(paths.home, "checkpoint.log");
const PROJECT_FILE = ".watercooler.json";
const GUARD = "WATERCOOLER_CHECKPOINT"; // set on our own `claude -p` so it can't recurse

const DEFAULTS = {
  minMinutes: 10, // at most one status per project per this many minutes
  minNewChars: 600, // skip when the session barely moved since last time
  maxDigestChars: 24000, // transcript tail handed to the model
  maxStatusChars: 700,
  model: "haiku",
};

function log(msg) {
  try {
    fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {}
}

function loadState() {
  try {
    return { sessions: {}, projects: {}, ...JSON.parse(fs.readFileSync(STATE, "utf8")) };
  } catch {
    return { sessions: {}, projects: {} };
  }
}

function saveState(s) {
  fs.writeFileSync(STATE, JSON.stringify(s, null, 2));
}

export function settings(cfg) {
  return { ...DEFAULTS, ...(cfg?.autostatus || {}) };
}

// ---------- project resolution ----------

function gitRoot(cwd) {
  try {
    return execSync("git rev-parse --show-toplevel", { cwd, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return null;
  }
}

function findProjectFile(cwd) {
  let dir = path.resolve(cwd);
  for (;;) {
    const f = path.join(dir, PROJECT_FILE);
    if (fs.existsSync(f)) return f;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

// Nearest .watercooler.json wins; otherwise the git repo name; otherwise the folder.
export function resolveProject(cwd) {
  const file = findProjectFile(cwd);
  if (file) {
    try {
      const j = JSON.parse(fs.readFileSync(file, "utf8"));
      if (j.project) {
        return { project: slug(j.project), tags: (j.tags || []).map(slug).filter(Boolean), source: file };
      }
    } catch {}
  }
  const root = gitRoot(cwd);
  if (root) return { project: slug(path.basename(root)), tags: [], source: "git repo name" };
  return { project: slug(path.basename(path.resolve(cwd))), tags: [], source: "folder name" };
}

export function writeProjectFile(cwd, project, tags) {
  const dir = gitRoot(cwd) || path.resolve(cwd);
  const file = path.join(dir, PROJECT_FILE);
  const body = { project: slug(project), ...(tags?.length ? { tags: tags.map(slug).filter(Boolean) } : {}) };
  fs.writeFileSync(file, JSON.stringify(body, null, 2) + "\n");
  return file;
}

// ---------- redaction ----------

const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, // JWT
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, // AWS access key id
  /\b(?:sk|pk|rk)[-_](?:live|test|ant|proj)?[-_]?[A-Za-z0-9_-]{16,}/g, // Stripe/Anthropic/OpenAI style
  /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, // Slack
  /\bAIza[0-9A-Za-z_-]{30,}/g, // Google API key
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@"'`]+:[^\s@"'`]+@/gi, // scheme://user:pass@
];
// key=value / "key": "value" where the key name says it's a secret
const NAMED_SECRET =
  /((?:[A-Za-z0-9_]*?)(?:secret|token|passw(?:or)?d|pwd|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|auth)[A-Za-z0-9_]*["']?\s*[:=]\s*["']?)([^\s"',;}]{6,})/gi;
// Long opaque strings mixing cases and digits are treated as secrets. Plain hex
// (git SHAs) and uuids have no uppercase+lowercase mix, so they survive.
const OPAQUE = /\b(?=[A-Za-z0-9_+/=-]*[A-Z])(?=[A-Za-z0-9_+/=-]*[a-z])(?=[A-Za-z0-9_+/=-]*\d)[A-Za-z0-9_+/=-]{32,}\b/g;

export function redact(text, extra = []) {
  let out = String(text);
  for (const s of extra) if (s && s.length >= 6) out = out.split(s).join("[redacted]");
  for (const re of SECRET_PATTERNS) out = out.replace(re, "[redacted]");
  out = out.replace(NAMED_SECRET, (_m, k) => `${k}[redacted]`);
  out = out.replace(OPAQUE, "[redacted]");
  return out;
}

// ---------- transcript digest ----------

function clip(s, n) {
  s = String(s ?? "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function toolLine(b) {
  const i = b.input || {};
  const what = i.description || i.file_path || i.path || i.pattern || i.url || i.query || i.command || i.prompt || "";
  return `[tool ${b.name}] ${clip(what, 160)}`;
}

// Reads the transcript from `offset` and keeps only the signal: what the user
// asked, what Claude said, and which tools it ran. Tool *results* and thinking
// are dropped: they're large and are where secrets usually live.
export function digest(file, offset = 0) {
  const size = fs.statSync(file).size;
  if (offset > size) offset = 0; // transcript was rotated/rewritten
  const fd = fs.openSync(file, "r");
  const buf = Buffer.alloc(size - offset);
  fs.readSync(fd, buf, 0, buf.length, offset);
  fs.closeSync(fd);

  const lines = [];
  let cwd = null;
  for (const raw of buf.toString("utf8").split("\n")) {
    if (!raw.trim()) continue;
    let d;
    try {
      d = JSON.parse(raw);
    } catch {
      continue;
    }
    if (d.cwd) cwd = d.cwd;
    const content = d.message?.content;
    if (d.type === "user") {
      if (typeof content === "string" && !content.startsWith("<")) lines.push(`USER: ${clip(content, 1200)}`);
      else if (Array.isArray(content))
        for (const b of content) if (b.type === "text" && !b.text.startsWith("<")) lines.push(`USER: ${clip(b.text, 1200)}`);
    } else if (d.type === "assistant" && Array.isArray(content)) {
      for (const b of content) {
        if (b.type === "text") lines.push(`CLAUDE: ${clip(b.text, 1500)}`);
        else if (b.type === "tool_use") lines.push(toolLine(b));
      }
    }
  }
  return { text: lines.join("\n"), size, cwd };
}

// ---------- the model call ----------

function buildPrompt({ project, person, previous, work, max }) {
  return `You maintain a one-glance project status board shared by a team.
Update the status for project "${project}" as worked on by ${person}, based on the session activity below.

Reply with EXACTLY three lines and nothing else:
Now: <what state the work is in right now: what's done, what's live, what's in review>
Next: <the very next concrete step>
Blocked: <what is waiting on someone or something, or "nothing">

Rules:
- Max ~${max} characters total. Terse, factual, concrete (branch names, PR numbers, environments).
- Keep facts from the previous status that are still true; replace what changed.
- Never include secrets, tokens, passwords, keys, credentials, or personal data. Leave out anything that looks like one.
- If the activity has nothing to do with real project work (chit-chat, config fiddling), reply with just: SKIP

Previous status:
${previous || "(none)"}

Session activity since the last update (oldest first):
${work}`;
}

function runModel(prompt, model) {
  const r = spawnSync(
    "claude",
    ["-p", "--model", model, "--tools", "", "--no-session-persistence", "--strict-mcp-config", "--setting-sources", "", "--output-format", "text"],
    { input: prompt, encoding: "utf8", timeout: 120000, env: { ...process.env, [GUARD]: "1" }, maxBuffer: 1 << 20 }
  );
  if (r.error) throw new Error(`claude -p failed: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`claude -p exited ${r.status}: ${clip(r.stderr || r.stdout, 300)}`);
  return r.stdout.trim();
}

// ---------- shared memory I/O ----------

async function currentStatus(cfg, key) {
  const { httpUrl } = origins(cfg.server);
  const q = new URLSearchParams({ invite: cfg.invite, q: key });
  const res = await fetch(`${httpUrl}/sync?${q}`, { headers: authHeaders(cfg) });
  if (!res.ok) return null;
  const { entries } = await res.json();
  return entries.find((e) => e.id === key)?.text || null;
}

async function post(cfg, body) {
  const { httpUrl } = origins(cfg.server);
  const res = await fetch(`${httpUrl}/mem?invite=${encodeURIComponent(cfg.invite)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(cfg) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`server answered ${res.status}`);
}

// ---------- entry points ----------

// Called by the Claude Code hook with the hook payload on stdin. Returns at once
// and does the real work in a detached child, so the session never waits on it.
export async function fromHook() {
  if (process.env[GUARD]) return;
  let input = "";
  for await (const c of process.stdin) input += c;
  let h;
  try {
    h = JSON.parse(input);
  } catch {
    return;
  }
  if (!h.transcript_path || !h.session_id) return;
  const args = [process.argv[1], "checkpoint", "--transcript", h.transcript_path, "--session", h.session_id];
  if (h.cwd) args.push("--cwd", h.cwd);
  if (h.hook_event_name === "SessionEnd") args.push("--final");
  const out = fs.openSync(LOG, "a");
  spawn(process.execPath, args, { detached: true, stdio: ["ignore", out, out] }).unref();
}

export async function checkpoint({ transcript, session, cwd, now = false, dryRun = false, final = false }) {
  if (process.env[GUARD]) return { skipped: "inside a checkpoint" };
  const cfg = readConfig();
  if (!cfg?.server || !cfg?.invite) return { skipped: "not in a watercooler room" };
  const opts = settings(cfg);
  if (!transcript || !fs.existsSync(transcript)) return { skipped: "no transcript" };

  const state = loadState();
  const sid = session || path.basename(transcript, ".jsonl");
  const offset = state.sessions[sid]?.offset || 0;
  const d = digest(transcript, offset);
  const where = cwd || d.cwd || process.cwd();
  const { project, tags } = resolveProject(where);
  const key = `status:${project}/${slug(cfg.name)}`;

  const done = (skipped) => {
    log(`${key}: ${skipped}`);
    return { skipped, key, project };
  };
  if (d.text.length < (now || final ? 80 : opts.minNewChars)) return done("not enough new activity");
  const last = state.projects[project]?.ts || 0;
  if (!now && !final && Date.now() - last < opts.minMinutes * 60000) return done(`updated < ${opts.minMinutes}m ago`);

  const secrets = [cfg.token];
  const work = redact(d.text.slice(-opts.maxDigestChars), secrets);
  const previous = await currentStatus(cfg, key).catch(() => null);
  const prompt = buildPrompt({ project, person: cfg.name, previous, work, max: opts.maxStatusChars });
  if (dryRun === "prompt") return { key, project, tags, prompt };

  let status = runModel(prompt, opts.model);
  const advance = () => {
    state.sessions[sid] = { offset: d.size, ts: Date.now() };
    state.projects[project] = { ts: Date.now() };
    if (!dryRun) saveState(state);
  };
  if (!status || /^SKIP\b/i.test(status)) {
    advance();
    return done("model said nothing worth posting");
  }
  status = redact(status, secrets).slice(0, opts.maxStatusChars);

  if (dryRun) return { key, project, tags, status, dryRun: true };
  await post(cfg, {
    op: "set",
    key,
    text: status,
    tags: [...new Set([project, ...tags, "status", "auto"])],
    from: { id: cfg.agentId, name: cfg.name, repo: cfg.repo || "" },
  });
  advance();
  log(`${key}: posted (${status.length} chars)`);
  return { key, project, tags, status };
}

// The hook entries a user adds to ~/.claude/settings.json to turn this on.
export function hookSnippet() {
  const q = (s) => `'${s.replace(/'/g, "'\\''")}'`;
  const command = `${q(process.execPath)} ${q(fs.realpathSync(process.argv[1]))} checkpoint --hook`;
  const h = { type: "command", command, async: true };
  return {
    hooks: {
      Notification: [{ matcher: "idle_prompt", hooks: [h] }],
      SessionEnd: [{ hooks: [h] }],
    },
  };
}
