// Bun automatically loads .env (and .env.local) into process.env ... no dotenv needed.

export interface Env {
  baseUrl: string;
  token: string;
  port: number;
  /** Optional Linear personal API key. Absent = Linear metrics are skipped. */
  linearApiKey?: string;
}

export class EnvError extends Error {
  override readonly name = "EnvError";
}

/**
 * Validate and return required environment. Throws EnvError with a readable
 * message rather than crashing the process, so the route can surface a clean 500.
 */
export function getEnv(): Env {
  const rawBase = process.env.GITLAB_BASE_URL?.trim();
  const token = process.env.GITLAB_TOKEN?.trim();
  const port = Number(process.env.PORT ?? 8787);

  if (!rawBase) {
    throw new EnvError("GITLAB_BASE_URL is not set. Copy .env.example to .env and fill it in.");
  }
  if (!token || token.startsWith("glpat-xxxx")) {
    throw new EnvError(
      "GITLAB_TOKEN is not set (or is still the placeholder). Create a read_api PAT and put it in .env.",
    );
  }
  if (Number.isNaN(port)) {
    throw new EnvError(`PORT is not a number: ${process.env.PORT}`);
  }

  // Optional: ignore the placeholder so a copied-but-unedited .env behaves as "unset".
  const rawLinear = process.env.LINEAR_API_KEY?.trim();
  const linearApiKey =
    rawLinear && !rawLinear.startsWith("lin_api_xxxx") ? rawLinear : undefined;

  return { baseUrl: rawBase.replace(/\/+$/, ""), token, port, linearApiKey };
}
