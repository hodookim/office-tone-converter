const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "mobile-web");

const files = [
  "index.html",
  "styles.css",
  "app.js",
  "favicon.svg",
  "manifest.webmanifest",
  "llms.txt",
  "about.html",
  "contact.html",
  "privacy.html",
  "terms.html",
  "office-phrases.html",
  "business-email-tips.html",
  "polite-reminder.html",
];

const directories = ["assets"];

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

for (const file of files) {
  const source = path.join(root, file);
  if (!fs.existsSync(source)) continue;
  fs.copyFileSync(source, path.join(outDir, file));
}

for (const directory of directories) {
  const source = path.join(root, directory);
  const target = path.join(outDir, directory);
  if (!fs.existsSync(source)) continue;
  fs.cpSync(source, target, { recursive: true });
}

console.log(`Mobile web bundle written to ${outDir}`);
