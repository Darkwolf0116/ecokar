// Classic Web Worker that runs the EcoKar core (pure Python) with Pyodide.
//
// It is the browser twin of the FastAPI WebSocket server and speaks the same message protocol
// (docs/protocol.md section 3), with JSON *strings* instead of WebSocket frames:
//   page   -> worker : a string with one client message ({"type":"tx","data":"A"}, ...)
//   worker -> page   : strings with hello / state / serial / event frames, plus control objects
//                      {kind:'progress', stage} | {kind:'ready'} | {kind:'error', stage, message}
//
// The clock lives here: a 10 ms timer feeds the elapsed wall time to BrowserSession.advance(),
// which runs the fixed 10 ms physics steps and returns the frames to send.
//
// The build script (scripts/build_web.py) reads PYODIDE_VERSION from this file: it is the single
// place where the Pyodide version is pinned.
'use strict';

const PYODIDE_VERSION = '0.27.2';
const PYODIDE_BASE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
const PACKAGE_URL = '/static/py/ecokar_sim.zip';
const EXTRACT_DIR = '/home/pyodide';
const TICK_MS = 10;

let session = null;
let timer = null;

function post(message) {
  self.postMessage(message);
}

function progress(stage) {
  post({ kind: 'progress', stage });
}

function fail(stage, error) {
  console.error(`[ecokar worker] ${stage} failed`, error);
  post({ kind: 'error', stage, message: String(error?.message ?? error) });
}

/** Post every frame of a Python list[str] and release the proxy. */
function flush(proxy) {
  let frames;
  try {
    frames = proxy.toJs();
  } finally {
    proxy.destroy();
  }
  for (const frame of frames) post(frame);
}

function startClock() {
  let last = performance.now();
  timer = setInterval(() => {
    const now = performance.now();
    const elapsed = (now - last) / 1000;
    last = now;
    try {
      flush(session.advance(elapsed));
    } catch (error) {
      clearInterval(timer);
      timer = null;
      fail('running', error);
    }
  }, TICK_MS);
}

async function boot() {
  progress('loading-runtime');
  importScripts(`${PYODIDE_BASE_URL}pyodide.js`);
  const pyodide = await loadPyodide({ indexURL: PYODIDE_BASE_URL });

  progress('loading-core');
  const response = await fetch(PACKAGE_URL);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${PACKAGE_URL}`);
  pyodide.unpackArchive(await response.arrayBuffer(), 'zip', { extractDir: EXTRACT_DIR });
  pyodide.runPython(
    [
      'import importlib, sys',
      `if ${JSON.stringify(EXTRACT_DIR)} not in sys.path:`,
      `    sys.path.insert(0, ${JSON.stringify(EXTRACT_DIR)})`,
      'importlib.invalidate_caches()',
    ].join('\n'),
  );

  progress('starting');
  const bridge = pyodide.pyimport('ecokar_sim.browser.bridge');
  session = bridge.BrowserSession();
  bridge.destroy();
  const hello = session.hello();

  post({ kind: 'ready' });
  post(hello);
  startClock();
}

self.addEventListener('message', (event) => {
  if (session !== null && typeof event.data === 'string') {
    try {
      session.receive(event.data);
    } catch (error) {
      console.error('[ecokar worker] could not handle a client message', error);
    }
  }
});

boot().catch((error) => fail('boot', error));
