import 'dotenv/config';
import express from 'express';
import ussdRouter from './routes/ussdRouter.js';
import { errorHandler } from './middleware/errorHandler.js';
import { requestLogger } from './middleware/requestLogger.js';

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);

// Routes
app.use('/ussd', ussdRouter);

// Error handling
app.use(errorHandler);

export default app;
