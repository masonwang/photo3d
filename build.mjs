/**
 * Zero-dependency build.
 *
 * Transforms src/*.ts -> dist/*.js using Node's built-in TypeScript handling
 * (module.stripTypeScriptTypes, transform mode), rewrites relative imports to
 * carry explicit .js extensions, and copies index.html (with a three.js import
 * map pointing at a CDN) plus the stylesheet into dist/.
 *
 * Result: a fully static app in dist/ that runs in any modern browser with no
 * npm install. (three.js is fetched from the CDN at runtime.)
 *
 * Users who prefer a bundler can still run the Vite path — see package.json.
 */
import { stripTypeScriptTypes } from 'node:module';
import {
  readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync, existsSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

/** Best-effort clean: some mounts forbid unlink. Overwriting handles the rest. */
function cleanDist(dir) {
  if (!existsSync(dir)) return;
  try {
    rmSync(dir, { recursive: true });
  } catch (err) {
    if (err.code === 'EPERM' || err.code === 'EACCES') {
      console.log('  (note: cannot clear dist/ on this filesystem — overwriting in place)');
    } else {
      throw err;
    }
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, 'src');
const DIST = resolve(__dirname, 'dist');

const THREE_VERSION = '0.160.0';
const TRANSFORMERS_VERSION = '3.5.2';
const IMPORT_MAP = {
  imports: {
    'three': `https://unpkg.com/three@${THREE_VERSION}/build/three.module.js`,
    'three/examples/jsm/controls/OrbitControls.js':
      `https://unpkg.com/three@${THREE_VERSION}/examples/jsm/controls/OrbitControls.js`,
    'three/examples/jsm/renderers/CSS2DRenderer.js':
      `https://unpkg.com/three@${THREE_VERSION}/examples/jsm/renderers/CSS2DRenderer.js`,
    // Transformers.js: runs Depth Anything v2 in-browser via WASM/WebGPU.
    // Model weights (~25 MB quantized) are fetched from HuggingFace Hub at runtime.
    '@huggingface/transformers':
      `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${TRANSFORMERS_VERSION}/dist/transformers.min.js`,
  },
};

/** Add .js to relative import specifiers that lack an extension. */
function rewriteImports(code) {
  return code.replace(
    /(\bfrom\s+|\bimport\s+)(['"])(\.\.?\/[^'"]+)\2/g,
    (full, kw, q, spec) => {
      if (/\.(js|mjs|json|css)$/.test(spec)) return full;
      return `${kw}${q}${spec}.js${q}`;
    },
  );
}

function build() {
  cleanDist(DIST);
  mkdirSync(DIST, { recursive: true });

  const tsFiles = readdirSync(SRC).filter(f => f.endsWith('.ts'));
  let count = 0;
  for (const f of tsFiles) {
    const srcPath = join(SRC, f);
    const tsCode = readFileSync(srcPath, 'utf8');
    let jsCode;
    try {
      jsCode = stripTypeScriptTypes(tsCode, { mode: 'transform', sourceMap: false });
    } catch (err) {
      console.error(`  FAIL transforming ${f}: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    jsCode = rewriteImports(jsCode);
    const outName = f.replace(/\.ts$/, '.js');
    writeFileSync(join(DIST, outName), jsCode);
    console.log(`  ${f} -> dist/${outName}`);
    count++;
  }

  // Copy stylesheet
  writeFileSync(join(DIST, 'style.css'), readFileSync(join(SRC, 'style.css'), 'utf8'));
  console.log('  src/style.css -> dist/style.css');

  // index.html: rewrite asset paths to the built files and inject the import map.
  let html = readFileSync(resolve(__dirname, 'index.html'), 'utf8');
  html = html
    .replace('/src/style.css', './style.css')
    .replace('/src/main.ts', './main.js');
  const mapTag =
    `    <script type="importmap">\n` +
    `${JSON.stringify(IMPORT_MAP, null, 2).split('\n').map(l => '    ' + l).join('\n')}\n` +
    `    </script>\n`;
  html = html.replace('  </head>', mapTag + '  </head>');
  writeFileSync(join(DIST, 'index.html'), html);
  console.log('  index.html -> dist/index.html (+ import map)');

  console.log(`\nBuilt ${count} modules into dist/. Run: npm run serve`);
}

build();
