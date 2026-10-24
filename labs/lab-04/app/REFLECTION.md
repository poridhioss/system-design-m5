# Reflection

**1. Where did async/await and streams need different error handling?**

An async/await route fails before it responds, so the error is thrown, reaches the central error handler, and becomes a clean `400`/`500` JSON response. A stream can fail after the `200` and part of the body have already been sent, so the handler can only log it and close the connection, and `finally` must release the database connection. Event streams never end on their own, so they also need explicit cleanup on disconnect and at shutdown.

**2. What would break first under load?**

The 10-connection database pool: every export holds a connection for its whole duration, so a handful of slow exports or unbounded `Promise.all` batches leave other requests queuing for a connection. Next, the in-memory list of event subscribers, which lives in one process and can't be shared across several instances.
