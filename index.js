require('dotenv').config();

import express, { json, urlencoded } from 'express';
import { Pool } from 'pg';
import AfricasTalking from 'africastalking';
import { createTransport } from 'nodemailer';

const app = express();
app.use(json());
app.use(urlencoded({ extended: true })); // Changed to true for nested objects

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Africa's Talking setup
const africastalking = new AfricasTalking({
  apiKey: process.env.AFRICASTALKING_API_KEY,
  username: process.env.AFRICASTALKING_USERNAME,
});

// Nodemailer setup
const transporter = createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  auth: {
    user: process.env.EMAIL_USER, 
    pass: process.env.EMAIL_PASS
  }
});

// Helper function to validate USSD request
function validateUSSDRequest(req) {
  const { sessionId, phoneNumber } = req.body;
  
  // Log the entire request body for debugging
  console.log('Request body:', req.body);
  
  if (!sessionId) {
    throw new Error('Missing sessionId');
  }
  if (!phoneNumber) {
    throw new Error('Missing phoneNumber');
  }
  
  // Don't validate text parameter since it can be empty on initial request
  return true;
}

// Helper function to check permit status
async function checkPermitStatus(permitNumber) {
  try {
    const result = await pool.query('SELECT date_expiry FROM permits WHERE permit_number = $1', [permitNumber]);
    if (result.rows.length > 0) {
      const expirationDate = new Date(result.rows[0].date_expiry);
      const currentDate = new Date();
      return expirationDate > currentDate;
    }
    return false;
  } catch (error) {
    console.error('Error in checkPermitStatus:', error);
    throw error;
  }
}

// Helper function to check quota balance
async function checkQuotaBalance(permitNumber) {
  try {
    const result = await pool.query('SELECT quota_balance FROM permits WHERE permit_number = $1', [permitNumber]);
    if (result.rows.length > 0) {
      return result.rows[0].quota_balance;
    }
    return 0;
  } catch (error) {
    console.error('Error in checkQuotaBalance:', error);
    throw error;
  }
}

// Helper function to notify rights holder
async function notifyRightsHolder(phoneNumber, permitNumber, sessionId) {
  try {
    // First, check if a notification has already been sent for this session
    const existingNotification = await pool.query(
      'SELECT id FROM skipper_notifications WHERE sessionid = $1',
      [sessionId]
    );
    
    if (existingNotification.rows.length > 0) {
      return true; // Notification already exists for this session
    }

    const result = await pool.query(
      'SELECT rh_cell_phone, email FROM rights_holders WHERE permit_number = $1',
      [permitNumber]
    );

    if (result.rows.length > 0) {
      const { rh_cell_phone, email } = result.rows[0];
      const message = `This is a notification to inform you that your Authorised Rep (Skipper) intends to depart to sea against Quota code: ${permitNumber}.`;
      
      // Send Email
      await transporter.sendMail({
        from: process.env.EMAIL_FROM,
        to: email,
        subject: 'Skipper (Auth Rep) Departure Notification',
        text: message,
      });
      
      // Send SMS
      const response = await africastalking.SMS.send({
        to: [rh_cell_phone],
        message: message,
        from: 'CatchTrack' 
      });
      
      console.log('SMS Response:', response);

      try {
        // Insert notification record into database
        await pool.query(
          `INSERT INTO skipper_notifications 
           (cellphone_nr, permit_number, sessionid, status, date_sent) 
           VALUES ($1, $2, $3, $4, NOW())`,
          [
            phoneNumber.toString(),
            permitNumber.toString(),
            sessionId.toString(),
            'approved'
          ]
        );
      } catch (dbError) {
        console.error('Database insertion error:', dbError);
        // Even if DB insert fails, return true if notification was sent
        return true;
      }

      return true;
    }
    return false;
  } catch (error) {
    console.error('Error in notifyRightsHolder:', error);
    throw error;
  }
}

