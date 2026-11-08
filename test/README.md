# Testing without SIS access

`mock-server.js` imitates the SIS pages and API on `http://localhost:8787`.
`build-test-extension.js` makes a copy of the extension in `test/dist` that talks to that
mock server instead of `https://sis.iutoic-dhaka.edu`. Your real source files are not changed.
Requires Node 18+.

## Manual test in Brave / Chrome / Edge

1. Start the mock site (leave it running):

   ```sh
   node test/mock-server.js
   ```

2. In a second terminal, build the test extension (re-run after any code change):

   ```sh
   node test/build-test-extension.js
   ```

3. Open `brave://extensions` (or `chrome://extensions`), enable **Developer mode**, click
   **Load unpacked**, and select the **`test/dist`** folder. It is named
   "IUT Course Evaluation Helper (TEST BUILD)". After a rebuild, click the reload icon on it.
   Disable or remove the normal build while testing, to avoid two copies.
4. Pin the extension.

### Test cases

| # | Steps | Expected |
|---|-------|----------|
| 1 | Open `http://localhost:8787/evaluation-list`, click the extension icon | Popup says "4 course links found"; **Evaluate All** enabled, **Fill & Submit Current** disabled |
| 2 | Pick rating 4, feedback "Great course", click **Evaluate All Listed Courses** | Popup: "Submitted 3/4 courses. 1 failed." (course 104 is rigged to fail with 422). Server terminal shows 3 ACCEPTED lines with rating 4 and your feedback, 1 REJECTED |
| 3 | Open `http://localhost:8787/evaluate-course/101`, click the icon | Popup says "Ready to submit this course"; **Fill & Submit Current** enabled, **Evaluate All** disabled |
| 4 | Pick rating 2, feedback "Needs work", click **Fill & Submit Current Course** | Form fills, page says "Server responded 200", tab returns to `/evaluation-list` after ~1s. Server terminal shows ACCEPTED course 101 with rating 2 |
| 5 | Close and reopen the popup | Last rating and feedback are remembered |
| 6 | Open `http://localhost:8787/evaluate-course/104`, fill & submit | Page says "Server responded 422" (error path) |
| 7 | Open any other tab (e.g. `about:blank`), click the icon | Popup says to open an SIS evaluation page; both buttons disabled |
| 8 | Visit `http://localhost:8787/__submissions` | JSON list of everything the server accepted. `DELETE` on the same URL clears it |

If test 1 shows "Open an IUT SIS evaluation page", reload the mock page. The extension was
probably loaded after the tab was opened.

## Automated test (optional)

Runs cases 1-4 and 7 in a real Chromium through Playwright and prints PASS/FAIL:

```sh
npm i --no-save playwright
npx playwright install chromium
node test/e2e.js
```

Note: Playwright's bundled Chromium is used because recent branded Chrome builds ignore
the `--load-extension` flag that automation needs. The manual steps above work in any browser.
