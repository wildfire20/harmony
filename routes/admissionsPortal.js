const express = require('express');
const multer = require('multer');
const {
  portalReadLimiter,
  portalWriteLimiter,
  securePortalHeaders,
  tokenSafeRequestLogger,
} = require('../middleware/admissionsPortalSecurity');
const { requireAdmissionsPortalSchema } = require('../middleware/admissionsPortalSchema');
const {
  PORTAL_ACCESS,
  TOKEN_PURPOSES,
  PortalTokenError,
  withValidatedPortalToken,
} = require('../services/admissionsPortalTokenService');
const {
  MAX_FILE_SIZE,
  validateAdmissionsFile,
  uploadAdmissionsDocument,
  deleteAdmissionsDocument,
} = require('../services/admissionsDocumentService');
const { notifyAdmissionsAdmins } = require('../services/admissionsNotificationService');

const router = express.Router();
const admissionsUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
});

const INVALID_LINK_MESSAGE = 'This secure link is invalid or no longer available.';
const APPLICATION_FIELDS = Object.freeze({
  parentEmail: 'parent_email',
  parentPhone: 'parent_phone',
  previousSchool: 'previous_school',
  additionalNotes: 'additional_notes',
});
const CHECKLIST_ITEMS = new Set([
  'BIRTH_CERTIFICATE',
  'PARENT_GUARDIAN_ID',
  'LATEST_SCHOOL_REPORT',
  'TRANSFER_DOCUMENT',
  'REGISTRATION_FORM',
]);
const ADDRESS_FIELDS = new Set([
  'addressLine1', 'addressLine2', 'suburb', 'city', 'province', 'postalCode', 'sameAsResidential',
]);
const EMERGENCY_FIELDS = new Set(['fullName', 'relationship', 'phone']);
const SERVICE_FIELDS = new Set(['boarding', 'transport', 'aftercare']);

router.use(securePortalHeaders);
router.use(tokenSafeRequestLogger);
router.use(portalReadLimiter);
router.use((req, res, next) => (
  ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)
    ? portalWriteLimiter(req, res, next)
    : next()
));
router.use(requireAdmissionsPortalSchema);

const rejectUnknownKeys = (value, allowed, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Object.assign(new Error(`${label} must be an object`), { status: 400 });
  }
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw Object.assign(new Error(`Unsupported ${label} field`), { status: 400 });
};

const cleanStrings = (value, allowed, limits, label) => {
  rejectUnknownKeys(value, allowed, label);
  return Object.fromEntries(Object.entries(value).map(([key, raw]) => {
    if (typeof raw === 'boolean' && key === 'sameAsResidential') return [key, raw];
    if (typeof raw !== 'string') throw Object.assign(new Error(`Invalid ${label} value`), { status: 400 });
    const cleaned = raw.trim();
    if (cleaned.length > (limits[key] || 200)) {
      throw Object.assign(new Error(`${label} value is too long`), { status: 400 });
    }
    return [key, cleaned];
  }));
};

const cleanServices = (value) => {
  rejectUnknownKeys(value, SERVICE_FIELDS, 'service');
  return Object.fromEntries(Object.entries(value).map(([key, selected]) => {
    if (typeof selected !== 'boolean') {
      throw Object.assign(new Error('Service selections must be true or false'), { status: 400 });
    }
    return [key, selected];
  }));
};

