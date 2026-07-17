const REQUIRED_CANONICAL_FIELDS = Object.freeze([
  'item_kind', 'source_namespace', 'subject_business_id', 'source_locator',
  'observed_at', 'content_sha256', 'provenance_record_id'
]);

function classifyLegacyEvidence(record) {
  const missing = REQUIRED_CANONICAL_FIELDS.filter(field => record == null || record[field] == null || record[field] === '');
  if (!record || !Buffer.isBuffer(record.evidence_bytes)) missing.push('evidence_bytes');
  return {
    status: missing.length ? 'UNMAPPED_LEGACY_EVIDENCE' : 'READY_FOR_CANONICAL_VALIDATION',
    missing: [...new Set(missing)]
  };
}

async function backfillLegacyEvidence(records, service, context = {}) {
  const results = [];
  for (const record of records) {
    const classification = classifyLegacyEvidence(record);
    if (classification.status !== 'READY_FOR_CANONICAL_VALIDATION') {
      results.push({ legacy_reference: record && record.legacy_reference || null, ...classification });
      continue;
    }
    const { evidence_bytes, legacy_reference, ...canonicalInput } = record;
    try {
      const issued = await service.issue(canonicalInput, {
        ...context,
        evidenceBytes: evidence_bytes,
        reason: `Controlled legacy backfill${legacy_reference ? ` for ${legacy_reference}` : ''}.`
      });
      results.push({ legacy_reference: legacy_reference || null, status: issued.created ? 'ISSUED' : 'EXISTING', evidence_id: issued.record.evidence_id });
    } catch (error) {
      results.push({ legacy_reference: legacy_reference || null, status: 'CANONICAL_VALIDATION_FAILED', reason_code: error.code || 'UNKNOWN' });
    }
  }
  return results;
}

module.exports = { REQUIRED_CANONICAL_FIELDS, classifyLegacyEvidence, backfillLegacyEvidence };
