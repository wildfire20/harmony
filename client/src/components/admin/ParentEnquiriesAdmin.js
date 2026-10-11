import React from 'react';
import api from '../../services/api';
import EnquiryWorkspace from '../common/EnquiryWorkspace';

const request = async (path, options = {}) => {
  try {
    return (await api.request({
      url: `/parent/enquiries/admin${path}`, method: options.method || 'GET',
      ...(options.body ? { data: JSON.parse(options.body) } : {}),
    })).data;
  } catch (error) { throw new Error(error.response?.data?.message || error.message); }
};
export default function ParentEnquiriesAdmin() { return <EnquiryWorkspace request={request} admin />; }
