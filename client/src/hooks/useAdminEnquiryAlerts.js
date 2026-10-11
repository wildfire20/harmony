import { useQuery } from 'react-query';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';

export const adminEnquiryAlertKey = adminId => ['admin-enquiry-unread-count', adminId];

export default function useAdminEnquiryAlerts() {
  const { user, isAdmin } = useAuth();
  const query = useQuery(adminEnquiryAlertKey(user?.id),
    async () => (await api.get('/parent/enquiries/admin/unread-count')).data,
    { enabled: !!isAdmin && !!user?.id, refetchInterval: 30000, refetchOnWindowFocus: true, retry: 1 });
  return { ...query, count: Number(query.data?.count || 0) };
}
