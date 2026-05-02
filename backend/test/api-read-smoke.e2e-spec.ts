import { INestApplication } from '@nestjs/common';
import { Permission, RoleScope } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash } from 'crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import * as path from 'path';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2eApp } from './e2e-app';

jest.setTimeout(120_000);

const TEST_PASS = 'TestPass123!';
const MODULES_DIR = path.join(__dirname, '..', 'src', 'modules');

type StaticGetRoute = {
  controllerFile: string;
  controllerPath: string;
  methodPath: string;
  path: string;
};

describe('API read route smoke coverage (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token = '';

  const suffix = `${Date.now()}`;
  let groupId = '';
  let companyId = '';
  let roleId = '';
  let userId = '';
  let apiClientId = '';
  let apiKeyId = '';
  let rawApiKey = '';
  let generatedPermissionCodes: string[] = [];
  const routes = discoverStaticGetRoutes();

  beforeAll(async () => {
    expect(routes.length).toBeGreaterThan(250);

    app = await createE2eApp();
    prisma = app.get(PrismaService);

    const { permissions, createdCodes } = await ensureAllDeclaredPermissions(prisma);
    const permissionIds = permissions.map((permission) => permission.id);
    generatedPermissionCodes = createdCodes;

    const group = await prisma.group.create({
      data: {
        code: `E2EAPIG${suffix.slice(-8)}`,
        name: `E2E API Smoke Group ${suffix}`,
      },
    });
    groupId = group.id;

    const company = await prisma.company.create({
      data: {
        groupId,
        code: `E2EAPIC${suffix.slice(-8)}`,
        name: `E2E API Smoke Company ${suffix}`,
      },
    });
    companyId = company.id;

    const role = await prisma.role.create({
      data: {
        name: `e2e_api_smoke_group_${suffix}`,
        displayName: 'E2E API Smoke Group Role',
        scope: RoleScope.GROUP,
        rolePermissions: {
          create: permissionIds.map((permissionId) => ({ permissionId })),
        },
      },
    });
    roleId = role.id;

    const passwordHash = await argon2.hash(TEST_PASS);
    const user = await prisma.user.create({
      data: {
        email: `e2e-api-smoke-${suffix}@itemba.local`,
        passwordHash,
        fullName: 'E2E API Smoke User',
        status: 'ACTIVE',
        companyId,
        userRoles: { create: { roleId } },
      },
    });
    userId = user.id;

    rawApiKey = `e2e-api-smoke-${suffix}-secret`;
    const apiClient = await prisma.apiClient.create({
      data: {
        clientCode: `E2EAPICL${suffix.slice(-8)}`,
        companyId,
        name: `E2E API Smoke Client ${suffix}`,
        allowedScopes: ['payments.read'],
        createdById: userId,
      },
    });
    apiClientId = apiClient.id;

    const apiKey = await prisma.apiKey.create({
      data: {
        apiKeyCode: `E2EAPIK${suffix.slice(-8)}`,
        apiClientId,
        keyPrefix: rawApiKey.slice(0, 16),
        keyHash: createHash('sha256').update(rawApiKey).digest('hex'),
        name: 'E2E API Smoke Key',
        scopes: ['payments.read'],
        createdById: userId,
      },
    });
    apiKeyId = apiKey.id;

    token = await loginAs(app, user.email, TEST_PASS);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.auditLog.deleteMany({
        where: {
          OR: [{ userId }, { companyId }],
        },
      });
      if (apiKeyId || apiClientId) {
        await prisma.apiRequestLog.deleteMany({
          where: {
            OR: [{ apiKeyId }, { apiClientId }],
          },
        });
      }
      if (apiKeyId) {
        await prisma.apiKey.deleteMany({ where: { id: apiKeyId } });
      }
      if (apiClientId) {
        await prisma.apiClient.deleteMany({ where: { id: apiClientId } });
      }
      if (userId) {
        await prisma.activeSession.deleteMany({ where: { userId } });
        await prisma.refreshToken.deleteMany({ where: { userId } });
        await prisma.user.deleteMany({ where: { id: userId } });
      }
      if (roleId) {
        await prisma.role.deleteMany({ where: { id: roleId } });
      }
      if (generatedPermissionCodes.length > 0) {
        await prisma.permission.deleteMany({
          where: {
            code: { in: generatedPermissionCodes },
            rolePermissions: { none: {} },
          },
        });
      }
      if (companyId) {
        await prisma.company.deleteMany({ where: { id: companyId } });
      }
      if (groupId) {
        await prisma.group.deleteMany({ where: { id: groupId } });
      }
    }
    if (app) {
      await app.close();
    }
  });

  it('has a static GET smoke route for most backend controllers', () => {
    const controllerCount = countControllerFiles();
    const coveredControllers = new Set(routes.map((route) => route.controllerFile)).size;
    expect(coveredControllers).toBeGreaterThanOrEqual(Math.floor(controllerCount * 0.8));
  });

  it.each(routes)('$path does not fail with a server error', async (route) => {
    const response = await request(app.getHttpServer())
      .get(route.path)
      .query({
        page: 1,
        limit: 1,
        pageSize: 1,
        companyId,
        year: 2026,
        month: 5,
        fromMonth: 1,
        toMonth: 5,
      })
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBeLessThan(500);
    expect(response.status).not.toBe(401);
  });

  it('authenticates API-key integration read routes', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/integration/payments')
      .query({ page: 1, limit: 1 })
      .set('x-api-key', rawApiKey);

    expect(response.status).toBeLessThan(500);
    expect(response.status).toBe(200);
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

async function ensureAllDeclaredPermissions(
  prisma: PrismaService,
): Promise<{ permissions: Permission[]; createdCodes: string[] }> {
  const codes = discoverRequirePermissionCodes();
  const existing = await prisma.permission.findMany({
    where: { code: { in: codes } },
    select: { code: true },
  });
  const existingCodes = new Set(existing.map((permission) => permission.code));
  const createdCodes = codes.filter((code) => !existingCodes.has(code));
  const permissions = await Promise.all(
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
  return { permissions, createdCodes };
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

function discoverStaticGetRoutes(): StaticGetRoute[] {
  const routes: StaticGetRoute[] = [];
  for (const controllerFile of walkControllerFiles(MODULES_DIR)) {
    const source = readFileSync(controllerFile, 'utf8');
    if (source.includes('RequireApiScope(') || source.includes('ApiKeyAuthGuard')) continue;

    const controllerPath = extractDecoratorPath(source, 'Controller');
    if (controllerPath === null || hasPathParam(controllerPath)) continue;

    const getRegex = /@Get\(([^)]*)\)/g;
    for (const match of source.matchAll(getRegex)) {
      const methodPath = parseDecoratorArgument(match[1] ?? '');
      if (methodPath === null || hasPathParam(methodPath)) continue;
      routes.push({
        controllerFile,
        controllerPath,
        methodPath,
        path: toApiPath(controllerPath, methodPath),
      });
    }
  }

  return [...new Map(routes.map((route) => [route.path, route])).values()].sort((a, b) =>
    a.path.localeCompare(b.path),
  );
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
  return `/api/v1/${combined}`.replace(/\/+/g, '/');
}

function hasPathParam(routePath: string): boolean {
  return /[:*()[\]]/.test(routePath);
}

function countControllerFiles(): number {
  return walkControllerFiles(MODULES_DIR).length;
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
