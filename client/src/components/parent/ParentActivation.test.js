import fs from 'fs';
import path from 'path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import ParentActivation from './ParentActivation';

const mockNavigate = jest.fn();
let mockSelfActivationEnabled = true;
global.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock('react-router-dom', () => {
  const actual = jest.requireActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});
jest.mock('../../contexts/AppConfigContext', () => ({
  useAppConfig: () => ({ parentSelfActivationEnabled: mockSelfActivationEnabled, configLoading: false }),
}));

const source = fs.readFileSync(path.join(__dirname, 'ParentActivation.js'), 'utf8');
const accountSource = fs.readFileSync(path.join(__dirname, 'ParentAccount.js'), 'utf8');

test('self activation uses the three requested stages and parent-friendly wording', () => {
  expect(source).toMatch(/Registered mobile number/);
  expect(source).toMatch(/Confirm email address/);
  expect(source).toMatch(/account recovery/);
  expect(source).toMatch(/school, learner, and payment notices/);
  expect(source).toMatch(/six-digit email verification code/i);
  expect(source).toMatch(/Resend code in/);
  expect(source).toMatch(/Confirm password/);
  expect(source).toMatch(/Forgot Password/);
});

test('self activation does not request legacy identity or child verification details', () => {
  expect(source).not.toMatch(/learner number|date of birth|\bDOB\b|parent id|security question|student number/i);
  expect(source).toMatch(/activation\/validate/);
  expect(source).toMatch(/tokenMode \? '\/api\/parent\/activate' : COMPLETE_PATH/);
});

