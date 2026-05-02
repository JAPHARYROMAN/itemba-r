import { TrainingService } from './training.service';

function makePrisma() {
  return {
    trainingCourse: {
      count: jest.fn().mockResolvedValueOnce(6).mockResolvedValueOnce(2).mockResolvedValueOnce(1),
      groupBy: jest
        .fn()
        .mockResolvedValueOnce([
          { status: 'ACTIVE', _count: { _all: 6 } },
          { status: 'DRAFT', _count: { _all: 2 } },
        ])
        .mockResolvedValueOnce([
          { moduleName: 'finance', _count: { _all: 4 } },
          { moduleName: null, _count: { _all: 1 } },
        ]),
      findMany: jest.fn().mockResolvedValue([
        { id: 'course-ready', title: 'Finance basics', _count: { lessons: 3, enrollments: 8 } },
        { id: 'course-empty', title: 'Procurement basics', _count: { lessons: 0, enrollments: 2 } },
      ]),
    },
    trainingEnrollment: {
      count: jest
        .fn()
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(3)
        .mockResolvedValueOnce(0),
      aggregate: jest.fn().mockResolvedValue({ _avg: { progressPercent: 62.5 } }),
      groupBy: jest.fn().mockResolvedValue([
        { status: 'COMPLETED', _count: { _all: 5 } },
        { status: 'IN_PROGRESS', _count: { _all: 3 } },
      ]),
      findMany: jest.fn().mockResolvedValue([{ id: 'completion-1' }]),
    },
    trainingLesson: {
      count: jest.fn().mockResolvedValueOnce(12).mockResolvedValueOnce(4),
      groupBy: jest.fn().mockResolvedValue([
        { status: 'ACTIVE', _count: { _all: 12 } },
        { status: 'DRAFT', _count: { _all: 4 } },
      ]),
    },
    guidedWalkthrough: { count: jest.fn().mockResolvedValueOnce(5).mockResolvedValueOnce(7) },
    trainingEnvironmentConfig: {
      count: jest.fn().mockResolvedValue(3),
      groupBy: jest.fn().mockResolvedValue([{ environment: 'SANDBOX', _count: { _all: 2 } }]),
    },
  } as any;
}

describe('TrainingService feature breadth summary', () => {
  it('returns course, enrollment, lesson, walkthrough, and environment readiness', async () => {
    const service = new TrainingService(makePrisma());

    const result = await service.getDashboardSummary();

    expect(result).toEqual(
      expect.objectContaining({
        activeCourses: 6,
        totalCourses: 8,
        draftCourses: 2,
        archivedCourses: 1,
        totalEnrollments: 10,
        completionRate: 50,
        usersInTraining: 3,
        activeLessons: 12,
        activeWalkthroughs: 5,
        totalWalkthroughs: 7,
        activeTrainingEnvironments: 3,
        averageProgressPercent: 62.5,
      }),
    );
    expect(result.courseReadiness.coursesWithPublishedLessons).toBe(1);
    expect(result.courseReadiness.coursesNeedingLessons).toEqual([
      { id: 'course-empty', title: 'Procurement basics', _count: { lessons: 0, enrollments: 2 } },
    ]);
    expect(result.coursesByModule).toEqual({ finance: 4, UNASSIGNED: 1 });
    expect(result.environmentsByType).toEqual({ SANDBOX: 2 });
  });
});