const getSafeSession = async (client, tokenContext) => {
  const result = await client.query(`
    SELECT
      e.application_reference, e.status, e.parent_first_name, e.parent_last_name,
      e.parent_email, e.parent_phone, e.student_first_name, e.student_last_name,
      e.student_date_of_birth, e.grade_applying, e.boarding_option, e.previous_school,
      e.additional_notes,
      rr.form_status, rr.residential_address, rr.postal_address, rr.emergency_contact,
      rr.service_selections, rr.requested_application_fields, rr.confirmed_at, rr.submitted_at,
      COALESCE(json_agg(json_build_object(
        'itemType', ci.item_type, 'status', ci.status, 'parentChoice', ci.parent_submission_choice
      ) ORDER BY ci.item_type) FILTER (WHERE ci.id IS NOT NULL), '[]') AS checklist
    FROM enrollments e
    LEFT JOIN registration_records rr ON rr.enrollment_id = e.id
    LEFT JOIN registration_checklist_items ci
      ON ci.enrollment_id = e.id AND ci.requested_at IS NOT NULL
    WHERE e.id = $1
    GROUP BY e.id, rr.id
  `, [tokenContext.enrollment_id]);
  const row = result.rows[0];
  return {
    mode: tokenContext.purpose === TOKEN_PURPOSES.UPDATE_APPLICATION
      ? 'UPDATE_APPLICATION'
      : 'COMPLETE_REGISTRATION',
    access: tokenContext.access,
    expiresAt: tokenContext.expires_at,
    application: {
      reference: row.application_reference,
      status: row.status,
      parent: {
        firstName: row.parent_first_name,
        lastName: row.parent_last_name,
        email: row.parent_email,
        phone: row.parent_phone,
      },
      learner: {
        firstName: row.student_first_name,
        lastName: row.student_last_name,
        dateOfBirth: row.student_date_of_birth,
        gradeApplying: row.grade_applying,
      },
      boardingOption: row.boarding_option,
      previousSchool: row.previous_school,
      additionalNotes: row.additional_notes,
    },
    requestedFields: Array.isArray(row.requested_application_fields)
      ? row.requested_application_fields
      : [],
    checklist: row.checklist || [],
    registration: {
      formStatus: row.form_status || 'NOT_STARTED',
      residentialAddress: row.residential_address || {},
      postalAddress: row.postal_address || {},
      emergencyContact: row.emergency_contact || {},
      serviceSelections: row.service_selections || {},
      confirmedAt: row.confirmed_at,
      submittedAt: row.submitted_at,
    },
  };
};

const sendPortalError = (res, error) => {
  if (error instanceof PortalTokenError) {
    return res.status(404).json({ message: INVALID_LINK_MESSAGE });
  }
  if (error.status === 400 || error.status === 409) {
    return res.status(error.status).json({ message: error.message });
  }
  console.error('Admissions portal request failed');
  return res.status(500).json({ message: 'The secure portal request could not be completed.' });
};

router.get('/session/:token', async (req, res) => {
  try {
    const data = await withValidatedPortalToken(req.params.token, {
      requireEdit: false,
      action: getSafeSession,
    });
    return res.json(data);
  } catch (error) {
    return sendPortalError(res, error);
  }
});

