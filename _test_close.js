// Test: does req.on("close") fire after express.json() + async work in Node 20?
const express = require("express");
const http = require("http");

const app = express();
app.use(express.json({ limit: "1mb" }));

app.post("/test", async (req, res) => {
    const t0 = Date.now();

    // Simulate resolveContext async work (DB call)
    await new Promise(r => setTimeout(r, 5));
    console.log("after async, req.destroyed=", req.destroyed);

    // Flush SSE headers (just like the real handler)
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    // Register close listener AFTER headers sent (same as production code)
    let closeFired = false;
    req.on("close", () => {
        closeFired = true;
        console.log("REQ CLOSE FIRED at T=" + (Date.now() - t0) + "ms");
    });
    console.log("close listener registered at T=" + (Date.now() - t0) + "ms, req.destroyed=", req.destroyed);

    // Wait a bit then check
    setTimeout(() => {
        console.log("50ms check: closeFired=", closeFired);
        res.write("data: {\"type\":\"thinking\",\"content\":\"test\"}\n\n");
    }, 50);

    setTimeout(() => {
        console.log("200ms check: closeFired=", closeFired);
        res.write("data: {\"type\":\"done\",\"result\":{}}\n\n");
        res.end();
        srv.close();
        process.exit(0);
    }, 200);
});

const srv = http.createServer(app);
srv.listen(9994, () => {
    console.log("Server listening on 9994");
    const req = http.request(
        { port: 9994, method: "POST", headers: { "content-type": "application/json" } },
        (r) => {
            r.on("data", (d) => console.log("CLIENT GOT:", d.toString().trim()));
            r.on("end", () => console.log("CLIENT END"));
        }
    );
    req.end(JSON.stringify({ message: "hello", pipelineRole: "dialogue", capability: "chat" }));
});
