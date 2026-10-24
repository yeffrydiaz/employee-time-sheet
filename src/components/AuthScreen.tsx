import React, { useState } from 'react';
import { Eye, EyeOff, ArrowLeft, AlertCircle } from 'lucide-react';
import { createBusinessAccount, signInUser } from '../services/dataStore';
import { AppUser, Company } from '../types/timeclock';

interface AuthScreenProps {
  onNavigate: (path: string) => void;
  onAuthenticated: (user: AppUser, company: Company) => void;
}

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Toronto',
  'America/Vancouver',
  'Europe/London',
  'UTC',
];

export default function AuthScreen({ onNavigate, onAuthenticated }: AuthScreenProps) {
  const [activeTab, setActiveTab] = useState<'signin' | 'signup'>('signin');

  // Sign In state
  const [identifier, setIdentifier] = useState('');
  const [signInPassword, setSignInPassword] = useState('');
  const [showSignInPassword, setShowSignInPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [signInError, setSignInError] = useState('');

  // Create Business Account state
  const [companyName, setCompanyName] = useState('');
  const [ownerFullName, setOwnerFullName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [signUpPassword, setSignUpPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showSignUpPassword, setShowSignUpPassword] = useState(false);
  const [timezone, setTimezone] = useState('America/New_York');
  const [signUpError, setSignUpError] = useState('');

  const handleSignInSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSignInError('');

    if (!identifier.trim()) {
      setSignInError('Please enter your Username or Email.');
      return;
    }
    if (!signInPassword) {
      setSignInError('Please enter your Password.');
      return;
    }

    const res = signInUser(identifier, signInPassword, rememberMe);
    if (!res.ok) {
      setSignInError(res.error);
      return;
    }

    onAuthenticated(res.user, res.company);
    if (res.user.role === 'Admin' || res.user.role === 'Manager') {
      onNavigate('/admin');
    } else {
      onNavigate('/my-hours');
    }
  };

  const handleSignUpSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSignUpError('');

    if (!companyName.trim()) {
      setSignUpError('Company Name is required.');
      return;
    }
    if (!ownerFullName.trim()) {
      setSignUpError('Your Full Name is required.');
      return;
    }
    if (!ownerEmail.trim() || !ownerEmail.includes('@')) {
      setSignUpError('Please enter a valid Email address.');
      return;
    }
    if (!signUpPassword || signUpPassword.length < 4) {
      setSignUpError('Password must be at least 4 characters.');
      return;
    }
    if (signUpPassword !== confirmPassword) {
      setSignUpError('Passwords do not match. Please re-enter your password.');
      return;
    }

    const res = createBusinessAccount({
      companyName,
      ownerFullName,
      ownerEmail,
      password: signUpPassword,
      timezone,
    });

    if (!res.ok) {
      setSignUpError(res.error);
      return;
    }

    onAuthenticated(res.user, res.company);
    onNavigate('/admin');
  };

  const fillDemoAccount = (username: string) => {
    setActiveTab('signin');
    setIdentifier(username);
    setSignInPassword('demo1234');
    setSignInError('');
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col justify-center items-center px-4 py-8 text-slate-900">
      <div className="w-full max-w-md">
        <div className="mb-4">
          <button
            type="button"
            onClick={() => onNavigate('/')}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>← Back to timesheet</span>
          </button>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 sm:p-8">
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Time Sheet Manager
            </h1>
            <p className="text-sm font-medium text-slate-500 mt-1">
              Business Login
            </p>
          </div>

          {/* Two tabs: Sign In | Create Business Account */}
          <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg mb-6">
            <button
              type="button"
              onClick={() => {
                setActiveTab('signin');
                setSignInError('');
              }}
              className={`py-2 px-3 text-xs sm:text-sm font-semibold rounded-md transition-colors whitespace-nowrap ${
                activeTab === 'signin'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('signup');
                setSignUpError('');
              }}
              className={`py-2 px-3 text-xs sm:text-sm font-semibold rounded-md transition-colors whitespace-nowrap ${
                activeTab === 'signup'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Create Business Account
            </button>
          </div>

          {activeTab === 'signin' ? (
            <form onSubmit={handleSignInSubmit} className="space-y-4" noValidate>
              {signInError && (
                <div
                  role="alert"
                  className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-700 flex items-start gap-2"
                >
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <span>{signInError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Username or Email <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={identifier}
                  onChange={e => setIdentifier(e.target.value)}
                  placeholder="e.g. admin1 or alex@royal-trans.com"
                  className="w-full min-h-[42px] px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Password <span className="text-red-600">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showSignInPassword ? 'text' : 'password'}
                    required
                    value={signInPassword}
                    onChange={e => setSignInPassword(e.target.value)}
                    placeholder="Enter password"
                    className="w-full min-h-[42px] pl-3 pr-10 py-2 text-sm border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSignInPassword(!showSignInPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
                    aria-label={showSignInPassword ? 'Hide password' : 'Show password'}
                  >
                    {showSignInPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={e => setRememberMe(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                  />
                  <span>Remember me</span>
                </label>
              </div>

              <button
                type="submit"
                className="w-full min-h-[44px] py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                Sign In
              </button>

              <p className="text-xs text-slate-500 text-center pt-1">
                Employees: your account is created by your manager.
              </p>
            </form>
          ) : (
            <form onSubmit={handleSignUpSubmit} className="space-y-4" noValidate>
              {signUpError && (
                <div
                  role="alert"
                  className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-700 flex items-start gap-2"
                >
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <span>{signUpError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Company Name <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={companyName}
                  onChange={e => setCompanyName(e.target.value)}
                  placeholder="e.g. Acme Logistics"
                  className="w-full min-h-[42px] px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Your Full Name <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={ownerFullName}
                  onChange={e => setOwnerFullName(e.target.value)}
                  placeholder="e.g. Jordan Smith"
                  className="w-full min-h-[42px] px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Email <span className="text-red-600">*</span>
                </label>
                <input
                  type="email"
                  required
                  value={ownerEmail}
                  onChange={e => setOwnerEmail(e.target.value)}
                  placeholder="owner@company.com"
                  className="w-full min-h-[42px] px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Password <span className="text-red-600">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showSignUpPassword ? 'text' : 'password'}
                      required
                      value={signUpPassword}
                      onChange={e => setSignUpPassword(e.target.value)}
                      placeholder="Password"
                      className="w-full min-h-[42px] pl-3 pr-9 py-2 text-sm border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSignUpPassword(!showSignUpPassword)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
                    >
                      {showSignUpPassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Confirm Password <span className="text-red-600">*</span>
                  </label>
                  <input
                    type={showSignUpPassword ? 'text' : 'password'}
                    required
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="Confirm"
                    className="w-full min-h-[42px] px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Company Timezone <span className="text-red-600">*</span>
                </label>
                <select
                  value={timezone}
                  onChange={e => setTimezone(e.target.value)}
                  className="w-full min-h-[42px] px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                >
                  {TIMEZONES.map(tz => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="submit"
                className="w-full min-h-[44px] py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                Create Business Account
              </button>

              <p className="text-xs text-slate-500 text-center pt-1">
                Creates your company and your Admin account. You can add employees next.
              </p>
            </form>
          )}
        </div>

        {/* Part J: Demo accounts box for testing */}
        <div className="mt-4 bg-white border border-slate-200 rounded-xl p-4 text-xs text-slate-600 shadow-2xs">
          <div className="flex items-center justify-between mb-2">
            <span className="font-bold text-slate-800">
              Demo accounts (Royal Transportation)
            </span>
            <span className="font-mono text-slate-500">
              Password: <strong>demo1234</strong>
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mb-2">
            Click any account below to pre-fill credentials:
          </p>
          <div className="space-y-1.5">
            {[
              { user: 'admin1', desc: 'Admin — Alex Owner (owner)' },
              { user: 'manager1', desc: 'Manager, Dispatch — Maria Manager (can approve, can view reports)' },
              { user: 'emp1', desc: 'Employee, Office — Emily Employee (can edit own time)' },
              { user: 'emp2', desc: 'Employee, Drivers — David Driver (cannot edit own time)' },
              { user: 'emp3', desc: 'Employee, Drivers — inactive example (Status Inactive)' },
            ].map(item => (
              <button
                key={item.user}
                type="button"
                onClick={() => fillDemoAccount(item.user)}
                className="w-full text-left px-2.5 py-1.5 rounded-md hover:bg-slate-100 transition-colors flex items-center justify-between gap-2 border border-transparent hover:border-slate-200"
              >
                <span>
                  <strong className="font-mono text-slate-900">{item.user}</strong> — {item.desc}
                </span>
                <span className="text-[11px] font-semibold text-slate-500 shrink-0">Fill</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