router.patch('/application/:token', async (req, res) => {
  try {
    const fields = req.body?.fields || {};
    const checklistChoices = req.body?.checklistChoices || {};
    rejectUnknownKeys(req.body || {}, new Set(['fields', 'checklistChoices']), 'request');
    rejectUnknownKeys(fields, new Set(Object.keys(APPLICATION_FIELDS)), 'application');
    rejectUnknownKeys(checklistChoices, CHECKLIST_ITEMS, 'checklist');
    if (!Object.keys(fields).length && !Object.keys(checklistChoices).length) {
      throw Object.assign(new Error('No application updates were provided.'), { status: 400 });
    }

    const result = await withValidatedPortalToken(req.params.token, {
      action: async (client, tokenContext) => {
        if (tokenContext.purpose !== TOKEN_PURPOSES.UPDATE_APPLICATION) {
          throw new PortalTokenError('TOKEN_NOT_ELIGIBLE');
        }
        const requestResult = await client.query(`
          SELECT requested_application_fields
          FROM registration_records
          WHERE enrollment_id = $1
        `, [tokenContext.enrollment_id]);
        const requested = requestResult.rows[0]?.requested_application_fields || [];
        const fieldEntries = Object.entries(fields);
        if (fieldEntries.some(([key]) => !requested.includes(key))) {
          throw Object.assign(new Error('Only information requested by Harmony may be updated.'), { status: 400 });
        }
        for (const [key, value] of fieldEntries) {
          if (typeof value !== 'string' || value.trim().length > (key === 'additionalNotes' ? 2000 : 255)) {
            throw Object.assign(new Error('Invalid application update value.'), { status: 400 });
          }
          if (key === 'parentEmail' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
            throw Object.assign(new Error('A valid parent email is required.'), { status: 400 });
          }
          if (key === 'parentPhone' && (value.trim().length < 10 || value.trim().length > 50)) {
            throw Object.assign(new Error('A valid parent phone number is required.'), { status: 400 });
          }
        }
        if (fieldEntries.length) {
          const assignments = fieldEntries.map(([key], index) => `${APPLICATION_FIELDS[key]} = $${index + 2}`);
          await client.query(`
            UPDATE enrollments
            SET ${assignments.join(', ')}, updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
          `, [tokenContext.enrollment_id, ...fieldEntries.map(([, value]) => value.trim() || null)]);
        }

        const choices = Object.entries(checklistChoices);
        for (const [itemType, choice] of choices) {
          if (!CHECKLIST_ITEMS.has(itemType) || !['UPLOAD_ONLINE', 'BRING_IN_PERSON'].includes(choice)) {
            throw Object.assign(new Error('Invalid checklist choice.'), { status: 400 });
          }
          const update = await client.query(`
            UPDATE registration_checklist_items
            SET status = $3, parent_submission_choice = $4, updated_at = CURRENT_TIMESTAMP
            WHERE enrollment_id = $1 AND item_type = $2
              AND requested_at IS NOT NULL
              AND status NOT IN ('RECEIVED', 'NOT_APPLICABLE')
              AND (
                $4 <> 'BRING_IN_PERSON'
                OR NOT EXISTS (
                  SELECT 1 FROM admissions_portal_documents d
                  WHERE d.checklist_item_id = registration_checklist_items.id
                    AND d.deleted_at IS NULL
                    AND d.superseded_by_document_id IS NULL
                )
              )
            RETURNING id
          `, [
            tokenContext.enrollment_id,
            itemType,
             choice === 'BRING_IN_PERSON' ? 'BRING_IN_PERSON' : 'MISSING',
            choice,
          ]);
          if (!update.rows.length) {
            throw Object.assign(new Error('Only requested checklist items may be updated.'), { status: 400 });
          }
        }
        return { saved: true };
      },
    });
    return res.json(result);
  } catch (error) {
    return sendPortalError(res, error);
  }
});

