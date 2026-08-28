import axios from 'axios';

// In production, use the configured API URL.
// In development, use a relative path so everything goes through Vite's proxy —
// this works on localhost, raw IP, AND ngrok without any changes.
const getApiUrl = () => {
  if (import.meta.env.PROD) return import.meta.env.VITE_API_URL;
  // Use absolute URL based on current origin to prevent Safari relative path resolution bugs
  return `${window.location.origin}/api`;
};

export const API_URL = getApiUrl();

// Create axios instance
const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'ngrok-skip-browser-warning': 'true',
  },
});

// Add auth token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle response errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('auth_token');
      // window.location.href = '/login'; // Optional: Redirect on 401
    }
    return Promise.reject(error);
  }
);

// Auth API
export const authApi = {
  register: (data: { username: string; email: string; password: string; password_confirmation?: string }) =>
    api.post('/register', data),
  login: (data: { username: string; password: string }) =>
    api.post('/login', data),
  logout: () =>
    api.post('/logout'),
  getUser: () =>
    api.get('/user'),
};

// Trips API
export const tripsApi = {
  getAll: () =>
    api.get('/trips'),
  getById: (id: string) =>
    api.get(`/trips/${id}`),
  create: (data: any) =>
    api.post('/trips', data),
  update: (id: string, data: any) =>
    api.put(`/trips/${id}`, data),
  delete: (id: string) =>
    api.delete(`/trips/${id}`),
  activate: (id: string) =>
    api.post(`/trips/${id}/activate`),
  getRecommendations: (id: string) =>
    api.get(`/trips/${id}/recommendations`),
  invite: (id: string, data: any) =>
    api.post(`/trips/${id}/invite`, data),
  getCollaborators: (id: string) =>
    api.get(`/trips/${id}/collaborators`),
  getMessages: (id: string) =>
    api.get(`/trips/${id}/messages`),
  sendMessage: (id: string, data: any) =>
    api.post(`/trips/${id}/messages`, data),
};

// Itineraries API
export const itinerariesApi = {
  getAll: (tripId: string) =>
    api.get(`/trips/${tripId}/itineraries`),
  create: (data: any) =>
    api.post('/itineraries', data),
  update: (id: string, data: any) =>
    api.put(`/itineraries/${id}`, data),
  delete: (id: string) =>
    api.delete(`/itineraries/${id}`),
  searchPlaces: (params: any) =>
    api.get('/itineraries/search-places', { params }),
  suggestPlaces: (params: any) =>
    api.get('/itineraries/suggest-places', { params }),
  calculateRoute: (tripId: string) =>
    api.post(`/trips/${tripId}/calculate-route`),
  getRouteDetails: (tripId: string) =>
    api.get(`/trips/${tripId}/route-details`),
  rearrange: (tripId: string, lat: number, lng: number) => 
    api.post(`/trips/${tripId}/rearrange`, { lat, lng }),
  calculateGeneric: (data: { start_lat: number; start_lng: number; end_lat: number; end_lng: number; mode: string }) =>
    api.post('/route/calculate', data),
  autoPlan: (tripId: string, preview: boolean = false) =>
    api.post(`/trips/${tripId}/auto-plan`, { preview }),
};

export const trackingApi = {
  updateLocation: (lat: number, lng: number) => api.post('/users/location', { lat, lng }),
  getHeatmap: () => api.get('/heatmap'),
};

export const expensesApi = {
  getByTrip: (tripId: string) => api.get(`/trips/${tripId}/expenses`),
  create: (tripId: string, expense: any) => api.post(`/trips/${tripId}/expenses`, expense),
  delete: (id: string) => api.delete(`/expenses/${id}`),
};

export const budgetApi = {
  getByTrip: (tripId: string) => api.get(`/trips/${tripId}/budget`),
  update: (tripId: string, budget: any) => api.put(`/trips/${tripId}/budget`, budget),
};

// Places API
export const placesApi = {
  search: (params: { lat: number; lng: number; category?: string; query?: string }) =>
    api.get('/places/search', { params }),
  popular: (params: { lat: number; lng: number }) =>
    api.get('/places/popular', { params }),
  highRated: (params: { lat: number; lng: number }) =>
    api.get('/places/high-rated', { params }),
  recommended: (params: { lat: number; lng: number }) =>
    api.get('/places/recommended', { params }),
  reverseGeocode: (params: { lat: number; lng: number }) =>
    api.get('/places/reverse', { params }),
  autocomplete: (params: { query: string; lat: number; lng: number }) =>
    api.get('/places/autocomplete', { params }),
  getPhoto: (ref: string) =>
    `${API_URL}/places/photo?ref=${ref}`,
};

// Chat API
export const chatApi = {
  getMessages: (tripId: string) =>
    api.get(`/trips/${tripId}/messages`),
  sendMessage: (tripId: string, data: { content: string; type?: string }) =>
    api.post(`/trips/${tripId}/messages`, data),
};

// User Preferences API
export const preferencesApi = {
  get: () =>
    api.get('/preferences'),
  update: (data: any) =>
    api.put('/preferences', data),
  analyzeHistory: () =>
    api.post('/preferences/analyze'),
};

// User Interactions API
export const interactionsApi = {
  create: (data: { place_id: string; place_name: string; category: string }) =>
    api.post('/interactions', data),
};

// Reviews API
export const reviewsApi = {
  getAll: (params?: { trip_id?: string }) =>
    api.get('/reviews', { params }),
  create: (data: { trip_id: string; place_name: string; rating: number; review_text?: string }) =>
    api.post('/reviews', data),
  delete: (id: string) =>
    api.delete(`/reviews/${id}`),
};

// User Search API (for inviting collaborators)
export const userSearchApi = {
  search: (query: string) =>
    api.get('/users/search', { params: { query } }),
};

// Weather API
export const weatherApi = {
  getWeather: (params: { lat: number; lng: number }) =>
    api.get('/weather', { params }),
};

// Notifications API
export const notificationsApi = {
  getAll: () => api.get('/notifications'),
  markRead: (id: string) => api.put(`/notifications/${id}/read`),
  markAllRead: () => api.put('/notifications/read-all'),
  delete: (id: string) => api.delete(`/notifications/${id}`),
  handleAction: (id: string, actionType: string) => api.post(`/notifications/${id}/action`, { action_type: actionType }),
};

// Currency API
export const currencyApi = {
  getRates: (base: string = 'USD') =>
    api.get('/currency/rates', { params: { base } }),
};

// Call Signaling API
export const callSignalApi = {
  send: (conversationId: string, toId: number, payload: any) =>
    api.post('/calls/signal', { conversation_id: conversationId, to_id: toId, payload }),
  receive: () =>
    api.get(`/calls/signals?t=${Date.now()}`),
};

export default api;
