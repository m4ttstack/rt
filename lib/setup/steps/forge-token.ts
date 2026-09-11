/**
 * The forge token an Install step offers git for a remote: the sops store
 * when it exists, else what the checklist staged, since team.create,
 * team.join and repos.clone all run before secrets.write drains the stage.
 */

import { readSecret } from "../../secrets/store.ts";
import type { ApplyContext } from "../apply.ts";
import { readStagedSecret } from "../staging.ts";
import { forgeTokenLookup, mayOfferToken, tokenOrNull } from "../../team/forge-token.ts";
import { readUserIntegrationOverrides } from "../team-settings.ts";

/** Null when rt holds no token for the remote's host. */
export async function forgeTokenFor(ctx: ApplyContext, remote: string): Promise<string | null> {
  return tokenOrNull(
    await forgeTokenLookup(remote, {
      readStored: (d, k) => readSecret(d, k, ctx.secrets),
      readStaged: (d, k) => readStagedSecret(ctx.p, d, k),
    })
  );
}

/**
 * `forgeTokenFor` behind the confirmed-host gate, for remotes built from
 * team-store data (tracked identities, a declared forge host): the token is
 * offered only to an unspoofable forge or the one host the user confirmed
 * through `rt setup <forge> connect --host` — a joined team's own declaration
 * never qualifies on its own.
 */
export async function trustedForgeTokenFor(ctx: ApplyContext, remote: string): Promise<string | null> {
  const confirmedHost = readUserIntegrationOverrides().forgeHost ?? null;
  if (!mayOfferToken(remote, confirmedHost)) return null;
  return forgeTokenFor(ctx, remote);
}
