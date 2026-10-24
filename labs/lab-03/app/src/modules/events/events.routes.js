import { Router } from 'express';
import { addClient, removeClient, clientCount, broadcast } from './events.service.js';

export const router = Router();

// Subscribe: keep the response open and send every event as it happens.
router.get('/', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ message: 'connected' })}\n\n`);

  addClient(res);
  // When the client disconnects, stop sending to it.
  res.on('close', () => removeClient(res));
});

// Publish: send a message to every connected client.
router.post('/', (req, res) => {
  const message = req.body?.message;
  if (typeof message !== 'string' || message.trim() === '') {
    return res.status(400).json({ error: 'message is required' });
  }

  const event = broadcast(message.trim());
  res.status(201).json({ ...event, deliveredTo: clientCount() });
});
