import { Body, Controller, Delete, Get, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { RequestMeta, StaffPrincipal, StudentPrincipal } from '../common/auth-principal';
import { CurrentStaff, CurrentStudent, ReqMeta, RequirePermissions, StudentOnly } from '../common/decorators';
import { Permission } from '../common/permissions';
import { CreateTestDto, MarksQueryDto, ProgressDto, ReviewDto, ReviveDto, SetQuestionsDto, StartTestDto, SubmitTestDto, TestQueryDto, UpdateTestDto } from './tests.dto';
import { TestsService } from './tests.service';

const Id = () => Param('id', ParseUUIDPipe);

@ApiTags('Tests & exams')
@ApiBearerAuth()
@Controller('tests')
export class TestsController {
  constructor(private readonly svc: TestsService) {}

  @Get() @RequirePermissions(Permission.TestsRead)
  list(@Query() q: TestQueryDto) {
    return this.svc.list(q);
  }

  @Get('marks') @RequirePermissions(Permission.TestsReview)
  marks(@Query() q: MarksQueryDto) {
    return this.svc.marksSheet(q.classId, q.sectionId);
  }

  @Get('reviews/pending') @RequirePermissions(Permission.TestsReview)
  pending() {
    return this.svc.pendingReviews();
  }

  @Get(':id') @RequirePermissions(Permission.TestsRead)
  get(@Id() id: string) {
    return this.svc.get(id);
  }

  @Post() @RequirePermissions(Permission.TestsWrite)
  create(@CurrentStaff() a: StaffPrincipal, @Body() dto: CreateTestDto, @ReqMeta() m: RequestMeta) {
    return this.svc.create(a, dto, m);
  }

  @Patch(':id') @RequirePermissions(Permission.TestsWrite)
  update(@CurrentStaff() a: StaffPrincipal, @Id() id: string, @Body() dto: UpdateTestDto, @ReqMeta() m: RequestMeta) {
    return this.svc.update(a, id, dto, m);
  }

  @Put(':id/questions') @RequirePermissions(Permission.TestsWrite)
  setQuestions(@CurrentStaff() a: StaffPrincipal, @Id() id: string, @Body() dto: SetQuestionsDto, @ReqMeta() m: RequestMeta) {
    return this.svc.setQuestions(a, id, dto.questions, m);
  }

  @Post(':id/publish') @HttpCode(200) @RequirePermissions(Permission.TestsWrite)
  publish(@CurrentStaff() a: StaffPrincipal, @Id() id: string, @ReqMeta() m: RequestMeta) {
    return this.svc.publish(a, id, m);
  }

  @Post(':id/unpublish') @HttpCode(200) @RequirePermissions(Permission.TestsWrite)
  unpublish(@CurrentStaff() a: StaffPrincipal, @Id() id: string, @ReqMeta() m: RequestMeta) {
    return this.svc.unpublish(a, id, m);
  }

  @Delete(':id') @HttpCode(204) @RequirePermissions(Permission.TestsWrite)
  async remove(@CurrentStaff() a: StaffPrincipal, @Id() id: string, @ReqMeta() m: RequestMeta) {
    await this.svc.remove(a, id, m);
  }

  @Get(':id/results') @RequirePermissions(Permission.TestsReview)
  results(@Id() id: string) {
    return this.svc.results(id);
  }

  @Patch(':id/attempts/:attemptId/review') @RequirePermissions(Permission.TestsReview)
  review(
    @CurrentStaff() a: StaffPrincipal,
    @Id() id: string,
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
    @Body() dto: ReviewDto,
    @ReqMeta() m: RequestMeta,
  ) {
    return this.svc.review(a, id, attemptId, dto, m);
  }

  @Get(':id/monitor') @RequirePermissions(Permission.TestsRead)
  monitor(@Id() id: string) {
    return this.svc.monitor(id);
  }

  @Post(':id/attempts/:attemptId/force-submit') @HttpCode(200) @RequirePermissions(Permission.TestsReview)
  forceSubmit(@CurrentStaff() a: StaffPrincipal, @Id() id: string, @Param('attemptId', ParseUUIDPipe) attemptId: string, @ReqMeta() m: RequestMeta) {
    return this.svc.forceSubmit(a, id, attemptId, m);
  }

  @Post(':id/attempts/:attemptId/revive') @HttpCode(200) @RequirePermissions(Permission.TestsReview)
  revive(@CurrentStaff() a: StaffPrincipal, @Id() id: string, @Param('attemptId', ParseUUIDPipe) attemptId: string, @Body() dto: ReviveDto, @ReqMeta() m: RequestMeta) {
    return this.svc.revive(a, id, attemptId, dto.minutes, m);
  }

  @Post(':id/attempts/:attemptId/restart') @HttpCode(200) @RequirePermissions(Permission.TestsReview)
  restart(@CurrentStaff() a: StaffPrincipal, @Id() id: string, @Param('attemptId', ParseUUIDPipe) attemptId: string, @ReqMeta() m: RequestMeta) {
    return this.svc.restart(a, id, attemptId, m);
  }

  @Post(':id/release-results') @HttpCode(200) @RequirePermissions(Permission.TestsReview)
  release(@CurrentStaff() a: StaffPrincipal, @Id() id: string, @ReqMeta() m: RequestMeta) {
    return this.svc.releaseResults(a, id, m);
  }
}

@ApiTags('Student app')
@ApiBearerAuth()
@StudentOnly()
@Controller('me')
export class StudentTestsController {
  constructor(private readonly svc: TestsService) {}

  @Get('tests')
  list(@CurrentStudent() me: StudentPrincipal) {
    return this.svc.studentList(me.id);
  }

  @Post('tests/:id/start') @HttpCode(200)
  start(@CurrentStudent() me: StudentPrincipal, @Id() id: string, @Body() dto: StartTestDto) {
    return this.svc.start(me, id, dto);
  }

  @Post('tests/:id/progress') @HttpCode(200)
  progress(@CurrentStudent() me: StudentPrincipal, @Id() id: string, @Body() dto: ProgressDto) {
    return this.svc.progress(me, id, dto);
  }

  @Get('tests/:id/package')
  pkg(@CurrentStudent() me: StudentPrincipal, @Id() id: string) {
    return this.svc.offlinePackage(me, id);
  }

  @Post('tests/:id/submit') @HttpCode(200)
  submit(@CurrentStudent() me: StudentPrincipal, @Id() id: string, @Body() dto: SubmitTestDto, @ReqMeta() m: RequestMeta) {
    return this.svc.submit(me, id, dto, m);
  }

  @Get('tests/:id/review')
  review(@CurrentStudent() me: StudentPrincipal, @Id() id: string) {
    return this.svc.studentReview(me.id, id);
  }

  @Get('results')
  results(@CurrentStudent() me: StudentPrincipal) {
    return this.svc.studentResults(me.id);
  }
}

@Module({ controllers: [TestsController, StudentTestsController], providers: [TestsService], exports: [TestsService] })
export class TestsModule {}
