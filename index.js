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

// Helper function to check Quota status
async function checkQuotaStatus(quotaCode) {
  try {
    const result = await pool.query('SELECT end_date FROM quotas WHERE quota_code = $1', [quotaCode]);
    if (result.rows.length > 0) {
      const endDate = new Date(result.rows[0].end_date);
      const currentDate = new Date();
      return endDate > currentDate;
    }
    return false;
  } catch (error) {
    console.error('Error in checkQuotaStatus:', error);
    throw error;
  }
}

// Helper function to check quota balance
async function checkQuotaBalance(quotaCode) {
  try {
    const result = await pool.query('SELECT quota_balance FROM quotas WHERE quota_code = $1', [quotaCode]);
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
async function notifyRightsHolder(phoneNumber, quotaCode, sessionId) {
  try {
    // First, check if a notification has already been sent for this session
    const existingNotification = await pool.query(
      'SELECT notification_id FROM trip_notifications WHERE sessionid = $1',
      [sessionId]
    );
    
    if (existingNotification.rows.length > 0) {
      return true; // Notification already exists for this session
    }

    const result = await pool.query(
      'SELECT cell_number, email FROM users WHERE quota_code = $1',
      [quotaCode]
    );

    if (result.rows.length > 0) {
      const { cell_number, email, quota_balance, end_date } = result.rows[0];
      
      // Create notification message with more details
      const message = `
        Notification: Authorised Rep with phone ${phoneNumber} intends to depart to sea.
        Quota Code: ${quotaCode}
        Current Balance: ${quota_balance} kg
        Valid until: ${new Date(end_date).toLocaleDateString()}
      `.trim();

      // Send Email
      try {
        await transporter.sendMail({
          from: process.env.EMAIL_FROM,
          to: email,
          subject: `Skipper Departure Notification - Quota ${quotaCode}`,
          text: message,
          html: `<div style="font-family: Arial, sans-serif;">
                  <h2>Skipper Departure Notification</h2>
                  <p>${message.replace(/\n/g, '<br>')}</p>
                </div>`
        });
      } catch (emailError) {
        console.error('Email sending failed:', emailError);
        // Continue with SMS even if email fails
      }
      
      // Send SMS
      const response = await africastalking.SMS.send({
        to: [cell_number],
        message: message,
        from: 'AssetFlwLtd' 
      });
      
      console.log('SMS Response:', response);

      try {
        // Insert notification record into database
        await pool.query(
          `INSERT INTO trip_notifications 
           (cellphone_nr, quota_code, sessionid, status, created_at) 
           VALUES ($1, $2, $3, $4, NOW())`,
          [
            phoneNumber.toString(),
            quotaCode.toString(),
            sessionId.toString(),
            'pending'
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
    const textArray = text ? text.split('*').filter(t => t !== '') : [];
    
    console.log('Processing USSD request:', {
      sessionId,
      phoneNumber,
      text,
      textArray,
      arrayLength: textArray.length
    });

    // Initial menu or after pressing 0
    if (text === '' || text.endsWith('*0')) {
      response = `CON What would you like to do?
      1. Notify Rights Holder
      2. Check Quota Status
      3. Check Quota Balance`;
    }
    // Handle menu selections (1, 2, or 3)
    else if (textArray.length === 1 && ['1', '2', '3'].includes(textArray[0])) {
      response = 'CON Enter your Quota Code or press 0 to return to the main menu';
    }
    // Option 1 flow - Notify Rights Holder
    else if (textArray[0] === '1' && textArray.length > 1) {
      const quotaCode = textArray[1];
      
      // Check if it's just the Quota code entry (no additional selections)
      if (textArray.length === 2) {
        try {
          const quotaBalance = await checkQuotaBalance(quotaCode);
          const isValid = await checkQuotaStatus (quotaCode);
          
          if (!isValid) {
            response = `CON Quota code ${quotaCode} is invalid or not found. 
            
            Press 0 to return to the main menu or enter a different Quota code`;
          } else if (quotaBalance <= 0) {
            response = `CON Quota code ${quotaCode} has insufficient Quota Balance. 
            
            Press 0 to return to the main menu or enter a different Quota code`;
          } else {
            const notified = await notifyRightsHolder(phoneNumber, quotaCode, sessionId);
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
    else if (textArray[0] === '2' && textArray.length > 1) {
      const quotaCode = textArray[1];
      
      if (textArray.length === 2) {
        try {
          const isValid = await checkQuotaStatus(quotaCode);
          if (isValid) {
            response = `CON Quota code ${quotaCode} is valid. Expiry Date: 30/05/2025. Do you wish to notify the Rights Holder of your intention to depart?
            1. Yes
            2. No
            0. Main menu`;
          } else {
            response = `CON Quota code ${quotaCode} has expired. 
            
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
            const notified = await notifyRightsHolder(phoneNumber, quotaCode, sessionId);
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
        } else {
          response = 'CON Invalid choice. Press 0 to return to the main menu';
        }
      }
    }
    // Option 3 flow - Check Quota balance
    else if (textArray[0] === '3' && textArray.length > 1) {
      const quotaCode = textArray[1];
      
      if (textArray.length === 2) {
        try {
          const quotaBalance = await checkQuotaBalance(quotaCode);
          const isValid = await checkQuotaStatus(quotaCode);
          if (isValid) {
            response = `CON The Quota balance for Quota code ${quotaCode} is: ${quotaBalance} kg. Do you wish to notify the Rights Holder of your intention to depart?    
            1. Yes
            2. No
            0. Main menu`;
          } else {
            response = `CON Quota code ${quotaCode} has either expired or is invalid or has insufficient Quota balance. 
            
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
            const notified = await notifyRightsHolder(phoneNumber, quotaCode, sessionId);
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
        } else {
          response = 'CON Invalid choice. Press 0 to return to the main menu';
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