router.post('/application/:token/submit', async (req, res) => {
  try {
    const result = await withValidatedPortalToken(req.params.token, {
      action: async (client, tokenContext) => {
        if (tokenContext.purpose !== TOKEN_PURPOSES.UPDATE_APPLICATION) {
          throw new PortalTokenError('TOKEN_NOT_ELIGIBLE');
        }
        const requestResult = await client.query(`
          SELECT rr.requested_application_fields, rr.application_update_submitted_at,
                 e.parent_email, e.parent_phone, e.previous_school, e.additional_notes
          FROM registration_records rr
          JOIN enrollments e ON e.id = rr.enrollment_id
          WHERE rr.enrollment_id = $1
          FOR UPDATE OF rr
        `, [tokenContext.enrollment_id]);
        const request = requestResult.rows[0];
        if (!request) {
          throw Object.assign(new Error('No requested information is available to submit.'), { status: 400 });
        }
        if (request.application_update_submitted_at) {
          return { submitted: true, alreadySubmitted: true, statusChanged: false };
        }
        const requestedFields = request.requested_application_fields || [];
        const missingField = requestedFields.some((field) => {
          const column = APPLICATION_FIELDS[field];
          return !column || request[column] === null || String(request[column]).trim() === '';
        });
        const unansweredChecklist = await client.query(`
          SELECT COUNT(*)::int AS count
          FROM registration_checklist_items
          WHERE enrollment_id = $1
            AND requested_at IS NOT NULL
            AND parent_submission_choice IS NULL
            AND status NOT IN ('RECEIVED', 'NOT_APPLICABLE')
        `, [tokenContext.enrollment_id]);
        const missingOnlineUpload = await client.query(`
          SELECT COUNT(*)::int AS count
          FROM registration_checklist_items ci
          WHERE ci.enrollment_id = $1
            AND ci.requested_at IS NOT NULL
            AND ci.parent_submission_choice = 'UPLOAD_ONLINE'
            AND ci.status NOT IN ('RECEIVED', 'NOT_APPLICABLE')
            AND NOT EXISTS (
              SELECT 1 FROM admissions_portal_documents d
              WHERE d.checklist_item_id = ci.id
                AND d.deleted_at IS NULL
                AND d.superseded_by_document_id IS NULL
            )
        `, [tokenContext.enrollment_id]);
        if (
          missingField
          || Number(unansweredChecklist.rows[0].count) > 0
          || Number(missingOnlineUpload.rows[0].count) > 0
        ) {
          throw Object.assign(new Error('Requested information is incomplete.'), { status: 400 });
        }
        await client.query(`
          UPDATE registration_records
          SET application_update_submitted_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
          WHERE enrollment_id = $1 AND application_update_submitted_at IS NULL
        `, [tokenContext.enrollment_id]);
        await notifyAdmissionsAdmins({
          enrollmentId: tokenContext.enrollment_id,
          event: 'INFORMATION_SUBMITTED',
          eventKey: `token-${tokenContext.token_id}`,
        }, client);
        const inPersonItems = await client.query(`
          SELECT item_type FROM registration_checklist_items
          WHERE enrollment_id = $1
            AND requested_at IS NOT NULL
            AND parent_submission_choice = 'BRING_IN_PERSON'
        `, [tokenContext.enrollment_id]);
        for (const item of inPersonItems.rows) {
          await notifyAdmissionsAdmins({
            enrollmentId: tokenContext.enrollment_id,
            event: 'BRING_IN_PERSON_SELECTED',
            checklistItem: item.item_type,
            eventKey: `token-${tokenContext.token_id}`,
          }, client);
        }
        const submittedDocuments = await client.query(`
          SELECT ci.item_type
          FROM registration_checklist_items ci
          JOIN admissions_portal_documents d ON d.checklist_item_id = ci.id
          WHERE ci.enrollment_id = $1 AND ci.requested_at IS NOT NULL
            AND d.deleted_at IS NULL AND d.superseded_by_document_id IS NULL
        `, [tokenContext.enrollment_id]);
        if (submittedDocuments.rows.length > 1) {
          await notifyAdmissionsAdmins({
            enrollmentId: tokenContext.enrollment_id,
            event: 'DOCUMENTS_SUBMITTED',
            documentCount: submittedDocuments.rows.length,
            checklistItems: submittedDocuments.rows.map((row) => row.item_type),
            eventKey: `token-${tokenContext.token_id}`,
          }, client);
        }
        return { submitted: true, alreadySubmitted: false, statusChanged: false };
      },
    });
    return res.json(result);
  } catch (error) {
    return sendPortalError(res, error);
  }
});

