# ITEMBA-R — Known Limitations at Launch

This document records known limitations of ITEMBA-R at initial launch.
These are documented risks, not failures. Each has a mitigation or planned resolution.

## 1. Mobile Application
**Status:** Not yet implemented  
**Impact:** Users must access via web browser on mobile devices. UI is responsive but not a native app.  
**Mitigation:** Mobile-responsive Aurora design system provides usable mobile experience.  
**Plan:** Native mobile app is planned for Phase 2.

## 2. Automated Test Execution
**Status:** Not yet integrated  
**Impact:** QA test cases are manually executed. No CI test runner integration.  
**Mitigation:** Manual QA process documented. Test cases are structured for future automation.  
**Plan:** Playwright/Jest integration planned for Phase 2.

## 3. Job Queue (Redis/BullMQ)
**Status:** Database-backed queue (not Redis)  
**Impact:** Background jobs run via database polling, not real-time queue. High-volume job throughput is limited.  
**Mitigation:** Sufficient for current load. Job table provides visibility and retry.  
**Plan:** Redis/BullMQ integration when load justifies it.

## 4. Multi-Language (Swahili)
**Status:** English only  
**Impact:** All UI, manuals, and help articles are in English.  
**Mitigation:** Staff training covers key terms. Swahili glossary to be created.  
**Plan:** Swahili language support planned for Phase 2.

## 5. Biometric Attendance
**Status:** Not integrated  
**Impact:** Attendance is recorded manually in the system. No biometric device integration.  
**Mitigation:** Manual attendance recording is functional and auditable.  
**Plan:** Biometric device API integration in Phase 2.

## 6. E-Signature
**Status:** Not yet implemented  
**Impact:** Documents and approvals use digital sign-off tracking, not cryptographic e-signatures.  
**Mitigation:** Approval audit logs provide traceable authorization records.  
**Plan:** DocuSign/qualified e-signature integration planned.

## 7. Advanced Report Scheduling
**Status:** Not yet implemented  
**Impact:** Reports must be manually run. No scheduled email delivery of reports.  
**Mitigation:** Users can run reports on demand and export to CSV/PDF.  
**Plan:** Scheduled reports via background jobs in Phase 2.

## 8. External Payment Provider Configuration
**Status:** Integration framework built; provider configuration required  
**Impact:** M-Pesa, Airtel Money, TigoPesa integrations require per-environment credentials.  
**Mitigation:** IT Admin can configure API keys via Integration Providers setup.  
**Plan:** Full configuration guide and test credentials provided during go-live.

## 9. Offline Sync Conflict Resolution UI
**Status:** Backend conflict detection built; frontend UI is basic  
**Impact:** Sync conflicts are flagged but require manual resolution by IT admin.  
**Mitigation:** Conflict records are logged and visible in Integration Events.  
**Plan:** Enhanced conflict resolution UI in Phase 2.

## 10. Data Import/Migration Tools
**Status:** Not built  
**Impact:** Historical data from previous systems must be entered manually or via Prisma seed scripts.  
**Mitigation:** Seed scripts provided for common reference data (COA, tax rates, etc.).  
**Plan:** CSV import tools for key entities (customers, products, employees) in Phase 2.
