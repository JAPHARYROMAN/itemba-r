import { INestApplication } from '@nestjs/common';
import { Permission, RoleScope } from '@prisma/client';
import * as argon2 from 'argon2';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import * as path from 'path';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2eApp } from './e2e-app';

jest.setTimeout(180_000);

const TEST_PASS = 'TestPass123!';
const MODULES_DIR = path.join(__dirname, '..', 'src', 'modules');
const SKIPPED_CONTROLLER_PATTERNS = [
  /[\\/]auth[\\/]auth\.controller\.ts$/,
  /RequireApiScope\(/,
  /ApiKeyAuthGuard/,
];

type WriteRoute = {
  controllerFile: string;
  method: 'post' | 'patch' | 'put' | 'delete';
  path: string;
};

describe('Exploratory write endpoint smoke (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token = '';

  const suffix = `${Date.now()}`;
  let groupId = '';
  let companyId = '';
  let divisionId = '';
  let branchId = '';
  let userId = '';

  const routes = discoverWriteRoutes();

  beforeAll(async () => {
    if (process.env.CRUD_SMOKE_DISPOSABLE_DB !== '1') {
      throw new Error(
        'Refusing to run write endpoint smoke tests without CRUD_SMOKE_DISPOSABLE_DB=1. Use a disposable database.',
      );
    }

    expect(routes.length).toBeGreaterThan(850);

    app = await createE2eApp({ useProductionPipeline: true });
    prisma = app.get(PrismaService);

    const permissions = await ensureAllDeclaredPermissions(prisma);

    const group = await prisma.group.create({
      data: {
        code: `E2EWSG${suffix.slice(-8)}`,
        name: `E2E Write Smoke Group ${suffix}`,
      },
    });
    groupId = group.id;

    const company = await prisma.company.create({
      data: {
        groupId,
        code: `E2EWSC${suffix.slice(-8)}`,
        name: `E2E Write Smoke Company ${suffix}`,
      },
    });
    companyId = company.id;

    const division = await prisma.division.create({
      data: {
        companyId,
        code: `E2EWSD${suffix.slice(-8)}`,
        name: `E2E Write Smoke Division ${suffix}`,
        type: 'OTHER',
      },
    });
    divisionId = division.id;

    const branch = await prisma.branch.create({
      data: {
        divisionId,
        code: `E2EWSB${suffix.slice(-8)}`,
        name: `E2E Write Smoke Branch ${suffix}`,
        type: 'BRANCH',
      },
    });
    branchId = branch.id;

    const role = await prisma.role.create({
      data: {
        name: `e2e_write_smoke_${suffix}`,
        displayName: 'E2E Write Smoke Role',
        scope: RoleScope.GROUP,
        rolePermissions: {
          create: permissions.map((permission) => ({ permissionId: permission.id })),
        },
      },
    });

    const passwordHash = await argon2.hash(TEST_PASS);
    const user = await prisma.user.create({
      data: {
        email: `e2e-write-smoke-${suffix}@itemba.local`,
        passwordHash,
        fullName: 'E2E Write Smoke User',
        status: 'ACTIVE',
        companyId,
        userRoles: { create: { roleId: role.id } },
        companyAccess: {
          create: { companyId, accessLevel: 'MANAGE' },
        },
      },
    });
    userId = user.id;

    token = await loginAs(app, user.email, TEST_PASS);
  });

  afterAll(async () => {
    if (app) await app.close();
    if (prisma) await prisma.$disconnect();
  });

  it.each(routes)('$method $path does not fail with a server error', async (route) => {
    const response = await request(app.getHttpServer())
      [route.method](route.path)
      .set('Authorization', `Bearer ${token}`)
      .query({
        companyId,
        divisionId,
        branchId,
        page: 1,
        limit: 1,
      })
      .send(sampleBody(route, { companyId, divisionId, branchId, userId }));

    expect(response.status).toBeLessThan(500);
  });
});

async function loginAs(app: INestApplication, email: string, password: string) {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password })
    .expect(200);
  const data = res.body?.data ?? res.body;
  expect(data.accessToken).toBeTruthy();
  return data.accessToken as string;
}

async function ensureAllDeclaredPermissions(prisma: PrismaService): Promise<Permission[]> {
  const codes = discoverRequirePermissionCodes();
  return Promise.all(
    codes.map((code) =>
      prisma.permission.upsert({
        where: { code },
        update: {},
        create: {
          code,
          description: `E2E generated permission for ${code}`,
          module: code.split('.')[0] || code.split('_')[0] || 'system',
          action: code.split('.').slice(1).join('.') || 'access',
        },
      }),
    ),
  );
}

