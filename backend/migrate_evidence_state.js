/**
 * Evidence Integrity Migration
 * 
 * Adds the evidence_state column to the leads table for persisting
 * Evidence Integrity metadata across the lead lifecycle.
 * Run this once after deploying the Evidence Integrity Pipeline.
 */

const { dbQuery } = require('./database');

async function migrateEvidenceState() {
  console.log('Running Evidence Integrity migration...');
  
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
  
  console.log('Evidence Integrity migration complete.');
}

migrateEvidenceState().catch(console.error);