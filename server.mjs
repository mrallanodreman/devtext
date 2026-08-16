#!/usr/bin/env node
// SeoEditor (formerly Dev.Text) — standalone local tool server, independent of any project.
// Attaches to a project via a single <script src="http://localhost:PORT/devtext.js?projectPath=..."> tag.
// Nothing here lives inside a client project's repo. This file adds safer projectPath
// validation, dry-run support, and a git-first workflow that creates a branch + commit
// when edits are applied.

import http from "node:http";
import { readFile, readdir, appendFile, mkdir, stat, writeFile, realpath } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as babelParse } from "@babel/parser";
import _traverse from "@babel/traverse";
import _generate from "@babel/generator";
import * as t from "@babel/types";

// @babel/traverse and @babel/generator are CJS with a default export that
// sometimes lands under .default depending on how Node's ESM interop resolves it.
const traverse = _traverse.default || _traverse;
const generate = _generate.default || _generate;

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.DEVTEXT_PORT ? Number(process.env.DEVTEXT_PORT) : 4477;
const GOOGLE_FONTS_ROOT = "/mnt/sda1/EdgeMarketing/Clientes/EOG/dev-fonts/google-fonts";
const LICENSE_DIRS = ["ofl", "apache", "ufl"];
const LOGS_DIR = path.join(__dirname, "logs");
const CLIENT_JS_PATH = path.join(__dirname, "client.js");

const SLUG_RE = /^[a-z0-9]+$/;
const FS_SLUG_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

let fontIndex = null;
let fontIndexPromise = null;

function projectSlug(projectPath) {
  return (projectPath || "unknown").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "unknown";
}

async function readLabel(dir, fallback) {
  const meta = await readFile(path.join(dir, "METADATA.pb"), "utf8").catch(() => "");
  const m = meta.match(/^name:\s*"([^"]+)"/m);
  return m?.[1] ?? fallback;
}

async function buildFontIndex() {
  const slugs = [];
  for (const dir of LICENSE_DIRS) {
    const base = path.join(GOOGLE_FONTS_ROOT, dir);
    let entries = [];
    try {
      entries = await readdir(base);
    } catch {
      continue;
    }
    for (const slug of entries) {
      if (!SLUG_RE.test(slug)) continue;
      slugs.push({ slug, dir: path.join(base, slug) });
    }
  }
  const out = [];
  const BATCH = 100;
  for (let i = 0; i < slugs.length; i += BATCH) {
    const batch = slugs.slice(i, i + BATCH);
    const labels = await Promise.all(batch.map((f) => readLabel(f.dir, f.slug)));
    batch.forEach((f, j) => out.push({ slug: f.slug, label: labels[j] }));
  }
  return out;
}

