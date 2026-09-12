import fs from 'fs';
import path from 'path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import ParentActivation from './ParentActivation';

const mockNavigate = jest.fn();
global.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock('react-router-dom', () => {
  const actual = jest.requireActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

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
  expect(source).not.toMatch(/activation\/validate|\/api\/parent\/activate['"]/);
});

test('self activation posts request, verify, then complete with credentials', () => {
  const requestIndex = source.indexOf('REQUEST_PATH');
  const verifyIndex = source.indexOf('VERIFY_PATH');
  const completeIndex = source.indexOf('COMPLETE_PATH');
  expect(requestIndex).toBeLessThan(verifyIndex);
  expect(verifyIndex).toBeLessThan(completeIndex);
  expect(source.match(/credentials: ['"]include['"]/g)).toHaveLength(3);
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