import React from 'react';

export const passwordIsValid = (password) =>
  password.length >= 8;

const ParentPasswordRequirements = ({ password }) => (
  <ul className="mt-2 space-y-1 text-xs text-gray-500" aria-label="Password requirements">
    <li className={password.length >= 8 ? 'text-emerald-600' : ''}>• At least 8 characters</li>
    <li>• Longer passphrases are easier to remember and safer</li>
  </ul>
);

export default ParentPasswordRequirements;