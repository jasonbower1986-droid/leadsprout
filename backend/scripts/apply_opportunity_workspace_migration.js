// Retained as an explicit compatibility entry point; all numbered migrations
// now execute through the canonical controlled runner.
require('./apply_migrations').main(process.argv.slice(2)).catch(error => {
  console.error(error.code || 'MIGRATION_FAILED');
  process.exitCode = 1;
});
