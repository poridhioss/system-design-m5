// Keeps track of connected clients and sends each event to all of them.
// It knows nothing about routes or requests: a client is anything with write().
const clients = new Set();
let nextId = 1;

export function addClient(client) {
  clients.add(client);
}

export function removeClient(client) {
  clients.delete(client);
}

export function clientCount() {
  return clients.size;
}

export function broadcast(message) {
  const event = { id: nextId++, message, sentAt: new Date().toISOString() };
  for (const client of clients) {
    client.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);
  }
  return event;
}
