import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import EnquiryWorkspace from './EnquiryWorkspace';
import { enquiryRequestKey } from './enquiryRequestKey';

global.IS_REACT_ACT_ENVIRONMENT = true;
const enquiry = (overrides = {}) => ({ id: 1, reference: 'ENQ-000001', subject: 'Attendance question',
  status: 'new', version: 1, created_at: '2026-10-11T09:00:00Z', updated_at: '2026-10-11T09:00:00Z', ...overrides });
const thread = (overrides = {}) => ({ enquiry: enquiry(overrides), messages: [{ id: 1, kind: 'message',
  author_role: 'parent', body: 'Where can I see attendance?', created_at: '2026-10-11T09:00:00Z' }] });
let container;
let root;
beforeEach(() => {
  Object.defineProperty(window, 'crypto', { value: require('crypto').webcrypto, configurable: true });
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const render = async (request, admin = false) => { await act(async () => root.render(<EnquiryWorkspace request={request} admin={admin} />)); };
const click = async label => {
  const button = Array.from(container.querySelectorAll('button')).find(item => item.textContent.trim() === label);
  expect(button).toBeDefined();
  await act(async () => button.click());
};
const change = async (selector, value) => {
  await act(async () => {
    const element = container.querySelector(selector);
    const prototype = element.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : element.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
    element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
};
const submit = async selector => { await act(async () => container.querySelector(selector).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); };
const readRequest = jest.fn();
beforeEach(() => readRequest.mockImplementation(path => Promise.resolve(path.startsWith('?') ? { enquiries: [enquiry()], has_more: false } : thread())));
const openFirst = async () => { await act(async () => container.querySelector('.enquiry-row').click()); };

test('failed sends keep the draft and retry key; confirmation appears only after saving', async () => {
  let attempts = 0;
  const request = jest.fn((path, options) => {
    if (options?.method === 'POST') return ++attempts === 1 ? Promise.reject(new Error('Not saved. Try again.')) : Promise.resolve({ enquiry: enquiry() });
    return readRequest(path);
  });
  await render(request); await click('New enquiry');
  await change('#enquiry-subject', 'Attendance question'); await change('#enquiry-message', 'Please help.');
  await submit('.enquiry-compose form');
  expect(container.querySelector('[role="alert"]').textContent).toBe('Not saved. Try again.');
  expect(container.querySelector('#enquiry-message').value).toBe('Please help.');
  expect(container.textContent).not.toContain('Your enquiry has been sent');
  await submit('.enquiry-compose form');
  expect(container.querySelector('[role="status"]').textContent).toContain('Your enquiry has been sent. Reference: ENQ-000001');
  const posts = request.mock.calls.filter(([, options]) => options?.method === 'POST');
  expect(JSON.parse(posts[0][1].body)).toEqual(JSON.parse(posts[1][1].body));
  expect(container.querySelector('.enquiry-compose')).toBeNull();
  expect(container.querySelector('.enquiry-thread-heading').textContent).toContain('Attendance question');
});

test('a pending request cannot show a success confirmation or send twice', async () => {
  let resolve;
  const request = jest.fn((path, options) => options?.method === 'POST' ? new Promise(done => { resolve = done; }) : readRequest(path));
  await render(request); await click('New enquiry');
  await change('#enquiry-subject', 'Question'); await change('#enquiry-message', 'Help');
  await submit('.enquiry-compose form');
  expect(container.textContent).not.toContain('Your enquiry has been sent');
  expect(Array.from(container.querySelectorAll('button')).find(button => button.textContent.includes('Sending')).disabled).toBe(true);
  await act(async () => resolve({ enquiry: enquiry() }));
  expect(container.textContent).toContain('Your enquiry has been sent');
});

test('Parent messages display as text and parents cannot change status', async () => {
  const unsafeText = '<img src=x onerror="alert(1)">';
  const request = path => Promise.resolve(path.startsWith('?') ? { enquiries: [enquiry()], has_more: false } : {
    ...thread(), messages: [{ ...thread().messages[0], body: unsafeText }],
  });
  await render(request); await openFirst();
  expect(container.querySelector('.enquiry-message p').textContent).toBe(unsafeText);
  expect(container.querySelector('.enquiry-message img')).toBeNull();
  expect(container.querySelector('#enquiry-status')).toBeNull();
  expect(container.querySelector('#enquiry-reply')).not.toBeNull();
});

test('a failed reply keeps the text without a false Reply sent confirmation', async () => {
  const request = jest.fn((path, options) => options ? Promise.reject(new Error('Could not save reply')) : readRequest(path));
  await render(request); await openFirst(); await change('#enquiry-reply', 'My follow-up');
  await submit('.enquiry-reply');
  expect(container.querySelector('#enquiry-reply').value).toBe('My follow-up');
  expect(container.querySelector('[role="alert"]').textContent).toContain('Could not save reply');
  expect(container.textContent).not.toContain('Reply sent.');
});

test('Done conversations remove the reply form and explain how to ask again', async () => {
  const request = path => Promise.resolve(path.startsWith('?') ? { enquiries: [enquiry({ status: 'done' })], has_more: false } : thread({ status: 'done' }));
  await render(request); await openFirst();
  expect(container.querySelector('#enquiry-reply')).toBeNull();
  expect(container.textContent).toContain('This enquiry is Done. Send a new enquiry if you still need help.');
});

test('Admin saves status using the current version and displays the saved result', async () => {
  let row = enquiry({ contact_name: 'Synthetic Parent', contact_phone: '27731234567', source: 'portal', version: 7 });
  const request = jest.fn((path, options) => {
    if (options?.method === 'PATCH') { row = { ...row, status: JSON.parse(options.body).status, version: 8 }; return Promise.resolve({ enquiry: row }); }
    return Promise.resolve(path.startsWith('?') ? { enquiries: [row], has_more: false } : { ...thread(), enquiry: row });
  });
  await render(request, true); await openFirst(); await change('#enquiry-status', 'on_hold');
  await submit('.enquiry-status-form');
  const [path, options] = request.mock.calls.find(([, opts]) => opts?.method === 'PATCH');
  expect(path).toBe('/1/status');
  expect(JSON.parse(options.body)).toMatchObject({ status: 'on_hold', version: 7 });
  expect(container.textContent).toContain('Status updated to On hold.');
  expect(container.querySelector('#enquiry-status').value).toBe('on_hold');
});

test('Admin login-help view directs a callback and hides unreadable portal replies', async () => {
  const row = enquiry({ source: 'login_help', contact_name: 'Synthetic Guest', contact_phone: '27731234567' });
  const request = path => Promise.resolve(path.startsWith('?') ? { enquiries: [row], has_more: false } : { ...thread(), enquiry: row });
  await render(request, true); await openFirst();
  expect(container.textContent).toContain('Confirm their identity before changing an account.');
  expect(container.textContent).toContain('Contact this parent using the mobile number provided.');
  expect(container.querySelector('#enquiry-reply')).toBeNull();
  expect(container.querySelector('#enquiry-status')).not.toBeNull();
});

test('a late response cannot replace the newly selected conversation', async () => {
  let resolveFirst;
  const request = path => path.startsWith('?') ? Promise.resolve({ enquiries: [enquiry(), enquiry({ id: 2, subject: 'Second question' })], has_more: false }) : path === '/1' ? new Promise(done => { resolveFirst = done; }) : Promise.resolve(thread({ id: 2, subject: 'Second question' }));
  await render(request);
  await act(async () => container.querySelectorAll('.enquiry-row')[0].click());
  await act(async () => container.querySelectorAll('.enquiry-row')[1].click());
  await act(async () => resolveFirst(thread()));
  expect(container.querySelector('.enquiry-thread-heading h2').textContent).toBe('Second question');
});

test('retry keys are valid random UUIDs, including the browser fallback', () => {
  const first = enquiryRequestKey(); const second = enquiryRequestKey();
  expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  expect(second).not.toBe(first);
});
