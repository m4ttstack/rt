export const LABEL_PREFIX = "com.mattstack.deck.";
/** Deck itself. Apps are `${LABEL_PREFIX}<name>`; the platform is the bare prefix. */
export const PLATFORM_LABEL = "com.mattstack.deck";
/** The platform's own registrar id, on its self-row (managedBy field) and route alias. */
export const PLATFORM_NAME = "deck";

/**
 * Pre-rename identity (Local -> Deck, ruled). Still recognized on read, so an
 * upgrading machine's self-row and self-agent are migrated rather than
 * orphaned: bootstrapSelf() boots the old label out and migrates the old
 * managedBy id the moment `deck setup` next runs (see registry/bootstrap.ts);
 * until then, "is this the platform" checks tolerate both ids.
 */
export const LEGACY_PLATFORM_LABEL_PREFIX = "com.mattstack.local.";
export const LEGACY_PLATFORM_LABEL = "com.mattstack.local";
export const LEGACY_PLATFORM_NAME = "local";

/** True for either the current or the pre-rename platform managedBy id. */
export function isPlatformManagedBy(managedBy: string): boolean {
  return managedBy === PLATFORM_NAME || managedBy === LEGACY_PLATFORM_NAME;
}

export interface ServiceSpec {
  label: string;
  programArguments: string[];
  workingDirectory: string;
  environment: Record<string, string>;
  stdoutPath: string;
  stderrPath: string;
}

/**
 * The supervision seam (ruled: macOS v1, Linux designed-for). launchd is the
 * only v1 implementation; a systemd user-unit impl is a fast-follow ticket,
 * not a rewrite, precisely because everything upstream talks to this interface.
 */
export interface ServiceManager {
  install(spec: ServiceSpec): Promise<void>;
  uninstall(label: string): Promise<void>;
  kickstart(label: string): Promise<boolean>;
  isInstalled(label: string): Promise<boolean>;
}
