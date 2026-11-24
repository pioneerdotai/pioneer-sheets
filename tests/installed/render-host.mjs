// Fixture for the installed-app HTTP boundary. Uses the real Sheets render page.
import { createServer } from "node:http";
import { chromium } from "playwright";

export async function openRenderHost(backend, executionCredential, credential) {
  const server = createServer(async (request, response) => {
    if (
      request.method !== "POST" ||
      request.url !== "/apps/host/render" ||
      request.headers.authorization !== "Bearer " + credential ||
      request.headers.origin
    ) {
      response.writeHead(403).end();
      return;
    }
    let browser;
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const job = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      browser = await chromium.launch();
      const page = await browser.newPage({
        viewport: { width: 1400, height: 1600 },
      });
      await page.route("**/*", (route) => {
        if (
          !route
            .request()
            .url()
            .startsWith(backend + "/")
        )
          return route.abort();
        return route.continue({
          headers: {
            ...route.request().headers(),
            "pioneer-app-execution-credential": executionCredential,
          },
        });
      });
      if (job.operation === "screenshot" && job.path === "/agent-render") {
        await page.goto(backend + job.path, { waitUntil: "domcontentloaded" });
        await page.waitForFunction(() => !!window.__pioneerRender);
        const size = await page.evaluate(
          (input) => window.__pioneerRender.prepare(input),
          job.input,
        );
        await page.setViewportSize(size);
        const { clip, metadata } = await page.evaluate(() =>
          window.__pioneerRender.capture(),
        );
        const png = await page.screenshot({ clip, type: "png" });
        response
          .writeHead(200, {
            "content-type": "image/png",
            "pioneer-render-metadata": Buffer.from(
              JSON.stringify(metadata),
            ).toString("base64url"),
          })
          .end(png);
      } else if (job.operation === "pdf") {
        await page.setContent(job.html, { waitUntil: "load" });
        await page.evaluate(() => document.fonts.ready);
        const pdf = await page.pdf({
          printBackground: true,
          preferCSSPageSize: true,
          tagged: true,
        });
        response.writeHead(200, { "content-type": "application/pdf" }).end(pdf);
      } else {
        response.writeHead(400).end();
      }
    } catch (error) {
      if (!response.headersSent) response.writeHead(502);
      response.end(String(error));
    } finally {
      await browser?.close();
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    endpoint: "ws://127.0.0.1:" + server.address().port + "/apps/host",
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
