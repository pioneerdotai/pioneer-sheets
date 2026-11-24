import type { AppProfile } from "@pioneercompany/app-sdk/client";
import type { IdentityReference } from "../../shared/types";
import { getAppClient } from "./client";

interface Presentation {
  name: string;
  avatarUrl: string | null;
}

const profiles = new Map<string, Presentation>();
const requested = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

const key = ({ type, id }: IdentityReference) => `${type}:${id}`;

export const profilesVersion = () => version;
export function subscribeProfiles(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function notify() {
  version++;
  for (const listener of listeners) listener();
}

function remember(
  entries: readonly AppProfile[],
  avatarUrl: (profile: AppProfile) => string | null,
) {
  if (!entries.length) return;
  const avatars: { id: string; source: string; record: Presentation }[] = [];
  for (const profile of entries) {
    const id = key(profile);
    if (profiles.has(id)) continue;
    const record = {
      name: profile.displayName.trim() || profile.nickname.trim(),
      avatarUrl: null,
    };
    profiles.set(id, record);
    const source = avatarUrl(profile);
    if (source) avatars.push({ id, source, record });
  }
  notify();
  void loadAvatars(avatars);
}

async function loadAvatars(
  avatars: { id: string; source: string; record: Presentation }[],
) {
  // Keep one in-memory copy per identity, including when a cursor redraws.
  for (let offset = 0; offset < avatars.length; offset += 4) {
    const results = await Promise.all(avatars.slice(offset, offset + 4).map(
      async ({ id, source, record }) => {
        try {
          const response = await fetch(source, {
            credentials: "omit",
            redirect: "error",
            referrerPolicy: "no-referrer",
            signal: AbortSignal.timeout(15000),
          });
          if (!response.ok || !/^image\/(png|jpeg|webp)$/.test(response.headers.get("content-type") ?? "")) {
            await response.body?.cancel();
            return false;
          }
          const bytes = await response.blob();
          if (!bytes.size || bytes.size > 256 * 1024 || profiles.get(id) !== record) return false;
          record.avatarUrl = URL.createObjectURL(bytes);
          return true;
        } catch {
          return false;
        }
      },
    ));
    if (results.some(Boolean)) notify();
  }
}

export function identityPresentation(identity: IdentityReference) {
  const profile = profiles.get(key(identity));
  const label = identity.type === "agent" ? "Agent" : "User";
  const name = profile?.name || label;
  return {
    name,
    label: identity.type === "agent" && profile?.name ? `${name} · ${label}` : name,
    avatarUrl: profile?.avatarUrl ?? null,
  };
}

export async function loadViewerProfile() {
  try {
    const { profiles: api } = await getAppClient();
    const { self } = await api.resolve({ includeSelf: true });
    if (self) {
      requested.add(key(self));
      remember([self], api.avatarUrl);
    }
  } catch {
    // Profile data is optional for opening the workspace.
  }
}

export async function loadProfiles(identities: readonly IdentityReference[]) {
  const missing = identities.filter((identity) => {
    if (!/^[A-Za-z0-9]{21}$/.test(identity.id)) return false;
    const id = key(identity);
    if (requested.has(id)) return false;
    requested.add(id);
    return true;
  });
  for (let offset = 0; offset < missing.length; offset += 64) {
    const batch = missing.slice(offset, offset + 64);
    try {
      const { profiles: api } = await getAppClient();
      const result = await api.resolve({ identities: batch });
      remember(result.profiles, api.avatarUrl);
    } catch {
      for (const identity of batch) requested.delete(key(identity));
    }
  }
}
