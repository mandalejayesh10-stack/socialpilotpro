import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { PostService } from './post.service';
import { CreatePostDto, BulkScheduleDto, UpdatePostDto } from './dto/create-post.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../../common/guards/org-member.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentOrg } from '../../common/decorators/current-user.decorator';
import { State } from '@prisma/client';

@ApiTags('Posts')
@ApiBearerAuth()
@Controller('posts')
@UseGuards(JwtAuthGuard, OrgMemberGuard, PermissionsGuard)
export class PostController {
  constructor(private postService: PostService) {}

  @Get()
  @ApiOperation({ summary: 'Get posts for calendar view' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'platform', required: false })
  @ApiQuery({ name: 'state', required: false, enum: State })
  async getPosts(
    @CurrentOrg() org: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('platform') platform?: string,
    @Query('state') state?: State,
  ) {
    return this.postService.getPosts(org.id, {
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      platform,
      state,
    });
  }

  @Post()
  @RequirePermissions('scheduling:write')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create and schedule a post' })
  async create(@CurrentOrg() org: any, @Body() dto: CreatePostDto) {
    return this.postService.createPost(org.id, {
      ...dto,
      publishDate: new Date(dto.publishDate),
    });
  }

  @Post('bulk')
  @RequirePermissions('scheduling:write')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Bulk schedule multiple posts' })
  async bulkSchedule(@CurrentOrg() org: any, @Body() body: BulkScheduleDto) {
    return this.postService.bulkSchedule(
      org.id,
      body.posts.map(p => ({ ...p, publishDate: new Date(p.publishDate) })),
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single post with metrics' })
  async getPost(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.postService.getPost(org.id, id);
  }

  @Patch(':id')
  @RequirePermissions('scheduling:write')
  @ApiOperation({ summary: 'Update a scheduled post' })
  async update(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() dto: UpdatePostDto,
  ) {
    return this.postService.updatePost(org.id, id, {
      ...dto,
      publishDate: dto.publishDate ? new Date(dto.publishDate) : undefined,
    });
  }

  @Delete(':id')
  @RequirePermissions('delete:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a post' })
  async delete(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.postService.deletePost(org.id, id);
  }

  @Get(':id/logs')
  @ApiOperation({ summary: 'Get publish logs for a post' })
  async getLogs(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.postService.getPublishLogs(org.id, id);
  }
}
