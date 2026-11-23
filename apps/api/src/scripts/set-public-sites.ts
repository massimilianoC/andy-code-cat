/**
 * Sets how published sites are addressed (PlatformConfig.publicSites) — the same write as the
 * "Published sites" card in /admin/config, for a deploy or an installer run where the panel is not
 * at hand. It validates with the same schema as the panel, so it refuses what the panel refuses.
 *
 * Usage (inside the api container):
 *   node apps/api/dist/scripts/set-public-sites.js path https://sites.example.com
 *   node apps/api/dist/scripts/set-public-sites.js path            (sites on the API origin)
 *   node apps/api/dist/scripts/set-public-sites.js subdomain example.com
 *
 * Nothing is migrated: deployments store only /p/{publishId} and their slug, so every existing
 * site takes the new address immediately.
 */
import { publicSitesConfigSchema } from "@andy-code-cat/contracts";
import { closeDb } from "../infra/db/mongo";
import { MongoPlatformConfigRepository } from "../infra/repositories/MongoPlatformConfigRepository";
import { resolvePublicSitesConfig } from "../application/publish/publicSiteAddress";

async function run() {
    const [urlMode, value = ""] = process.argv.slice(2);
    const parsed = publicSitesConfigSchema.safeParse(
        urlMode === "subdomain" ? { urlMode, publicDomain: value } : { urlMode, sitesOrigin: value },
    );
    if (!parsed.success) {
        throw new Error(
            `Usage: set-public-sites path [<sites origin>] | set-public-sites subdomain <domain> — ${parsed.error.issues.map((i) => i.message).join("; ")}`,
        );
    }

    const repository = new MongoPlatformConfigRepository();
    const before = resolvePublicSitesConfig(await repository.get());
    const updated = await repository.upsert({ publicSites: parsed.data });
    const after = resolvePublicSitesConfig(updated);
    console.log(`[set-public-sites] before: ${JSON.stringify(before)}`);
    console.log(`[set-public-sites] after:  ${JSON.stringify(after)}`);
}

run()
    .then(async () => {
        await closeDb();
    })
    .catch(async (error) => {
        console.error("[set-public-sites] failed:", error instanceof Error ? error.message : error);
        await closeDb().catch(() => undefined);
        process.exit(1);
    });
