/**
 * afterPack hook — copies fresh React build output to the packaged app.
 * Ensures the latest build/ is always in the package as app-build/.
 */
const path = require('path');
const fs = require('fs');

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

exports.default = async function (context) {
  console.log('[afterPack] Copying fresh build output...');
  const appDir = context.appOutDir;
  const resourcesDir = path.join(appDir, 'StickToMusic.app', 'Contents', 'Resources');
  const buildSrc = path.join(__dirname, '..', 'build');
  // app-build goes inside Resources/app/ (where __dirname/../ resolves in production)
  const buildDest = path.join(resourcesDir, 'app', 'app-build');

  if (fs.existsSync(buildSrc)) {
    if (fs.existsSync(buildDest)) {
      fs.rmSync(buildDest, { recursive: true, force: true });
    }
    copyRecursive(buildSrc, buildDest);
    const jsCount = fs.readdirSync(path.join(buildDest, 'static', 'js')).filter(f => f.endsWith('.js')).length;
    console.log(`[afterPack] Copied build/ -> app-build/ (${jsCount} JS chunks)`);
  } else {
    console.warn('[afterPack] WARNING: build/ directory not found!');
  }

  // Fix missing transitive dependencies that electron-builder prunes
  const appNodeModules = path.join(resourcesDir, 'app', 'node_modules');
  const localNodeModules = path.join(__dirname, '..', 'node_modules');
  const missingModules = ['call-bind-apply-helpers', 'call-bound', 'math-intrinsics'];
  for (const mod of missingModules) {
    const dest = path.join(appNodeModules, mod);
    const src = path.join(localNodeModules, mod);
    if (!fs.existsSync(dest) && fs.existsSync(src)) {
      copyRecursive(src, dest);
      console.log(`[afterPack] Patched missing module: ${mod}`);
    }
  }
};
