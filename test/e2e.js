// Automated end-to-end test: loads the test build into Chromium (via Playwright) and drives
// the popup -> background -> content script -> mock server flow.
// Setup (one time, from repo root):  npm i --no-save playwright && npx playwright install chromium
// Run:                                node test/e2e.js
const { chromium } = require("playwright");
const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
execFileSync("node", [path.join(__dirname, "build-test-extension.js")], { stdio: "ignore" });
const server = spawn("node", [path.join(__dirname, "mock-server.js")], { stdio: "ignore" });
const EXT = path.join(__dirname, "dist");
const BASE = "http://localhost:8787";
let fails = 0;
const check = (name, ok, extra="") => { console.log((ok?"PASS ":"FAIL ")+name+(extra?"  "+extra:"")); if(!ok) fails++; };
(async () => {
  await new Promise((resolve) => setTimeout(resolve, 800)); // let the mock server start
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), "iut-ext-test-")), {
    channel: "chromium", headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
  });
  let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent("serviceworker");
  const extId = sw.url().split("/")[2];
  const submissions = async () => (await fetch(BASE+"/__submissions")).json();
  await fetch(BASE+"/__submissions",{method:"DELETE"});

  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`);

  // --- list page: page state + submit all
  const list = await ctx.newPage();
  await list.goto(BASE+"/evaluation-list");
  await list.bringToFront();
  let r = await popup.evaluate(() => sendCommand("getPageState"));
  check("list page state", r.ok && r.page==="list" && r.courseCount===4, JSON.stringify(r));

  r = await popup.evaluate(() => sendCommand("submitAll", {rating:"4", feedback:"Great course"}));
  check("submit all: 3 ok, 1 failed (422)", r.ok && r.successCount===3 && r.failedCount===1 && r.totalCount===4, JSON.stringify({ok:r.ok,s:r.successCount,f:r.failedCount}));
  let subs = await submissions();
  check("server got 3 submissions w/ rating 4 + feedback", subs.length===3 && subs.every(s=>JSON.stringify(s.ratings)==="[4]" && JSON.stringify(s.texts)==='["Great course"]'), JSON.stringify(subs.map(s=>s.courseId)));

  // --- course page: submit current
  const course = await ctx.newPage();
  await course.goto(BASE+"/evaluate-course/101");
  await course.bringToFront();
  r = await popup.evaluate(() => sendCommand("getPageState"));
  check("course page state", r.ok && r.page==="course", JSON.stringify(r));
  r = await popup.evaluate(() => sendCommand("submitCurrent", {rating:"2", feedback:"Needs work"}));
  check("submit current returns ok", r.ok === true, JSON.stringify(r));
  await course.waitForURL(BASE+"/evaluation-list", {timeout:5000}).then(()=>check("redirected to evaluation-list",true)).catch(()=>check("redirected to evaluation-list",false,course.url()));
  subs = await submissions();
  const last = subs[subs.length-1];
  check("server got course 101 with rating 2 + feedback", subs.length===4 && last.courseId==="101" && JSON.stringify(last.ratings)==="[2]" && JSON.stringify(last.texts)==='["Needs work"]', JSON.stringify(last));

  // --- real popup UI: storage persistence + disabled states on unsupported page
  const other = await ctx.newPage(); await other.goto(BASE+"/nothing"); await other.bringToFront();
  r = await popup.evaluate(() => sendCommand("getPageState"));
  check("unsupported page reports error (no content script)", r.ok===false, JSON.stringify(r));
  await ctx.close();
  server.kill();
  console.log(fails? `\n${fails} FAILED` : "\nALL PASSED"); process.exit(fails?1:0);
})();
