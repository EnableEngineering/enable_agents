import React, { useState, useEffect } from 'react';
import '../styles/Login.css';
import { useNavigate } from 'react-router-dom';
import { API_CONFIG } from '../config/apiConfig';
import { showToast } from './toast';
import { navigateAfterLogin } from './authHeaders';
import FormField from '../components/FormField';
import useValidation, { validators } from '../hooks/useValidation';

function RegisterUser() {
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const navigate = useNavigate();

  // Form validation
  const {
    values,
    errors,
    touched,
    handleChange,
    handleBlur,
    validate,
    reset
  } = useValidation({
    firstName: { value: '', validators: [validators.required('First name is required')] },
    lastName: { value: '', validators: [validators.required('Last name is required')] },
    email: { value: '', validators: [validators.required('Email is required'), validators.email()] },
    password: { value: '', validators: [validators.required('Password is required'), validators.minLength(8, 'Password must be at least 8 characters')] },
    company: { value: '', validators: [] },
    linkedin: { value: '', validators: [] },
    shortIntro: { value: '', validators: [] },
    companyIntro: { value: '', validators: [] }
  });

  const bgImages = [
    `${process.env.PUBLIC_URL}/assets/background_images/pexels-googledeepmind-17483867.jpg`,
    `${process.env.PUBLIC_URL}/assets/background_images/pexels-googledeepmind-17483868.jpg`,
    `${process.env.PUBLIC_URL}/assets/background_images/pexels-googledeepmind-17483873.jpg`,
    `${process.env.PUBLIC_URL}/assets/background_images/pexels-googledeepmind-17483874.jpg`,
  ];

  const [bgIndex, setBgIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setBgIndex(prev => (prev + 1) % bgImages.length);
    }, 6000);
    return () => clearInterval(interval);
  }, [bgImages.length]);

  const handleGoogleRegister = async () => {
    reset(); // Clear validation state before OAuth redirect
    setLoading(true);
    try {
      const response = await fetch(`${API_CONFIG.API_URL}/auth/google/start`);
      const data = await response.json();
      if (!response.ok) {
        showToast(data.error || 'Google sign-up is not configured.', 'error');
        setLoading(false);
        return;
      }
      if (data.auth_url) {
        window.location.href = data.auth_url;
      } else {
        showToast('Google sign-up is not available right now.', 'warning');
        setLoading(false);
      }
    } catch {
      showToast('Could not reach the server. Please try again.', 'error');
      setLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setSubmitted(true);
    if (!validate()) return;

    setLoading(true);
    try {
      const response = await fetch(`${API_CONFIG.API_URL}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: values.password,
          first_name: values.firstName,
          last_name: values.lastName,
          email: values.email,
          company: values.company,
          linkedin: values.linkedin,
          short_intro: values.shortIntro,
          company_intro: values.companyIntro,
        }),
      });
      const data = await response.json();
      if (response.ok) {
        if (data.session_token) {
          localStorage.setItem('sessionToken', data.session_token);
        }
        localStorage.setItem('userEmail', values.email.trim());
        localStorage.setItem('firstName', values.firstName || values.email.trim().split('@')[0] || 'User');
        localStorage.setItem('lastName', values.lastName || '');
        showToast('Account created. You are signed in.', 'success');
        window.dispatchEvent(new Event('authChange'));
        navigateAfterLogin(navigate);
      } else {
        showToast(data.error || 'Registration failed. Please try again.', 'error');
      }
    } catch {
      showToast('Could not reach the server. Please try again.', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="login-page"
      style={{
        backgroundImage: `url(${bgImages[bgIndex]})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
      }}
    >
      <div className="login-card-container login-card-container--wide">
        <div className="enable-logo" style={{ marginBottom: '20px' }}>
          Enable<span className="dot">.</span>
        </div>

        <form onSubmit={handleRegister} className="login-form" noValidate>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', width: '100%' }}>
            <FormField htmlFor="firstName" error={submitted && errors.firstName}>
              <input type="text" name="firstName" id="firstName" placeholder="First Name" value={values.firstName} onChange={handleChange} onBlur={handleBlur} className={`styled-input centered-placeholder ${submitted && errors.firstName ? 'input-error' : ''}`} disabled={loading} aria-label="First name" />
            </FormField>
            <FormField htmlFor="lastName" error={submitted && errors.lastName}>
              <input type="text" name="lastName" id="lastName" placeholder="Last Name" value={values.lastName} onChange={handleChange} onBlur={handleBlur} className={`styled-input centered-placeholder ${submitted && errors.lastName ? 'input-error' : ''}`} disabled={loading} aria-label="Last name" />
            </FormField>
          </div>

          <FormField htmlFor="email" error={submitted && errors.email}>
            <input type="email" name="email" id="email" placeholder="Email Address" value={values.email} onChange={handleChange} onBlur={handleBlur} className={`styled-input centered-placeholder ${submitted && errors.email ? 'input-error' : ''}`} disabled={loading} aria-label="Email address" />
          </FormField>
          <FormField htmlFor="password" error={submitted && errors.password}>
            <input type="password" name="password" id="password" placeholder="Password (min 8 characters)" value={values.password} onChange={handleChange} onBlur={handleBlur} className={`styled-input centered-placeholder ${submitted && errors.password ? 'input-error' : ''}`} disabled={loading} aria-label="Password" />
          </FormField>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', width: '100%' }}>
            <input type="text" name="company" placeholder="Company Name" value={values.company} onChange={handleChange} className="styled-input centered-placeholder" disabled={loading} aria-label="Company name" />
            <input type="text" name="linkedin" placeholder="LinkedIn Profile" value={values.linkedin} onChange={handleChange} className="styled-input centered-placeholder" disabled={loading} aria-label="LinkedIn profile URL" />
          </div>

          <input type="text" name="shortIntro" placeholder="Short Personal Intro" value={values.shortIntro} onChange={handleChange} className="styled-input centered-placeholder" disabled={loading} aria-label="Short personal introduction" />
          <textarea name="companyIntro" placeholder="Company Intro" value={values.companyIntro} onChange={handleChange} className="styled-input centered-placeholder" style={{ minHeight: '80px', resize: 'vertical' }} disabled={loading} aria-label="Company introduction" />

          <button
            type="submit"
            disabled={loading}
            className="primary-button"
          >
            {loading ? 'Creating account…' : 'Create Account'}
          </button>

          <div className="form-divider">OR</div>

          <button
            type="button"
            onClick={handleGoogleRegister}
            disabled={loading}
            className="google-button"
          >
            <img src="/assets/icons/google.png" alt="Google" className="google-icon" />
            {loading ? 'Redirecting…' : 'Sign up with Google'}
          </button>

          <p className="login-footer-text">
            Already have an account?{' '}
            <button type="button" className="new-user-link" onClick={() => navigate('/login')} disabled={loading} aria-label="Go to login page">
              Login
            </button>
          </p>
        </form>
      </div>

      <div className="footer-text">enableyou.co</div>
    </div>
  );
}

export default RegisterUser;
