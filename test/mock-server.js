// Mock of the IUT SIS evaluation pages + API, for testing the extension without SIS access.
// Zero dependencies. Usage: node test/mock-server.js   (listens on http://localhost:8787)

const http = require("http");

const PORT = Number(process.env.PORT) || 8787;
const CSRF_TOKEN = "mock-csrf-token-123";
const XSRF_COOKIE_RAW = "mock-xsrf-token%3D%3D"; // URL-encoded, like Laravel; decodes to "mock-xsrf-token=="
const XSRF_TOKEN = decodeURIComponent(XSRF_COOKIE_RAW);

const QUESTION_COUNT = 36;
const TEXT_QUESTION_IDS = new Set([5, 7, 13, 18, 23, 27, 34, 35, 36]);

// Course 104 always fails with 422 so the "partial failure" path can be tested.
const COURSES = [
  { id: "101", name: "CSE 4401 - Algorithms" },
  { id: "102", name: "CSE 4403 - Databases" },
  { id: "103", name: "CSE 4405 - Networks" },
  { id: "104", name: "CSE 4407 - (mock: always rejected)" }
];
const FAILING_COURSE_ID = "104";

const submissions = []; // everything the API accepted

function listPage() {
  const rows = COURSES.map((course) => `
        <div class="course-action">
          <span>${course.name}</span>
          <a href="/evaluate-course/${course.id}">Evaluate</a>
        </div>`).join("");

  return `<!doctype html><html><head><meta charset="utf-8">
    <meta name="csrf-token" content="${CSRF_TOKEN}">
    <title>Mock SIS - Evaluation List</title></head>
    <body><h1>Mock SIS: Evaluation List</h1>${rows}
    <p><a href="/__submissions">View received submissions (JSON)</a></p></body></html>`;
}

function coursePage(id) {
  const course = COURSES.find((c) => c.id === id);
  const questions = Array.from({ length: QUESTION_COUNT }, (_, i) => {
    const n = i + 1;
    if (TEXT_QUESTION_IDS.has(n)) {
      return `<div class="q"><label>Q${n} (text)</label>
        <textarea class="form-control" data-q="${n}"></textarea></div>`;
    }
    const radios = [1, 2, 3, 4, 5].map((v) =>
      `<label><input type="radio" name="q${n}" value="${v}" data-q="${n}"> ${v}</label>`).join(" ");
    return `<div class="q"><label>Q${n}</label> ${radios}</div>`;
  }).join("\n");

  return `<!doctype html><html><head><meta charset="utf-8">
    <meta name="csrf-token" content="${CSRF_TOKEN}">
    <title>Mock SIS - Evaluate ${course ? course.name : id}</title></head>
    <body><h1>Mock SIS: ${course ? course.name : "Unknown course " + id}</h1>
    ${questions}
    <button id="mock-submit" type="button">Submit</button>
    <p id="mock-result"></p>
    <script>
      document.getElementById("mock-submit").addEventListener("click", async () => {
        const answers = [];
        for (let n = 1; n <= ${QUESTION_COUNT}; n++) {
          const text = document.querySelector('textarea[data-q="' + n + '"]');
          const radio = document.querySelector('input[data-q="' + n + '"]:checked');
          if (text) answers.push({ question_id: n, value: text.value });
          else if (radio) answers.push({ question_id: n, value: Number(radio.value) });
        }
        const out = document.getElementById("mock-result");
        if (answers.length !== ${QUESTION_COUNT} || answers.some((a) => a.value === "")) {
          out.textContent = "Validation failed: fill every question (got " + answers.length + ")";
          return;
        }
        // Like the real SIS front-end, send the XSRF cookie back as a header.
        const xsrf = decodeURIComponent((document.cookie.split("; ").find((c) => c.startsWith("XSRF-TOKEN=")) || "").slice(11));
        const res = await fetch("/api/course-evaluate", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-CSRF-TOKEN": "${CSRF_TOKEN}", "X-XSRF-TOKEN": xsrf },
          body: JSON.stringify({ course_allocation_detail_id: "${id}", answers })
        });
        out.textContent = "Server responded " + res.status;
        out.dataset.status = String(res.status);
      });
    </script></body></html>`;
}