async function findFamilyDir(slug) {
  if (!SLUG_RE.test(slug)) return null;
  for (const dir of LICENSE_DIRS) {
    const candidate = path.join(GOOGLE_FONTS_ROOT, dir, slug);
    try {
      await readdir(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

function fontsourceFileScore(name) {
  let score = 0;
  if (name.includes("-latin-")) score += 4;
  else if (name.includes("-latin-ext-")) score += 2;
  if (name.includes("-400-")) score += 2;
  if (name.includes("-normal.")) score += 1;
  return score;
}

async function fontsourcePkgDir(projectPath, slug) {
  return path.join(projectPath, "node_modules", "@fontsource", slug);
}

async function listFontsourceFiles(projectPath, slug) {
  const filesDir = path.join(await fontsourcePkgDir(projectPath, slug), "files");
  try {
    const entries = await readdir(filesDir);
    return entries.filter((f) => f.endsWith(".woff2")).sort((a, b) => fontsourceFileScore(b) - fontsourceFileScore(a));
  } catch {
    return [];
  }
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    ...headers,
  });
  res.end(body);
}

function sendJSON(res, status, obj) {
  send(res, status, JSON.stringify(obj), { "Content-Type": "application/json; charset=utf-8" });
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

// Safer project path validation: must be absolute, have no '..' segments and contain package.json
async function isSafeProjectPath(p) {
  try {
    if (typeof p !== "string") return false;
    if (!path.isAbsolute(p)) return false;
    if (p.includes("..")) return false;
    const real = await realpath(p).catch(() => null);
    if (!real) return false;
    const pkg = path.join(real, "package.json");
    const hasPkg = await stat(pkg).then(() => true).catch(() => false);
    return hasPkg ? real : false;
  } catch {
    return false;
  }
}

// Ensure a target file path is contained within the projectPath (prevents escaping)
function isPathInside(filePath, projectPath) {
  const rel = path.relative(projectPath, filePath);
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

// ---------------------------------------------------------------------
// Apply text edits directly to source (replaces the old clipboard-only flow)
// Supports dryRun and git-first commit-on-apply. Returns useful diff/snippets
// when dryRun is requested.
// ---------------------------------------------------------------------
const SOURCE_EXTENSIONS = new Set([".tsx", ".ts", ".jsx", ".js"]);
const SOURCE_EXCLUDE_DIRS = new Set(["node_modules", ".next", ".git", ".claude", "dev-fonts", "_archive", "logs"]);

async function walkSourceFiles(root) {
  const out = [];
  async function walk(dir) {
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".") continue;
      if (entry.isDirectory()) {
        if (SOURCE_EXCLUDE_DIRS.has(entry.name)) continue;
        await walk(path.join(dir, entry.name));
      } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        out.push(path.join(dir, entry.name));
      }
    }
  }
  await walk(root);
  return out;
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

function excerptAround(content, index, length, context = 80) {
  const start = Math.max(0, index - context);
  const end = Math.min(content.length, index + length + context);
  return content.slice(start, end);
}

function makeSimpleDiff(original, updated) {
  // Return a minimal line-based diff for UI preview (not a full unified diff)
  const oLines = original.split(/\r?\n/);
  const uLines = updated.split(/\r?\n/);
  const out = [];
  const max = Math.max(oLines.length, uLines.length);
  for (let i = 0; i < max; i++) {
    const o = oLines[i];
    const u = uLines[i];
    if (o === u) {
      out.push(' ' + (o ?? ''));
    } else {
      if (o !== undefined) out.push('-' + o);
      if (u !== undefined) out.push('+' + u);
    }
  }
  return out.join('\n');
}

// If the match sits directly inside a quoted string literal ("...", '...', `...`),
// escape unescaped occurrences of that same quote char (and backslashes) in the
// replacement so we don't break the source file's syntax.
function safeReplacement(fileContent, matchIndex, originalText, newText) {
  const before = fileContent[matchIndex - 1];
  const after = fileContent[matchIndex + originalText.length];
  const quoteChars = ['"', "'", "`"];
  if (quoteChars.includes(before) && before === after) {
    const escaped = newText.replace(/\\/g, "\\\\").split(before).join("\\" + before);
    return escaped;
  }
  return newText;
}

async function applyTextEdit(projectPath, originalText, newText, options = { dryRun: false, commit: true, commitMessage: null }) {
  const resolvedProject = await isSafeProjectPath(projectPath);
  if (!resolvedProject) return { applied: false, reason: "invalid projectPath or missing package.json" };
  const needle = (originalText || "").trim();
  if (!needle) return { applied: false, reason: "empty original text" };
  if (needle === (newText || "").trim()) return { applied: false, reason: "no change" };

  const files = await walkSourceFiles(resolvedProject);
  const matches = [];
  for (const file of files) {
    let content;
    try {
      content = await readFile(file, "utf8");
    } catch {
      continue;
    }
    const count = countOccurrences(content, needle);
    if (count > 0) matches.push({ file, content, count });
  }

  if (matches.length === 0) {
    return { applied: false, reason: "no source match — text is likely computed/derived, not a literal string" };
  }
  if (matches.length > 1) {
    return {
      applied: false,
      reason: "ambiguous — matched in " + matches.length + " files",
      matches: matches.map((m) => path.relative(resolvedProject, m.file)),
    };
  }
  const single = matches[0];
  if (single.count > 1) {
    return {
      applied: false,
      reason: "ambiguous — appears " + single.count + " times in " + path.relative(resolvedProject, single.file),
    };
  }

  const matchIndex = single.content.indexOf(needle);
  const replacement = safeReplacement(single.content, matchIndex, needle, (newText || "").trim());
  const updated = single.content.slice(0, matchIndex) + replacement + single.content.slice(matchIndex + needle.length);

  if (options.dryRun) {
    return {
      applied: false,
      dryRun: true,
      file: path.relative(resolvedProject, single.file),
      originalExcerpt: excerptAround(single.content, matchIndex, needle.length),
      updatedExcerpt: excerptAround(updated, matchIndex, replacement.length),
      diff: makeSimpleDiff(excerptAround(single.content, matchIndex, needle.length).replace(/\r/g, ''), excerptAround(updated, matchIndex, replacement.length).replace(/\r/g, '')),
    };
  }

  // safety: ensure target file is inside projectPath
  if (!isPathInside(single.file, resolvedProject)) {
    return { applied: false, reason: "target file outside project directory" };
  }

  await writeFile(single.file, updated, "utf8");

  let branch = null;
  if (options.commit) {
    try {
      const gitResult = await createGitBranchAndCommit(resolvedProject, [path.relative(resolvedProject, single.file)], options.commitMessage || `seoeditor: edit text '${needle.slice(0,50)}'`);
      if (gitResult.ok) branch = gitResult.branch;
    } catch (e) {
      // commit failed — we still return applied true but provide a note
      return { applied: true, file: path.relative(resolvedProject, single.file), commit: false, commitError: String(e).slice(0, 400) };
    }
  }

  return { applied: true, file: path.relative(resolvedProject, single.file), branch };
}

// ---------------------------------------------------------------------
// Apply style edits directly to source, as a real style={{...}} JSX prop.
// Supports dryRun and commit-on-apply as well.
// ---------------------------------------------------------------------
const JSX_EXTENSIONS = new Set([".tsx", ".jsx"]);

function parseJsxFile(content) {
  return babelParse(content, {
    sourceType: "module",
    plugins: ["jsx", "typescript"],
  });
}

function findJsxTextOwner(ast, needle) {
  let found = null;
  traverse(ast, {
    JSXText(nodePath) {
      if (found) return;
      if (nodePath.node.value.trim() === needle) {
        found = nodePath.parentPath; // JSXElement
      }
    },
    JSXExpressionContainer(nodePath) {
      if (found) return;
      const expr = nodePath.node.expression;
      if (t.isStringLiteral(expr) && expr.value.trim() === needle && t.isJSXElement(nodePath.parentPath.node)) {
        found = nodePath.parentPath;
      }
    },
  });
  return found;
}

function buildStylePropertyNodes(cssStyle) {
  return Object.keys(cssStyle).map((key) => {
    const value = cssStyle[key];
    const valueNode = typeof value === "number" ? t.numericLiteral(value) : t.stringLiteral(String(value));
    return t.objectProperty(t.identifier(key), valueNode);
  });
}

async function applyStyleEdit(projectPath, originalText, cssStyle, options = { dryRun: false, commit: true, commitMessage: null }) {
  const resolvedProject = await isSafeProjectPath(projectPath);
  if (!resolvedProject) return { applied: false, reason: "invalid projectPath or missing package.json" };
  const needle = (originalText || "").trim();
  if (!needle) return { applied: false, reason: "empty original text" };
  if (!cssStyle || typeof cssStyle !== "object") return { applied: false, reason: "missing style" };

  const allFiles = await walkSourceFiles(resolvedProject);
  const jsxFiles = allFiles.filter((f) => JSX_EXTENSIONS.has(path.extname(f)));
  const matches = [];
  for (const file of jsxFiles) {
    let content;
    try {
      content = await readFile(file, "utf8");
    } catch {
      continue;
    }
    const count = countOccurrences(content, needle);
    if (count > 0) matches.push({ file, content, count });
  }

  if (matches.length === 0) {
    return { applied: false, reason: "no JSX/TSX source match for this text" };
  }
  if (matches.length > 1) {
    return { applied: false, reason: "ambiguous — matched in " + matches.length + " files" };
  }
  const single = matches[0];
  if (single.count > 1) {
    return {
      applied: false,
      reason: "ambiguous — appears " + single.count + " times in " + path.relative(resolvedProject, single.file),
    };
  }

  let ast;
  try {
    ast = parseJsxFile(single.content);
  } catch (err) {
    return { applied: false, reason: "could not parse file: " + String(err.message || err).slice(0, 200) };
  }

  const owner = findJsxTextOwner(ast, needle);
  if (!owner) {
    return {
      applied: false,
      reason: "text is not literal JSX content in this file — likely comes from shared data (lib/*.ts) rendered by a generic tag; applying style there would affect every instance",
    };
  }

  const openingElement = owner.node.openingElement;
  const newProps = buildStylePropertyNodes(cssStyle);
  const existingStyleAttr = openingElement.attributes.find(
    (attr) => t.isJSXAttribute(attr) && attr.name.name === "style" && t.isJSXExpressionContainer(attr.value) && t.isObjectExpression(attr.value.expression)
  );

  let patchStart, patchEnd, patchText;

  if (existingStyleAttr) {
    const objExpr = existingStyleAttr.value.expression;
    const newKeys = new Set(Object.keys(cssStyle));
    const keptProps = objExpr.properties.filter((p) => !(t.isObjectProperty(p) && t.isIdentifier(p.key) && newKeys.has(p.key.name)));
    const mergedObj = t.objectExpression([...keptProps, ...newProps]);
    patchStart = objExpr.start;
    patchEnd = objExpr.end;
    patchText = generate(mergedObj, { concise: true }).code;
  } else {
    const objExpr = t.objectExpression(newProps);
    const objCode = generate(objExpr, { concise: true }).code;
    const attrs = openingElement.attributes;
    const insertAt = attrs.length > 0 ? attrs[attrs.length - 1].end : openingElement.name.end;
    patchStart = insertAt;
    patchEnd = insertAt;
    patchText = " style={" + objCode + "}";
  }

  const updated = single.content.slice(0, patchStart) + patchText + single.content.slice(patchEnd);

  if (options.dryRun) {
    return {
      applied: false,
      dryRun: true,
      file: path.relative(resolvedProject, single.file),
      originalExcerpt: excerptAround(single.content, patchStart, 0),
      updatedExcerpt: excerptAround(updated, patchStart, patchText.length),
      diff: makeSimpleDiff(excerptAround(single.content, patchStart, 0).replace(/\r/g, ''), excerptAround(updated, patchStart, patchText.length).replace(/\r/g, '')),
    };
  }

  if (!isPathInside(single.file, resolvedProject)) {
    return { applied: false, reason: "target file outside project directory" };
  }

  await writeFile(single.file, updated, "utf8");

  let branch = null;
  if (options.commit) {
    try {
      const gitResult = await createGitBranchAndCommit(resolvedProject, [path.relative(resolvedProject, single.file)], options.commitMessage || `seoeditor: style update for '${needle.slice(0,50)}'`);
      if (gitResult.ok) branch = gitResult.branch;
    } catch (e) {
      return { applied: true, file: path.relative(resolvedProject, single.file), commit: false, commitError: String(e).slice(0, 400) };
    }
  }

  return { applied: true, file: path.relative(resolvedProject, single.file), branch };
}

// ---------------------------------------------------------------------
// Git helpers: create a branch, add files and commit. If not a git repo,
// return a clear result so the caller can still proceed.
// ---------------------------------------------------------------------
async function createGitBranchAndCommit(projectPath, files, message) {
  try {
    // ensure we're inside a git repo
    await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: projectPath, timeout: 5000 });
  } catch (e) {
    return { ok: false, reason: "not a git repository" };
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const branchName = `seoeditor/${timestamp}`;
  try {
    await execFileAsync("git", ["checkout", "-b", branchName], { cwd: projectPath, timeout: 10000 });
    await execFileAsync("git", ["add", "--", ...files], { cwd: projectPath, timeout: 10000 });
    await execFileAsync("git", ["commit", "-m", message], { cwd: projectPath, timeout: 10000 });
    return { ok: true, branch: branchName };
  } catch (e) {
    return { ok: false, reason: String(e.message || e).slice(0, 400) };
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === "OPTIONS") return send(res, 204, "");

  try {
    if (url.pathname === "/devtext.js" && req.method === "GET") {
      const js = await readFile(CLIENT_JS_PATH, "utf8");
      return send(res, 200, js, { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-store" });
    }

    if (url.pathname === "/api/fonts" && req.method === "GET") {
      const family = url.searchParams.get("family");
      if (family) {
        const dir = await findFamilyDir(family);
        if (!dir) return sendJSON(res, 404, { error: "not found" });
        const meta = await readFile(path.join(dir, "METADATA.pb"), "utf8").catch(() => "");
        const nameMatch = meta.match(/^name:\s*"([^"]+)"/m);
        const fileMatch = meta.match(/filename:\s*"([^"]+)"/);
        if (!fileMatch) return sendJSON(res, 404, { error: "no font file" });
        const buf = await readFile(path.join(dir, fileMatch[1]));
        return send(res, 200, buf, {
          "Content-Type": "font/ttf",
          "X-Font-Label": nameMatch?.[1] ?? family,
          "Cache-Control": "no-store",
        });
      }
      if (!fontIndex) {
        if (!fontIndexPromise) fontIndexPromise = buildFontIndex();
        fontIndex = await fontIndexPromise;
      }
      const qRaw = (url.searchParams.get("q") ?? "").toLowerCase();
      const q = qRaw.replace(/\s+/g, "");
      const results = q
        ? fontIndex.filter((f) => f.slug.includes(q) || f.label.toLowerCase().replace(/\s+/g, "").includes(q)).slice(0, 60)
        : fontIndex.slice(0, 60);
      return sendJSON(res, 200, { total: fontIndex.length, results });
    }

    if (url.pathname === "/api/fontsource" && req.method === "GET") {
      const slug = url.searchParams.get("slug") ?? "";
      const file = url.searchParams.get("file");
      const projectPath = url.searchParams.get("projectPath") ?? "";
      const realProject = await isSafeProjectPath(projectPath);
      if (!FS_SLUG_RE.test(slug) || !realProject) return sendJSON(res, 400, { error: "invalid params" });

      if (file) {
        if (!/^[a-zA-Z0-9._-]+\.woff2$/.test(file)) return sendJSON(res, 400, { error: "invalid file" });
        const filePath = path.join(await fontsourcePkgDir(realProject, slug), "files", file);
        try {
          const buf = await readFile(filePath);
          return send(res, 200, buf, { "Content-Type": "font/woff2", "Cache-Control": "no-store" });
        } catch {
          return sendJSON(res, 404, { error: "not found" });
        }
      }
      const dir = await fontsourcePkgDir(realProject, slug);
      const installed = await stat(dir).then(() => true).catch(() => false);
      const files = installed ? await listFontsourceFiles(realProject, slug) : [];
      return sendJSON(res, 200, { installed, files });
    }

    if (url.pathname === "/api/fontsource" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const { slug, projectPath } = body;
      const realProject = await isSafeProjectPath(projectPath);
      if (typeof slug !== "string" || !FS_SLUG_RE.test(slug) || !realProject) {
        return sendJSON(res, 400, { error: "invalid params" });
      }
      try {
        await execFileAsync("npm", ["install", `@fontsource/${slug}`, "--no-audit", "--no-fund"], {
          cwd: realProject,
          timeout: 90_000,
        });
      } catch (err) {
        return sendJSON(res, 500, { error: "install failed", detail: String(err.message || err).slice(0, 400) });
      }
      const files = await listFontsourceFiles(realProject, slug);
      if (files.length === 0) return sendJSON(res, 500, { error: "installed but no font files found" });
      return sendJSON(res, 200, { ok: true, slug, files });
    }

    if (url.pathname === "/api/apply-text" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const { projectPath, originalText, newText, dryRun = false, commit = true, commitMessage = null } = body;
      const realProject = await isSafeProjectPath(projectPath);
      if (!realProject || typeof originalText !== "string" || typeof newText !== "string") {
        return sendJSON(res, 400, { error: "invalid params" });
      }
      try {
        const result = await applyTextEdit(realProject, originalText, newText, { dryRun, commit, commitMessage });
        return sendJSON(res, 200, result);
      } catch (err) {
        return sendJSON(res, 500, { applied: false, reason: "write failed", detail: String(err.message || err).slice(0, 400) });
      }
    }

    if (url.pathname === "/api/apply-style" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const { projectPath, originalText, cssStyle, dryRun = false, commit = true, commitMessage = null } = body;
      const realProject = await isSafeProjectPath(projectPath);
      if (!realProject || typeof originalText !== "string" || !cssStyle || typeof cssStyle !== "object") {
        return sendJSON(res, 400, { error: "invalid params" });
      }
      try {
        const result = await applyStyleEdit(realProject, originalText, cssStyle, { dryRun, commit, commitMessage });
        return sendJSON(res, 200, result);
      } catch (err) {
        return sendJSON(res, 500, { applied: false, reason: "write failed", detail: String(err.message || err).slice(0, 400) });
      }
    }

    if (url.pathname === "/api/edit-log" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const { projectPath, ...rest } = body;
      const realProject = await isSafeProjectPath(projectPath);
      if (!realProject) return sendJSON(res, 400, { error: "invalid projectPath" });
      await mkdir(LOGS_DIR, { recursive: true });
      const logFile = path.join(LOGS_DIR, `${projectSlug(realProject)}.jsonl`);
      const entry = { at: new Date().toISOString(), projectPath: realProject, ...rest };
      await appendFile(logFile, JSON.stringify(entry) + "\n", "utf8");
      return sendJSON(res, 200, { ok: true });
    }

    if (url.pathname === "/api/edit-log" && req.method === "GET") {
      const projectPath = url.searchParams.get("projectPath") ?? "";
      const realProject = await isSafeProjectPath(projectPath);
      if (!realProject) return sendJSON(res, 400, { error: "invalid projectPath" });
      const logFile = path.join(LOGS_DIR, `${projectSlug(realProject)}.jsonl`);
      const content = await readFile(logFile, "utf8").catch(() => "");
      return send(res, 200, content, { "Content-Type": "text/plain; charset=utf-8" });
    }

    return sendJSON(res, 404, { error: "not found" });
  } catch (err) {
    return sendJSON(res, 500, { error: "server error", detail: String(err.message || err).slice(0, 400) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`SeoEditor server listening on http://localhost:${PORT}`);
});
