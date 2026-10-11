import React from 'react';
import EnquiryWorkspace from '../common/EnquiryWorkspace';
import { parentApi } from './ParentPortal';

const request = (path, options = {}) => parentApi(`/enquiries${path}`, { ...options, skipChildId: true });
export default function ParentEnquiries() { return <EnquiryWorkspace request={request} />; }
