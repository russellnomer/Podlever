/** scripts/run-startup-migrations.ts — manual runner for lib/startup-migrations (testing/ops) */
import { runStartupMigrations } from "../lib/startup-migrations";
runStartupMigrations().then(() => process.exit(0));