function validate(payload, headers) {
  if (headers["x-csrf-token"] !== CSRF_TOKEN) return "Bad or missing X-CSRF-TOKEN header";
  if (headers["x-xsrf-token"] !== XSRF_TOKEN) return "Bad or missing X-XSRF-TOKEN header";
  if (!payload || !payload.course_allocation_detail_id) return "Missing course_allocation_detail_id";
  if (!Array.isArray(payload.answers) || payload.answers.length !== QUESTION_COUNT) {
    return `Expected ${QUESTION_COUNT} answers`;
  }
  for (const answer of payload.answers) {
    const isText = TEXT_QUESTION_IDS.has(answer.question_id);
    if (isText && (typeof answer.value !== "string" || answer.value === "")) {
      return `Question ${answer.question_id} needs non-empty text`;
    }
    if (!isText && !(Number.isInteger(answer.value) && answer.value >= 1 && answer.value <= 5)) {
      return `Question ${answer.question_id} needs a rating 1-5`;
    }
  }
  return null;
}

function send(res, status, type, body, extraHeaders = {}) {
  res.writeHead(status, { "Content-Type": type, ...extraHeaders });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const cookie = { "Set-Cookie": `XSRF-TOKEN=${XSRF_COOKIE_RAW}; Path=/` };

  if (req.method === "GET" && url.pathname.startsWith("/evaluation-list")) {
    return send(res, 200, "text/html", listPage(), cookie);
  }

  if (req.method === "GET" && url.pathname.startsWith("/evaluate-course/")) {
    const id = url.pathname.split("/").filter(Boolean).pop();
    return send(res, 200, "text/html", coursePage(id), cookie);
  }

  if (req.method === "GET" && url.pathname === "/__submissions") {
    return send(res, 200, "application/json", JSON.stringify(submissions, null, 2));
  }

  if (req.method === "DELETE" && url.pathname === "/__submissions") {
    submissions.length = 0;
    return send(res, 200, "application/json", '{"cleared":true}');
  }

  if (req.method === "POST" && url.pathname === "/api/course-evaluate") {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      let payload = null;
      try { payload = JSON.parse(raw); } catch (error) { /* handled below */ }

      const problem = validate(payload, req.headers);
      if (problem) {
        console.log(`  REJECTED (400): ${problem}`);
        return send(res, 400, "application/json", JSON.stringify({ message: problem }));
      }

      const courseId = String(payload.course_allocation_detail_id);
      if (courseId === FAILING_COURSE_ID) {
        console.log(`  REJECTED (422): course ${courseId} (mock failure)`);
        return send(res, 422, "application/json", JSON.stringify({ message: "Mock: this course always fails" }));
      }

      const ratings = new Set(payload.answers.filter((a) => !TEXT_QUESTION_IDS.has(a.question_id)).map((a) => a.value));
      const texts = new Set(payload.answers.filter((a) => TEXT_QUESTION_IDS.has(a.question_id)).map((a) => a.value));
      submissions.push({ courseId, ratings: [...ratings], texts: [...texts], at: new Date().toISOString() });
      console.log(`  ACCEPTED course ${courseId}: ratings=${JSON.stringify([...ratings])} feedback=${JSON.stringify([...texts])}`);
      return send(res, 200, "application/json", JSON.stringify({ message: "ok" }));
    });
    return;
  }

  send(res, 404, "text/plain", "Not found");
});

server.listen(PORT, () => {
  console.log(`Mock SIS running at http://localhost:${PORT}`);
  console.log(`  List page:   http://localhost:${PORT}/evaluation-list`);
  console.log(`  Course page: http://localhost:${PORT}/evaluate-course/101`);
  console.log(`  Received:    http://localhost:${PORT}/__submissions`);
});
