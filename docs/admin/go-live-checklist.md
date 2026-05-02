# Go-Live Checklist — ITEMBA-R

## T-30 Days
- [ ] Complete all critical QA suites (AUTH, FINANCE, PETROLEUM, HR, SECURITY)
- [ ] Resolve all CRITICAL launch blockers
- [ ] Review all HIGH launch blockers — accept risk or resolve
- [ ] Complete accounting verification checklist
- [ ] Complete security review checklist
- [ ] Verify data isolation tests pass

## T-14 Days
- [ ] Final UAT with company managers and key users
- [ ] Training courses active and staff enrolled
- [ ] Admin documentation published
- [ ] User manuals published and in Help Center
- [ ] Support process established (ticket system live)
- [ ] Production environment fully provisioned

## T-7 Days
- [ ] Run backup test — backup and restore successfully
- [ ] Run load test on staging environment
- [ ] Verify all API integrations (M-Pesa, Airtel, SMS)
- [ ] Verify offline sync on registered devices
- [ ] Final round of security event testing
- [ ] Confirm all user accounts created and roles assigned

## T-1 Day
- [ ] Database migration on production: `npx prisma migrate deploy`
- [ ] Seed data on production: `npm run db:seed`
- [ ] Health check all services
- [ ] Verify backup schedule active
- [ ] Confirm monitoring alerts configured
- [ ] All signatories confirm go-live approval

## Go-Live Day
- [ ] Deploy production Docker stack
- [ ] Verify frontend accessible
- [ ] Verify backend health endpoint
- [ ] Test login as Group Super Admin
- [ ] Test login as Company Manager (each company)
- [ ] Run smoke test: create customer, record sale, view dashboard
- [ ] Monitor error logs for first 2 hours
- [ ] Confirm support team on standby

## Post-Launch (First 24 Hours)
- [ ] Review security events
- [ ] Review error logs
- [ ] Confirm backup ran
- [ ] Monitor performance traces for slow queries
- [ ] Handle any urgent support tickets
- [ ] Brief management on go-live status
