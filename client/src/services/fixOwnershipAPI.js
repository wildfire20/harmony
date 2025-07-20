import api from './api';

const fixOwnershipAPI = {
  // Fix announcement ownership for teachers
  fixOwnership: () => {
    return api.post('/fix-ownership/fix-ownership');
  }
};

export default fixOwnershipAPI;
