import {
  Body,
  Controller,
  Get,
  HttpCode,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { RequestMeta, StaffPrincipal } from '../common/auth-principal';
import { CurrentStaff, ReqMeta, RequirePermissions } from '../common/decorators';
import { Permission } from '../common/permissions';
import { CreateStudentDto, ImportQueryDto, StudentQueryDto, StudentStatusDto, TransferStudentDto, UpdateStudentDto } from './students.dto';
import { StudentsService } from './students.service';

const Id = () => Param('id', ParseUUIDPipe);
const fileBody = { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } };

@ApiTags('Students')
@ApiBearerAuth()
@Controller('students')
export class StudentsController {
  constructor(private readonly svc: StudentsService) {}

  @Get() @RequirePermissions(Permission.StudentsRead)
  list(@CurrentStaff() a: StaffPrincipal, @Query() q: StudentQueryDto) {
    return this.svc.list(a, q);
  }

  @Post('import')
  @HttpCode(200)
  @RequirePermissions(Permission.StudentsWrite, Permission.StudentsCredentials)
  @ApiConsumes('multipart/form-data')
  @ApiBody(fileBody)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  import(@CurrentStaff() a: StaffPrincipal, @UploadedFile() file: Express.Multer.File, @Query() q: ImportQueryDto, @ReqMeta() m: RequestMeta) {
    return this.svc.importCsv(a, file, q, m);
  }

  @Get(':id') @RequirePermissions(Permission.StudentsRead)
  get(@CurrentStaff() a: StaffPrincipal, @Id() id: string) {
    return this.svc.get(a, id);
  }

  @Post() @RequirePermissions(Permission.StudentsWrite, Permission.StudentsCredentials)
  create(@CurrentStaff() a: StaffPrincipal, @Body() dto: CreateStudentDto, @ReqMeta() m: RequestMeta) {
    return this.svc.create(a, dto, m);
  }

  @Patch(':id') @RequirePermissions(Permission.StudentsWrite)
  update(@CurrentStaff() a: StaffPrincipal, @Id() id: string, @Body() dto: UpdateStudentDto, @ReqMeta() m: RequestMeta) {
    return this.svc.update(a, id, dto, m);
  }

  @Patch(':id/status') @RequirePermissions(Permission.StudentsWrite)
  setStatus(@CurrentStaff() a: StaffPrincipal, @Id() id: string, @Body() dto: StudentStatusDto, @ReqMeta() m: RequestMeta) {
    return this.svc.setStatus(a, id, dto.status, dto.reason, m);
  }

  @Post(':id/transfer') @HttpCode(200) @RequirePermissions(Permission.StudentsWrite)
  transfer(@CurrentStaff() a: StaffPrincipal, @Id() id: string, @Body() dto: TransferStudentDto, @ReqMeta() m: RequestMeta) {
    return this.svc.transfer(a, id, dto, m);
  }

  @Post(':id/reset-credentials') @HttpCode(200) @RequirePermissions(Permission.StudentsCredentials)
  reset(@CurrentStaff() a: StaffPrincipal, @Id() id: string, @ReqMeta() m: RequestMeta) {
    return this.svc.resetCredentials(a, id, m);
  }

  @Post(':id/photo')
  @HttpCode(200)
  @RequirePermissions(Permission.StudentsWrite)
  @ApiConsumes('multipart/form-data')
  @ApiBody(fileBody)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }))
  setPhoto(@CurrentStaff() a: StaffPrincipal, @Id() id: string, @UploadedFile() file: Express.Multer.File, @ReqMeta() m: RequestMeta) {
    return this.svc.setPhoto(a, id, file, m);
  }

  @Get(':id/photo') @RequirePermissions(Permission.StudentsRead)
  async photo(@Id() id: string, @Res({ passthrough: true }) res: Response) {
    const { data, contentType } = await this.svc.getPhoto(id);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, max-age=300');
    return new StreamableFile(data);
  }
}

@Module({ controllers: [StudentsController], providers: [StudentsService], exports: [StudentsService] })
export class StudentsModule {}
