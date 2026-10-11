import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import ParentHelp from './ParentHelp';

global.IS_REACT_ACT_ENVIRONMENT = true;
let container;
let root;
beforeEach(async () => {
  Object.defineProperty(window, 'crypto', { value: require('crypto').webcrypto, configurable: true });
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  await act(async () => root.render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><ParentHelp /></MemoryRouter>));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); delete global.fetch; });
const fill = async () => {
  for (const [selector, value] of [['#help-name','Synthetic Parent'],['#help-phone','0731234567'],['#help-subject','Cannot sign in'],['#help-message','Please contact me.']]) {
    await act(async () => {
      const element = container.querySelector(selector);
      const prototype = element.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
};
const submit = async () => { await act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); };

test('public help needs no email, sends no auth and confirms only after a successful save', async () => {
  expect(container.querySelector('input[type="email"]')).toBeNull();
  expect(container.querySelector('button').disabled).toBe(true);
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: async () => ({ enquiry: { reference: 'ENQ-000007', status: 'new' } }) }));
  await fill(); await submit();
  expect(global.fetch.mock.calls[0][0]).toBe('/api/parent/enquiries/help');
  expect(global.fetch.mock.calls[0][1].credentials).toBe('omit');
  expect(global.fetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
  expect(container.querySelector('[role="status"]').textContent).toContain('Your enquiry has been sent');
  expect(container.textContent).toContain('ENQ-000007');
  expect(container.querySelector('form')).toBeNull();
});

test('public help errors retain all details and use the same key on retry', async () => {
  global.fetch = jest.fn(() => Promise.resolve({ ok: false, json: async () => ({ message: 'Please enter a valid South African mobile number.' }) }));
  await fill(); await submit();
  expect(container.querySelector('[role="alert"]').textContent).toContain('valid South African mobile number');
  expect(container.querySelector('#help-message').value).toBe('Please contact me.');
  expect(container.textContent).not.toContain('Your enquiry has been sent');
  await submit();
  expect(global.fetch.mock.calls[0][1].body).toBe(global.fetch.mock.calls[1][1].body);
});
