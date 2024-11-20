export function errorHandler(err, req, res, next) {
    console.error('Error:', err);
    
    res.set('Content-Type', 'text/plain');
    
    if (err.message === 'Missing sessionId' || err.message === 'Missing phoneNumber') {
      return res.status(400).send('END Invalid request. Please try again.');
    }
    
    return res.send('CON An unexpected error occurred. Press 0 to return to the main menu');
  }
  