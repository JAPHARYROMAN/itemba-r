import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { identifier, object, revision, validateLayout } from './workspace.validation';
import sharp from 'sharp';

@Injectable()
export class WorkspaceService {
  constructor(private readonly prisma: PrismaService) {}
  owner(user: AuthUser) {
    if (!user?.id || user.principalType) throw new ForbiddenException('Personal workspace requires a signed-in person');
    return user.id;
  }
  sessions(user: AuthUser) {
    return this.prisma.workspaceSession.findMany({ where: { userId: this.owner(user) }, orderBy: { updatedAt: 'desc' }, take: 50 });
  }
  async saveSession(user: AuthUser, id: string, input: unknown) {
    const userId = this.owner(user), dto = object(input), layout = validateLayout(dto.layout);
    identifier(id); const expected = revision(dto.expectedRevision), deviceId = identifier(dto.deviceId);
    if (typeof dto.name !== 'string' || !dto.name.trim() || dto.name.length > 80) throw new BadRequestException('A workspace name is required');
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`workspace:${userId}`}))`;
      const old = await tx.workspaceSession.findUnique({ where: { id } });
      if (old && old.userId !== userId) throw new NotFoundException();
      if ((old?.revision ?? 0) !== expected) throw new ConflictException('Workspace changed elsewhere. Continue in a new session to preserve both layouts.');
      if (!old && await tx.workspaceSession.count({ where: { userId } }) >= 50) throw new BadRequestException('Remove an old workspace before creating another');
      return tx.workspaceSession.upsert({ where: { id }, create: { id, userId, deviceId, name: dto.name.trim(), layout }, update: { name: dto.name.trim(), layout, revision: { increment: 1 } } });
    });
  }
  async deleteSession(user: AuthUser, id: string) {
    await this.prisma.workspaceSession.deleteMany({ where: { id: identifier(id), userId: this.owner(user) } });
    return { removed: true };
  }
  wallpapers(user: AuthUser) {
    return this.prisma.workspaceWallpaper.findMany({ where: { userId: this.owner(user) }, select: { id: true, name: true, width: true, height: true, createdAt: true }, orderBy: { createdAt: 'desc' } });
  }
  async wallpaper(user: AuthUser, id: string) {
    const row = await this.prisma.workspaceWallpaper.findFirst({ where: { id: identifier(id), userId: this.owner(user) } });
    if (!row) throw new NotFoundException('Wallpaper unavailable');
    return row.image;
  }
  async uploadWallpaper(user: AuthUser, file: Express.Multer.File) {
    const userId = this.owner(user);
    if (!file?.buffer || file.size > 10 * 1024 * 1024 || !['image/jpeg','image/png','image/webp'].includes(file.mimetype)) throw new BadRequestException('Choose a JPEG, PNG or WebP image under 10 MB');
    let image: Buffer, width: number, height: number;
    try {
      const source = sharp(file.buffer, { limitInputPixels: 40000000, animated: false });
      const meta = await source.metadata();
      if (!['jpeg','png','webp'].includes(meta.format ?? '') || (meta.pages ?? 1) > 1) throw new Error('Unsupported image');
      const result = await source.rotate().resize({ width: 2560, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer({ resolveWithObject: true });
      image = result.data; width = result.info.width; height = result.info.height;
    } catch { throw new BadRequestException('This image could not be decoded. Choose a valid static JPEG, PNG or WebP.'); }
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`workspace:${userId}`}))`;
      if (await tx.workspaceWallpaper.count({ where: { userId } }) >= 12) throw new BadRequestException('Keep up to 12 personal wallpapers. Remove one before uploading.');
      return tx.workspaceWallpaper.create({ data: { userId, name: file.originalname.replace(/[\x00-\x1f\\/]/g, '').slice(0,120) || 'Wallpaper', image, width, height }, select: { id: true, name: true, width: true, height: true, createdAt: true } });
    });
  }
  async deleteWallpaper(user: AuthUser, id: string) {
    await this.prisma.workspaceWallpaper.deleteMany({ where: { id: identifier(id), userId: this.owner(user) } });
    return { removed: true };
  }
}
