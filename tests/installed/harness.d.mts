export function createHarness(options?: {
  cwd?: string;
  entry?: string;
}): Promise<{
  origin: string;
  directory: string;
  backend: string;
  credential: string;
  principals: { alice: string; bob: string };
  view(name?: string): string;
  api(path: string, body?: unknown, user?: string, method?: string): Promise<any>;
  restart(): Promise<void>;
  close(): Promise<void>;
  log(): string;
}>;
