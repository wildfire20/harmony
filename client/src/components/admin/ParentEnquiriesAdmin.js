import React, { useCallback } from 'react';
import { useQueryClient } from 'react-query';
import { useAuth } from '../../contexts/AuthContext';
import { adminEnquiryAlertKey } from '../../hooks/useAdminEnquiryAlerts';
import api from '../../services/api';
import EnquiryWorkspace from '../common/EnquiryWorkspace';

const request = async (path, options = {}) => {
  try {
    return (await api.request({
      url: `/parent/enquiries/admin${path}`, method: options.method || 'GET',
      ...(options.body ? { data: JSON.parse(options.body) } : {}),
    })).data;
  } catch (error) { throw new Error(error.response?.data?.message || error.message); }
};
export default function ParentEnquiriesAdmin() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const onRead = useCallback(() => queryClient.invalidateQueries(adminEnquiryAlertKey(user?.id)), [queryClient, user?.id]);
  return <EnquiryWorkspace request={request} admin onRead={onRead} />;
}