const parseRegistrationBody = (body) => {
  rejectUnknownKeys(body || {}, new Set([
    'residentialAddress', 'postalAddress', 'emergencyContact', 'serviceSelections', 'confirmed',
  ]), 'registration');
  const parsed = {};
  if (body.residentialAddress !== undefined) {
    parsed.residentialAddress = cleanStrings(body.residentialAddress, ADDRESS_FIELDS, {}, 'residential address');
  }
  if (body.postalAddress !== undefined) {
    parsed.postalAddress = cleanStrings(body.postalAddress, ADDRESS_FIELDS, {}, 'postal address');
  }
  if (body.emergencyContact !== undefined) {
    parsed.emergencyContact = cleanStrings(body.emergencyContact, EMERGENCY_FIELDS, { phone: 50 }, 'emergency contact');
  }
  if (body.serviceSelections !== undefined) parsed.serviceSelections = cleanServices(body.serviceSelections);
  if (body.confirmed !== undefined && typeof body.confirmed !== 'boolean') {
    throw Object.assign(new Error('Confirmation must be true or false.'), { status: 400 });
  }
  if (body.confirmed !== undefined) parsed.confirmed = body.confirmed;
  if (!Object.keys(parsed).length) throw Object.assign(new Error('No registration updates were provided.'), { status: 400 });
  return parsed;
};

const saveRegistration = async (client, tokenContext, parsed) => {
  if (tokenContext.purpose !== TOKEN_PURPOSES.COMPLETE_REGISTRATION) {
    throw new PortalTokenError('TOKEN_NOT_ELIGIBLE');
  }
  const existing = await client.query(`
    SELECT residential_address, postal_address, emergency_contact, service_selections, confirmed_at
    FROM registration_records WHERE enrollment_id = $1
  `, [tokenContext.enrollment_id]);
  const current = existing.rows[0] || {};
  await client.query(`
    INSERT INTO registration_records (
      enrollment_id, form_status, residential_address, postal_address,
      emergency_contact, service_selections, confirmed_at, started_at
    ) VALUES ($1, 'IN_PROGRESS', $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
    ON CONFLICT (enrollment_id) DO UPDATE SET
      form_status = 'IN_PROGRESS',
      residential_address = EXCLUDED.residential_address,
      postal_address = EXCLUDED.postal_address,
      emergency_contact = EXCLUDED.emergency_contact,
      service_selections = EXCLUDED.service_selections,
      confirmed_at = EXCLUDED.confirmed_at,
      started_at = COALESCE(registration_records.started_at, CURRENT_TIMESTAMP),
      updated_at = CURRENT_TIMESTAMP
  `, [
    tokenContext.enrollment_id,
    parsed.residentialAddress ?? current.residential_address ?? {},
    parsed.postalAddress ?? current.postal_address ?? {},
    parsed.emergencyContact ?? current.emergency_contact ?? {},
    parsed.serviceSelections ?? current.service_selections ?? {},
    parsed.confirmed === undefined
      ? current.confirmed_at
      : parsed.confirmed ? new Date() : null,
  ]);
};

router.patch('/registration/:token', async (req, res) => {
  try {
    const parsed = parseRegistrationBody(req.body || {});
    const result = await withValidatedPortalToken(req.params.token, {
      action: async (client, tokenContext) => {
        await saveRegistration(client, tokenContext, parsed);
        return { saved: true, formStatus: 'IN_PROGRESS' };
      },
    });
    return res.json(result);
  } catch (error) {
    return sendPortalError(res, error);
  }
});

