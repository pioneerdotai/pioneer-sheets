import type { AppServerContext } from "@pioneercompany/app-sdk/server";
import { identity, type Identity } from "../../shared/types.ts";
import { ServiceError } from "../documents/error.ts";

export function appAuthority(getContext: () => Promise<AppServerContext>) {
  async function authenticateService(headers: Headers) {
    const app = await getContext();
    try {
      app.authenticateServiceRequest({
        get: (name) => headers.get(name) ?? undefined,
      });
    } catch {
      throw new ServiceError(401, "PIONEER_EXECUTION_REQUIRED");
    }
    return app;
  }

  async function pioneerIdentity(
    headers: Headers,
    agent = false,
  ): Promise<Identity> {
    const app = await authenticateService(headers);
    try {
      const user = app.authenticateRequest({
        get: (name) => headers.get(name) ?? undefined,
      }).user;
      if (!agent)
        return identity(
          headers.get("pioneer-app-user-name") || "User",
          user.id,
        );
      const id = headers.get("pioneer-app-agent-id");
      if (!id || !/^[A-Za-z0-9_-]{1,128}$/.test(id))
        throw new ServiceError(400, "PIONEER_AGENT_ID_REQUIRED");
      return identity(
        headers.get("pioneer-app-agent-name") || "Agent",
        id,
        "agent",
      );
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw new ServiceError(403, "PIONEER_USER_REQUIRED");
    }
  }

  return { authenticateService, pioneerIdentity };
}
