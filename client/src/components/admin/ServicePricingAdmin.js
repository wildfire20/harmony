import React, { useState, useEffect, useCallback } from 'react';
import { CheckCircle, AlertCircle, Edit3, Save, X, DollarSign, Clock } from 'lucide-react';

const API_BASE = '/api';
const authHeaders = () => {
  const token = localStorage.getItem('token');
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
};

const R = (n) => `R ${Number(n || 0).toFixed(2)}`;
const SERVICE_ICONS = {
  tuition:   { bg: 'bg-blue-100',   text: 'text-blue-700',   dot: 'bg-blue-500' },
  boarding:  { bg: 'bg-purple-100', text: 'text-purple-700', dot: 'bg-purple-500' },
  transport: { bg: 'bg-amber-100',  text: 'text-amber-700',  dot: 'bg-amber-500' },
  aftercare: { bg: 'bg-emerald-100',text: 'text-emerald-700',dot: 'bg-emerald-500' },
};

export default function ServicePricingAdmin() {
  const [prices, setPrices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [editValues, setEditValues] = useState({});
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/service-prices`, { headers: authHeaders() });
      const data = await res.json();
      setPrices(data.prices || []);
    } catch {
      setPrices([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const startEdit = (price) => {
    setEditing(price.service_key);
    setEditValues({
      amount: price.amount,
      label: price.label,
      description: price.description || '',
    });
    setFeedback(null);
  };

  const cancelEdit = () => {
    setEditing(null);
    setEditValues({});
  };

  const handleSave = async (serviceKey) => {
    if (parseFloat(editValues.amount) < 0) {
      setFeedback({ type: 'error', message: 'Amount cannot be negative' });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      const res = await fetch(`${API_BASE}/service-prices/${serviceKey}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({
          amount: parseFloat(editValues.amount) || 0,
          label: editValues.label,
          description: editValues.description,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setFeedback({ type: 'success', message: `${editValues.label} updated to ${R(editValues.amount)} per month.` });
      setEditing(null);
      load();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message });
    } finally {
      setSaving(false);
    }
  };

  const fmtUpdated = (p) => {
    if (!p.updated_at || (!p.updated_by_first_name && parseFloat(p.amount) === 0)) return null;
    const date = new Date(p.updated_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
    const who = p.updated_by_first_name ? ` by ${p.updated_by_first_name} ${p.updated_by_last_name}` : '';
    return `Last updated ${date}${who}`;
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Monthly Service Rates</h2>
        <p className="text-gray-400 text-sm mt-0.5">
          Set the monthly fee for each service. These rates are shown to parents when they submit proof of payment.
        </p>
      </div>

      {feedback && (
        <div className={`flex items-start gap-3 rounded-xl p-4 text-sm border ${
          feedback.type === 'success'
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
            : 'bg-red-50 border-red-200 text-red-700'
        }`}>
          {feedback.type === 'success'
            ? <CheckCircle className="h-5 w-5 shrink-0 mt-0.5" />
            : <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />}
          {feedback.message}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-10">
          <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-blue-600" />
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {prices.map((price) => {
            const style = SERVICE_ICONS[price.service_key] || SERVICE_ICONS.tuition;
            const isEditing = editing === price.service_key;
            const lastUpdated = fmtUpdated(price);

            return (
              <div
                key={price.service_key}
                className={`bg-white rounded-2xl border-2 p-5 transition-all ${
                  isEditing ? 'border-blue-400 shadow-lg shadow-blue-100' : 'border-gray-100'
                }`}
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl ${style.bg} flex items-center justify-center shrink-0`}>
                      <DollarSign className={`h-5 w-5 ${style.text}`} />
                    </div>
                    <div>
                      {isEditing ? (
                        <input
                          value={editValues.label}
                          onChange={e => setEditValues(v => ({ ...v, label: e.target.value }))}
                          className="text-sm font-bold text-gray-800 border-b border-blue-300 focus:outline-none w-full bg-transparent"
                        />
                      ) : (
                        <p className="text-sm font-bold text-gray-800">{price.label}</p>
                      )}
                      {isEditing ? (
                        <input
                          value={editValues.description}
                          onChange={e => setEditValues(v => ({ ...v, description: e.target.value }))}
                          placeholder="Short description (optional)"
                          className="text-xs text-gray-400 border-b border-gray-200 focus:outline-none w-full bg-transparent mt-0.5"
                        />
                      ) : (
                        price.description && <p className="text-xs text-gray-400">{price.description}</p>
                      )}
                    </div>
                  </div>

                  {!isEditing && (
                    <button
                      onClick={() => startEdit(price)}
                      className="text-gray-300 hover:text-blue-500 transition-colors shrink-0"
                      title="Edit price"
                    >
                      <Edit3 className="h-4 w-4" />
                    </button>
                  )}
                </div>

                {/* Amount */}
                {isEditing ? (
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs font-semibold text-gray-500 block mb-1">Monthly Amount (R)</label>
                      <div className="flex items-center border-2 border-blue-300 rounded-xl overflow-hidden focus-within:border-blue-500">
                        <span className="px-3 py-2.5 text-gray-400 font-semibold text-sm bg-gray-50 border-r border-blue-200">R</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={editValues.amount}
                          onChange={e => setEditValues(v => ({ ...v, amount: e.target.value }))}
                          className="flex-1 px-3 py-2.5 text-lg font-bold text-gray-800 focus:outline-none"
                          autoFocus
                        />
                        <span className="px-3 py-2.5 text-xs text-gray-400 bg-gray-50 border-l border-blue-200">/ month</span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleSave(price.service_key)}
                        disabled={saving}
                        className="flex-1 flex items-center justify-center gap-1.5 bg-blue-600 text-white text-sm font-semibold py-2 rounded-xl hover:bg-blue-700 disabled:opacity-60 transition-colors"
                      >
                        <Save className="h-4 w-4" />
                        {saving ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="px-3 py-2 border border-gray-200 text-gray-500 text-sm rounded-xl hover:bg-gray-50 transition-colors"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-end gap-1">
                      <span className={`text-3xl font-black ${parseFloat(price.amount) === 0 ? 'text-gray-300' : style.text}`}>
                        {R(price.amount)}
                      </span>
                      <span className="text-gray-400 text-sm mb-1">/ month</span>
                    </div>
                    {parseFloat(price.amount) === 0 && (
                      <p className="text-xs text-amber-600 font-medium mt-1">⚠ Price not set yet — click the edit icon to set a price</p>
                    )}
                    {lastUpdated && (
                      <div className="flex items-center gap-1 mt-2 text-xs text-gray-300">
                        <Clock className="h-3 w-3" />
                        {lastUpdated}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
        <p className="text-amber-800 text-sm font-semibold mb-1">How these prices are used</p>
        <ul className="text-amber-700 text-xs space-y-1 list-disc list-inside">
          <li>Prices are shown to parents when they open the "Submit Proof of Payment" screen</li>
          <li>Parents only see fees for services their child is enrolled in (based on their service flags)</li>
          <li>Tuition is shown to all parents</li>
          <li>Changing a price here takes effect immediately for all parents</li>
        </ul>
      </div>
    </div>
  );
}
