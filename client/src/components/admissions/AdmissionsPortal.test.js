import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AdmissionsPortal from './AdmissionsPortal';
import { admissionsPortalApi } from '../../services/admissionsPortalApi';

jest.mock('../../services/admissionsPortalApi', () => ({
  admissionsPortalApi: {
    getSession: jest.fn(),
    saveApplication: jest.fn(),
    submitApplication: jest.fn(),
    saveRegistration: jest.fn(),
    submitRegistration: jest.fn(),
  },
  portalErrorMessage: jest.fn(() => 'This secure link is no longer available. Please contact Harmony Learning Institute for assistance.'),
}));

jest.mock('../common/HarmonyLogo', () => () => <div>Harmony Learning Institute</div>);

const registrationSession = {
  mode: 'COMPLETE_REGISTRATION',
  access: 'read_only',
  expiresAt: '2026-10-01T00:00:00.000Z',
  application: {
    reference: 'HLI-2027-0001',
    status: 'REGISTRATION_PENDING',
    parent: { firstName: 'Parent', lastName: 'One', email: 'parent@example.com', phone: '0123456789' },
    learner: { firstName: 'Learner', lastName: 'One', dateOfBirth: '2018-01-01', gradeApplying: 'Grade 1' },
    previousSchool: '',
    additionalNotes: '',
  },
  requestedFields: [],
  checklist: [],
  registration: {
    formStatus: 'SUBMITTED',
    residentialAddress: { addressLine1: '1 Main Road', city: 'Lephalale' },
    postalAddress: {},
    emergencyContact: { fullName: 'Emergency Contact', relationship: 'Parent', phone: '0123456789' },
    serviceSelections: { boarding: false, transport: true, aftercare: false },
    confirmedAt: '2026-09-09T00:00:00.000Z',
    submittedAt: '2026-09-09T00:00:00.000Z',
  },
};

let container;
let root;

beforeAll(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  jest.clearAllMocks();
});

const renderAt = async (path) => {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/registration/:token" element={<AdmissionsPortal />} />
          <Route path="/application/update/:token" element={<AdmissionsPortal />} />
        </Routes>
      </MemoryRouter>,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const clickButton = async (label) => {
  const button = [...container.querySelectorAll('button')]
    .find((candidate) => candidate.textContent.trim() === label);
  expect(button).toBeTruthy();
  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

test('renders submitted registration as read-only without write actions', async () => {
  admissionsPortalApi.getSession.mockResolvedValue({ data: registrationSession });
  await renderAt('/registration/safe-test-token');

  expect(container.textContent).toMatch(/currently being reviewed by Harmony Learning Institute/i);
  expect(container.textContent).toContain('Learner One');
  expect(container.textContent).not.toMatch(/Submit registration/i);
  expect(admissionsPortalApi.saveRegistration).not.toHaveBeenCalled();
});

test('shows a generic unavailable state when route and token purpose do not match', async () => {
  admissionsPortalApi.getSession.mockResolvedValue({
    data: { ...registrationSession, mode: 'UPDATE_APPLICATION', access: 'edit' },
  });

  await renderAt('/registration/safe-test-token');

  expect(container.textContent).toMatch(/This secure link is unavailable/i);
  expect(container.textContent).toMatch(/contact Harmony Learning Institute for assistance/i);
});

test('saves the current registration draft before final submission', async () => {
  admissionsPortalApi.getSession.mockResolvedValue({
    data: {
      ...registrationSession,
      access: 'edit',
      application: { ...registrationSession.application, status: 'APPROVED' },
      registration: {
        ...registrationSession.registration,
        formStatus: 'IN_PROGRESS',
        postalAddress: { sameAsResidential: true },
        submittedAt: null,
      },
    },
  });
  admissionsPortalApi.saveRegistration.mockResolvedValue({ data: { saved: true } });
  admissionsPortalApi.submitRegistration.mockResolvedValue({ data: { submitted: true } });

  await renderAt('/registration/safe-test-token');
  await clickButton('Submit registration');

  expect(admissionsPortalApi.saveRegistration).toHaveBeenCalledTimes(1);
  expect(admissionsPortalApi.submitRegistration).toHaveBeenCalledTimes(1);
  expect(admissionsPortalApi.saveRegistration.mock.invocationCallOrder[0])
    .toBeLessThan(admissionsPortalApi.submitRegistration.mock.invocationCallOrder[0]);
});

test('saves requested application values before submitting the update', async () => {
  admissionsPortalApi.getSession.mockResolvedValue({
    data: {
      ...registrationSession,
      mode: 'UPDATE_APPLICATION',
      access: 'edit',
      application: {
        ...registrationSession.application,
        status: 'MORE_INFORMATION_REQUIRED',
        parent: { ...registrationSession.application.parent, phone: '0123456789' },
      },
      requestedFields: ['parentPhone'],
      checklist: [{
        itemType: 'BIRTH_CERTIFICATE',
        status: 'MISSING',
        parentChoice: 'BRING_IN_PERSON',
      }],
      registration: null,
    },
  });
  admissionsPortalApi.saveApplication.mockResolvedValue({ data: { saved: true } });
  admissionsPortalApi.submitApplication.mockResolvedValue({ data: { submitted: true } });

  await renderAt('/application/update/safe-test-token');
  await clickButton('Submit update');

  expect(admissionsPortalApi.saveApplication).toHaveBeenCalledWith(
    'safe-test-token',
    {
      fields: { parentPhone: '0123456789' },
      checklistChoices: { BIRTH_CERTIFICATE: 'BRING_IN_PERSON' },
    },
  );
  expect(admissionsPortalApi.saveApplication.mock.invocationCallOrder[0])
    .toBeLessThan(admissionsPortalApi.submitApplication.mock.invocationCallOrder[0]);
});