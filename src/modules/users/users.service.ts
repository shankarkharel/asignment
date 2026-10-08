import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';
import { ConflictError } from '../../common/errors/domain.errors';
import { AppConfig } from '../../config/configuration';
import { Role } from './domain/role.enum';
import { UserEntity } from './domain/user.entity';
import { CreateUserDto } from './dto/create-user.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async create(dto: CreateUserDto): Promise<UserEntity> {
    const email = dto.email.toLowerCase();
    if (await this.users.existsBy({ email })) {
      throw new ConflictError('A user with this email already exists');
    }
    const passwordHash = await bcrypt.hash(
      dto.password,
      this.config.get('auth.bcryptRounds', { infer: true }),
    );
    const user = await this.users.save(
      this.users.create({ email, passwordHash, fullName: dto.fullName, role: dto.role }),
    );
    // Re-read so the returned object never carries the hash.
    return this.users.findOneByOrFail({ id: user.id });
  }

  findActiveById(id: string): Promise<UserEntity | null> {
    return this.users.findOneBy({ id, isActive: true });
  }

  /** The only query that loads the password hash; used exclusively by the login flow. */
  findActiveByEmailWithPassword(email: string): Promise<UserEntity | null> {
    return this.users
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email: email.toLowerCase() })
      .andWhere('user.isActive = true')
      .getOne();
  }

  list(role?: Role): Promise<UserEntity[]> {
    return this.users.find({ where: role ? { role } : {}, order: { createdAt: 'ASC' } });
  }
}
