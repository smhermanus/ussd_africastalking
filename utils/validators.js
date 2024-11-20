export function validateUSSDRequest(req) {
  const { sessionId, phoneNumber } = req.body;
  
  // Log the entire request body for debugging
  console.log('Request body:', req.body);
  
  if (!sessionId) {
    throw new Error('Missing sessionId');
  }
  if (!phoneNumber) {
    throw new Error('Missing phoneNumber');
  }
  
  return true;
}

export function sanitizePhoneNumber(phoneNumber) {
  // Remove any non-digit characters
  const cleaned = phoneNumber.replace(/\D/g, '');
  
  // Ensure the number starts with the country code
  if (!cleaned.startsWith('27')) {
    return `27${cleaned}`;
  }
  
  return cleaned;
}

export function validatePermitNumber(permitNumber) {
  // Add your permit number validation logic here
  // For example: must be alphanumeric and between 5-10 characters
  const permitRegex = /^[A-Za-z0-9]{5,10}$/;
  return permitRegex.test(permitNumber);
}
