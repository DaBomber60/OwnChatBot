const fs = require('fs');
const path = require('path');

const pkgPath = path.join(__dirname, '..', 'package.json');
const swTemplatePath = path.join(__dirname, '..', 'public', 'sw.template.js');
const swPath = path.join(__dirname, '..', 'public', 'sw.js');

function main() {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const version = pkg.version || '0.0.0';
  // Always start from template so placeholder exists
  fs.copyFileSync(swTemplatePath, swPath);
  let sw = fs.readFileSync(swPath, 'utf8');
  sw = sw.replace(/__APP_VERSION__/g, version);
  fs.writeFileSync(swPath, sw);
  console.log(`[sw-version] Injected version ${version} into service worker`);
}

main();
