require('dotenv').config();

import express, { json, urlencoded } from 'express';
import { Pool } from 'pg';
import AfricasTalking from 'africastalking';
import { createTransport } from 'nodemailer';

const app = express();
app.use(json());
app.use(urlencoded({ extended: false }));

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
      const message = `This is a notification to inform you that your Authorised Rep (Skipper) intends to depart to sea against permit ${permitNumber}.`;
      
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
        from: 'AssetFlwLtd' 
      });
      
      console.log('SMS Response:', response);

      // Insert notification record into database with proper formatting
      try {
        // Extract numeric part from sessionId or use full sessionId if extraction fails
        const numericSessionId = sessionId.match(/\d+/)?.[0] || '0';
        
        // Insert notification record into database
        await pool.query(
          `INSERT INTO skipper_notifications 
           (cellphone_nr, permit_number, sessionid, status, date_sent) 
           VALUES ($1, $2, $3, $4, NOW())`,
          [
            phoneNumber.toString(),         // cellphone_nr as string
            permitNumber.toString(),        // permit_number as string
            numericSessionId.toString(),    // sessionid as numeric string
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
    const {
      sessionId,
      phoneNumber,
      text,
    } = req.body;

    let response = '';
    const textArray = text.split('*');

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
    res.set('Content-Type: text/plain');
    res.send(response);
    
  } catch (error) {
    console.error('Unexpected error:', error);
    res.set('Content-Type: text/plain');
    res.send('END An unexpected error occurred. Please try again.');
  }
});

export default app;