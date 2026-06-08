import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Behind the DigitalOcean App Platform load balancer: trust the first proxy hop
  // so req.ip reflects the real client (X-Forwarded-For). Without this the rate
  // limiter would key every request by the LB IP and throttle all users together.
  app.set('trust proxy', 1);

  // CORS — allow the Vercel frontend + local dev. Configure via CORS_ORIGINS (comma-separated).
  const origins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.enableCors({
    origin: origins.length ? origins : true,
    credentials: true,
  });

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
  );

  const port = process.env.PORT || 4000;
  await app.listen(port, '0.0.0.0');
  console.log(`Kriyava API running on :${port}`);
}
bootstrap();
