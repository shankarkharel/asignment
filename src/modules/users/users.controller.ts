import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from './domain/role.enum';
import { CreateUserDto } from './dto/create-user.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Caller is not an ADMIN' })
@Roles(Role.ADMIN)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @ApiOperation({ summary: 'Create a user (ADMIN only)' })
  async create(@Body() dto: CreateUserDto): Promise<UserResponseDto> {
    return UserResponseDto.fromEntity(await this.usersService.create(dto));
  }

  @Get()
  @ApiOperation({ summary: 'List users, optionally filtered by role (ADMIN only)' })
  async list(@Query() query: ListUsersQueryDto): Promise<UserResponseDto[]> {
    const users = await this.usersService.list(query.role);
    return users.map((user) => UserResponseDto.fromEntity(user));
  }
}