test('self activation posts request, verify, then complete with credentials', () => {
  const requestIndex = source.indexOf('REQUEST_PATH');
  const verifyIndex = source.indexOf('VERIFY_PATH');
  const completeIndex = source.indexOf('COMPLETE_PATH');
  expect(requestIndex).toBeLessThan(verifyIndex);
  expect(verifyIndex).toBeLessThan(completeIndex);
  expect(source.match(/credentials: ['"]include['"]/g)).toHaveLength(4);
  expect(source).toMatch(/storage\.setItem\('parentToken'/);
  expect(source).toMatch(/storage\.setItem\('parentUser'/);
  expect(source).toMatch(/storage\.setItem\('parentChildren'/);
  expect(source).toMatch(/storage\.setItem\('parentChild'/);
  expect(source).toMatch(/localStorage\.setItem\('parentSelectedChildId'/);
});

test('verified completion capability is sent only with the final activation request', async () => {
  const responses = [
    { challenge_id: 42 },
    { challenge_id: 42, completion_token: 'verified-completion-capability' },
    {
      token: 'parent-access-token',
      user: { id: 10, first_name: 'Parent' },
      children: [{ id: 501, first_name: 'Learner' }],
      child: { id: 501, first_name: 'Learner' },
    },
  ];
  global.fetch = jest.fn(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(responses.shift()),
  }));

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const change = async (selector, value) => {
    await act(async () => {
      const input = container.querySelector(selector);
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };
  const submit = async () => {
    const form = container.querySelector('form');
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await new Promise(resolve => setTimeout(resolve, 0));
    });
  };

  await act(async () => {
    root.render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><ParentActivation /></MemoryRouter>);
  });
  await change('#activation-mobile', '073 123 4567');
  await change('#activation-email', 'parent@example.com');
  await change('#activation-email-confirmation', 'parent@example.com');
  await submit();
  expect(container.querySelector('#activation-otp')).not.toBeNull();

  await change('#activation-otp', '123456');
  await submit();
  expect(container.querySelector('#activation-password')).not.toBeNull();

  await change('#activation-password', 'SecurePassword1');
  await change('#activation-password-confirmation', 'SecurePassword1');
  await submit();

  expect(global.fetch).toHaveBeenCalledTimes(3);
  const verifyBody = JSON.parse(global.fetch.mock.calls[1][1].body);
  const completeBody = JSON.parse(global.fetch.mock.calls[2][1].body);
  expect(verifyBody.completion_token).toBeUndefined();
  expect(completeBody.completion_token).toBe('verified-completion-capability');
  expect(mockNavigate).toHaveBeenCalledWith('/parent/dashboard', { replace: true });
  await act(async () => { root.unmount(); });
  container.remove();
});

test('self activation uses the Parent navy, teal and white palette', () => {
  expect(source).toMatch(/bg-\[#17324d\]/);
  expect(source).toMatch(/bg-\[#2c7475\]/);
  expect(source).toMatch(/bg-white/);
  expect(source).not.toMatch(/bg-(blue|indigo|violet)-|from-(blue|indigo|violet)-|via-(blue|indigo|violet)-|to-(blue|indigo|violet)-/i);
});

test('account presents registered contact details as read-only information', () => {
  expect(accountSource).toMatch(/Mobile number/);
  expect(accountSource).toMatch(/Registered/);
  expect(accountSource).toMatch(/Email/);
  expect(accountSource).toMatch(/Verified/);
  expect(accountSource).toMatch(/read-only/);
  expect(accountSource).not.toMatch(/type=["']tel["']/i);
});

describe('school-provided activation links', () => {
  let container;
  let root;
  beforeEach(() => {
    mockSelfActivationEnabled = false;
    mockNavigate.mockClear();
    sessionStorage.clear();
    localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    mockSelfActivationEnabled = true;
    delete global.fetch;
  });
  const render = async (url = '/parent/activate?token=school-link') => {
    await act(async () => {
      root.render(<MemoryRouter initialEntries={[url]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><ParentActivation /></MemoryRouter>);
    });
  };
  const change = async (selector, value) => {
    await act(async () => {
      const input = container.querySelector(selector);
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const submit = async () => {
    await act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  };

  test('validates masked identity and activates without email even with self-activation disabled', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ valid: true, identity: { name: 'Ada P.', phone: '********567' } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({
        token: 'access-token', user: { id: 10, email: null }, children: [{ id: 501 }], child: { id: 501 },
      }) });
    await render();
    expect(fetch.mock.calls[0][0]).toBe('/api/parent/activation/validate?token=school-link');
    expect(fetch.mock.calls[0][1]).toMatchObject({ cache: 'no-store', referrerPolicy: 'no-referrer' });
    expect(container.textContent).toContain('Ada P.');
    expect(container.textContent).toContain('********567');
    expect(container.querySelector('#activation-email')).toBeNull();
    expect(container.querySelector('#activation-otp')).toBeNull();
    await change('#activation-password', 'SecurePassword1');
    await change('#activation-password-confirmation', 'DifferentPassword1');
    await submit();
    expect(container.textContent).toContain('Passwords do not match.');
    expect(fetch).toHaveBeenCalledTimes(1);
    await change('#activation-password-confirmation', 'SecurePassword1');
    await submit();
    expect(fetch.mock.calls[1][0]).toBe('/api/parent/activate');
    expect(fetch.mock.calls[1][1].credentials).toBe('include');
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({
      token: 'school-link', password: 'SecurePassword1', password_confirmation: 'SecurePassword1',
    });
    expect(sessionStorage.getItem('parentToken')).toBe('access-token');
    expect(JSON.parse(sessionStorage.getItem('parentUser')).email).toBeNull();
    expect(JSON.parse(sessionStorage.getItem('parentChild')).id).toBe(501);
    expect(JSON.stringify({ ...sessionStorage, ...localStorage })).not.toMatch(/school-link|SecurePassword1/);
    expect(mockNavigate).toHaveBeenCalledWith('/parent/dashboard', { replace: true });
  });

  test.each(['expired', 'revoked', 'reused', 'disabled'])('%s links never show identity or a password/OTP form', async reason => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => ({ valid: false, message: 'Invalid or expired activation link' }) });
    await render(`/parent/activate?token=${reason}`);
    expect(container.textContent).toContain('Invalid or expired activation link');
    expect(container.querySelector('form')).toBeNull();
    expect(container.textContent).not.toContain('Ada');
    expect(container.textContent).not.toContain('an email address you can access');
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test('empty token fails closed rather than switching to email activation', async () => {
    global.fetch = jest.fn();
    await render('/parent/activate?token=');
    expect(fetch).not.toHaveBeenCalled();
    expect(container.querySelector('form')).toBeNull();
  });

  test('a link revoked after validation does not start a session', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ valid: true, identity: { name: 'Ada P.', phone: '***567' } }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ message: 'Invalid or expired activation link' }) });
    await render();
    await change('#activation-password', 'SecurePassword1');
    await change('#activation-password-confirmation', 'SecurePassword1');
    await submit();
    expect(container.textContent).toContain('Invalid or expired activation link');
    expect(sessionStorage.getItem('parentToken')).toBeNull();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});