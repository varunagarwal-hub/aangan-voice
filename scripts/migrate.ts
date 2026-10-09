// Applies lib/schema.ts to DATABASE_URL (Neon). Safe to run repeatedly.
import { migrate } from "../lib/db";

migrate().then(() => { console.log("Schema applied."); process.exit(0); })
  .catch((err) => { console.error(err); process.exit(1); });
