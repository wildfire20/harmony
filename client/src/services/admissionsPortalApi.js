import axios from 'axios';

// Deliberately separate from services/api.js: portal links are bearer credentials.
// This client never reads auth storage, adds Authorization headers, or logs requests.
const portalClient = axios.create({
  baseURL: '/api',
  timeout: 30000,
});

export const admissionsPortalApi = {
  getSession: (token) => portalClient.get(`/admissions-portal/session/${encodeURIComponent(token)}`),
  saveApplication: (token, body) => portalClient.patch(`/admissions-portal/application/${encodeURIComponent(token)}`, body),
  submitApplication: (token) => portalClient.post(`/admissions-portal/application/${encodeURIComponent(token)}/submit`, {}),
  saveRegistration: (token, body) => portalClient.patch(`/admissions-portal/registration/${encodeURIComponent(token)}`, body),
  submitRegistration: (token) => portalClient.post(`/admissions-portal/registration/${encodeURIComponent(token)}/submit`, {}),
};

export const portalErrorMessage = (error) => {
  const status = error?.response?.status;
  if (status === 404 || status === 401 || status === 403 || !error?.response) {
    return 'This secure link is no longer available. Please contact Harmony Learning Institute for assistance.';
  }
  return error?.response?.data?.message || 'We could not save your information. Please try again or contact Harmony Learning Institute.';
};