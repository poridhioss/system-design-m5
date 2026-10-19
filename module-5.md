Module 5: Node.js & Asynchronous Backend Development
Class Topics
What is Node.js and why use it for backends; the event loop
ES6 essentials for Node.js
Asynchronous programming: callbacks, promises, async/await
Understanding data flow in a web application; data nature on the front end
Application layer and database access with Express.js
Connecting a PostgreSQL database from a Node.js backend
Error handling, configuration, and graceful shutdown
Hands-On Labs
M5-L1 — Express CRUD Service

Objective: Build a REST CRUD service backed by PostgreSQL with proper status codes and validation.
Tools/Stack: Node.js, Express, PostgreSQL, Docker
Deliverable: A running containerized API with a Postman/HTTP test collection.
M5-L2 — Async Patterns & Backpressure

Objective: Refactor a callback-heavy handler into async/await; add concurrency limits and streaming for large responses.
Tools/Stack: Node.js streams, p-limit
Deliverable: Before/after latency and memory profile.
M5-L3 — Modular Streaming Service

Objective: Build a simple media/event streaming endpoint using a modular microservice structure.
Tools/Stack: Node.js, Express, Docker
Deliverable: A deployable streaming service with a health endpoint.
M5-L4 — Integration: Production-Shaped Service (Task)

Objective: Combine your CRUD service (L1), async patterns (L2), and streaming endpoint (L3) into a single deployable service with a coherent module structure, health endpoint, graceful shutdown, and a passing smoke-test suite.
Tools/Stack: Node.js, Express, Docker (AI tools may be used freely)
Reflection (3–5 lines): Where did async/await vs. streams require different error handling? What would break first under load?
Deliverable: A single Docker Compose stack running all three capabilities, plus a test file covering the happy path and one failure case for each.