router.post('/registration/:token/submit', async (req, res) => {
  try {
    rejectUnknownKeys(req.body || {}, new Set(), 'request');
    const result = await withValidatedPortalToken(req.params.token, {
      requireEdit: false,
      action: async (client, tokenContext) => {
        if (tokenContext.purpose !== TOKEN_PURPOSES.COMPLETE_REGISTRATION) {
          throw new PortalTokenError('TOKEN_NOT_ELIGIBLE');
        }
        const registration = await client.query(`
          SELECT form_status, residential_address, emergency_contact, confirmed_at, submitted_at
          FROM registration_records WHERE enrollment_id = $1 FOR UPDATE
        `, [tokenContext.enrollment_id]);
        const record = registration.rows[0];
        if (
          tokenContext.enrollment_status === 'REGISTRATION_PENDING'
          && record?.form_status === 'SUBMITTED'
        ) {
          return { submitted: true, alreadySubmitted: true, status: 'REGISTRATION_PENDING' };
        }
        if (!record || record.form_status === 'SUBMITTED') {
          throw Object.assign(new Error('Registration cannot be submitted in its current state.'), { status: 409 });
        }
        if (
          !record.residential_address?.addressLine1
          || !record.residential_address?.city
          || !record.emergency_contact?.fullName
          || !record.emergency_contact?.phone
          || !record.confirmed_at
        ) {
          throw Object.assign(new Error('Required registration information is incomplete.'), { status: 400 });
        }
        if (!['APPROVED', 'approved'].includes(tokenContext.enrollment_status)) {
          throw new PortalTokenError('TOKEN_NOT_ELIGIBLE');
        }
        await client.query(`
          UPDATE registration_records
          SET form_status = 'SUBMITTED',
              submitted_at = COALESCE(submitted_at, CURRENT_TIMESTAMP),
              updated_at = CURRENT_TIMESTAMP
          WHERE enrollment_id = $1
        `, [tokenContext.enrollment_id]);
        await client.query(`
          UPDATE enrollments
          SET status = 'REGISTRATION_PENDING', updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
        `, [tokenContext.enrollment_id]);
        await notifyAdmissionsAdmins({
          enrollmentId: tokenContext.enrollment_id,
          event: 'REGISTRATION_SUBMITTED',
          eventKey: `token-${tokenContext.token_id}`,
        }, client);
        await client.query(`
          INSERT INTO enrollment_status_history
            (enrollment_id, previous_status, new_status, changed_by, parent_message)
          VALUES ($1, $2, 'REGISTRATION_PENDING', NULL, NULL)
        `, [tokenContext.enrollment_id, tokenContext.enrollment_status]);
        return { submitted: true, alreadySubmitted: false, status: 'REGISTRATION_PENDING' };
      },
    });
    return res.json(result);
  } catch (error) {
    return sendPortalError(res, error);
  }
});

const documentError = (res, error) => {
  if (error instanceof PortalTokenError) return sendPortalError(res, error);
  if (error instanceof multer.MulterError || error.status === 400 || error.status === 409 || error.status === 503) {
    return res.status(error.status || 400).json({ message: error.message });
  }
  console.error('Admissions document request failed');
  return res.status(500).json({ message: 'The admissions document request could not be completed.' });
};

const documentListAction = async (client, tokenContext) => {
  const result = await client.query(`
    SELECT d.public_id, d.original_filename, d.content_type, d.file_size, d.review_status,
      d.rejection_reason, d.uploaded_at, ci.item_type, d.scan_status, d.sha256
    FROM admissions_portal_documents d
    LEFT JOIN registration_checklist_items ci ON ci.id = d.checklist_item_id
    WHERE d.enrollment_id = $1
      AND d.deleted_at IS NULL AND d.superseded_by_document_id IS NULL
    ORDER BY d.uploaded_at DESC
  `, [tokenContext.enrollment_id]);
  const checklist = await client.query(`
    SELECT item_type, status, requested_at
    FROM registration_checklist_items
    WHERE enrollment_id = $1 AND requested_at IS NOT NULL
    ORDER BY item_type
  `, [tokenContext.enrollment_id]);
  return {
    documents: result.rows.map((row) => ({
      publicId: row.public_id, originalFilename: row.original_filename, contentType: row.content_type,
      fileSize: Number(row.file_size), reviewStatus: row.review_status, scanStatus: row.scan_status,
      rejectionReason: row.rejection_reason, sha256: row.sha256,
      uploadedAt: row.uploaded_at, itemType: row.item_type,
    })),
    checklist: checklist.rows.map((row) => ({
      itemType: row.item_type,
      status: row.status,
      documentState: result.rows.some((doc) => doc.item_type === row.item_type)
        ? (result.rows.find((doc) => doc.item_type === row.item_type).review_status === 'PENDING'
          ? 'UPLOADED_PENDING_REVIEW'
          : result.rows.find((doc) => doc.item_type === row.item_type).review_status)
        : row.status,
    })),
  };
};

