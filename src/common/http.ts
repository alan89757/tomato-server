import {
  Catch,
  HttpException,
  Injectable,
  Logger,
  UnauthorizedException,
  type ArgumentsHost,
  type CallHandler,
  type CanActivate,
  type ExceptionFilter,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { map } from 'rxjs';
import { config } from '../config.js';

export class Versioned<T> {
  constructor(
    readonly value: T,
    readonly revision: string,
  ) {}
}
@Injectable()
export class RevisionInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    return next.handle().pipe(
      map((result: unknown) => {
        if (result instanceof Versioned) {
          context
            .switchToHttp()
            .getResponse<Response>()
            .setHeader('ETag', `"${result.revision}"`);
          return result.value;
        }
        return result;
      }),
    );
  }
}
@Injectable()
export class ApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (!config.API_KEY) return true;
    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.header('x-api-key') ?? '';
    const expected = Buffer.from(config.API_KEY);
    const received = Buffer.from(provided);
    if (
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    ) {
      throw new UnauthorizedException('缺少或无效的 X-API-Key');
    }
    return true;
  }
}
@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpErrorFilter.name);
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<Request>();
    let status = 500;
    let details: Record<string, unknown> = { message: '服务器内部错误' };
    if (error instanceof HttpException) {
      status = error.getStatus();
      const body = error.getResponse();
      details =
        typeof body === 'string'
          ? { message: body }
          : (body as Record<string, unknown>);
    } else {
      // Avoid logging SQL statements/parameters, which can contain private todo notes.
      const code = (error as { code?: string })?.code;
      this.logger.error(
        `Request failed (${request.method}): ${code ?? 'unknown error'}`,
      );
    }
    response
      .status(status)
      .json({
        ...details,
        statusCode: status,
        timestamp: new Date().toISOString(),
      });
  }
}
