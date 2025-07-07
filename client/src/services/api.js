const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

class ApiService {
  constructor() {
    this.baseURL = API_BASE_URL;
  }

  // Get auth token from localStorage
  getAuthToken() {
    return localStorage.getItem('token');
  }

  // Get auth headers
  getAuthHeaders() {
    const token = this.getAuthToken();
    return {
      'Content-Type': 'application/json',
      ...(token && { 'Authorization': `Bearer ${token}` })
    };
  }

  // Generic fetch wrapper
  async fetch(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const config = {
      headers: this.getAuthHeaders(),
      ...options
    };

    try {
      const response = await fetch(url, config);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || `HTTP error! status: ${response.status}`);
      }

      return data;
    } catch (error) {
      console.error('API Error:', error);
      throw error;
    }
  }

  // GET request
  async get(endpoint, params = {}) {
    const searchParams = new URLSearchParams(params);
    const url = searchParams.toString() ? `${endpoint}?${searchParams}` : endpoint;
    return this.fetch(url);
  }

  // POST request
  async post(endpoint, data = {}) {
    return this.fetch(endpoint, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  // PUT request
  async put(endpoint, data = {}) {
    return this.fetch(endpoint, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  }

  // DELETE request
  async delete(endpoint) {
    return this.fetch(endpoint, {
      method: 'DELETE'
    });
  }

  // File upload
  async uploadFile(endpoint, formData) {
    const token = this.getAuthToken();
    const url = `${this.baseURL}${endpoint}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...(token && { 'Authorization': `Bearer ${token}` })
      },
      body: formData
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || `HTTP error! status: ${response.status}`);
    }

    return data;
  }

  // Authentication endpoints
  async login(credentials) {
    return this.post('/auth/login', credentials);
  }

  async register(userData) {
    return this.post('/auth/register', userData);
  }

  async logout() {
    return this.post('/auth/logout');
  }

  async getCurrentUser() {
    return this.get('/auth/me');
  }

  // Announcements endpoints
  async getAnnouncements(params = {}) {
    return this.get('/announcements', params);
  }

  async getAnnouncement(id) {
    return this.get(`/announcements/${id}`);
  }

  async createAnnouncement(data) {
    return this.post('/announcements', data);
  }

  async updateAnnouncement(id, data) {
    return this.put(`/announcements/${id}`, data);
  }

  async deleteAnnouncement(id) {
    return this.delete(`/announcements/${id}`);
  }

  async getAnnouncementTargets() {
    return this.get('/announcements/meta/targets');
  }

  // Tasks endpoints
  async getTasks(params = {}) {
    return this.get('/tasks', params);
  }

  async getTask(id) {
    return this.get(`/tasks/${id}`);
  }

  async createTask(data) {
    return this.post('/tasks', data);
  }

  async updateTask(id, data) {
    return this.put(`/tasks/${id}`, data);
  }

  async deleteTask(id) {
    return this.delete(`/tasks/${id}`);
  }

  // Submissions endpoints
  async getSubmissions(params = {}) {
    return this.get('/submissions/student', params);
  }

  async getTaskSubmissions(taskId) {
    return this.get(`/submissions/task/${taskId}`);
  }

  async submitAssignment(taskId, formData) {
    return this.uploadFile(`/submissions/assignment/${taskId}`, formData);
  }

  async gradeSubmission(id, data) {
    return this.put(`/submissions/${id}/grade`, data);
  }

  // Documents endpoints
  async getDocuments(params = {}) {
    return this.get('/documents', params);
  }

  async uploadDocument(formData) {
    return this.uploadFile('/documents/upload', formData);
  }

  async downloadDocument(id) {
    const token = this.getAuthToken();
    const url = `${this.baseURL}/documents/${id}/download`;
    
    const response = await fetch(url, {
      headers: {
        ...(token && { 'Authorization': `Bearer ${token}` })
      }
    });

    if (!response.ok) {
      throw new Error('Failed to download document');
    }

    return response.blob();
  }

  async deleteDocument(id) {
    return this.delete(`/documents/${id}`);
  }

  // Admin endpoints
  async getStudents(params = {}) {
    return this.get('/admin/students', params);
  }

  async getTeachers(params = {}) {
    return this.get('/admin/teachers', params);
  }

  async getGrades() {
    return this.get('/admin/grades');
  }

  async getClasses() {
    return this.get('/admin/classes');
  }

  async createStudent(data) {
    return this.post('/admin/students', data);
  }

  async updateStudent(id, data) {
    return this.put(`/admin/students/${id}`, data);
  }

  async deleteStudent(id) {
    return this.delete(`/admin/students/${id}`);
  }

  async createTeacher(data) {
    return this.post('/admin/teachers', data);
  }

  async updateTeacher(id, data) {
    return this.put(`/admin/teachers/${id}`, data);
  }

  async deleteTeacher(id) {
    return this.delete(`/admin/teachers/${id}`);
  }

  // Calendar endpoints
  async getCalendarEvents(params = {}) {
    return this.get('/calendar/events', params);
  }

  async createCalendarEvent(data) {
    return this.post('/calendar/events', data);
  }

  async updateCalendarEvent(id, data) {
    return this.put(`/calendar/events/${id}`, data);
  }

  async deleteCalendarEvent(id) {
    return this.delete(`/calendar/events/${id}`);
  }

  // Analytics endpoints
  async getAnalytics(params = {}) {
    return this.get('/analytics', params);
  }

  async getStudentAnalytics(params = {}) {
    return this.get('/analytics/student', params);
  }

  async getTeacherAnalytics(params = {}) {
    return this.get('/analytics/teacher', params);
  }

  async getAdminAnalytics(params = {}) {
    return this.get('/analytics/admin', params);
  }

  // Health check
  async checkHealth() {
    return this.get('/health');
  }
}

// Create main API service instance
const apiService = new ApiService();

// Create admin-specific API object
export const adminAPI = {
  getStudents: (params = {}) => apiService.getStudents(params),
  getTeachers: (params = {}) => apiService.getTeachers(params),
  getGrades: () => apiService.getGrades(),
  getClasses: () => apiService.getClasses(),
  createStudent: (data) => apiService.createStudent(data),
  updateStudent: (id, data) => apiService.updateStudent(id, data),
  deleteStudent: (id) => apiService.deleteStudent(id),
  createTeacher: (data) => apiService.createTeacher(data),
  updateTeacher: (id, data) => apiService.updateTeacher(id, data),
  deleteTeacher: (id) => apiService.deleteTeacher(id),
  getAdminAnalytics: (params = {}) => apiService.getAdminAnalytics(params)
};

export default apiService;
