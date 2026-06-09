// Sentry must be initialised before any other module is imported so its
// OpenTelemetry auto-instrumentation can hook into them. This file is imported
// at the very top of main.ts.
import * as Sentry from '@sentry/nestjs';

const DSN =
  process.env.SENTRY_DSN ??
  'https://3f1fc341c65f62caf1bc10062ac5982f@o4511432063320064.ingest.us.sentry.io/4511533742817280';

Sentry.init({
  dsn: DSN,
  // Full tracing only in explicit local dev; otherwise 10% to stay within the
  // free-tier ~10k spans/month (DO may not set NODE_ENV at runtime, so default low).
  tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
  environment: process.env.NODE_ENV || 'development',
});
