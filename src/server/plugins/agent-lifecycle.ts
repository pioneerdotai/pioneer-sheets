import { shutdownOfficeService } from "../runtime";
import { beginDrain } from "../../client/pioneer/lifecycle";
import { closePioneerContext } from "#sheets-authority";
import { shutdownFileServices } from "../files/service";
import { shutdownExchangeServices } from "../exchange/service";
import { definePlugin } from "nitro";
import { shutdownAgentRuntimes } from "../agent/manager";

export default definePlugin((nitro) => {
  // Stop upgraded connections before the HTTP server waits for them to close.
  process.once("SIGTERM", beginDrain);
  process.once("SIGINT", beginDrain);
  nitro.hooks.hook("close", async () => {
    beginDrain();
    shutdownFileServices();
    shutdownExchangeServices();
    shutdownAgentRuntimes();
    await shutdownOfficeService();
    await closePioneerContext();
  });
});