app.post('/ussd', async (req, res) => {
  try {
    validateUSSDRequest(req);

    const {
      sessionId,
      phoneNumber,
      text = ''
    } = req.body;

    let response = '';
    const textArray = text ? text.split('*') : [''];

    console.log('Processing USSD request:', {
      sessionId,
      phoneNumber,
      text,
      textArray,
      arrayLength: textArray.length
    });

    // Main menu
    if (text === '') {
      response = `CON What would you like to do?
      1. Notify Rights Holder
      2. Check Quota Status
      3. Check Quota Balance`;
    } 
    
    // Return to main menu when 0 is pressed
    else if (text === '1*0' || text === '2*0' || text === '3*0') {
      response = `CON What would you like to do?
      1. Notify Rights Holder
      2. Check Quota Status
      3. Check Quota Balance`;
    }
    
    // Main menu option selections
    else if (text === '1' || text === '2' || text === '3') {
      response = 'CON Enter your Quota Code or press 0 to return to the main menu';
    }
    
    // Option 1 flow - Notify Rights Holder
    else if (text.startsWith('1*') && text !== '1*0') {
      const permitNumber = textArray[1];
      
      // Check if it's just the quota code entry (no additional selections)
      if (textArray.length === 2) {
        try {
          const quotaBalance = await checkQuotaBalance(permitNumber);
          const isValid = await checkPermitStatus(permitNumber);
          
          if (!isValid) {
            response = `CON Quota code ${permitNumber} is invalid or not found. 
            
            Press 0 to return to the main menu or enter a different Quota code`;
          } else if (quotaBalance <= 0) {
            response = `CON Quota code ${permitNumber} has insufficient Quota Balance. 
            
            Press 0 to return to the main menu or enter a different Quota code`;
          } else {
            const notified = await notifyRightsHolder(phoneNumber, permitNumber, sessionId);
            if (notified) {
              response = 'END Notification sent to Rights Holder via SMS and Email.';
            } else {
              response = `CON Failed to notify Rights Holder. 
              
              Press 0 to return to the main menu or enter a different Quota code`;
            }
          }
        } catch (error) {
          console.error('Error in option 1:', error);
          response = `CON An error occurred. 
          
          Press 0 to return to the main menu or enter a different Quota code`;
        }
      }
    }
    
    // Option 2 flow - Check Quota status
    else if (text.startsWith('2*') && text !== '2*0') {
      const permitNumber = textArray[1];
      
      // Check if it's just the quota code entry (no additional selections)
      if (textArray.length === 2) {
        try {
          const isValid = await checkPermitStatus(permitNumber);
          if (isValid) {
            response = `CON Quota code ${permitNumber} is valid. Do you want to notify the Rights Holder of your intention to depart?
            1. Yes
            2. No
            0. Main menu`;
          } else {
            response = `CON Quota code ${permitNumber} is invalid or not found. 
            
            Press 0 to return to the main menu or enter a different Quota code`;
          }
        } catch (error) {
          console.error('Error in option 2:', error);
          response = `CON An error occurred. 
          
          Press 0 to return to the main menu or enter a different Quota code`;
        }
      } else if (textArray.length === 3) {
        const choice = textArray[2];
        if (choice === '1') {
          try {
            const notified = await notifyRightsHolder(phoneNumber, permitNumber, sessionId);
            if (notified) {
              response = 'END Notification sent to Rights Holder via SMS and Email.';
            } else {
              response = `CON Failed to notify Rights Holder. 
              
              Press 0 to return to the main menu or enter a different Quota code`;
            }
          } catch (error) {
            console.error('Error in option 2 notification:', error);
            response = `CON An error occurred while sending notification. 
            
            Press 0 to return to the main menu or enter a different Quota code`;
          }
        } else if (choice === '2') {
          response = 'END Thank you for checking your Quota status.';
        } else if (choice === '3') {
          response = 'CON Enter Quota code or press 0 to return to the main menu';
        } else {
          response = 'CON Invalid choice. Press 0 to return to the main menu or enter a valid Quota code';
        }
      }
    }
    
    // Option 3 flow - Check Quota balance
    else if (text.startsWith('3*') && text !== '3*0') {
      const permitNumber = textArray[1];
      
      // Check if it's just the quota code entry (no additional selections)
      if (textArray.length === 2) {
        try {
          const quotaBalance = await checkQuotaBalance(permitNumber);
          const isValid = await checkPermitStatus(permitNumber);
          if (isValid) {
            response = `CON Remaining Quota balance for Quota code ${permitNumber} is: ${quotaBalance} kg. Do you want to notify the Rights Holder of your intention to depart?
            1. Yes
            2. No
            0. Main menu`;
          } else {
            response = `CON Quota code ${permitNumber} is invalid or has insufficient Quota balance. 
            
            Press 0 to return to the main menu or enter a different Quota code`;
          }
        } catch (error) {
          console.error('Error in option 3:', error);
          response = `CON An error occurred. 
          
          Press 0 to return to the main menu or enter a different Quota code`;
        }
      } else if (textArray.length === 3) {
        const choice = textArray[2];
        if (choice === '1') {
          try {
            const notified = await notifyRightsHolder(phoneNumber, permitNumber, sessionId);
            if (notified) {
              response = 'END Notification sent to Rights Holder via SMS and Email.';
            } else {
              response = `CON Failed to notify Rights Holder. 
              
              Press 0 to return to the main menu or enter a different Quota code`;
            }
          } catch (error) {
            console.error('Error in option 3 notification:', error);
            response = `CON An error occurred while sending notification. 
            
            Press 0 to return to the main menu or enter a different Quota code`;
          }
        } else if (choice === '2') {
          response = 'END Thank you for checking the Quota balance.';
        } else if (choice === '3') {
          response = 'CON Enter Quota code or press 0 to return to the main menu';
        } else {
          response = 'CON Invalid choice. Press 0 to return to the main menu or enter a valid Quota code';
        }
      }
    }
    
    // Invalid input handler
    else {
      response = `CON Invalid input.
      
      Press 0 to return to the main menu`;
    }
    
    // Send response back to Africa's Talking gateway
    res.set('Content-Type', 'text/plain');
    res.send(response);
    
  } catch (error) {
    console.error('Unexpected error:', error);
    res.set('Content-Type', 'text/plain');
    res.send('CON An unexpected error occurred. Press 0 to return to the main menu');
  }
});

export default app;