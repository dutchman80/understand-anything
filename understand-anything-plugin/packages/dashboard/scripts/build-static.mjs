#!/usr/bin/env node
// Build a single self-contained HTML file of the dashboard with a project's
// graph data baked in. The output opens directly via file:// — no dev
// server, no token, no network fetches for app code or data.
//
// Usage (from the dashboard package, or via the root build:static script):
//   pnpm build:static -- --graph <path-to-.understand-anything-or-project> \
//     [--title "Page title"] [--skip-vite]
//
// Steps:
//   1. build @understand-anything/core, then vite build with
//      vite.config.static.ts (one JS chunk, one CSS file, demo mode)
//   2. inline the JS bundle and CSS into index.html
//   3. inject the project's data files as window.__UA_DATA__ plus a fetch
//      shim that serves them (404 for data files that don't exist on disk)
//   4. write dist-static/<project-name>.html

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dashboardRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(dashboardRoot, "../../..");
const buildDir = path.join(dashboardRoot, "dist-static-build");
const outDir = path.join(dashboardRoot, "dist-static");

// Data files the dashboard fetches at startup. knowledge-graph.json is
// required; the rest are inlined when present and 404 from the shim when not.
const DATA_FILES = [
  "knowledge-graph.json",
  "meta.json",
  "domain-graph.json",
  "diff-overlay.json",
  "config.json",
];

