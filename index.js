const express = require('express');
const AfricasTalking = require('africastalking');
const db = require('./db');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const africastalking = new AfricasTalking({
  apiKey: process.env.AFRICASTALKING_API_KEY,
  username: process.env.AFRICASTALKING_USERNAME,
});

app.post('/ussd', async (req, res) => {
  const {
    sessionId,
    serviceCode,
    phoneNumber,
    text,
  } = req.body;

  let response = '';

  if (text === '') {
    response = `CON What would you like to do?
    1. Permit status
    2. Quota balance
    3. Notify Rights Holder`;
  } else if (text === '1') {
    response = `CON Enter permit number or press 0 to return to the main menu`;
  } else if (text.startsWith('1*')) {
    const permitNumber = text.split('*')[1];
    if (permitNumber === '0') {
      response = `CON What would you like to do?
      1. Permit status
      2. Quota balance
      3. Notify Rights Holder`;
    } else {
      try {
        const result = await db.query(
          'SELECT date_expiry, quota_qty FROM permits WHERE permit_number = $1',
          [permitNumber]
        );

        if (result.rows.length > 0) {
          const permit = result.rows[0];
          response = `END Permit ${permitNumber} is valid until ${permit.date_expiry.toDateString()} with a remaining quota of ${permit.quota_qty} kg.`;
        } else {
          response = `END Permit ${permitNumber} not found`;
        }
      } catch (error) {
        console.error('Error retrieving permit information:', error);
        response = `END An error occurred while checking the permit information`;
      }
    }
  } else if (text === '2') {
    response = `CON Enter permit number or press 0 to return to the main menu`;
  } else if (text.startsWith('2*')) {
    const permitNumber = text.split('*')[1];
    if (permitNumber === '0') {
      response = `CON What would you like to do?
      1. Permit status
      2. Quota balance
      3. Notify Rights Holder`;
    } else {
      try {
        const result = await db.query(
          'SELECT quota_qty FROM permits WHERE permit_number = $1',
          [permitNumber]
        );

        if (result.rows.length > 0) {
          const quota = result.rows[0].quota_qty;
          response = `END Remaining quota for permit ${permitNumber}: ${quota} kg`;
        } else {
          response = `END Permit ${permitNumber} not found`;
        }
      } catch (error) {
        console.error('Error retrieving quota information:', error);
        response = `END An error occurred while checking the quota`;
      }
    }
  } else if (text === '3') {
    response = `CON Enter permit number or press 0 to return to the main menu`;
  } else if (text.startsWith('3*')) {
    const permitNumber = text.split('*')[1];
    if (permitNumber === '0') {
      response = `CON What would you like to do?
      1. Permit status
      2. Quota balance
      3. Notify Rights Holder`;
    } else {
      try {
        const result = await db.query(
          'SELECT rh.cell_phone, rh.id FROM rights_holders rh JOIN permits p ON p.permit_number = ANY(rh.permit_numbers) WHERE p.permit_number = $1',
          [permitNumber]
        );

        if (result.rows.length > 0) {
          const { cell_phone, id } = result.rows[0];

          // Send SMS notification
          await africastalking.SMS.send({
            to: [cell_phone],
            message: `Skipper with permit number ${permitNumber} intends to leave the harbor.`,
          });

          // Update the database
          await db.query(
            'INSERT INTO skipper_notifications (rights_holder_id, permit_number, notification_date) VALUES ($1, $2, NOW())',
            [id, permitNumber]
          );

          response = `END Notification sent to Rights Holder. Database updated.`;
        } else {
          response = `END Permit ${permitNumber} not found`;
        }
      } catch (error) {
        console.error('Error notifying Rights Holder:', error);
        response = `END An error occurred while notifying the Rights Holder`;
      }
    }
  } else {
    response = `END Invalid input`;
  }

  // Send the response back to the API
  res.set('Content-Type: text/plain');
  res.send(response);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`USSD Server listening on http://localhost:${PORT}`));