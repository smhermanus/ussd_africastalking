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

const sms = africastalking.SMS;

// Nodemailer setup
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Helper functions
async function checkPermitStatus(permitNumber) {
  const query = 'SELECT date_expiry > CURRENT_DATE as is_valid FROM permits WHERE permit_number = $1';
  const result = await pool.query(query, [permitNumber]);
  return result.rows.length > 0 ? result.rows[0].is_valid : false;
}

async function checkQuotaBalance(permitNumber) {
  const query = 'SELECT quota_balance > 0 as has_balance, quota_balance FROM permits WHERE permit_number = $1';
  const result = await pool.query(query, [permitNumber]);
  return result.rows.length > 0 ? { hasBalance: result.rows[0].has_balance, balance: result.rows[0].quota_balance } : { hasBalance: false, balance: 0 };
}

async function notifyRightsHolder(permitNumber, sessionId, phoneNumber) {
  const query = 'SELECT rh_cell_phone, email FROM rights_holders WHERE permit_number = $1';
  const result = await pool.query(query, [permitNumber]);
  if (result.rows.length > 0) {
    const { rh_cell_phone, email } = result.rows[0];
    const message = `Skipper intends to depart to sea against permit ${permitNumber}.`;
    
    // Send SMS
    await sms.send({ to: rh_cell_phone, message: message });
    
    // Send Email
    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: email,
      subject: 'Skipper Departure Notification',
      text: message,
    });
    
    // Log notification
    await pool.query('INSERT INTO skipper_notifications (session_id, date_sent, permit_number, user_phone) VALUES ($1, $2, $3, $4)', 
      [sessionId, new Date(), permitNumber, phoneNumber]);
    
    return true;
  }
  return false;
}

app.post('/ussd', async (req, res) => {
  const { sessionId, phoneNumber, text } = req.body;
  let response = '';

  try {
    const textArray = text.split('*');
    const level = textArray.length;

    if (level === 1) {
      switch (text) {
        case '':
          response = `CON Select an option:
1: Check permit status
2: Check Quota balance
3: Notify Rights Holder`;
          break;
        case '1':
        case '2':
        case '3':
          response = 'CON Enter permit number:';
          break;
        default:
          response = 'END Invalid option';
      }
    } else if (level === 2) {
      const permitNumber = textArray[1];
      const option = textArray[0];

      switch (option) {
        case '1':
          const isValid = await checkPermitStatus(permitNumber);
          if (isValid) {
            response = `CON Permit ${permitNumber} is valid. Notify rights holder?
1: Yes
2: No`;
          } else {
            response = `END Permit ${permitNumber} is invalid or expired.`;
          }
          break;
        case '2':
          const { hasBalance, balance } = await checkQuotaBalance(permitNumber);
          const isValidForQuota = await checkPermitStatus(permitNumber);
          if (hasBalance && isValidForQuota) {
            response = `CON Quota balance: ${balance}kg. Notify rights holder?
1: Yes
2: No`;
          } else {
            response = `END Permit ${permitNumber} is invalid or has insufficient quota.`;
          }
          break;
        case '3':
          const isValidForNotify = await checkPermitStatus(permitNumber);
          const { hasBalance: hasBalanceForNotify } = await checkQuotaBalance(permitNumber);
          if (isValidForNotify && hasBalanceForNotify) {
            const notified = await notifyRightsHolder(permitNumber, sessionId, phoneNumber);
            response = notified ? 'END Notification sent via SMS and Email.' : 'END Failed to notify Rights Holder.';
          } else {
            response = `END Cannot notify. Permit invalid or insufficient quota.`;
          }
          break;
      }
    } else if (level === 3 && (textArray[0] === '1' || textArray[0] === '2')) {
      const permitNumber = textArray[1];
      const choice = textArray[2];

      if (choice === '1') {
        const notified = await notifyRightsHolder(permitNumber, sessionId, phoneNumber);
        response = notified ? 'END Notification sent via SMS and Email.' : 'END Failed to notify Rights Holder.';
      } else if (choice === '2') {
        response = 'END Returning to main menu.';
      } else {
        response = 'END Invalid choice.';
      }
    } else {
      response = 'END Invalid input';
    }
  } catch (error) {
    console.error('USSD error:', error);
    response = 'END An error occurred. Please try again.';
  }

  // Ensure response doesn't exceed USSD character limit
  response = response.substring(0, 182);
  
  // Send response back to Africa's Talking gateway
  res.set('Content-Type: text/plain');
  res.send(response);
});

module.exports = app;