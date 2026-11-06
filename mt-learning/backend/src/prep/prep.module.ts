import { Body, Controller, Delete, Get, HttpCode, Logger, Module, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { StudentPrincipal } from '../common/auth-principal';
import { CurrentStudent, RequirePermissions, StudentOnly } from '../common/decorators';
import { Permission } from '../common/permissions';
import { loadEnv } from '../config/env';
import { QUESTION_BANK, type QuestionBank } from './bank';
import { MongoQuestionBank } from './mongo-bank';
import { AnswersDto, BookmarkDto, BrowseQueryDto, ExamQueryDto, HistoryQueryDto, MockDto, PracticeDto, ReviseDto, TargetDto } from './prep.dto';
import { PrepService } from './prep.service';
import { SampleQuestionBank } from './sample-bank';
import { SupabaseQuestionBank } from './supabase-bank';

const AttemptId = () => Param('id', new ParseUUIDPipe());

@ApiTags('Student app: practice')
@ApiBearerAuth()
@StudentOnly()
@Controller('me/prep')
export class StudentPrepController {
  constructor(private readonly svc: PrepService) {}

  @Get('exams')
  exams(@CurrentStudent() me: StudentPrincipal) {
    return this.svc.exams(me);
  }

  @Put('target')
  target(@CurrentStudent() me: StudentPrincipal, @Body() dto: TargetDto) {
    return this.svc.setTarget(me, dto.examId);
  }

  @Get('syllabus')
  syllabus(@CurrentStudent() me: StudentPrincipal, @Query() q: ExamQueryDto) {
    return this.svc.syllabus(me, q.examId);
  }

  @Get('chapters/:chapterId/topics')
  topics(@Param('chapterId') chapterId: string) {
    return this.svc.topics(chapterId.slice(0, 64));
  }

  @Post('practice')
  practice(@CurrentStudent() me: StudentPrincipal, @Body() dto: PracticeDto) {
    return this.svc.startPractice(me, dto);
  }

  @Post('mock')
  mock(@CurrentStudent() me: StudentPrincipal, @Body() dto: MockDto) {
    return this.svc.startMock(me, dto);
  }

  @Get('mocks')
  mocks(@CurrentStudent() me: StudentPrincipal, @Query() q: ExamQueryDto) {
    return this.svc.mocks(me, q.examId);
  }

  @Post('revise/wrong')
  wrong(@CurrentStudent() me: StudentPrincipal, @Body() dto: ReviseDto) {
    return this.svc.startWrong(me, dto);
  }

  @Post('revise/bookmarks')
  revisebookmarks(@CurrentStudent() me: StudentPrincipal, @Body() dto: ReviseDto) {
    return this.svc.startBookmarks(me, dto);
  }

  @Get('attempts/:id')
  attempt(@CurrentStudent() me: StudentPrincipal, @AttemptId() id: string) {
    return this.svc.getAttempt(me, id);
  }

  @Put('attempts/:id/answers')
  save(@CurrentStudent() me: StudentPrincipal, @AttemptId() id: string, @Body() dto: AnswersDto) {
    return this.svc.save(me, id, dto);
  }

  @Post('attempts/:id/submit') @HttpCode(200)
  submit(@CurrentStudent() me: StudentPrincipal, @AttemptId() id: string, @Body() dto: AnswersDto) {
    return this.svc.submit(me, id, dto);
  }

  @Get('bookmarks')
  bookmarks(@CurrentStudent() me: StudentPrincipal, @Query() q: ExamQueryDto) {
    return this.svc.bookmarks(me, q.examId);
  }

  @Post('bookmarks') @HttpCode(200)
  addBookmark(@CurrentStudent() me: StudentPrincipal, @Body() dto: BookmarkDto) {
    return this.svc.addBookmark(me, dto.questionId);
  }

  @Delete('bookmarks/:questionId') @HttpCode(204)
  async removeBookmark(@CurrentStudent() me: StudentPrincipal, @Param('questionId') questionId: string) {
    await this.svc.removeBookmark(me, questionId.slice(0, 64));
  }

  @Get('dashboard')
  dashboard(@CurrentStudent() me: StudentPrincipal, @Query() q: ExamQueryDto) {
    return this.svc.dashboard(me, q.examId);
  }

  @Get('analytics')
  analytics(@CurrentStudent() me: StudentPrincipal, @Query() q: ExamQueryDto) {
    return this.svc.analytics(me, q.examId);
  }

  @Get('history')
  history(@CurrentStudent() me: StudentPrincipal, @Query() q: HistoryQueryDto) {
    return this.svc.history(me, q.examId, q.page ?? 1);
  }
}

/** Staff browse GenPrep's questions to build live tests. Read-only. */
@ApiTags('Question bank')
@ApiBearerAuth()
@Controller('question-bank')
export class QuestionBankController {
  constructor(private readonly svc: PrepService) {}

  @Get('status') @RequirePermissions(Permission.TestsRead)
  status() {
    return this.svc.status();
  }

  @Get('exams') @RequirePermissions(Permission.TestsWrite)
  exams() {
    return this.svc.staffExams();
  }

  @Get('syllabus') @RequirePermissions(Permission.TestsWrite)
  syllabus(@Query() q: ExamQueryDto) {
    return this.svc.staffSyllabus(q.examId);
  }

  @Get('questions') @RequirePermissions(Permission.TestsWrite)
  questions(@Query() q: BrowseQueryDto) {
    return this.svc.browse(q.chapterId, q.page ?? 1);
  }
}

@Module({
  controllers: [StudentPrepController, QuestionBankController],
  providers: [
    PrepService,
    {
      provide: QUESTION_BANK,
      useFactory: (): QuestionBank => {
        const env = loadEnv();
        if (env.GENPREP_DATABASE_URL) return new SupabaseQuestionBank(env.GENPREP_DATABASE_URL);
        if (env.GENPREP_MONGO_URI) return new MongoQuestionBank(env.GENPREP_MONGO_URI, env.GENPREP_DB_NAME);
        new Logger('QuestionBank').warn('GENPREP_DATABASE_URL is not set: using the built-in sample question bank');
        return new SampleQuestionBank();
      },
    },
  ],
  exports: [PrepService, QUESTION_BANK],
})
export class PrepModule {}
