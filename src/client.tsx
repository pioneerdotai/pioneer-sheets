import "./pioneer-capabilities";
import "./client/pioneer/client";
import { startTransition } from "react";
import { hydrateRoot } from "react-dom/client";
import { StartClient } from "@tanstack/react-start/client";

startTransition(() => {
  hydrateRoot(document, <StartClient />);
});
