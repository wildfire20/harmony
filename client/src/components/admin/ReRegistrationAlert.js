import React from 'react';
import { Link } from 'react-router-dom';
import useAdminReRegistrationAlerts from '../../hooks/useAdminReRegistrationAlerts';
import '../common/ReRegistration.css';
export default function ReRegistrationAlert() {
  const { count } = useAdminReRegistrationAlerts();
  if (!count) return null;
  return <div className="rr-shell rr-admin"><div className="rr-notice" role="status"><strong>{count} re-registration {count === 1 ? 'form needs' : 'forms need'} review</strong>
    <p>Returning learners for 2027. Review the forms and confirm their status.</p><Link className="rr-button" to="/re-registration">View re-registrations</Link></div></div>;
}