function discoverRequirePermissionCodes(): string[] {
  const codes = new Set<string>();
  for (const file of walkTsFiles(path.join(__dirname, '..', 'src'))) {
    const source = readFileSync(file, 'utf8');
    const regex = /RequirePermissions\(([^)]*)\)/g;
    for (const match of source.matchAll(regex)) {
      const args = match[1] ?? '';
      for (const permission of args.matchAll(/['"`]([^'"`]+)['"`]/g)) {
        codes.add(permission[1]);
      }
    }
  }
  return [...codes].sort();
}

function discoverWriteRoutes(): WriteRoute[] {
  const routes: WriteRoute[] = [];
  for (const controllerFile of walkControllerFiles(MODULES_DIR)) {
    const source = readFileSync(controllerFile, 'utf8');
    if (
      SKIPPED_CONTROLLER_PATTERNS.some(
        (pattern) => pattern.test(controllerFile) || pattern.test(source),
      )
    ) {
      continue;
    }

    const controllerPath = extractDecoratorPath(source, 'Controller');
    if (controllerPath === null) continue;

    const writeRegex = /@(Post|Patch|Put|Delete)\(([^)]*)\)/g;
    for (const match of source.matchAll(writeRegex)) {
      const methodPath = parseDecoratorArgument(match[2] ?? '');
      if (methodPath === null) continue;
      routes.push({
        controllerFile,
        method: match[1].toLowerCase() as WriteRoute['method'],
        path: toApiPath(controllerPath, methodPath),
      });
    }
  }

  return [
    ...new Map(routes.map((route) => [`${route.method} ${route.path}`, route])).values(),
  ].sort((a, b) => `${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`));
}

function extractDecoratorPath(source: string, decorator: string): string | null {
  const match = source.match(new RegExp(`@${decorator}\\(([^)]*)\\)`));
  return match ? parseDecoratorArgument(match[1] ?? '') : null;
}

function parseDecoratorArgument(argument: string): string | null {
  const trimmed = argument.trim();
  if (!trimmed) return '';
  const quoted = trimmed.match(/^['"`]([^'"`]*)['"`]$/);
  return quoted ? quoted[1] : null;
}

function toApiPath(controllerPath: string, methodPath: string): string {
  const combined = [controllerPath, methodPath]
    .map((part) => part.trim().replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');
  return `/api/v1/${combined}`
    .replace(/\/+/g, '/')
    .replace(/:([A-Za-z0-9_]+)/g, (_match, name) => samplePathParam(name));
}

function samplePathParam(name: string): string {
  if (name.toLowerCase().includes('number')) return `E2E-${Date.now()}`;
  const hex = Array.from(name)
    .map((char) => char.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('')
    .padEnd(12, '0')
    .slice(0, 12);
  return `00000000-0000-4000-8000-${hex}`;
}

function sampleBody(
  route: WriteRoute,
  ids: { companyId: string; divisionId: string; branchId: string; userId: string },
) {
  const stamp = `${Date.now()}`;
  return {
    companyId: ids.companyId,
    divisionId: ids.divisionId,
    branchId: ids.branchId,
    userId: ids.userId,
    assignedToId: ids.userId,
    reportedById: ids.userId,
    createdById: ids.userId,
    name: `E2E Write Smoke ${stamp}`,
    title: `E2E Write Smoke ${stamp}`,
    description: `E2E write smoke for ${route.method.toUpperCase()} ${route.path}`,
    notes: 'E2E write smoke',
    content: 'E2E write smoke content',
    status: 'DRAFT',
    priority: 'MEDIUM',
    amount: 1,
    quantity: 1,
    percentage: 1,
    rate: 1,
    daysBefore: 1,
    retentionDays: 1,
    date: '2026-05-04T00:00:00.000Z',
    startDate: '2026-05-04T00:00:00.000Z',
    endDate: '2026-05-05T00:00:00.000Z',
    effectiveDate: '2026-05-04T00:00:00.000Z',
    issueDate: '2026-05-04T00:00:00.000Z',
    expiryDate: '2027-05-04T00:00:00.000Z',
    renewalDate: '2027-04-04T00:00:00.000Z',
    config: {},
    metadata: {},
    condition: {},
    steps: [],
  };
}

function walkControllerFiles(dir: string): string[] {
  return walkTsFiles(dir).filter((file) => file.endsWith('.controller.ts'));
}

function walkTsFiles(dir: string, files: string[] = []): string[] {
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir)) {
    const absolute = path.join(dir, entry);
    const stat = statSync(absolute);
    if (stat.isDirectory()) {
      walkTsFiles(absolute, files);
    } else if (absolute.endsWith('.ts')) {
      files.push(absolute);
    }
  }
  return files;
}