function fail(message) {
  console.error(`\n[build-static] ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { graph: null, title: null, skipVite: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    // pnpm forwards a literal "--" separator through nested scripts.
    if (arg === "--") continue;
    if (arg === "--graph") args.graph = argv[++i];
    else if (arg === "--title") args.title = argv[++i];
    else if (arg === "--skip-vite") args.skipVite = true;
    else fail(`Unknown argument: ${arg}`);
  }
  if (!args.graph) {
    fail(
      "Missing --graph. Pass the path to a project's .understand-anything " +
        "directory (or to the project root containing one).",
    );
  }
  return args;
}

/** Accept either the .understand-anything dir itself or its parent project. */
function resolveGraphDir(graphArg) {
  const resolved = path.resolve(process.cwd(), graphArg);
  if (!fs.existsSync(resolved)) fail(`No such path: ${resolved}`);
  if (path.basename(resolved) === ".understand-anything") return resolved;
  const nested = path.join(resolved, ".understand-anything");
  if (fs.existsSync(nested)) return nested;
  fail(`No .understand-anything directory found at or under: ${resolved}`);
}

/**
 * Mirror the dev server's path sanitisation: node filePath values can be
 * absolute (e.g. /Users/alice/company/src/auth.ts) and would leak the
 * author's directory layout into a shareable file. Relativise paths inside
 * the project root, keep relative paths, and reduce external absolute
 * paths to their basename.
 */
function sanitizeGraph(raw, projectRoot) {
  if (!raw || !Array.isArray(raw.nodes)) return raw;
  return {
    ...raw,
    nodes: raw.nodes.map((node) => {
      if (typeof node.filePath !== "string") return node;
      const abs = node.filePath;
      const rel = abs.startsWith(projectRoot)
        ? abs.slice(projectRoot.length).replace(/^[\\/]/, "")
        : path.isAbsolute(abs)
          ? path.basename(abs)
          : abs;
      return { ...node, filePath: rel };
    }),
  };
}

function readDataFiles(graphDir) {
  const projectRoot = path.dirname(graphDir);
  const data = {};
  for (const fileName of DATA_FILES) {
    const filePath = path.join(graphDir, fileName);
    if (!fs.existsSync(filePath)) continue;
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (err) {
      fail(`Failed to parse ${filePath}: ${err.message}`);
    }
    data[fileName] =
      fileName === "knowledge-graph.json" || fileName === "domain-graph.json"
        ? sanitizeGraph(parsed, projectRoot)
        : parsed;
  }
  if (!data["knowledge-graph.json"]) {
    fail(`No knowledge-graph.json in ${graphDir}. Run /understand first.`);
  }
  return data;
}

function run(command, cwd) {
  console.log(`\n[build-static] ${command}`);
  execSync(command, { cwd, stdio: "inherit" });
}

/** `</script>` inside the inlined JS or JSON would close our tag early. */
function escapeScriptContent(code) {
  return code.replace(/<\/script/gi, "<\\/script");
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function slugify(name) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "knowledge-graph";
}

// The shim intercepts the dashboard's startup fetches and serves the inlined
// data. Anything not inlined gets a 404 Response, which the app already
// handles gracefully (optional overlays simply don't load).
function buildShimScript(data) {
  const payload = escapeScriptContent(
    JSON.stringify(data).replace(/</g, "\\u003c"),
  );
  return `<script>
window.__UA_DATA__ = ${payload};
(function () {
  var DATA_FILES = ${JSON.stringify(DATA_FILES)};
  var originalFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    var name = String(url).split("?")[0].split("#")[0].split("/").pop();
    if (DATA_FILES.indexOf(name) !== -1) {
      var data = window.__UA_DATA__[name];
      if (data === undefined) {
        return Promise.resolve(new Response("", { status: 404, statusText: "Not Found" }));
      }
      return Promise.resolve(new Response(JSON.stringify(data), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    }
    if (originalFetch) return originalFetch(input, init);
    return Promise.reject(new TypeError("fetch is unavailable in this context"));
  };
})();
</script>`;
}

function inlineFavicon(html) {
  const faviconPath = path.join(dashboardRoot, "public", "favicon.svg");
  if (!fs.existsSync(faviconPath)) return html;
  const dataUri = `data:image/svg+xml;base64,${fs.readFileSync(faviconPath).toString("base64")}`;
  return html.replace(
    /<link rel="icon"[^>]*\/?>/,
    `<link rel="icon" type="image/svg+xml" href="${dataUri}" />`,
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const graphDir = resolveGraphDir(args.graph);
  const data = readDataFiles(graphDir);

  if (!args.skipVite) {
    run("pnpm --filter @understand-anything/core build", workspaceRoot);
    run("npx vite build --config vite.config.static.ts", dashboardRoot);
  } else if (!fs.existsSync(path.join(buildDir, "index.html"))) {
    fail("--skip-vite passed but dist-static-build/ is missing. Build first.");
  }

  let html = fs.readFileSync(path.join(buildDir, "index.html"), "utf8");

  // Inline the single CSS bundle.
  html = html.replace(
    /<link rel="stylesheet"[^>]*href="\.\/(assets\/[^"]+\.css)"[^>]*\/?>/g,
    (_match, cssFile) => {
      const css = fs.readFileSync(path.join(buildDir, cssFile), "utf8");
      return `<style>\n${css}\n</style>`;
    },
  );

  // Inline the single module-script bundle.
  let inlinedJs = false;
  html = html.replace(
    /<script type="module"[^>]*src="\.\/(assets\/[^"]+\.js)"[^>]*><\/script>/g,
    (_match, jsFile) => {
      const js = fs.readFileSync(path.join(buildDir, jsFile), "utf8");
      inlinedJs = true;
      return `<script type="module">\n${escapeScriptContent(js)}\n</script>`;
    },
  );
  if (!inlinedJs) fail("Could not find the module script tag to inline.");

  // Single-chunk build should not emit modulepreload hints; drop any stragglers.
  html = html.replace(/<link rel="modulepreload"[^>]*\/?>/g, "");

  // Data + fetch shim must run before the app bundle.
  html = html.replace(
    '<script type="module">',
    `${buildShimScript(data)}\n<script type="module">`,
  );

  const projectName = data["knowledge-graph.json"]?.project?.name ?? "knowledge-graph";
  const title = args.title ?? projectName;
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`);
  html = inlineFavicon(html);

  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${slugify(projectName)}.html`);
  fs.writeFileSync(outFile, html);

  const sizeMb = (fs.statSync(outFile).size / (1024 * 1024)).toFixed(1);
  console.log(`\n[build-static] Wrote ${outFile} (${sizeMb} MB)`);
  console.log("[build-static] Open it directly in a browser — no server needed.");
}

main();