router.get('/application/:token/documents', async (req, res) => {
  try {
    return res.json(await withValidatedPortalToken(req.params.token, {
      requireEdit: false,
      action: async (client, tokenContext) => {
        if (tokenContext.purpose !== TOKEN_PURPOSES.UPDATE_APPLICATION) {
          throw new PortalTokenError('TOKEN_NOT_ELIGIBLE');
        }
        return documentListAction(client, tokenContext);
      },
    }));
  } catch (error) { return documentError(res, error); }
});

router.post('/application/:token/documents', admissionsUpload.single('file'), async (req, res) => {
  let uploadedKey;
  try {
    const detected = validateAdmissionsFile(req.file);
    const itemType = typeof req.body?.itemType === 'string' ? req.body.itemType : '';
    if (!CHECKLIST_ITEMS.has(itemType) || itemType === 'REGISTRATION_FORM') {
      throw Object.assign(new Error('A valid requested checklist item is required.'), { status: 400 });
    }
    const result = await withValidatedPortalToken(req.params.token, {
      action: async (client, tokenContext) => {
        if (tokenContext.purpose !== TOKEN_PURPOSES.UPDATE_APPLICATION) {
          throw new PortalTokenError('TOKEN_NOT_ELIGIBLE');
        }
        const requested = await client.query(`
          SELECT id, status, parent_submission_choice FROM registration_checklist_items
          WHERE enrollment_id = $1 AND item_type = $2 AND requested_at IS NOT NULL
          FOR UPDATE
        `, [tokenContext.enrollment_id, itemType]);
        const checklist = requested.rows[0];
        if (!checklist || checklist.status === 'RECEIVED' || checklist.status === 'NOT_APPLICABLE') {
          throw Object.assign(new Error('This checklist item is not eligible for upload.'), { status: 409 });
        }
        const replacesPublicId = typeof req.body?.replacesPublicId === 'string'
          ? req.body.replacesPublicId : null;
        let replacedDocument = null;
        if (replacesPublicId) {
          const replaced = await client.query(`
            SELECT id, public_id, review_status
            FROM admissions_portal_documents
            WHERE public_id = $1 AND enrollment_id = $2 AND checklist_item_id = $3
              AND deleted_at IS NULL AND superseded_by_document_id IS NULL
            FOR UPDATE
          `, [replacesPublicId, tokenContext.enrollment_id, checklist.id]);
          if (!replaced.rows.length) {
            throw Object.assign(new Error('The document to replace was not found.'), { status: 404 });
          }
          replacedDocument = replaced.rows[0];
          if (replacedDocument.review_status === 'RECEIVED' || checklist.status === 'RECEIVED') {
            throw Object.assign(new Error('A received document cannot be replaced.'), { status: 409 });
          }
          await client.query(
            'UPDATE admissions_portal_documents SET replaced_at = CURRENT_TIMESTAMP WHERE id = $1',
            [replacedDocument.id],
          );
        } else {
          const activeDocument = await client.query(`
            SELECT id FROM admissions_portal_documents
            WHERE enrollment_id = $1 AND checklist_item_id = $2
              AND deleted_at IS NULL AND superseded_by_document_id IS NULL
            LIMIT 1
          `, [tokenContext.enrollment_id, checklist.id]);
          if (activeDocument.rows.length) {
            throw Object.assign(new Error('Replace the existing document instead of adding another.'), { status: 409 });
          }
        }
        const publicId = require('node:crypto').randomUUID();
        const stored = await uploadAdmissionsDocument({
          buffer: req.file.buffer, contentType: detected.mime,
          publicId, originalFilename: req.file.originalname,
        });
        uploadedKey = stored.key;
        const inserted = await client.query(`
          INSERT INTO admissions_portal_documents
            (public_id, enrollment_id, checklist_item_id, storage_key, original_filename, content_type,
             detected_content_type, sha256, file_size, upload_source, scan_status, review_status)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PARENT_ONLINE', 'NOT_SCANNED', 'PENDING')
          RETURNING id, public_id, original_filename, content_type, file_size, review_status, uploaded_at
        `, [publicId, tokenContext.enrollment_id, checklist.id, stored.key, stored.originalFilename, stored.contentType, stored.detectedContentType, stored.sha256, stored.fileSize]);
        if (replacedDocument) {
          await client.query(`
            UPDATE admissions_portal_documents
            SET superseded_by_document_id = $1
            WHERE id = $2
          `, [inserted.rows[0].id, replacedDocument.id]);
        }
        await client.query(`
          UPDATE registration_checklist_items
          SET parent_submission_choice = 'UPLOAD_ONLINE',
              status = 'MISSING',
              received_at = NULL,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
        `, [checklist.id]);
        await notifyAdmissionsAdmins({
          enrollmentId: tokenContext.enrollment_id,
          event: replacedDocument ? 'DOCUMENT_REPLACED' : 'DOCUMENT_UPLOADED',
          documentPublicId: publicId,
          checklistItem: itemType,
        }, client);
        const document = inserted.rows[0];
        return { document: {
          publicId: document.public_id,
          originalFilename: document.original_filename,
          contentType: document.content_type,
          fileSize: Number(document.file_size),
          reviewStatus: document.review_status,
          uploadedAt: document.uploaded_at,
          itemType,
          documentState: 'UPLOADED_PENDING_REVIEW',
        } };
      },
    });
    return res.status(201).json(result);
  } catch (error) {
    if (uploadedKey) await deleteAdmissionsDocument(uploadedKey);
    return documentError(res, error);
  }
});

