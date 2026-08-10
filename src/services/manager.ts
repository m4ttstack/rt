export const LABEL_PREFIX = "com.mattstack.local.";
/** Local itself. Apps are `${LABEL_PREFIX}<name>`; the platform is the bare prefix. */
export const PLATFORM_LABEL = "com.mattstack.local";

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
