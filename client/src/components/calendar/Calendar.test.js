import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Calendar from './Calendar';
import ParentCalendar from '../parent/ParentCalendar';
import api from '../../services/api';
import { parentApi } from '../parent/ParentPortal';

jest.mock('../../services/api', () => ({ __esModule: true, default: { get: jest.fn(), put: jest.fn(), post: jest.fn() } }));
jest.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 1, role: 'super_admin' } }) }));
jest.mock('../common/ThemeProvider', () => ({ useTheme: () => ({ theme: 'light' }) }));
jest.mock('react-hot-toast', () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));
jest.mock('../parent/ParentPortal', () => ({ parentApi: jest.fn(), useSelectedChild: () => ({ child: { id: 501, first_name: 'Synthetic' } }) }));
jest.mock('react-big-calendar', () => ({
  momentLocalizer: jest.fn(),
  Calendar: ({ events, onSelectEvent }) => <div>{events.map(event => <button key={event.id}
    data-testid="calendar-event" data-hour={event.start.getHours()} onClick={() => onSelectEvent(event)}>{event.title}</button>)}</div>,
}));
let container, root, event;
global.IS_REACT_ACT_ENVIRONMENT = true;
const click = async node => act(async () => node.click());
const button = text => Array.from(container.querySelectorAll('button')).find(node => node.textContent.trim() === text);
const change = async (node, value) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(node, value);
  node.dispatchEvent(new Event('input', { bubbles: true }));
});
beforeEach(() => {
  jest.clearAllMocks();
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  event = { id: 41, title: 'Synthetic meeting', event_type: 'school_event', category: 'meeting',
    start_date: '2026-10-26T09:00:00.000+02:00', end_date: '2026-10-26T10:00:00.000+02:00',
    parent_visible: true, target_audience: 'all' };
  api.get.mockImplementation(path => Promise.resolve({ data: path.startsWith('/calendar')
    ? { success: true, events: [event] } : {} }));
  api.put.mockImplementation((path, body) => {
    event = { ...event, ...body, event_type: 'school_event', category: body.event_type };
    return Promise.resolve({ data: { success: true } });
  });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const edit = async () => { await click(container.querySelector('[data-testid="calendar-event"]')); await click(button('Edit Event')); };
test('Admin edit, save and reopen retain the selected school time', async () => {
  await act(async () => root.render(<Calendar />));
  expect(container.querySelector('[data-testid="calendar-event"]').dataset.hour).toBe('9');
  await edit();
  expect(container.querySelector('input[type="time"]').value).toBe('09:00');
  expect(container.querySelector('input[type="date"]').value).toBe('2026-10-26');
  await change(container.querySelectorAll('input[type="time"]')[0], '14:35');
  await change(container.querySelectorAll('input[type="time"]')[1], '15:40');
  await act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(api.put.mock.calls[0][1].start_date).toBe('2026-10-26T14:35:00+02:00');
  expect(api.put.mock.calls[0][1].end_date).toBe('2026-10-26T15:40:00+02:00');
  await edit(); expect(container.querySelector('input[type="time"]').value).toBe('14:35');
});
test('Admin can clear an optional end date without losing the start time', async () => {
  await act(async () => root.render(<Calendar />)); await edit();
  await change(container.querySelectorAll('input[type="date"]')[1], '');
  await act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(api.put.mock.calls[0][1].end_date).toBeNull();
  expect(api.put.mock.calls[0][1].start_date).toBe('2026-10-26T09:00:00+02:00');
});
test('Parent calendar puts midnight events on the school date and shows the same time in details', async () => {
  parentApi.mockResolvedValue({ events: [{ ...event, event_type: 'meeting',
    start_date: '2026-11-01T00:15:00+02:00', end_date: '2026-11-01T01:15:00+02:00' }] });
  await act(async () => root.render(<ParentCalendar />));
  await change(container.querySelector('input[type="date"]'), '2026-11-01');
  expect(container.textContent).toContain('00:15 – 01:15');
  await click(container.querySelector('[aria-label="Next day"]')); expect(container.textContent).toContain('No events');
  await click(container.querySelector('[aria-label="Previous day"]')); expect(container.textContent).toContain('Synthetic meeting');
  await click(Array.from(container.querySelectorAll('button')).find(node => node.classList.contains('parent-calendar-event')));
  expect(container.textContent).toContain('00:15');
  expect(container.textContent).toContain('South African time');
});
