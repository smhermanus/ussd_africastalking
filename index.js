require('dotenv').config();

const express = require('express');
const { Pool } = require('pg');
const AfricasTalking = require('africastalking');
const nodemailer = require('nodemailer');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

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
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  auth: {
    user: process.env.EMAIL_USER, 
    pass: process.env.EMAIL_PASS
  }
});

// Helper function to check permit status
async function checkPermitStatus(permitNumber) {
  const result = await pool.query('SELECT date_expiry FROM permits WHERE permit_number = $1', [permitNumber]);
  if (result.rows.length > 0) {
    const expirationDate = new Date(result.rows[0].date_expiry);
    const currentDate = new Date();
    return expirationDate > currentDate;
  }
  return false;
}

// Helper function to check quota balance
async function checkQuotaBalance(permitNumber) {
  const result = await pool.query('SELECT quota_balance FROM permits WHERE permit_number = $1', [permitNumber]);
  if (result.rows.length > 0) {
    return result.rows[0].quota_balance;
  }
  return 0;
}

// Helper function to notify rights holder
async function notifyRightsHolder(phoneNumber, permitNumber, sessionId) {
  try {
    const result = await pool.query('SELECT rh_cell_phone, email FROM rights_holders WHERE permit_number = $1', [permitNumber]);
    if (result.rows.length > 0) {
      const { rh_cell_phone, email } = result.rows[0];
      const message = `This is a notification to inform you that your Authorised Rep (Skipper)intends to depart to sea against permit ${permitNumber}.`;
      
    
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
    
    console.log(response);  // Log the response for debugging

      // Insert notification record into database
      const currentDate = new Date().toISOString();
      await pool.query('INSERT INTO skipper_notifications (cellphone_nr, permit_number, date_sent, sessionid) VALUES ($1, $2, $3, $4)', [phoneNumber, permitNumber, currentDate, sessionId]);
      
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error in notifyRightsHolder:', error);
    throw error;  // Re-throw the error to be caught in the calling function
  }
}

app.post('/ussd', async (req, res) => {
  const {
    sessionId,
    phoneNumber,
    text,
  } = req.body;

  let response = '';

  if (text === '') {
    response = `CON What would you like to do?
    1. Notify Rights Holder
    2. Check permit status
    3. Check Quota balance`;
  } 
  
  else if (text === '1') {
    response = 'CON Enter permit number or press 0 to return to the main menu';
  } 
  
  else if (text.startsWith('1*') && text !== '1*0') {
    const permitNumber = text.split('*')[1];
    try {
      const quotaBalance = await checkQuotaBalance(permitNumber);
      const isValid = await checkPermitStatus(permitNumber);
      if (quotaBalance > 0 && isValid) {
        const notified = await notifyRightsHolder(phoneNumber, permitNumber, sessionId);
        if (notified) {
          response = 'END Notification sent to Rights Holder via SMS and Email.';
        } else {
          response = 'END Failed to notify Rights Holder. Please try again later.';
        }
      } else {
        response = `END Cannot notify Rights Holder. Permit ${permitNumber} is invalid or has insufficient quota balance.`;
      }
    } catch (error) {
      console.error('Database error:', error);
      response = 'END An error occurred while processing your request. Please try again later.';
    }
  } 
  
  else if (text === '2') {
    response = 'CON Enter permit number or press 0 to return to the main menu';
  } 
  
  else if (text.startsWith('2*') && text !== '2*0') {
    const permitNumber = text.split('*')[1];
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
      console.error('Database error:', error);
      response = 'END An error occurred while checking the permit status. Please try again later.';
    }
  } 
  
  else if (text.startsWith('2*') && text.split('*').length === 3) {
    const [_, permitNumber, choice] = text.split('*');
    if (choice === '1') {
      try {
        const notified = await notifyRightsHolder(phoneNumber, permitNumber, sessionId);
        if (notified) {
          response = 'END Notification sent to Rights Holder via SMS and Email.';
        } else {
          response = 'END Failed to notify Rights Holder. Rights holder information not found.';
        }
      } catch (error) {
        console.error('Notification error:', error);
        response = 'END An error occurred while notifying the rights holder. Please try again later.';
      }
    } else if (choice === '2') {
      response = `CON What would you like to do?
      1. Notify Rights Holder
      2. Check permit status
      3. Check Quota balance`;
    } else {
      response = 'END Invalid choice. Please start over.';
    }
  }
  
  else if (text === '3') {
    response = 'CON Enter permit number or press 0 to return to the main menu';
  } 
  
  else if (text.startsWith('3*') && text !== '3*0') {
    const permitNumber = text.split('*')[1];
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
      console.error('Database error:', error);
      response = 'END An error occurred while checking the quota balance. Please try again later.';
    }
  } 
  
  else if (text.startsWith('3*') && text.split('*').length === 3) {
    const [_, permitNumber, choice] = text.split('*');
    if (choice === '1') {
      try {
        const notified = await notifyRightsHolder(phoneNumber, permitNumber, sessionId);
        if (notified) {
          response = 'END Notification sent to Rights Holder via SMS and Email.';
        } else {
          response = 'END Failed to notify Rights Holder. Rights holder information not found.';
        }
      } catch (error) {
        console.error('Notification error:', error);
        response = 'END An error occurred while notifying the rights holder. Please try again later.';
      }
    } else if (choice === '2') {
      response = `CON What would you like to do?
      1. Notify Rights Holder
      2. Check permit status
      3. Check Quota balance`;
    } else {
      response = 'END Invalid choice. Please start over.';
    }
  }
  
  else if (text === '1*0' || text === '2*0' || text === '3*0') {
    response = `CON What would you like to do?
    1. Notify Rights Holder
    2. Check permit status
    3. Check Quota balance`;
  } else {
    response = 'END Invalid input';
  }
  
  // Send response back to Africa's Talking gateway
  res.set('Content-Type: text/plain');
  res.send(response);
});

module.exports = app;