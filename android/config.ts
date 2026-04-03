// API Configuration
// Replace with your computer's IP address (run 'ipconfig' in PowerShell)
export const API_BASE_URL = 'http://10.122.252.1:8000';

export const ENDPOINTS = {
  HEALTH_CHECK: `${API_BASE_URL}/`,
  REGISTER: `${API_BASE_URL}/register`,
  VALIDATE_FACE: `${API_BASE_URL}/validate-face`,
  ATTENDANCE: `${API_BASE_URL}/attendance`,
  DELETE_USER: `${API_BASE_URL}/delete-user`,
  VERIFY_TEACHER_CODE: `${API_BASE_URL}/verify-teacher-code`,
  SEND_OTP: `${API_BASE_URL}/send-otp`,
  VERIFY_OTP: `${API_BASE_URL}/verify-otp`,
  LIVENESS_CHECK: `${API_BASE_URL}/liveness-check`,
};
