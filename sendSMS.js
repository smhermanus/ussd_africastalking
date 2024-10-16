const AfricasTalking = require('africastalking');

// TODO: Initialize Africa's Talking
const africastalking = AfricasTalking({
  apiKey: process.env.AFRICASTALKING_API_KEY, 
  username: process.env.AFRICASTALKING_USERNAME,
});


module.exports = async function sendSMS() {
    
    // TODO: Send message
try {
  const result=await africastalking.SMS.send({
    to: '[+27812807278]', 
    message: 'NOTIFICATION from SKIPPER',
    from: '[AssetFlwLtd]'
  });
  console.log(result);
} catch(ex) {
  console.error(ex);
} 
};