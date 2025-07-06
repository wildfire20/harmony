import axios from 'axios';

// In production, use relative paths since frontend and backend are on same domain
// In development, use localhost:5000
const API_BASE_URL = process.env.NODE_ENV === 'production' 
  ? '/api' 
  : (process.env.REACT_APP_API_URL || 'http://localhost:5000/api');

console.log('API Base URL:', API_BASE_URL);

// Create axios instance
const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  withCredentials: true, // Include cookies for CORS
});

// Request interceptor to add token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor to handle errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('API Error:', error.response?.data || error.message);
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Auth API
export const authAPI = {
  login: (credentials, userType) => {
    const endpoint = userType === 'student' ? '/auth/login/student' : '/auth/login/staff';
    return api.post(endpoint, credentials);
  },
  logout: () => api.post('/auth/logout'),
  verifyToken: (token) => api.get('/auth/verify', {
    headers: { Authorization: `Bearer ${token}` }
  }),
  changePassword: (passwords) => api.put('/auth/change-password', passwords),
  getProfile: () => api.get('/auth/profile'),
};

// Users API
export const usersAPI = {
  getProfile: () => api.get('/users/profile'),
  updateProfile: (data) => api.put('/users/profile', data),
};

// Classes API
export const classesAPI = {
  getGrades: () => api.get('/classes/grades'),
  getClasses: (gradeId) => api.get(`/classes/classes${gradeId ? `?grade_id=${gradeId}` : ''}`),
  getClassesByGrade: (gradeId) => api.get(`/classes/grades/${gradeId}/classes`),
  getClassStudents: (classId) => api.get(`/classes/classes/${classId}/students`),
  createGrade: (data) => api.post('/classes/grades', data),
  createClass: (data) => api.post('/classes/classes', data),
  updateClass: (id, data) => api.put(`/classes/classes/${id}`, data),
  deleteClass: (id) => api.delete(`/classes/classes/${id}`),
};

// Tasks API
export const tasksAPI = {
  getTasks: (gradeId, classId) => api.get(`/tasks/grade/${gradeId}/class/${classId}`),
  getTask: (id) => api.get(`/tasks/${id}`),
  createTask: (data) => api.post('/tasks', data),
  updateTask: (id, data) => api.put(`/tasks/${id}`, data),
  deleteTask: (id) => api.delete(`/tasks/${id}`),
  getTaskSubmissions: (id, status) => api.get(`/tasks/${id}/submissions${status ? `?status=${status}` : ''}`),
};

// Quizzes API
export const quizzesAPI = {
  createQuiz: (data) => api.post('/quizzes', data),
  getQuiz: (taskId) => api.get(`/quizzes/${taskId}`),
  submitQuiz: (taskId, answers) => api.post(`/quizzes/${taskId}/submit`, { answers }),
  getQuizResults: (taskId) => api.get(`/quizzes/${taskId}/results`),
  deleteQuiz: (taskId) => api.delete(`/quizzes/${taskId}`),
};

// Announcements API
export const announcementsAPI = {
  getAnnouncements: (gradeId, classId) => api.get(`/announcements/grade/${gradeId}/class/${classId}`),
  getAnnouncement: (id) => api.get(`/announcements/${id}`),
  createAnnouncement: (data) => api.post('/announcements', data),
  updateAnnouncement: (id, data) => api.put(`/announcements/${id}`, data),
  deleteAnnouncement: (id) => api.delete(`/announcements/${id}`),
  getRecentAnnouncements: (limit) => api.get(`/announcements/recent/${limit || 5}`),
};

// Submissions API
export const submissionsAPI = {
  submitAssignment: (taskId, formData) => {
    return api.post(`/submissions/assignment/${taskId}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  getStudentSubmissions: (params) => api.get('/submissions/student', { params }),
  getSubmission: (id) => api.get(`/submissions/${id}`),
  gradeSubmission: (id, data) => api.put(`/submissions/${id}/grade`, data),
  returnSubmission: (id, data) => api.put(`/submissions/${id}/return`, data),
  downloadSubmission: (id) => api.get(`/submissions/${id}/download`, { responseType: 'blob' }),
  getTaskSubmissions: (taskId, status) => api.get(`/submissions/task/${taskId}${status ? `?status=${status}` : ''}`),
  getTaskStudents: (taskId) => api.get(`/submissions/task/${taskId}/students`),
};

// Admin API
export const adminAPI = {
  // Students
  addStudent: (data) => api.post('/admin/students', data),
  bulkAddStudents: (students) => api.post('/admin/students/bulk', { students }),
  getStudents: (params) => api.get('/admin/students', { params }),
  updateStudent: (id, data) => api.put(`/admin/students/${id}`, data),
  deleteStudent: (id) => api.delete(`/admin/students/${id}`),
  exportCredentials: (params) => api.get('/admin/students/export-credentials', { 
    params, 
    responseType: 'blob' 
  }),
  
  // Teachers
  addTeacher: (data) => api.post('/admin/teachers', data),
  getTeachers: (params) => api.get('/admin/teachers', { params }),
  updateTeacher: (id, data) => api.put(`/admin/teachers/${id}`, data),
  deleteTeacher: (id) => api.delete(`/admin/teachers/${id}`),
  
  // Grades (System Settings)
  getGrades: () => api.get('/admin/grades'),
  addGrade: (data) => api.post('/admin/grades', data),
  updateGrade: (id, data) => api.put(`/admin/grades/${id}`, data),
  deleteGrade: (id) => api.delete(`/admin/grades/${id}`),
  
  // Classes (System Settings)
  getClasses: () => api.get('/admin/classes'),
  addClass: (data) => api.post('/admin/classes', data),
  updateClass: (id, data) => api.put(`/admin/classes/${id}`, data),
  deleteClass: (id) => api.delete(`/admin/classes/${id}`),
  
  // Statistics
  getStatistics: () => api.get('/admin/statistics'),
};

export default api;
