require('dotenv').config();

import express, { json, urlencoded } from 'express';
import { Pool } from 'pg';
import AfricasTalking from 'africastalking';
import { createTransport } from 'nodemailer';

const app = express();
app.use(json());
app.use(urlencoded({ extended: false }));

// ... (previous connection setup code remains the same)

// Helper function to validate USSD request
function validateUSSDRequest(req) {
  const { sessionId, phoneNumber, text, serviceCode } = req.body;
  
  console.log('Received USSD request:', {
    sessionId,
    phoneNumber,
    text,
    serviceCode
  });

  if (!sessionId) {
    throw new Error('Missing sessionId');
  }
  if (!phoneNumber) {
    throw new Error('Missing phoneNumber');
  }
  if (text === undefined) {  // text can be empty string but not undefined
    throw new Error('Missing text parameter');
  }
}

app.post('/ussd', async (req, res) => {
  try {
    // Validate the request
    validateUSSDRequest(req);

    const {
      sessionId,
      phoneNumber,
      text = '',  // Default to empty string if undefined
      serviceCode
    } = req.body;

    let response = '';
    const textArray = text ? text.split('*') : [''];  // Handle empty text safely

    console.log('Processing USSD request:', {
      sessionId,
      phoneNumber,
      text,
      textArray,
      serviceCode
    });

    if (text === '') {
      response = `CON What would you like to do?
      1. Notify Rights Holder
      2. Check permit status
      3. Check Quota balance`;
    } 
    
    // Option 1 flow
    else if (text === '1') {
      response = 'CON Enter permit number or press 0 to return to the main menu';
    } 
    else if (text.startsWith('1*') && text !== '1*0') {
      const permitNumber = textArray[1];
      if (!permitNumber) {
        response = 'END Invalid permit number';
        return;
      }

      try {
        const quotaBalance = await checkQuotaBalance(permitNumber);
        const isValid = await checkPermitStatus(permitNumber);
        
        if (!isValid) {
          response = `END Permit ${permitNumber} is invalid or not found.`;
        } else if (quotaBalance <= 0) {
          response = `END Permit ${permitNumber} has insufficient quota balance.`;
        } else {
          const notified = await notifyRightsHolder(phoneNumber, permitNumber, sessionId);
          if (notified) {
            response = 'END Notification sent to Rights Holder via SMS and Email.';
          } else {
            response = 'END Failed to notify Rights Holder. Rights holder information not found.';
          }
        }
      } catch (error) {
        console.error('Error in option 1:', error);
        response = 'END An error occurred. Please try again later.';
      }
    }
    
    // Option 2 flow
    else if (text === '2') {
      response = 'CON Enter permit number or press 0 to return to the main menu';
    } 
    else if (text.startsWith('2*') && textArray.length === 2 && text !== '2*0') {
      const permitNumber = textArray[1];
      if (!permitNumber) {
        response = 'END Invalid permit number';
        return;
      }

      try {
        const isValid = await checkPermitStatus(permitNumber);
        if (isValid) {
          response = `CON Permit ${permitNumber} is valid. Do you want to notify the rights holder of your intention to depart?
          1. Yes
          2. No`;
        } else {
          response = `END Permit ${permitNumber} is invalid or not found.`;
        }
      } catch (error) {
        console.error('Error in option 2:', error);
        response = 'END An error occurred. Please try again later.';
      }
    }
    else if (text.startsWith('2*') && textArray.length === 3) {
      const [_, permitNumber, choice] = textArray;
      if (!permitNumber || !choice) {
        response = 'END Invalid input';
        return;
      }

      if (choice === '1') {
        try {
          const notified = await notifyRightsHolder(phoneNumber, permitNumber, sessionId);
          if (notified) {
            response = 'END Notification sent to Rights Holder via SMS and Email.';
          } else {
            response = 'END Failed to notify Rights Holder. Rights holder information not found.';
          }
        } catch (error) {
          console.error('Error in option 2 notification:', error);
          response = 'END An error occurred while sending notification.';
        }
      } else if (choice === '2') {
        response = 'END Thank you for using our service.';
      } else {
        response = 'END Invalid choice. Please start over.';
      }
    }
    
    // Option 3 flow
    else if (text === '3') {
      response = 'CON Enter permit number or press 0 to return to the main menu';
    }
    else if (text.startsWith('3*') && textArray.length === 2 && text !== '3*0') {
      const permitNumber = textArray[1];
      if (!permitNumber) {
        response = 'END Invalid permit number';
        return;
      }

      try {
        const quotaBalance = await checkQuotaBalance(permitNumber);
        const isValid = await checkPermitStatus(permitNumber);
        if (isValid) {
          response = `CON Remaining quota balance for permit ${permitNumber} is: ${quotaBalance} kg. Do you want to notify the rights holder of your intention to depart?
          1. Yes
          2. No`;
        } else {
          response = `END Permit ${permitNumber} is invalid or has insufficient quota balance.`;
        }
      } catch (error) {
        console.error('Error in option 3:', error);
        response = 'END An error occurred. Please try again later.';
      }
    }
    else if (text.startsWith('3*') && textArray.length === 3) {
      const [_, permitNumber, choice] = textArray;
      if (!permitNumber || !choice) {
        response = 'END Invalid input';
        return;
      }

      if (choice === '1') {
        try {
          const notified = await notifyRightsHolder(phoneNumber, permitNumber, sessionId);
          if (notified) {
            response = 'END Notification sent to Rights Holder via SMS and Email.';
          } else {
            response = 'END Failed to notify Rights Holder. Rights holder information not found.';
          }
        } catch (error) {
          console.error('Error in option 3 notification:', error);
          response = 'END An error occurred while sending notification.';
        }
      } else if (choice === '2') {
        response = 'END Thank you for using our service.';
      } else {
        response = 'END Invalid choice. Please start over.';
      }
    }
    
    // Return to main menu
    else if (text === '1*0' || text === '2*0' || text === '3*0') {
      response = `CON What would you like to do?
      1. Notify Rights Holder
      2. Check permit status
      3. Check Quota balance`;
    }
    
    // Invalid input handler
    else {
      response = 'END Invalid input. Please try again.';
    }
    
    // Send response back to Africa's Talking gateway
    res.set('Content-Type', 'text/plain');
    res.send(response);
    
  } catch (error) {
    console.error('Unexpected error:', error);
    res.set('Content-Type', 'text/plain');
    res.send('END An unexpected error occurred. Please try again.');
  }
});

export default app;