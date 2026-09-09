const db = require('../config/database');

const REQUIRED_PORTAL_TABLES = Object.freeze([
  'admissions_portal_tokens',
  'registration_records',
  'registration_checklist_items',
  'admissions_portal_documents',
]);

let portalSchemaReady = false;

async function isAdmissionsPortalSchemaReady(database = db) {
  const result = await database.query(`
    WITH required_columns(table_name, column_name) AS (
      VALUES
        ('admissions_portal_tokens', 'enrollment_id'),
        ('admissions_portal_tokens', 'purpose'),
        ('admissions_portal_tokens', 'token_hash'),
        ('admissions_portal_tokens', 'expires_at'),
        ('admissions_portal_tokens', 'revoked_at'),
        ('admissions_portal_tokens', 'last_used_at'),
        ('registration_records', 'enrollment_id'),
        ('registration_records', 'form_status'),
        ('registration_checklist_items', 'enrollment_id'),
        ('registration_checklist_items', 'item_type'),
        ('admissions_portal_documents', 'enrollment_id'),
        ('admissions_portal_documents', 'public_id')
    ),
    readiness AS (
      SELECT
        (SELECT COUNT(*) FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = ANY($1::text[])) AS tables_present,
        (SELECT COUNT(*) FROM required_columns required
          JOIN information_schema.columns columns
            ON columns.table_schema = 'public'
           AND columns.table_name = required.table_name
           AND columns.column_name = required.column_name) AS columns_present,
        (SELECT COUNT(*) FROM (VALUES
          ('idx_admissions_portal_tokens_enrollment'),
          ('idx_admissions_portal_tokens_one_active'),
          ('idx_registration_checklist_enrollment'),
          ('idx_admissions_portal_documents_enrollment')
        ) required(index_name)
        WHERE to_regclass('public.' || required.index_name) IS NOT NULL) AS indexes_present
    )
    SELECT tables_present, columns_present, indexes_present FROM readiness
  `, [REQUIRED_PORTAL_TABLES]);
  return Number(result.rows[0]?.tables_present) === REQUIRED_PORTAL_TABLES.length
    && Number(result.rows[0]?.columns_present) === 12
    && Number(result.rows[0]?.indexes_present) === 4;
}

async function requireAdmissionsPortalSchema(req, res, next) {
  if (portalSchemaReady) return next();
  try {
    portalSchemaReady = await isAdmissionsPortalSchemaReady();
    if (portalSchemaReady) return next();
  } catch (error) {
    console.error('Admissions portal schema readiness check failed');
  }
  return res.status(503).json({
    message: 'The secure admissions portal is temporarily unavailable.',
  });
}

module.exports = {
  REQUIRED_PORTAL_TABLES,
  isAdmissionsPortalSchemaReady,
  requireAdmissionsPortalSchema,
};