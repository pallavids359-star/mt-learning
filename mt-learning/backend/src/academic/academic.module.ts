import { Body, Controller, Delete, Get, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { RequestMeta, StaffPrincipal } from '../common/auth-principal';
import { CurrentStaff, ReqMeta, RequirePermissions } from '../common/decorators';
import { Permission } from '../common/permissions';
import {
  ClassQueryDto,
  CreateAcademicYearDto,
  CreateClassDto,
  CreateSubjectDto,
  SectionDto,
  SetClassSubjectsDto,
  UpdateAcademicYearDto,
  UpdateClassDto,
  UpdateSubjectDto,
} from './academic.dto';
import { AcademicService } from './academic.service';

const Id = () => Param('id', ParseUUIDPipe);

@ApiTags('Academic years')
@ApiBearerAuth()
@Controller('academic-years')
export class AcademicYearsController {
  constructor(private readonly svc: AcademicService) {}

  @Get() @RequirePermissions(Permission.AcademicRead)
  list() {
    return this.svc.listYears();
  }

  @Post() @RequirePermissions(Permission.AcademicWrite)
  create(@CurrentStaff() a: StaffPrincipal, @Body() dto: CreateAcademicYearDto, @ReqMeta() m: RequestMeta) {
    return this.svc.createYear(a, dto, m);
  }

  @Patch(':id') @RequirePermissions(Permission.AcademicWrite)
  update(@CurrentStaff() a: StaffPrincipal, @Id() id: string, @Body() dto: UpdateAcademicYearDto, @ReqMeta() m: RequestMeta) {
    return this.svc.updateYear(a, id, dto, m);
  }

  @Post(':id/set-current') @HttpCode(200) @RequirePermissions(Permission.AcademicWrite)
  setCurrent(@CurrentStaff() a: StaffPrincipal, @Id() id: string, @ReqMeta() m: RequestMeta) {
    return this.svc.setCurrentYear(a, id, m);
  }
}

@ApiTags('Classes & sections')
@ApiBearerAuth()
@Controller()
export class ClassesController {
  constructor(private readonly svc: AcademicService) {}

  @Get('classes') @RequirePermissions(Permission.AcademicRead)
  list(@Query() q: ClassQueryDto) {
    return this.svc.listClasses(q.academicYearId);
  }

  @Get('classes/:id') @RequirePermissions(Permission.AcademicRead)
  get(@Id() id: string) {
    return this.svc.getClass(id);
  }

  @Post('classes') @RequirePermissions(Permission.AcademicWrite)
  create(@CurrentStaff() a: StaffPrincipal, @Body() dto: CreateClassDto, @ReqMeta() m: RequestMeta) {
    return this.svc.createClass(a, dto, m);
  }

  @Patch('classes/:id') @RequirePermissions(Permission.AcademicWrite)
  update(@CurrentStaff() a: StaffPrincipal, @Id() id: string, @Body() dto: UpdateClassDto, @ReqMeta() m: RequestMeta) {
    return this.svc.updateClass(a, id, dto, m);
  }

  @Put('classes/:id/subjects') @RequirePermissions(Permission.AcademicWrite)
  setSubjects(@CurrentStaff() a: StaffPrincipal, @Id() id: string, @Body() dto: SetClassSubjectsDto, @ReqMeta() m: RequestMeta) {
    return this.svc.setClassSubjects(a, id, dto.subjectIds, m);
  }

  @Delete('classes/:id') @HttpCode(204) @RequirePermissions(Permission.AcademicWrite)
  async remove(@CurrentStaff() a: StaffPrincipal, @Id() id: string, @ReqMeta() m: RequestMeta) {
    await this.svc.deleteClass(a, id, m);
  }

  @Post('classes/:id/sections') @RequirePermissions(Permission.AcademicWrite)
  addSection(@CurrentStaff() a: StaffPrincipal, @Id() id: string, @Body() dto: SectionDto, @ReqMeta() m: RequestMeta) {
    return this.svc.addSection(a, id, dto.name, m);
  }

  @Patch('sections/:id') @RequirePermissions(Permission.AcademicWrite)
  renameSection(@CurrentStaff() a: StaffPrincipal, @Id() id: string, @Body() dto: SectionDto, @ReqMeta() m: RequestMeta) {
    return this.svc.renameSection(a, id, dto.name, m);
  }

  @Delete('sections/:id') @HttpCode(204) @RequirePermissions(Permission.AcademicWrite)
  async deleteSection(@CurrentStaff() a: StaffPrincipal, @Id() id: string, @ReqMeta() m: RequestMeta) {
    await this.svc.deleteSection(a, id, m);
  }
}

@ApiTags('Subjects')
@ApiBearerAuth()
@Controller('subjects')
export class SubjectsController {
  constructor(private readonly svc: AcademicService) {}

  @Get() @RequirePermissions(Permission.AcademicRead)
  list() {
    return this.svc.listSubjects();
  }

  @Post() @RequirePermissions(Permission.AcademicWrite)
  create(@CurrentStaff() a: StaffPrincipal, @Body() dto: CreateSubjectDto, @ReqMeta() m: RequestMeta) {
    return this.svc.createSubject(a, dto, m);
  }

  @Patch(':id') @RequirePermissions(Permission.AcademicWrite)
  update(@CurrentStaff() a: StaffPrincipal, @Id() id: string, @Body() dto: UpdateSubjectDto, @ReqMeta() m: RequestMeta) {
    return this.svc.updateSubject(a, id, dto, m);
  }
}

@Module({
  controllers: [AcademicYearsController, ClassesController, SubjectsController],
  providers: [AcademicService],
  exports: [AcademicService],
})
export class AcademicModule {}
