import React from 'react';
import { Link } from 'react-router-dom';
import { MessageSquare } from 'lucide-react';
import useAdminEnquiryAlerts from '../../hooks/useAdminEnquiryAlerts';
import '../common/Enquiries.css';

export default function EnquiryAlert() {
  const { count, isError } = useAdminEnquiryAlerts();
  if (!count && !isError) return null;
  return <div role="status" className="enquiry-alert flex flex-col gap-4 rounded-2xl border-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
    <div className="flex items-start gap-3">
      <MessageSquare className="mt-1 h-6 w-6 shrink-0" aria-hidden="true" />
      <div>
        <p className="enquiry-alert-title font-bold">{isError ? 'Enquiry alerts could not be refreshed' : `${count} enquir${count === 1 ? 'y has' : 'ies have'} unread messages`}</p>
        <p className="enquiry-alert-copy mt-1 text-sm">{isError ? 'Open Enquiries and select Refresh to check for parent questions.' : 'Open Enquiries to read new questions and parent replies.'}</p>
      </div>
    </div>
    <Link to="/enquiries" className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-teal-700 px-4 py-2.5 font-semibold text-white hover:bg-teal-800 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:ring-offset-2">View enquiries</Link>
  </div>;
}
