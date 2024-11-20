import pool from '../config/database.js';

export async function checkPermitStatus(permitNumber) {
  try {
    const result = await pool.query(
      'SELECT date_expiry FROM permits WHERE permit_number = $1',
      [permitNumber]
    );
    
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

export async function checkQuotaBalance(permitNumber) {
  try {
    const result = await pool.query(
      'SELECT quota_balance FROM permits WHERE permit_number = $1',
      [permitNumber]
    );
    
    if (result.rows.length > 0) {
      return result.rows[0].quota_balance;
    }
    return 0;
  } catch (error) {
    console.error('Error in checkQuotaBalance:', error);
    throw error;
  }
}
