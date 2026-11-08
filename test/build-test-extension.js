// Builds a copy of the extension in test/dist that targets the local mock server
// instead of https://sis.iutoic-dhaka.edu. The real source files are not modified.
// Usage: node test/build-test-extension.js

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(__dirname, "dist");
const REAL_ORIGIN = "https://sis.iutoic-dhaka.edu";
const MOCK_ORIGIN = `http://localhost:${process.env.PORT || 8787}`;

const TEXT_FILES = ["manifest.json", "background.js", "contentScript.js", "popup.html", "script.js", "styles.css"];
const BINARY_FILES = ["images/logo.png"];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "images"), { recursive: true });

for (const file of TEXT_FILES) {
  const source = fs.readFileSync(path.join(ROOT, file), "utf8");
  fs.writeFileSync(path.join(OUT, file), source.split(REAL_ORIGIN).join(MOCK_ORIGIN));
}

for (const file of BINARY_FILES) {
  fs.copyFileSync(path.join(ROOT, file), path.join(OUT, file));
}

// Make it obvious in the browser's extension list that this is the test build.
const manifestPath = path.join(OUT, "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
manifest.name += " (TEST BUILD)";
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

console.log(`Test extension built at ${OUT}`);
console.log(`Targets ${MOCK_ORIGIN} instead of ${REAL_ORIGIN}`);
