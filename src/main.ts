import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json } from 'express';
import { AppModule } from './app.module.js';
import { config } from './config.js';
import { HttpErrorFilter, RevisionInterceptor } from './common/http.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(json({ limit: '20mb' }));
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new HttpErrorFilter());
  app.useGlobalInterceptors(new RevisionInterceptor());
  app.enableShutdownHooks();
  app.enableCors({
    origin: config.CORS_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'If-Match', 'X-API-Key', 'Authorization'],
    exposedHeaders: ['ETag', 'X-Tomato-Data-Scope'],
  });
  const swagger = new DocumentBuilder()
    .setTitle('Tomato Todo API')
    .setDescription(
      '客户端 Snapshot v1 与待办、专注、计时器接口。所有待办与专注接口需要登录，数据按账号隔离。',
    )
    .setVersion('1.0.0')
    .addApiKey({ type: 'apiKey', in: 'header', name: 'X-API-Key' }, 'apiKey')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swagger);
  document.openapi = '3.1.0';
  SwaggerModule.setup('api/docs', app, document, {
    jsonDocumentUrl: '/api/docs-json',
  });
  await app.listen(config.PORT, config.HOST);
}
await bootstrap();
