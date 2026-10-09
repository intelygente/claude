// Bundles src/*.js into one file you can paste into the Apps Script editor.
// Usage: node build.js   ->   dist/QuoteAgent.gs
const fs = require('fs');
const path = require('path');
const order = ['Config.js', 'Core.js', 'Prompts.js', 'Claude.js', 'Main.js'];
const parts = order.map((f) => `// ===== ${f} =====\n` + fs.readFileSync(path.join(__dirname, 'src', f), 'utf8'));
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist', 'QuoteAgent.gs'), parts.join('\n\n'));
fs.copyFileSync(path.join(__dirname, 'src', 'appsscript.json'), path.join(__dirname, 'dist', 'appsscript.json'));
console.log('Wrote dist/QuoteAgent.gs and dist/appsscript.json');
