import React, { useState } from 'react';
import { DollarSign, FileText, Receipt, BadgeDollarSign, Tag, CreditCard } from 'lucide-react';
import { useTheme } from '../common/ThemeProvider';
import PaymentDashboard from './PaymentDashboard';
import ManualPayments from '../admin/ManualPayments';
import PendingPayments from '../admin/PendingPayments';
import ServicePricingAdmin from '../admin/ServicePricingAdmin';
import StudentFeeAssignment from '../admin/StudentFeeAssignment';

const PaymentsHub = () => {
  const { theme } = useTheme();
  const [activeTab, setActiveTab] = useState('invoices');

  const isDark = theme === 'dark';
  const cardBg = isDark ? 'bg-gray-900' : 'bg-white';
  const cardBorder = isDark ? 'border-gray-800' : 'border-gray-100';
  const textPrimary = isDark ? 'text-white' : 'text-gray-900';
  const textSecondary = isDark ? 'text-gray-400' : 'text-gray-600';

  const tabs = [
    { id: 'invoices',        label: 'Invoices',         icon: FileText },
    { id: 'manual',          label: 'Manual Payments',  icon: CreditCard },
    { id: 'pending',         label: 'Pending Payments', icon: Receipt },
    { id: 'service-pricing', label: 'Service Pricing',  icon: BadgeDollarSign },
    { id: 'one-off-fees',    label: 'One-Off Fees',     icon: Tag },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2.5 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-xl shadow-lg shadow-emerald-500/25">
          <DollarSign className="h-6 w-6 text-white" />
        </div>
        <div>
          <h1 className={`text-2xl font-bold ${textPrimary}`}>Payments</h1>
          <p className={`text-sm ${textSecondary}`}>Invoices, reconciliation and fee management</p>
        </div>
      </div>

      <div className={`${cardBg} rounded-2xl shadow-sm border ${cardBorder} p-1.5`}>
        <nav className="flex flex-wrap gap-1">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
                activeTab === id
                  ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-lg shadow-emerald-500/25'
                  : `${textSecondary} hover:bg-gray-100 dark:hover:bg-gray-800`
              }`}
            >
              <Icon className="h-4 w-4" />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </nav>
      </div>

      <div>
        {activeTab === 'invoices'        && <PaymentDashboard />}
        {activeTab === 'manual'          && <ManualPayments />}
        {activeTab === 'pending'         && <PendingPayments />}
        {activeTab === 'service-pricing' && <ServicePricingAdmin />}
        {activeTab === 'one-off-fees'    && <StudentFeeAssignment />}
      </div>
    </div>
  );
};

export default PaymentsHub;
