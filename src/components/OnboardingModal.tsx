import React, { useState } from 'react';
import { Building2, CreditCard, UserCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { ETHIOPIA_LOCATIONS } from '../data/ethiopiaCatalog';

export const OnboardingModal: React.FC = () => {
  const { firebaseUser, needsRoleSelection, completeOnboarding, settings, t } = useAuth();
  const [role, setRole] = useState<'customer' | 'pharmacy'>('customer');
  const [displayName, setDisplayName] = useState(firebaseUser?.displayName || '');
  const [city, setCity] = useState('Addis Ababa');
  const [phone, setPhone] = useState('+251');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!firebaseUser || !needsRoleSelection) return null;

  const uniqueCities = Array.from(new Set(ETHIOPIA_LOCATIONS.map((l) => l.city))).sort();
  const regFeeEtb =
    role === 'pharmacy'
      ? settings.pharmacyMonthlyPriceEtb || 50
      : settings.customerMonthlyPriceEtb || 50;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) {
      setError('Full name is required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await completeOnboarding({ role, displayName, city, phone });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save profile.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto">
      <div className="bg-white border border-slate-200 rounded-t-2xl sm:rounded-xl max-w-lg w-full max-h-[92dvh] overflow-y-auto p-5 sm:p-6 shadow-xl pb-safe">
        <div className="flex items-center gap-3 mb-4">
          <img
            src="/aplus-app-icon.png"
            alt="Aplus Drug Finder"
            className="w-10 h-10 rounded-lg object-cover shrink-0"
          />
          <div>
            <h2 className="text-base sm:text-lg font-bold text-slate-900">Complete Your Aplus Registration</h2>
            <p className="text-xs text-slate-500">
              Registration Fee: <strong className="text-[#123F91]">{regFeeEtb} Birr (ETB) for 1 Month</strong> · Account remains permanently saved.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-2">Account Type</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setRole('customer')}
                className={`p-3.5 rounded-lg border text-left transition-colors min-h-[64px] ${
                  role === 'customer'
                    ? 'border-[#123F91] bg-[#123F91]/5 text-[#123F91]'
                    : 'border-slate-200 text-slate-700 hover:border-slate-300'
                }`}
              >
                <UserCheck className="w-4 h-4 mb-1.5" />
                <div className="text-sm font-semibold">{t.registerCustomer}</div>
                <div className="text-xs text-slate-500 mt-0.5">
                  Find verified pharmacies & send prescriptions
                </div>
              </button>
              <button
                type="button"
                onClick={() => setRole('pharmacy')}
                className={`p-3.5 rounded-lg border text-left transition-colors min-h-[64px] ${
                  role === 'pharmacy'
                    ? 'border-[#43B02A] bg-[#43B02A]/5 text-[#123F91]'
                    : 'border-slate-200 text-slate-700 hover:border-slate-300'
                }`}
              >
                <Building2 className="w-4 h-4 mb-1.5 text-[#43B02A]" />
                <div className="text-sm font-semibold">{t.registerPharmacy}</div>
                <div className="text-xs text-slate-500 mt-0.5">
                  Verify EFDA license & receive requests
                </div>
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-blue-200 bg-blue-50/70 p-3 flex items-start gap-2.5 text-xs text-slate-800">
            <CreditCard className="w-4 h-4 text-[#123F91] shrink-0 mt-0.5" />
            <div>
              <strong>1-Month Registration Fee ({regFeeEtb} Birr / 30 Days):</strong> After saving your registration details, you will be asked to pay the <strong>{regFeeEtb} ETB</strong> monthly registration fee via Chapa, Telebirr, or CBE Birr to activate full platform access.
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Full Name</label>
            <input
              type="text"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#123F91]"
              placeholder="Abebe Kebede"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Ethiopian City</label>
              <select
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#123F91] bg-white"
              >
                {uniqueCities.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Phone Number</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#123F91] tabular-nums"
                placeholder="+251911000000"
              />
            </div>
          </div>

          {error && <p className="text-xs text-red-700 bg-red-50 p-2.5 rounded-lg">{error}</p>}

          <button
            type="submit"
            disabled={saving}
            className="w-full min-h-[44px] py-2.5 px-4 rounded-lg bg-[#123F91] text-white text-sm font-semibold hover:bg-[#0e3275] disabled:opacity-60 transition-colors"
          >
            {saving ? 'Creating Account...' : `Continue to ${regFeeEtb} Birr Registration Payment`}
          </button>
        </form>
      </div>
    </div>
  );
};
