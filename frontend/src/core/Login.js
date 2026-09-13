import React, { useState, useEffect } from 'react';
import '../styles/Login.css';
import { useNavigate, useLocation } from 'react-router-dom';
import { API_CONFIG } from '../config/apiConfig';
import { showToast } from './toast';
import { navigateAfterLogin } from './authHeaders';

function Login() {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const bgImages = [
    `${process.env.PUBLIC_URL}/assets/background_images/pexels-googledeepmind-17483867.jpg`,
    `${process.env.PUBLIC_URL}/assets/background_images/pexels-googledeepmind-17483868.jpg`,
    `${process.env.PUBLIC_URL}/assets/background_images/pexels-googledeepmind-17483873.jpg`,
    `${process.env.PUBLIC_URL}/assets/background_images/pexels-googledeepmind-17483874.jpg`,
  ];

  const [bgIndex, setBgIndex] = useState(0);

  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const oauthError = searchParams.get('error');
    if (oauthError) {
      showToast(`Google sign-in failed: ${oauthError}`, 'error');
    }
    if (searchParams.get('google_auth') === 'success') {
      const googleEmail = searchParams.get('email');
      const sess = searchParams.get('session_token');
      if (googleEmail) {
        localStorage.setItem('userEmail', googleEmail);
        localStorage.setItem('firstName', googleEmail.split('@')[0]);
        localStorage.setItem('authProvider', 'google');
      }
      if (sess) {
        localStorage.setItem('sessionToken', sess);
      }
      window.dispatchEvent(new Event('authChange'));
      navigateAfterLogin(navigate);
    }
  }, [location, navigate]);

  useEffect(() => {
    const interval = setInterval(() => {
      setBgIndex(prev => (prev + 1) % bgImages.length);
    }, 6000);
    return () => clearInterval(interval);
  }, [bgImages.length]);

  const handleGoogleLogin = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_CONFIG.API_URL}/auth/google/start`);
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        showToast(err.error || 'Google sign-in is not configured.', 'error');
        return;
      }
      const data = await response.json();
      if (data.auth_url) {
        window.location.href = data.auth_url;
      } else {
        showToast('Google sign-in is not available right now.', 'warning');
      }
    } catch {
      showToast('Could not reach the server. Please try again.', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card-container">
        <div className="login-header">
          <img
            src={`${process.env.PUBLIC_URL}/logo192.svg`}
            alt="Enable Logo"
            className="login-logo"
          />
        </div>

        <div className="login-form">
          <p className="login-footer-text" style={{ marginTop: 0 }}>
            Sign in to Enable with your Google account.
          </p>
          <button
            type="button"
            onClick={handleGoogleLogin}
            className="google-button"
            disabled={loading}
          >
            <img src="/assets/icons/google.png" alt="Google" className="google-icon" />
            {loading ? 'Redirecting…' : 'Continue with Google'}
          </button>
        </div>
      </div>

      <div className="footer-text">
        <a href="https://enableyou.co/" target="_blank" rel="noopener noreferrer">
          enableyou.co
        </a>
      </div>
    </div>
  );
}

export default Login;
