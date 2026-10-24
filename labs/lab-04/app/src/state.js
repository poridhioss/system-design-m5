// Shared process state. server.js sets shuttingDown; the health module reads it.
export const state = {
  shuttingDown: false,
};
