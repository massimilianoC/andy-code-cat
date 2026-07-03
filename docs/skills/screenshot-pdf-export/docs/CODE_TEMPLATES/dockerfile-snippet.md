# Docker — Chromium for Puppeteer

Puppeteer's own bundled Chromium download is large and can hit sandbox/permission issues in
constrained containers. Install the OS Chromium package instead and point Puppeteer at it. Apply
this in **every** stage of your Dockerfile that runs code calling `captureHtml`/`captureUrl` —
dev stage included, not just prod.

## Alpine-based images (`node:XX-alpine`)

```dockerfile
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
```

## Debian/Ubuntu-based images (`node:XX-slim`, `node:XX-bookworm`, etc.)

```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    libnss3 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libgbm1 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
```

(Package name/binary path vary slightly by distro version — verify with
`which chromium || which chromium-browser` inside the built image if the above doesn't resolve.)

## `npm install` env note

Because `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true` is set as an image `ENV`, it applies during
`npm install` too — Puppeteer's postinstall script will skip downloading its own Chromium,
keeping the image smaller. Make sure the `ENV` line comes **before** `npm install` / `npm ci` in
the Dockerfile, not after.

## Serverless / no OS package control (Lambda, Vercel Functions, etc.)

The above assumes you control the container image. If the target runtime doesn't allow installing
OS packages (e.g. AWS Lambda, Vercel serverless functions), use
[`@sparticuz/chromium`](https://github.com/Sparticuz/chromium) with `puppeteer-core` instead — it
ships a Lambda-compatible prebuilt Chromium binary. The rest of `capture-service.ts` is unchanged;
only the browser launch (`puppeteer.launch()` → `puppeteer-core.launch({ executablePath: await
chromium.executablePath(), args: chromium.args, ... })`) differs.

## Verifying the setup works

Before wiring any routes, run a throwaway script **inside the actual built container** (not just
locally) to confirm Chromium launches:

```js
// verify-puppeteer.js
const puppeteer = require("puppeteer");
(async () => {
    const browser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
    });
    const page = await browser.newPage();
    await page.setContent("<h1>ok</h1>");
    const buf = await page.screenshot({ type: "jpeg" });
    console.log("Screenshot bytes:", buf.length);
    await browser.close();
})();
```

```
docker run --rm your-image node verify-puppeteer.js
```

If this fails, the problem is the container/OS setup, not your feature code — fix it here before
building anything on top.
