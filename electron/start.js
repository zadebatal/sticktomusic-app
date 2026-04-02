/**
 * Orchestrator — starts the API proxy, waits for the React dev server,
 * then launches Electron.
 *
 * Usage: node electron/start.js
 *
 * Expects the React dev server to already be running on port 3000,
 * OR set START_REACT=1 to have this script start it too.
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REACT_PORT = 3000;
const PROXY_PORT = 3001;

function waitForPort(port, timeout = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(`http://localhost:${port}`, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - start > timeout) {
          reject(new Error(`Timeout waiting for port ${port}`));
        } else {
          setTimeout(check, 500);
        }
      });
      req.end();
    };
    check();
  });
}

async function main() {
  console.log('=== StickToMusic Desktop ===\n');

  // 1. Start API proxy
  console.log('[1/3] Starting API proxy on port 3001...');
  const proxy = spawn('node', [path.join(__dirname, 'proxy.js')], {
    cwd: ROOT,
    stdio: 'inherit',
  });

  // 2. Check if React dev server is running, or start it
  console.log('[2/3] Checking React dev server on port 3000...');
  try {
    await waitForPort(REACT_PORT, 3000);
    console.log('[2/3] React dev server already running.');
  } catch {
    if (process.env.START_REACT === '1') {
      console.log('[2/3] Starting React dev server...');
      const react = spawn('npm', ['start'], {
        cwd: ROOT,
        stdio: 'inherit',
        env: { ...process.env, BROWSER: 'none', PORT: String(REACT_PORT) },
      });
      react.on('error', (err) => console.error('React start failed:', err));
      await waitForPort(REACT_PORT, 60000);
      console.log('[2/3] React dev server ready.');
    } else {
      console.error(
        '\n[ERROR] React dev server not running on port 3000.\n' +
          'Run "npm start" in the project root first, or set START_REACT=1\n'
      );
      proxy.kill();
      process.exit(1);
    }
  }

  // 3. Launch Electron
  console.log('[3/3] Launching Electron...');
  const electronBin = require('electron');
  const electron = spawn(String(electronBin), [path.join(__dirname, 'main.js')], {
    cwd: ROOT,
    stdio: 'inherit',
  });

  electron.on('close', (code) => {
    console.log(`\n[electron] Exited with code ${code}`);
    proxy.kill();
    process.exit(code || 0);
  });

  // Cleanup on Ctrl+C
  process.on('SIGINT', () => {
    proxy.kill();
    electron.kill();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
