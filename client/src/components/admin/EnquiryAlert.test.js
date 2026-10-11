import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from 'react-query';
import EnquiryAlert from './EnquiryAlert';
import api from '../../services/api';

let mockUser = { id: 1, role: 'admin' };
jest.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser,
  isAdmin: ['admin', 'super_admin'].includes(mockUser?.role) }) }));
jest.mock('../../services/api', () => ({ __esModule: true, default: { get: jest.fn() } }));
global.IS_REACT_ACT_ENVIRONMENT = true;
let container;
let root;
let client;
beforeEach(() => {
  mockUser = { id: 1, role: 'admin' }; api.get.mockReset();
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { cacheTime: 0 } },
    logger: { log: () => {}, warn: () => {}, error: () => {} } });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); container.remove(); jest.useRealTimers(); });
const render = async () => { await act(async () => root.render(
  <QueryClientProvider client={client}><MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><EnquiryAlert /></MemoryRouter></QueryClientProvider>
)); };
const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); };

test('Admin gets a visible unread count and a link directly to the inbox', async () => {
  api.get.mockResolvedValue({ data: { count: 2 } });
  await render(); await settle();
  expect(api.get).toHaveBeenCalledWith('/parent/enquiries/admin/unread-count');
  expect(container.textContent).toContain('2 enquiries have unread messages');
  expect(container.querySelector('a').getAttribute('href')).toBe('/enquiries');
});

test('the visible count updates when a later polling response contains new enquiries', async () => {
  jest.useFakeTimers();
  api.get.mockResolvedValueOnce({ data: { count: 1 } }).mockResolvedValue({ data: { count: 3 } });
  await render();
  await act(async () => { jest.advanceTimersByTime(0); });
  expect(container.textContent).toContain('1 enquiry has unread messages');
  await act(async () => { jest.advanceTimersByTime(30000); });
  await act(async () => { jest.advanceTimersByTime(0); });
  expect(container.textContent).toContain('3 enquiries have unread messages');
  expect(api.get).toHaveBeenCalledTimes(2);
});

test('cached counts never cross administrator accounts', async () => {
  api.get.mockResolvedValueOnce({ data: { count: 3 } }).mockResolvedValue({ data: { count: 0 } });
  await render(); await settle();
  expect(container.textContent).toContain('3 enquiries have unread messages');
  mockUser = { id: 2, role: 'super_admin' };
  await render(); await settle();
  expect(api.get).toHaveBeenCalledTimes(2);
  expect(container.textContent).not.toContain('3 enquiries');
});

test('parents never request the Admin alert endpoint', async () => {
  mockUser = { id: 10, role: 'parent' };
  await render(); await settle();
  expect(api.get).not.toHaveBeenCalled();
  expect(container.textContent).toBe('');
});

test('a failed alert check shows a way to open the inbox rather than claiming no enquiries', async () => {
  api.get.mockRejectedValue(new Error('Temporary connection error'));
  await render();
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 1150)); });
  expect(container.textContent).toContain('Enquiry alerts could not be refreshed');
  expect(container.querySelector('a').getAttribute('href')).toBe('/enquiries');
});
