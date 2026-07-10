const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const contentPages = [
  "index.html",
  "guides.html",
  "office-phrases.html",
  "business-email-tips.html",
  "polite-reminder.html",
  "polite-refusal.html",
  "schedule-coordination.html",
  "vendor-follow-up.html",
  "constructive-feedback.html",
  "customer-response.html",
  "about.html",
  "contact.html",
  "privacy.html",
  "terms.html",
];

const errors = [];

function textContent(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z0-9#]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function count(pattern, value) {
  return (value.match(pattern) || []).length;
}

for (const file of contentPages) {
  const fullPath = path.join(root, file);
  if (!fs.existsSync(fullPath)) {
    errors.push(`${file}: file is missing`);
    continue;
  }

  const html = fs.readFileSync(fullPath, "utf8");
  const text = textContent(html);
  const koreanChars = count(/[가-힣]/g, text);

  if (!/<title>[^<]+<\/title>/i.test(html)) errors.push(`${file}: title is missing`);
  if (!/<meta\s+name="description"\s+content="[^"]+"/i.test(html)) errors.push(`${file}: meta description is missing`);
  if (!/<link\s+rel="canonical"\s+href="[^"]+"/i.test(html)) errors.push(`${file}: canonical link is missing`);
  if (count(/<h1(?:\s[^>]*)?>/gi, html) !== 1) errors.push(`${file}: expected exactly one h1`);
  if (/[—–]/.test(html)) errors.push(`${file}: contains a forbidden long dash`);
  if (/광고 승인 후|준비 중인 사이트|공사 중/.test(text)) errors.push(`${file}: contains unfinished-site wording`);
  if (html.includes("�")) errors.push(`${file}: contains a replacement character`);

  if (file.includes("-") && file !== "index.html" && koreanChars < 900) {
    errors.push(`${file}: article is too short (${koreanChars} Korean characters)`);
  }

  for (const match of html.matchAll(/href="\.\/([^"#?]+\.html)"/g)) {
    const target = path.join(root, match[1]);
    if (!fs.existsSync(target)) errors.push(`${file}: broken local link to ${match[1]}`);
  }

  for (const match of html.matchAll(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/gi)) {
    try {
      JSON.parse(match[1]);
    } catch (error) {
      errors.push(`${file}: invalid JSON-LD (${error.message})`);
    }
  }

  console.log(`${file.padEnd(34)} text=${String(text.length).padStart(5)} ko=${String(koreanChars).padStart(5)}`);
}

const sitemap = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8");
for (const file of contentPages) {
  const url = file === "index.html" ? "https://office-tone-converter.vercel.app/" : `https://office-tone-converter.vercel.app/${file}`;
  if (!sitemap.includes(`<loc>${url}</loc>`)) errors.push(`sitemap.xml: missing ${url}`);
}

if (errors.length) {
  console.error("\nSite content check failed:\n- " + errors.join("\n- "));
  process.exit(1);
}

console.log(`\nPASS ${contentPages.length} public pages`);
