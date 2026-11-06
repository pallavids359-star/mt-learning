import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';

interface PgError {
  code?: string;
  constraint?: string;
  detail?: string;
}

const CONSTRAINT_MESSAGES: Record<string, string> = {
  staff_users_email_key: 'A staff member with this email already exists',
  academic_years_name_key: 'An academic year with this name already exists',
  academic_years_single_current: 'Another academic year is already marked current',
  classes_year_name_key: 'A class with this name already exists in the academic year',
  sections_class_name_key: 'A section with this name already exists in the class',
  subjects_code_key: 'A subject with this code already exists',
  hostels_name_key: 'A hostel with this name already exists',
  students_code_key: 'A student with this student ID already exists',
  students_section_roll_key: 'This roll number is already used in the section',
  tablets_serial_key: 'A tablet with this serial number already exists',
  tablets_asset_tag_key: 'A tablet with this asset tag already exists',
  tablets_student_key: 'This student already has a tablet assigned',
};

function pgErrorOf(err: unknown): PgError | undefined {
  // Drizzle wraps driver errors; the pg error is on `cause`.
  let cur: unknown = err;
  for (let i = 0; i < 3 && cur && typeof cur === 'object'; i++) {
    const c = cur as PgError & { cause?: unknown };
    if (typeof c.code === 'string' && /^[0-9A-Z]{5}$/.test(c.code)) return c;
    cur = c.cause;
  }
  return undefined;
}

/** Maps known PostgreSQL errors to clean HTTP responses; everything else becomes a 500 without internals. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      res.status(status).json(typeof body === 'string' ? { statusCode: status, message: body } : body);
      return;
    }

    const pg = pgErrorOf(exception);
    if (pg?.code === '23505') {
      res.status(HttpStatus.CONFLICT).json({
        statusCode: HttpStatus.CONFLICT,
        message: CONSTRAINT_MESSAGES[pg.constraint ?? ''] ?? 'This record conflicts with an existing one',
      });
      return;
    }
    if (pg?.code === '23503') {
      res.status(HttpStatus.CONFLICT).json({
        statusCode: HttpStatus.CONFLICT,
        message: 'This record is referenced by other records or refers to a record that does not exist',
      });
      return;
    }
    if (pg?.code === '22P02') {
      res.status(HttpStatus.BAD_REQUEST).json({ statusCode: HttpStatus.BAD_REQUEST, message: 'Invalid identifier' });
      return;
    }

    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    res
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json({ statusCode: HttpStatus.INTERNAL_SERVER_ERROR, message: 'Internal server error' });
  }
}
