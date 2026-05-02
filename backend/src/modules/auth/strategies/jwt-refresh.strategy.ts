import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { ConfigService } from '@nestjs/config';
import { JwtPayload } from '../auth.service';

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      passReqToCallback: true,
    });
  }

  async validate(req: Request, payload: JwtPayload) {
    const rawToken = (req.headers['authorization'] ?? '').replace(/^Bearer\s+/i, '');
    if (!rawToken) throw new UnauthorizedException('Refresh token missing');
    return {
      id: payload.sub,
      email: payload.email,
      roles: [],
      permissions: [],
      rawRefreshToken: rawToken,
      // Carry the session id from the refresh JWT so AuthService.refresh() can
      // verify the bound ActiveSession is still ACTIVE before rotating tokens.
      sid: payload.sid,
    };
  }
}
