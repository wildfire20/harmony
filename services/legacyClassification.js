const CLASSIFICATION_SOURCE = 'legacy_invoice_reconciliation';
const CORRECTION_SOURCE = 'legacy_classification_correction';

const metadataOf = (line) => {
  if (line?.metadata && typeof line.metadata === 'object') return line.metadata;
  if (typeof line?.metadata === 'string') {
    try { return JSON.parse(line.metadata); } catch (_) { return {}; }
  }
  return {};
};

const isInitialClassification = (line) => {
  const metadata = metadataOf(line);
  return String(line?.line_type || 'charge').toLowerCase() === 'charge' && (
    metadata.source === CLASSIFICATION_SOURCE ||
    metadata.legacy_reconciliation === true ||
    metadata.legacy_reconciliation === 'true'
  );
};

const isClassificationCorrection = (line) => {
  const metadata = metadataOf(line);
  return metadata.source === CORRECTION_SOURCE && (
    String(line?.line_type || '').toLowerCase() === 'classification_correction' ||
    (String(line?.line_type || '').toLowerCase() === 'charge' &&
      Boolean(line?.is_included ?? line?.included) && Number(line?.amount || 0) === 0)
  );
};

function resolveLegacyClassification(rawLines = []) {
  const lines = rawLines.map((line) => ({ ...line, metadata: metadataOf(line) }));
  const initial = lines.find(isInitialClassification);
  if (!initial) return { lines, initial: null, effective: null, corrections: [] };

  const corrections = lines
    .filter(isClassificationCorrection)
    .filter((line) => Number(line.metadata.target_line_id) === Number(initial.id))
    .sort((left, right) => Number(left.id || 0) - Number(right.id || 0));

  let category = String(initial.metadata.category || initial.service_key || '');
  let effective = initial;
  const validCorrections = [];
  corrections.forEach((correction) => {
    const metadata = correction.metadata;
    const previous = String(metadata.previous_category || '');
    const next = String(metadata.new_category || correction.service_key || '');
    if (!next || previous !== category) return;
    category = next;
    effective = correction;
    validCorrections.push(correction);
  });

  const effectiveMetadata = {
    ...initial.metadata,
    ...(effective === initial ? {} : effective.metadata),
    category,
    service_key: category,
    original_category: initial.metadata.category || initial.service_key || null,
    correction_count: validCorrections.length,
  };
  return {
    initial,
    effective,
    corrections: validCorrections,
    category,
    lines: lines.map((line) => Number(line.id) === Number(initial.id) ? {
      ...line,
      service_key: category,
      label: effective === initial ? line.label : (effective.label || line.label),
      metadata: effectiveMetadata,
      original_service_key: initial.service_key || null,
    } : line),
    metadata: effectiveMetadata,
  };
}

module.exports = {
  CLASSIFICATION_SOURCE,
  CORRECTION_SOURCE,
  isInitialClassification,
  isClassificationCorrection,
  resolveLegacyClassification,
};