const removeDocument = async (req, res) => {
  let oldKey;
  try {
    const result = await withValidatedPortalToken(req.params.token, {
      action: async (client, tokenContext) => {
        if (tokenContext.purpose !== TOKEN_PURPOSES.UPDATE_APPLICATION) {
          throw new PortalTokenError('TOKEN_NOT_ELIGIBLE');
        }
        const existing = await client.query(`
          SELECT d.*, ci.item_type, ci.id AS checklist_item_id
          FROM admissions_portal_documents d
          LEFT JOIN registration_checklist_items ci ON ci.id = d.checklist_item_id
          WHERE d.public_id = $1 AND d.enrollment_id = $2
            AND d.deleted_at IS NULL AND d.superseded_by_document_id IS NULL
          FOR UPDATE OF d
        `, [req.params.publicId, tokenContext.enrollment_id]);
        if (!existing.rows.length) throw Object.assign(new Error('Document not found.'), { status: 404 });
        const doc = existing.rows[0];
        oldKey = doc.storage_key;
        if (doc.review_status === 'RECEIVED') {
          throw Object.assign(new Error('A received document cannot be removed.'), { status: 409 });
        }
        await client.query(
          'UPDATE admissions_portal_documents SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1',
          [doc.id],
        );
        await client.query(`
          UPDATE registration_checklist_items
          SET parent_submission_choice = NULL, status = 'MISSING',
              received_at = NULL, updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND status <> 'RECEIVED'
        `, [doc.checklist_item_id]);
        return { removed: true };
      },
    });
    if (oldKey) await deleteAdmissionsDocument(oldKey);
    return res.json(result);
  } catch (error) {
    return documentError(res, error);
  }
};

router.delete('/application/:token/documents/:publicId', removeDocument);

router.use((req, res) => res.status(404).json({ message: 'Secure portal endpoint not found.' }));

module.exports = router;
module.exports.APPLICATION_FIELDS = APPLICATION_FIELDS;