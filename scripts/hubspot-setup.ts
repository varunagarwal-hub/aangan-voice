// One-time HubSpot setup: creates the custom contact/deal properties and prints your deal pipeline stages,
// so you can set HUBSPOT_PIPELINE / HUBSPOT_STAGE_* in .env if they differ from the defaults.
import { ensureProperties, listDealStages } from "../lib/integrations/hubspot";

(async () => {
  await ensureProperties();
  const p: any = await listDealStages();
  for (const pl of p.results ?? []) {
    console.log(`\nPipeline "${pl.label}" id=${pl.id}`);
    for (const s of pl.stages ?? []) console.log(`  stage "${s.label}" id=${s.id}`);
  }
})().catch((err) => { console.error(err); process.exit(1); });
