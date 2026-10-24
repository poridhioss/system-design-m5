// All configuration comes from environment variables, read once at startup.
function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 8000),
  databaseUrl: required('DATABASE_URL'),
  // Must be shorter than Docker's 10-second stop timeout.
  shutdownTimeoutMs: Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 8000),
};
