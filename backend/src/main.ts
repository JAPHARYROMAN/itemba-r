import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

async function bootstrap() {
  const isProd = process.env.NODE_ENV === 'production';

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: isProd ? ['error', 'warn', 'log'] : ['error', 'warn', 'log', 'debug'],
  });

  const config = app.get(ConfigService);
  const port = config.get<number>('PORT', 3001);
  const apiPrefix = config.get<string>('API_PREFIX', 'api/v1');
  const corsOrigin = config.getOrThrow<string>('CORS_ORIGIN');

  if (isProd) {
    app.set('trust proxy', 1);
  }

  app.use(
    helmet({
      hsts: isProd ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
    }),
  );
  const corsOrigins = corsOrigin
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (
    corsOrigins.length === 0 ||
    corsOrigins.some((origin) => origin === '*' || origin.includes('*'))
  ) {
    throw new Error('CORS_ORIGIN cannot be empty or wildcard when credentialed CORS is enabled');
  }
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });

  app.setGlobalPrefix(apiPrefix);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Order matters: Nest checks global filters in reverse registration order.
  app.useGlobalFilters(new HttpExceptionFilter(), new PrismaExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor(), new TransformInterceptor());

  if (!isProd) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('ITEMBA-R API')
      .setDescription('Group Digital Governance & Enterprise Management System')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup(`${apiPrefix}/docs`, app, document);
  }

  await app.listen(port);

  const logger = new Logger('Bootstrap');
  logger.log(`🚀 ITEMBA-R API running at http://localhost:${port}/${apiPrefix}`);
  if (!isProd) logger.log(`📘 Swagger at http://localhost:${port}/${apiPrefix}/docs`);
}

bootstrap();
