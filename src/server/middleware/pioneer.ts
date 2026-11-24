import { isDraining } from "../../client/pioneer/lifecycle";
import { defineHandler } from "nitro";
import { authenticateService, development } from "#sheets-authority";

function reject(request: Request, response: Response) {
  // Nitro resolves upgrades via crossws hooks and otherwise loses an early
  // middleware response. Use crossws' public request handoff so denied HTTP
  // requests cannot become an empty, unauthenticated WebSocket connection.
  if (request.headers.get("upgrade")?.toLowerCase() === "websocket")
    Object.assign(request, {
      [Symbol.for("crossws.hooks")]: { upgrade: () => response },
    });
  return response;
}

// Development serves the page and Vite assets directly. Data and socket routes
// use the same authenticated Gateway requests as the installed app.
export default defineHandler(async (event) => {
  if (isDraining())
    return reject(
      event.req,
      new Response("Application stopping", { status: 503 }),
    );
  if (development) {
    const { pathname } = new URL(event.req.url);
    if (pathname !== "/api" && !pathname.startsWith("/api/") &&
        pathname !== "/collaboration" && pathname !== "/collaboration/") return;
  }
  try {
    await authenticateService(event.req.headers);
  } catch {
    return reject(
      event.req,
      new Response("Pioneer execution credential required", {
        status: 401,
        headers: { "Cache-Control": "no-store" },
      }),
    );
  }
});
