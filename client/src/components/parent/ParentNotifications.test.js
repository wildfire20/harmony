import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useNavigate } from 'react-router-dom';
import { parentApi, useSelectedChild } from './ParentPortal';
import { getNotificationAction } from './ParentNotifications';

jest.mock('react-router-dom', () => ({
  useNavigate: jest.fn(),
}));
jest.mock('./ParentPortal', () => ({
  parentApi: jest.fn(),
  useSelectedChild: jest.fn(),
}));

const ParentNotifications = require('./ParentNotifications').default;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('parent notification safe actions', () => {
  test('maps known notification categories to allowlisted portal destinations', () => {
    expect(getNotificationAction({ category: 'attendance' })).toEqual({
      label: 'View attendance',
      path: '/parent/attendance',
    });
    expect(getNotificationAction({ type: 'payment_approved' })).toBeNull();
    expect(getNotificationAction({ category: 'documents' }).path).toBe('/parent/documents');
    expect(getNotificationAction({ category: 'grades' })).toBeNull();
    expect(getNotificationAction({ action: 'grades' })).toBeNull();
  });

  test('never forwards a server-provided arbitrary URL', () => {
    expect(getNotificationAction({
      category: 'attendance',
      action: 'https://example.com/collect-data',
      action_url: 'https://example.com/collect-data',
    }).path).toBe('/parent/attendance');
    expect(getNotificationAction({ action: 'https://example.com' })).toBeNull();
  });
});

describe('learner-specific notification navigation', () => {
  let root;
  let container;
  let navigate;
  let onSelectChild;
  const linkedChild = { id: 101, first_name: 'Ada', last_name: 'One' };

  beforeEach(() => {
    jest.clearAllMocks();
    navigate = jest.fn();
    onSelectChild = jest.fn();
    useNavigate.mockReturnValue(navigate);
    useSelectedChild.mockReturnValue({ children: [linkedChild], onSelectChild });
    parentApi.mockImplementation((path) => path === '/notifications'
      ? Promise.resolve({
        notifications: [{
          id: 7, category: 'attendance', learner_id: 101,
          learner_name: 'Ada One', title: 'Ada was marked absent',
        }],
      })
      : Promise.resolve({ count: 1 }));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  test('selects a currently linked learner before navigating', async () => {
    await act(async () => { root.render(<ParentNotifications />); });
    const action = [...container.querySelectorAll('button')]
      .find((button) => button.textContent.includes('View attendance'));
    expect(action).toBeTruthy();

    await act(async () => { action.click(); });
    expect(onSelectChild).toHaveBeenCalledTimes(1);
    expect(onSelectChild).toHaveBeenCalledWith(linkedChild);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/parent/attendance');
  });

  test('does not navigate or select a learner that is no longer linked', async () => {
    useSelectedChild.mockReturnValue({ children: [], onSelectChild });
    await act(async () => { root.render(<ParentNotifications />); });
    const action = [...container.querySelectorAll('button')]
      .find((button) => button.textContent.includes('View attendance'));
    expect(action).toBeTruthy();

    await act(async () => { action.click(); });
    expect(onSelectChild).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(container.textContent).toContain('This learner is no longer linked to your account.');
  });
});