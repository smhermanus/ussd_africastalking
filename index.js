require('dotenv').config();

const express = require('express');
const { Pool } = require('pg');
const AfricasTalking = require('africastalking');

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

// Test request handlers 
app.get('/api/test', function(req, res) {
  res.send('Test Request!');
  });   

app.post('/ussd', async (req, res) => {
  const {
    sessionId,
    phoneNumber,
    text,
  } = req.body;

  let response = '';

  if (text === '') {
    response = `CON What would you like to do?
    1. Check permit status
    2. Check Quota balance
    3. Notify Rights Holder`;
  } 
  
  else if (text === '1') {
    response = 'CON Enter permit number or press 0 to return to the main menu';
  } 
  
  else if (text.startsWith('1*') && text !== '1*0') {
    const permitNumber = text.split('*')[1];
    try {
      const result = await pool.query('SELECT date_expiry FROM permits WHERE permit_number = $1', [permitNumber]);
      if (result.rows.length > 0) {
        const expirationDate = new Date(result.rows[0].date_expiry);
        const currentDate = new Date();
        if (expirationDate > currentDate) {
          response = `END Permit ${permitNumber} is valid until ${expirationDate.toDateString()}`;
        } else {
          response = `END Permit ${permitNumber} is invalid. The expiration date was on ${expirationDate.toDateString()}`;
        }
      } else {
        response = `END Permit ${permitNumber} was not found or may have been entered incorrectly.`;
      }
    } catch (error) {
      console.error('Database error:', error);
      response = 'END An error occurred while checking the permit status. Please try again later.';
    }
  } 
  
  else if (text === '2') {
    response = 'CON Enter permit number or press 0 to return to the main menu';
  } 
  
  else if (text.startsWith('2*') && text !== '2*0') {
    const permitNumber = text.split('*')[1];
    try {
      const result = await pool.query('SELECT quota_balance FROM permits WHERE permit_number = $1', [permitNumber]);
      if (result.rows.length > 0) {
        const quotaBalance = result.rows[0].quota_balance;
        response = `END Remaining quota balance for permit ${permitNumber} is: ${quotaBalance} kg`;
      } else {
        response = `END Permit ${permitNumber} was not found or may have been entered incorrectly.`;
      }
    } catch (error) {
      console.error('Database error:', error);
      response = 'END An error occurred while checking the quota balance. Please try again later.';
    }
  } 
  
  else if (text === '3') {
    response = 'CON Enter permit number or press 0 to return to the main menu';
  } 
  
  else if (text.startsWith('3*') && text !== '3*0') {
    const permitNumber = text.split('*')[1];
    try {
      const result = await pool.query('SELECT rh_cell_phone FROM rights_holders WHERE permit_number = $1', [permitNumber]);
      if (result.rows.length > 0) {
        const rightsHolderPhone = result.rows[0].rh_cell_phone;
        const message = `This is a notification message to inform you that your Skipper intends to depart to sea against permit ${permitNumber}.`;
        
        try {
          await sms.send({
            to: rightsHolderPhone,
            message: message,
          });
          
          const currentDate = new Date().toISOString();
          await pool.query('INSERT INTO skipper_notifications (session_id, date_sent, permit_number, user_phone) VALUES ($1, $2, $3)',[sessionId, currentDate, permitNumber, phoneNumber]);
          
          response = 'END Notification sent to Rights Holder. Database updated.';
        } catch (smsError) {
          console.error('SMS sending error:', smsError);
          response = 'END An error occurred while sending the notification. Please try again later.';
        }
      } else {
        response = `END Permit ${permitNumber} was not found or may have been entered incorrectly.`;
      }
    } catch (error) {
      console.error('Database error:', error);
      response = 'END An error occurred while notifying the rights holder. Please try again later.';
    }
  } 
  
  else if (text === '1*0' || text === '2*0' || text === '3*0') {
    response = `CON What would you like to do?
    1. Check permit status
    2. Check Quota balance
    3. Notify Rights Holder`;
  } else {
    response = 'END Invalid input';
  }

  // Send response back to Africa's Talking gateway
  res.set('Content-Type: text/plain');
  res.send(response);
});

// Set port
// const PORT = process.env.PORT || 3000;


// Start the server
// app.listen(PORT, () => 
// console.log(`USSD Server listening on http://localhost:${PORT}`)
// );  