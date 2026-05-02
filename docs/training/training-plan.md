# Training Plan

## 1. Training Program Overview

The ITEMBA-R Training Program prepares all staff of the Itemba Group of Companies to use the system effectively from Day 1 of go-live. Training is not optional — proficient users make fewer errors, raise fewer support tickets, and trust the system faster.

**Training program scope:**
- All staff members who will use ITEMBA-R in any capacity
- IT Administrator and technical support staff
- All three companies: Mwanjalisi Oil, Westsides Company Ltd, and Itemba Enterprises Co. Ltd

---

## 2. Training Objectives

By the end of the training program, each staff member should be able to:
1. Log in, navigate the system, and complete their daily tasks without assistance.
2. Understand which data they can access and what their role responsibilities are.
3. Know how to raise a support ticket if they encounter a problem.
4. Understand the importance of data accuracy and the audit trail.

---

## 3. Training Methods

| Method | Format | Best For |
|---|---|---|
| **In-System Walkthroughs** | Guided step-by-step overlays in ITEMBA-R | Learning specific workflows while actually doing them |
| **User Manuals** | Written guides in the Help Center | Reference material, detailed procedures |
| **Training Courses** | Structured modules with tasks to complete | Role-specific learning paths with tracked completion |
| **Live Training Sessions** | Instructor-led sessions (in-person or video call) | Groups, Q&A, complex topics requiring discussion |
| **Hands-On Practice** | Using the Training environment with demo data | Building confidence before go-live |

---

## 4. Role-Based Learning Paths

Each role has a curated learning path. Staff should complete their assigned path before go-live. See `docs/training/role-based-training-paths.md` for the full details of each path.

### Learning Path Summary

| Role | Estimated Time | Method |
|---|---|---|
| Group Director | ~2 hours | Courses + Manuals |
| Finance Controller / Accountant | ~3 hours | Courses + Manuals + Live session |
| Mwanjalisi Operations Staff | ~2 hours | Courses + Walkthroughs |
| Westsides Operations Staff | ~2 hours | Courses + Walkthroughs |
| Itemba Operations Staff | ~2.5 hours | Courses + Manuals |
| HR Manager | ~2 hours | Courses + Manuals |
| Compliance Officer | ~2 hours | Courses + Manuals |
| IT/Admin | ~4 hours | Courses + Manuals + Live session |
| General User | ~1 hour | Walkthrough + Getting Started manual |

---

## 5. Training Timeline (4 Weeks Before Go-Live)

### Week 1 (T-28 to T-22): IT Admin and Finance Training
- **Day 1–2:** IT Admin completes the IT/Admin learning path. Sets up training environment.
- **Day 3–4:** Finance Controller and Accountants complete Finance learning path.
- **Day 5:** Live training session — Finance team Q&A with IT Admin.

### Week 2 (T-21 to T-15): Operations Staff Training
- **Day 1–2:** Mwanjalisi Operations Staff complete Petroleum learning path.
- **Day 3–4:** Westsides Operations Staff complete their learning path.
- **Day 5:** Live training session — Operations staff Q&A.

### Week 3 (T-14 to T-8): Remaining Roles and UAT
- **Day 1–2:** Itemba Enterprises Operations Staff complete their learning path.
- **Day 3:** HR Manager and Compliance Officer complete their learning paths.
- **Day 4–5:** UAT period begins — trained users test the system in Staging.

### Week 4 (T-7 to T-1): Review and Readiness
- **Day 1–3:** Address training gaps identified during UAT.
- **Day 4:** Final refresher sessions for any struggling users.
- **Day 5:** Confirm all users have completed their training and are marked Ready for Go-Live.

---

## 6. Training Environment

The **TRAINING** environment is a dedicated instance of ITEMBA-R pre-loaded with the Training seed profile. It includes:
- All three companies with demo data
- Sample transactions for each module
- Demo employees, customers, and products
- Pre-configured compliance obligations
- A "reset" function to restore demo data when needed

### Training Environment URL
The training URL is provided by the IT Administrator (separate from production).

### Resetting Training Data
If training data becomes corrupted or needs to be refreshed:
```
POST /api/v1/training/environments/:id/reset-demo-data
Authorization: Bearer [admin token]
Permission: training.environments.manage
```

---

## 7. Assessment Method

### In-Course Assessments
Each training course includes 3–5 practical tasks the user must complete (e.g., "Open a fuel shift and record nozzle readings"). Completion is tracked automatically.

### Completion Threshold
A user's training for a given path is marked **Complete** when they have:
- Completed all required courses in their learning path (100%)
- Completed at least one guided walkthrough for their primary workflow
- Passed any in-course practical tasks (no formal written test)

### Manual Competency Check
For high-stakes roles (Finance Controller, Petroleum Supervisor, IT Admin), the QA Lead or IT Admin should conduct a brief live competency check:
- "Show me how you would close a fuel shift."
- "Show me how you would post a journal entry."
- "Show me how you would add a new user."

---

## 8. Completion Tracking

Training completion is tracked in ITEMBA-R:
1. Navigate to **Help & Training → Training → Administration → Completion Report**.
2. Filter by company or learning path.
3. The report shows: user name, assigned path, courses completed, courses pending, % complete, last activity date.
4. Users at 0% completion one week before go-live are flagged for immediate follow-up.

---

## 9. Training Gap Reporting

### Identifying Gaps
After Week 3 (post-UAT), run the Completion Report and identify:
- Users who have not started training
- Users who have started but are below 50% complete
- Users who completed training but scored poorly in the UAT scenarios for their role

### Gap Resolution
For each gap, the IT Admin or Training Coordinator:
1. Contacts the user's manager to schedule time for completion.
2. Offers a 1:1 session if the user is struggling.
3. Documents the gap and the resolution plan.
4. Re-checks completion after 2 days.

**Go-live readiness gate:** At least 80% of all identified key users must be training-complete before go-live. Any user in a critical role (Finance, Petroleum Supervisor, IT Admin) must be 100% training-complete.
