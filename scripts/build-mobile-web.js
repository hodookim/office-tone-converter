const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "mobile-web");
const mobileEntry = path.join(root, "app-mobile.html");

const files = [
  "app.js",
  "mobile-app.css",
  "site-v2.css",
  "theme-init.js",
  "favicon.svg",
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

if (!fs.existsSync(mobileEntry)) {
  throw new Error("app-mobile.html is required for the Android bundle.");
}

fs.copyFileSync(mobileEntry, path.join(outDir, "index.html"));

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
