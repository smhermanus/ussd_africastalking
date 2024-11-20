import pool from '../config/database.js';
import { africastalking, transporter } from '../config/notifications.js';

export async function notifyRightsHolder(phoneNumber, permitNumber, sessionId) {
  try {
    // Check for existing notification
    const existingNotification = await pool.query(
      'SELECT id FROM skipper_notifications WHERE sessionid = $1',
      [sessionId]
    );
    
    if (existingNotification.rows.length > 0) {
      return true; // Already notified
    }

    // Get rights holder contact details
    const result = await pool.query(
      'SELECT rh_cell_phone, email FROM rights_holders WHERE permit_number = $1',
      [permitNumber]
    );

    if (result.rows.length > 0) {
      const { rh_cell_phone, email } = result.rows[0];
      const message = `This is a notification to inform you that your Authorised Rep (Skipper) intends to depart to sea against Quota code: ${permitNumber}.`;
      
      // Send notifications in parallel
      const [emailResult, smsResult] = await Promise.all([
        // Send email
        transporter.sendMail({
          from: process.env.EMAIL_FROM,
          to: email,
          subject: 'Skipper (Auth Rep) Departure Notification',
          text: message,
        }),
        
        // Send SMS
        africastalking.SMS.send({
          to: [rh_cell_phone],
          message: message,
          from: 'AssetFlwLtd'
        })
      ]);

      // Log notification attempts
      console.log('Email notification result:', emailResult);
      console.log('SMS notification result:', smsResult);

      // Record notification in database
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

      return true;
    }
    return false;
  } catch (error) {
    console.error('Error in notifyRightsHolder:', error);
    throw error;
  }
}