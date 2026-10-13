import { useQuery } from 'react-query';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';
export const reRegistrationAlertKey = id => ['admin-reregistration-pending',id];
export default function useAdminReRegistrationAlerts() {
  const { user,isAdmin } = useAuth();
  const query = useQuery(reRegistrationAlertKey(user?.id), async () => (await api.get('/parent/re-registration/admin/pending-count')).data,
    { enabled: !!isAdmin && !!user?.id, refetchInterval: 30000, refetchOnWindowFocus: true, retry: 1 });
  return { ...query, count: Number(query.data?.count || 0) };
}
