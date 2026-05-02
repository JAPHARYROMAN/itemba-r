import { Injectable } from '@nestjs/common';
import { TrainingCourseStatus, TrainingEnrollmentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

type GroupCount = { _count: { _all: number } } & Record<string, unknown>;

@Injectable()
export class TrainingService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboardSummary() {
    const [
      activeCourses,
      draftCourses,
      archivedCourses,
      totalEnrollments,
      assignedEnrollments,
      completedEnrollments,
      inProgressEnrollments,
      cancelledEnrollments,
      activeLessons,
      draftLessons,
      activeWalkthroughs,
      totalWalkthroughs,
      activeTrainingEnvironments,
      averageProgress,
      courseStatusRows,
      enrollmentStatusRows,
      lessonStatusRows,
      coursesByModuleRows,
      recentCompletions,
      activeCourseCatalog,
      trainingEnvironmentRows,
    ] = await Promise.all([
      this.prisma.trainingCourse.count({
        where: { status: TrainingCourseStatus.ACTIVE, deletedAt: null },
      }),
      this.prisma.trainingCourse.count({
        where: { status: TrainingCourseStatus.DRAFT, deletedAt: null },
      }),
      this.prisma.trainingCourse.count({
        where: { status: TrainingCourseStatus.ARCHIVED, deletedAt: null },
      }),
      this.prisma.trainingEnrollment.count({ where: {} }),
      this.prisma.trainingEnrollment.count({
        where: { status: TrainingEnrollmentStatus.ASSIGNED },
      }),
      this.prisma.trainingEnrollment.count({
        where: { status: TrainingEnrollmentStatus.COMPLETED },
      }),
      this.prisma.trainingEnrollment.count({
        where: { status: TrainingEnrollmentStatus.IN_PROGRESS },
      }),
      this.prisma.trainingEnrollment.count({
        where: { status: TrainingEnrollmentStatus.CANCELLED },
      }),
      this.prisma.trainingLesson.count({ where: { status: 'ACTIVE', deletedAt: null } }),
      this.prisma.trainingLesson.count({ where: { status: 'DRAFT', deletedAt: null } }),
      this.prisma.guidedWalkthrough.count({ where: { status: 'ACTIVE', deletedAt: null } }),
      this.prisma.guidedWalkthrough.count({ where: { deletedAt: null } }),
      this.prisma.trainingEnvironmentConfig.count({
        where: { status: 'ACTIVE', deletedAt: null },
      }),
      this.prisma.trainingEnrollment.aggregate({ _avg: { progressPercent: true } }),
      this.prisma.trainingCourse.groupBy({
        by: ['status'],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.trainingEnrollment.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.trainingLesson.groupBy({
        by: ['status'],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.trainingCourse.groupBy({
        by: ['moduleName'],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.trainingEnrollment.findMany({
        where: { status: TrainingEnrollmentStatus.COMPLETED },
        select: {
          id: true,
          completedAt: true,
          progressPercent: true,
          trainingCourse: { select: { id: true, title: true, moduleName: true } },
          user: { select: { id: true, email: true, fullName: true } },
        },
        orderBy: { completedAt: 'desc' },
        take: 8,
      }),
      this.prisma.trainingCourse.findMany({
        where: { status: TrainingCourseStatus.ACTIVE, deletedAt: null },
        select: {
          id: true,
          courseCode: true,
          title: true,
          moduleName: true,
          roleName: true,
          difficulty: true,
          estimatedMinutes: true,
          _count: { select: { lessons: true, enrollments: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 10,
      }),
      this.prisma.trainingEnvironmentConfig.groupBy({
        by: ['environment'],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
    ]);
    const completionRate =
      totalEnrollments > 0 ? Math.round((completedEnrollments / totalEnrollments) * 100) : 0;
    const totalCourses = sumGroupCounts(courseStatusRows as GroupCount[]);

    return {
      activeCourses,
      totalCourses,
      totalEnrollments,
      completionRate,
      usersInTraining: inProgressEnrollments,
      recentCompletions,
      draftCourses,
      archivedCourses,
      activeLessons,
      draftLessons,
      activeWalkthroughs,
      totalWalkthroughs,
      activeEnvironments: activeTrainingEnvironments,
      activeTrainingEnvironments,
      assignedEnrollments,
      inProgressEnrollments,
      completedEnrollments,
      cancelledEnrollments,
      averageProgressPercent: round1(toNumber(averageProgress._avg.progressPercent)),
      courseReadiness: {
        activeCourses,
        coursesWithPublishedLessons: activeCourseCatalog.filter(
          (course) => course._count.lessons > 0,
        ).length,
        coursesNeedingLessons: activeCourseCatalog.filter((course) => course._count.lessons === 0),
      },
      courseStatusBreakdown: countBy(courseStatusRows as GroupCount[], 'status'),
      enrollmentStatusBreakdown: countBy(enrollmentStatusRows as GroupCount[], 'status'),
      lessonStatusBreakdown: countBy(lessonStatusRows as GroupCount[], 'status'),
      coursesByModule: countBy(coursesByModuleRows as GroupCount[], 'moduleName', 'UNASSIGNED'),
      environmentsByType: countBy(trainingEnvironmentRows as GroupCount[], 'environment'),
      activeCourseCatalog,
    };
  }
}

function toNumber(value: unknown) {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function countBy(rows: GroupCount[], key: string, emptyLabel = 'UNKNOWN') {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const value = row[key];
    const label =
      value === null || value === undefined || value === '' ? emptyLabel : String(value);
    acc[label] = row._count._all;
    return acc;
  }, {});
}

function sumGroupCounts(rows: GroupCount[]) {
  return rows.reduce((sum, row) => sum + row._count._all, 0);
}
