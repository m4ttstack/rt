import { buildFlavor, processFlavor } from "../lib/flavor.ts";
import { bold, cyan, dim, green, reset, yellow } from "../lib/tui.ts";

declare const RT_VERSION: string;

export async function runVersion(_args: string[]): Promise<void> {
  const version = (typeof RT_VERSION !== "undefined" ? RT_VERSION : null) ?? process.env.RT_VERSION ?? "dev";

  console.log(`\n  ${bold}${cyan}rt${reset}  ${version}`);

  if (processFlavor() === "dev") {
    const where = buildFlavor() === "dev" ? import.meta.dir.replace(/\/commands$/, "") : process.execPath;
    console.log(`  ${yellow}dev${reset}  ${dim}mattstack-dev.app · ${where}${reset}`);
  } else {
    console.log(`  ${green}prod${reset}  ${dim}mattstack.app · ${process.execPath}${reset}`);
  }

  console.log("");
}
