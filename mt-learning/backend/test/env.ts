// Test configuration. TEST_DATABASE_URL must point at a disposable database: it is wiped before the tests run.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://mt:mt@localhost:5432/mt_tablet_test';
process.env.JWT_ACCESS_SECRET = 'test-secret-test-secret-test-secret-1234';
process.env.ENFORCE_TABLET_BINDING = 'false';
process.env.LOGIN_MAX_ATTEMPTS = '5';
process.env.STORAGE_DIR = require('node:path').join(require('node:os').tmpdir(), `mt-test-storage-${process.pid}`);
process.env.LOGIN_RATE_LIMIT_PER_MINUTE = '15';
