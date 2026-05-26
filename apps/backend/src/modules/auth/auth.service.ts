import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../database/prisma.service';
import { TokenService } from './token.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private tokenService: TokenService,
  ) {}

  // ── Email / Password Registration ─────────────────────────
  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findFirst({
      where: { email: dto.email, providerName: 'LOCAL' },
    });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const hashed = await bcrypt.hash(dto.password, 12);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashed,
        name: dto.name,
        providerName: 'LOCAL',
        activated: true,
        timezone: dto.timezone || 'UTC',
      },
    });

    // Create default organization (brand) for the user
    const org = await this.prisma.organization.create({
      data: {
        name: dto.organizationName || `${dto.name}'s Workspace`,
        users: {
          create: {
            userId: user.id,
            role: 'ADMIN',
          },
        },
        usageLimits: {
          create: {
            postsLimit: 10,
            accountsLimit: 3,
            reportsLimit: 0,
            aiCreditsLimit: 10,
            teamMembersLimit: 1,
          },
        },
      },
    });

    const token = this.tokenService.sign({
      id: user.id,
      email: user.email,
      isSuperAdmin: user.isSuperAdmin,
    });

    return {
      token,
      user: this.sanitizeUser(user),
      organization: org,
    };
  }

  // ── Email / Password Login ────────────────────────────────
  async login(dto: LoginDto) {
    const user = await this.prisma.user.findFirst({
      where: { email: dto.email, providerName: 'LOCAL' },
    });

    if (!user || !user.password) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const valid = await bcrypt.compare(dto.password, user.password);
    if (!valid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.activated) {
      throw new UnauthorizedException('Please activate your account first');
    }

    // Update last online
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastOnline: new Date() },
    });

    const token = this.tokenService.sign({
      id: user.id,
      email: user.email,
      isSuperAdmin: user.isSuperAdmin,
    });

    // Get user's organizations
    const orgs = await this.prisma.userOrganization.findMany({
      where: { userId: user.id, disabled: false },
      include: { organization: true },
    });

    return {
      token,
      user: this.sanitizeUser(user),
      organizations: orgs.map((o) => o.organization),
    };
  }

  // ── Google OAuth Login / Register ─────────────────────────
  async googleAuth(googleUser: {
    email: string;
    name: string;
    pictureUrl?: string;
    providerId: string;
  }) {
    // Find ANY existing user with this email to link accounts
    let user = await this.prisma.user.findFirst({
      where: { email: googleUser.email },
      orderBy: { createdAt: 'asc' }, // Prefer the oldest account (usually the LOCAL one)
    });

    if (!user) {
      // New user via Google
      user = await this.prisma.user.create({
        data: {
          email: googleUser.email,
          name: googleUser.name,
          pictureUrl: googleUser.pictureUrl,
          providerName: 'GOOGLE',
          providerId: googleUser.providerId,
          activated: true,
          timezone: 'UTC',
        },
      });

      // Create default org
      await this.prisma.organization.create({
        data: {
          name: `${googleUser.name}'s Workspace`,
          users: {
            create: { userId: user.id, role: 'ADMIN' },
          },
          usageLimits: {
            create: {
              postsLimit: 10,
              accountsLimit: 3,
              reportsLimit: 0,
              aiCreditsLimit: 10,
              teamMembersLimit: 1,
            },
          },
        },
      });
    } else {
      // Update picture if changed
      if (googleUser.pictureUrl && user.pictureUrl !== googleUser.pictureUrl) {
        await this.prisma.user.update({
          where: { id: user.id },
          data: { pictureUrl: googleUser.pictureUrl, lastOnline: new Date() },
        });
      }
    }

    const token = this.tokenService.sign({
      id: user.id,
      email: user.email,
      isSuperAdmin: user.isSuperAdmin,
    });

    const orgs = await this.prisma.userOrganization.findMany({
      where: { userId: user.id, disabled: false },
      include: { organization: true },
    });

    return {
      token,
      user: this.sanitizeUser(user),
      organizations: orgs.map((o) => o.organization),
    };
  }

  // ── Get current user ──────────────────────────────────────
  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        organizations: {
          where: { disabled: false },
          include: {
            organization: {
              include: {
                subscription: true,
                usageLimits: true,
                _count: {
                  select: {
                    integrations: { where: { deletedAt: null } },
                  },
                },
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!user) throw new UnauthorizedException('User not found');

    // Update last online
    await this.prisma.user.update({
      where: { id: userId },
      data: { lastOnline: new Date() },
    });

    const { password, twoFactorSecret, ...safeUser } = user as any;
    return safeUser;
  }
  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.password) throw new BadRequestException('No password set for this account');

    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) throw new UnauthorizedException('Current password is incorrect');

    const hashed = await bcrypt.hash(newPassword, 12);
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashed },
    });

    return { message: 'Password updated successfully' };
  }

  private sanitizeUser(user: any) {
    const { password, twoFactorSecret, ...safe } = user;
    return safe;
  }
}
