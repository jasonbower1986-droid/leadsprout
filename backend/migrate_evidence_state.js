/**
 * Evidence Integrity Migration (ENG-AUTH-015 Gate 001)
 *
 * Adds the evidence_state column to the leads table for persisting
 * Evidence Integrity metadata and provenance state.
 * Run once after deploying Gate 001.
 */

const { dbQuery } = require('./database');

async function migrateEvidenceState() {
  console.log('Running Gate 001 migration: Evidence Integrity state column...');

  try {
    // Add evidence_state column to leads table
    await dbQuery.run("ALTER TABLE leads ADD COLUMN evidence_state TEXT DEFAULT NULL;");
    console.log('✅ Added evidence_state column to leads table');
  } catch (err) {
    // Column may already exist
    if (err.message && err.message.includes('duplicate column')) {
      console.log('ℹ️ evidence_state column already exists');
    } else {
      console.error('❌ Migration failed:', err.message);
      throw err;
    }
  }

  console.log('Gate 001 migration complete.');
}

migrateEvidenceState().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});