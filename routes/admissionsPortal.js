const express = require('express');
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

const router = express.Router();

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
          if (!CHECKLIST_ITEMS.has(itemType) || !['UPLOAD_LATER', 'BRING_IN_PERSON'].includes(choice)) {
            throw Object.assign(new Error('Invalid checklist choice.'), { status: 400 });
          }
          const update = await client.query(`
            UPDATE registration_checklist_items
            SET status = $3, parent_submission_choice = $4, updated_at = CURRENT_TIMESTAMP
            WHERE enrollment_id = $1 AND item_type = $2
              AND requested_at IS NOT NULL AND status <> 'RECEIVED'
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
        if (missingField || Number(unansweredChecklist.rows[0].count) > 0) {
          throw Object.assign(new Error('Requested information is incomplete.'), { status: 400 });
        }
        await client.query(`
          UPDATE registration_records
          SET application_update_submitted_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
          WHERE enrollment_id = $1 AND application_update_submitted_at IS NULL
        `, [tokenContext.enrollment_id]);
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

router.use((req, res) => res.status(404).json({ message: 'Secure portal endpoint not found.' }));

module.exports = router;
module.exports.APPLICATION_FIELDS = APPLICATION_FIELDS;