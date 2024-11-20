import express from 'express';
import { checkPermitStatus, checkQuotaBalance } from '../services/permitService.js';
import { notifyRightsHolder } from '../services/notificationService.js';
import { validateUSSDRequest } from '../utils/validators.js';
import { MENU_TEXT } from '../constants/menuText.js';

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    validateUSSDRequest(req);

    const {
      sessionId,
      phoneNumber,
      text = ''
    } = req.body;

    let response = '';
    const textArray = text ? text.split('*') : [''];
    const lastInput = textArray[textArray.length - 1];

    console.log('Processing USSD request:', {
      sessionId,
      phoneNumber,
      text,
      textArray,
      lastInput,
      arrayLength: textArray.length
    });

    // Return to main menu when 0 is pressed
    if (lastInput === '0') {
      response = MENU_TEXT.MAIN_MENU;
    }
    // Initial menu display
    else if (text === '') {
      response = MENU_TEXT.MAIN_MENU;
    }
    // Handle main menu selections (1, 2, or 3)
    else if (lastInput === '1' || lastInput === '2' || lastInput === '3') {
      response = MENU_TEXT.ENTER_QUOTA;
    }
    // Option 1 flow - Notify Rights Holder
    else if (text.startsWith('1*') && !text.endsWith('*0')) {
      response = await handleNotifyRightsHolder(textArray, sessionId, phoneNumber);
    }
    // Option 2 flow - Check Quota Status
    else if (text.startsWith('2*') && !text.endsWith('*0')) {
      response = await handleCheckQuotaStatus(textArray, sessionId, phoneNumber);
    }
    // Option 3 flow - Check Quota Balance
    else if (text.startsWith('3*') && !text.endsWith('*0')) {
      response = await handleCheckQuotaBalance(textArray, sessionId, phoneNumber);
    }
    // Invalid input handler
    else {
      response = MENU_TEXT.INVALID_INPUT;
    }

    res.set('Content-Type', 'text/plain');
    res.send(response);

  } catch (error) {
    console.error('Unexpected error:', error);
    res.set('Content-Type', 'text/plain');
    res.send('CON An unexpected error occurred. Press 0 to return to the main menu');
  }
});

// Handler for Option 1 - Notify Rights Holder
async function handleNotifyRightsHolder(textArray, sessionId, phoneNumber) {
  if (textArray.length !== 2) return MENU_TEXT.INVALID_INPUT;

  const permitNumber = textArray[1];
  
  try {
    const quotaBalance = await checkQuotaBalance(permitNumber);
    const isValid = await checkPermitStatus(permitNumber);
    
    if (!isValid) {
      return `CON Quota code ${permitNumber} is invalid or not found. 
      
      Press 0 to return to the main menu or enter a different Quota code`;
    }
    
    if (quotaBalance <= 0) {
      return `CON Quota code ${permitNumber} has insufficient Quota Balance. 
      
      Press 0 to return to the main menu or enter a different Quota code`;
    }
    
    const notified = await notifyRightsHolder(phoneNumber, permitNumber, sessionId);
    if (notified) {
      return 'END Notification sent to Rights Holder via SMS and Email.';
    }
    
    return `CON Failed to notify Rights Holder. 
    
    Press 0 to return to the main menu or enter a different Quota code`;
  } catch (error) {
    console.error('Error in handleNotifyRightsHolder:', error);
    return `CON An error occurred. 
    
    Press 0 to return to the main menu or enter a different Quota code`;
  }
}

// Handler for Option 2 - Check Quota Status
async function handleCheckQuotaStatus(textArray, sessionId, phoneNumber) {
  const permitNumber = textArray[1];
  
  if (textArray.length === 2) {
    try {
      const isValid = await checkPermitStatus(permitNumber);
      
      if (isValid) {
        return `CON Quota code ${permitNumber} is valid. Do you want to notify the Rights Holder of your intention to depart?
        1. Yes
        2. No
        0. Main menu`;
      }
      
      return `CON Quota code ${permitNumber} is invalid or not found. 
      
      Press 0 to return to the main menu or enter a different Quota code`;
    } catch (error) {
      console.error('Error in handleCheckQuotaStatus:', error);
      return `CON An error occurred. 
      
      Press 0 to return to the main menu or enter a different Quota code`;
    }
  } 
  else if (textArray.length === 3) {
    const choice = textArray[2];
    
    if (choice === '1') {
      try {
        const notified = await notifyRightsHolder(phoneNumber, permitNumber, sessionId);
        if (notified) {
          return 'END Notification sent to Rights Holder via SMS and Email.';
        }
        return `CON Failed to notify Rights Holder. 
        
        Press 0 to return to the main menu or enter a different Quota code`;
      } catch (error) {
        console.error('Error in quota status notification:', error);
        return `CON An error occurred while sending notification. 
        
        Press 0 to return to the main menu or enter a different Quota code`;
      }
    } 
    else if (choice === '2') {
      return 'END Thank you for checking your Quota status.';
    }
    
    return 'CON Invalid choice. Press 0 to return to the main menu';
  }
  
  return MENU_TEXT.INVALID_INPUT;
}

// Handler for Option 3 - Check Quota Balance
async function handleCheckQuotaBalance(textArray, sessionId, phoneNumber) {
  const permitNumber = textArray[1];
  
  if (textArray.length === 2) {
    try {
      const quotaBalance = await checkQuotaBalance(permitNumber);
      const isValid = await checkPermitStatus(permitNumber);
      
      if (isValid) {
        return `CON Remaining Quota balance for Quota code ${permitNumber} is: ${quotaBalance} kg. Do you want to notify the Rights Holder of your intention to depart?
        1. Yes
        2. No
        0. Main menu`;
      }
      
      return `CON Quota code ${permitNumber} is invalid or has insufficient Quota balance. 
      
      Press 0 to return to the main menu or enter a different Quota code`;
    } catch (error) {
      console.error('Error in handleCheckQuotaBalance:', error);
      return `CON An error occurred. 
      
      Press 0 to return to the main menu or enter a different Quota code`;
    }
  } 
  else if (textArray.length === 3) {
    const choice = textArray[2];
    
    if (choice === '1') {
      try {
        const notified = await notifyRightsHolder(phoneNumber, permitNumber, sessionId);
        if (notified) {
          return 'END Notification sent to Rights Holder via SMS and Email.';
        }
        return `CON Failed to notify Rights Holder. 
        
        Press 0 to return to the main menu or enter a different Quota code`;
      } catch (error) {
        console.error('Error in quota balance notification:', error);
        return `CON An error occurred while sending notification. 
        
        Press 0 to return to the main menu or enter a different Quota code`;
      }
    } 
    else if (choice === '2') {
      return 'END Thank you for checking the Quota balance.';
    }
    
    return 'CON Invalid choice. Press 0 to return to the main menu';
  }
  
  return MENU_TEXT.INVALID_INPUT;
}

export default router;