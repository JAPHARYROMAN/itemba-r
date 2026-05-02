# UI/UX Review Checklist

## Overview

This checklist verifies ITEMBA-R's compliance with the **Aurora Design System** — the component library and design language used throughout the application. Each item has a clear pass/fail criterion. The UI/UX QA tester works through this checklist on both the Test and Staging environments before go-live.

---

## 1. Light Mode

| # | Check | Pass Criteria | Result |
|---|---|---|---|
| 1.1 | Application loads in light mode by default | White/light grey background, dark text | ☐ PASS ☐ FAIL |
| 1.2 | Primary color (brand) used consistently for CTAs | All primary buttons use the same brand color | ☐ PASS ☐ FAIL |
| 1.3 | Sidebar background is correct shade | Not pure black, uses Aurora sidebar color | ☐ PASS ☐ FAIL |
| 1.4 | Text contrast on light backgrounds | All body text meets WCAG AA (4.5:1 minimum) | ☐ PASS ☐ FAIL |
| 1.5 | Card/panel background distinguishable from page | Subtle elevation or border visible | ☐ PASS ☐ FAIL |

---

## 2. Dark Mode

| # | Check | Pass Criteria | Result |
|---|---|---|---|
| 2.1 | Dark mode toggle switches correctly | Switching dark mode applies to all components | ☐ PASS ☐ FAIL |
| 2.2 | All text readable in dark mode | No white-on-white or black-on-black text | ☐ PASS ☐ FAIL |
| 2.3 | Sidebar has correct dark mode color | Uses Aurora dark sidebar color, not pure black | ☐ PASS ☐ FAIL |
| 2.4 | Cards and panels have elevated background | Distinct from page background in dark mode | ☐ PASS ☐ FAIL |
| 2.5 | Inputs and dropdowns visible in dark mode | Input borders visible, text is white/light | ☐ PASS ☐ FAIL |
| 2.6 | Dark mode preference persists after refresh | User preference stored in localStorage or cookie | ☐ PASS ☐ FAIL |

---

## 3. Sidebar Navigation

| # | Check | Pass Criteria | Result |
|---|---|---|---|
| 3.1 | Active menu item is visually highlighted | Current page link has active state (color/background) | ☐ PASS ☐ FAIL |
| 3.2 | Sidebar collapses to icons on narrow viewport | At <1024px, sidebar collapses to icon-only | ☐ PASS ☐ FAIL |
| 3.3 | Sidebar groups are collapsible | Clicking group header toggles sub-items | ☐ PASS ☐ FAIL |
| 3.4 | Inaccessible items are visually distinct | Hidden or greyed-out items for unauthorized routes | ☐ PASS ☐ FAIL |
| 3.5 | Sidebar scroll for long navigation lists | Sidebar scrolls independently of page content | ☐ PASS ☐ FAIL |

---

## 4. Topbar

| # | Check | Pass Criteria | Result |
|---|---|---|---|
| 4.1 | Company selector shows current company | Company name/logo visible in topbar | ☐ PASS ☐ FAIL |
| 4.2 | Notification bell shows unread count | Badge number on bell icon matches unread count | ☐ PASS ☐ FAIL |
| 4.3 | User avatar/name menu opens on click | Dropdown shows profile, settings, sign out | ☐ PASS ☐ FAIL |
| 4.4 | Topbar is sticky on scroll | Topbar remains visible when scrolling page content | ☐ PASS ☐ FAIL |
| 4.5 | Mobile menu hamburger visible at small sizes | At <768px, hamburger icon opens the sidebar | ☐ PASS ☐ FAIL |

---

## 5. StatCards (Dashboard KPI Cards)

| # | Check | Pass Criteria | Result |
|---|---|---|---|
| 5.1 | StatCard shows label, value, and trend | All three elements visible and readable | ☐ PASS ☐ FAIL |
| 5.2 | Positive trend uses green color | Green arrow/text for positive change | ☐ PASS ☐ FAIL |
| 5.3 | Negative trend uses red color | Red arrow/text for negative change | ☐ PASS ☐ FAIL |
| 5.4 | StatCard is clickable and navigates to detail | Clicking the card navigates to the underlying data | ☐ PASS ☐ FAIL |
| 5.5 | Large numbers are formatted with commas | TZS 1,234,567 not TZS 1234567 | ☐ PASS ☐ FAIL |

---

## 6. DataTable

| # | Check | Pass Criteria | Result |
|---|---|---|---|
| 6.1 | Pagination controls are present and functional | Page numbers, previous/next, per-page selector | ☐ PASS ☐ FAIL |
| 6.2 | Column sorting works on sortable columns | Clicking column header sorts ascending then descending | ☐ PASS ☐ FAIL |
| 6.3 | Empty state shows helpful message | "No records found" with clear description (not blank table) | ☐ PASS ☐ FAIL |
| 6.4 | Row hover state is visible | Row background changes subtly on hover | ☐ PASS ☐ FAIL |
| 6.5 | Action buttons per row are clear | Edit/View/Delete buttons are visible and labeled | ☐ PASS ☐ FAIL |
| 6.6 | Table is horizontally scrollable on small screens | Table doesn't overflow and hide content | ☐ PASS ☐ FAIL |
| 6.7 | Search/filter works and updates the table | Results update as user types or applies filter | ☐ PASS ☐ FAIL |

---

## 7. Forms

| # | Check | Pass Criteria | Result |
|---|---|---|---|
| 7.1 | All form labels are visible above inputs | Labels not inside inputs (placeholders supplement only) | ☐ PASS ☐ FAIL |
| 7.2 | Required field indicators are present | Asterisk (*) or "Required" on mandatory fields | ☐ PASS ☐ FAIL |
| 7.3 | Validation messages appear on blur or submit | Error message appears below the invalid field | ☐ PASS ☐ FAIL |
| 7.4 | Validation message text is helpful | "Amount must be greater than 0", not generic "Invalid" | ☐ PASS ☐ FAIL |
| 7.5 | Disabled fields are visually distinct | Greyed out, cursor: not-allowed | ☐ PASS ☐ FAIL |
| 7.6 | Date pickers work and format correctly | Dates display as DD/MM/YYYY in Tanzanian locale | ☐ PASS ☐ FAIL |
| 7.7 | Number inputs reject non-numeric input | Letters cannot be typed in amount fields | ☐ PASS ☐ FAIL |
| 7.8 | Save/Cancel buttons clearly differentiated | Primary action (Save) is more prominent than Cancel | ☐ PASS ☐ FAIL |

---

## 8. Modals and Drawers

| # | Check | Pass Criteria | Result |
|---|---|---|---|
| 8.1 | Modal opens with overlay background | Background is dimmed/blurred when modal is open | ☐ PASS ☐ FAIL |
| 8.2 | Modal closes on Escape key | Pressing Escape closes the modal | ☐ PASS ☐ FAIL |
| 8.3 | Modal closes on backdrop click (if appropriate) | Clicking outside modal closes it (unless unsaved changes) | ☐ PASS ☐ FAIL |
| 8.4 | Drawer opens from the right side | Drawer slides in from the right | ☐ PASS ☐ FAIL |
| 8.5 | Focus is trapped inside modal when open | Tab key does not navigate outside the modal | ☐ PASS ☐ FAIL |
| 8.6 | Destructive confirmation modals require explicit confirmation | Delete/cancel actions require typed confirmation or explicit button | ☐ PASS ☐ FAIL |

---

## 9. Status Badges

| # | Check | Pass Criteria | Result |
|---|---|---|---|
| 9.1 | Status colors are consistent across modules | "Active" is always green, "Inactive" is always grey, "Pending" is always amber | ☐ PASS ☐ FAIL |
| 9.2 | Status badges are readable in both light and dark mode | Sufficient contrast in both themes | ☐ PASS ☐ FAIL |
| 9.3 | Badge text does not truncate | Badge is wide enough to show full status text | ☐ PASS ☐ FAIL |

### Standard Status Color Map
| Status | Color |
|---|---|
| Active / Approved / Paid / Open | Green |
| Pending / In Progress / Draft | Amber / Yellow |
| Closed / Inactive / Cancelled | Grey |
| Rejected / Overdue / Failed | Red |
| Blocked / Critical | Dark Red |

---

## 10. Loading States

| # | Check | Pass Criteria | Result |
|---|---|---|---|
| 10.1 | Pages show loading skeleton/spinner while fetching | No blank white flash during data fetch | ☐ PASS ☐ FAIL |
| 10.2 | Buttons show loading state when processing | Spinner icon on button, button disabled during processing | ☐ PASS ☐ FAIL |
| 10.3 | Long-running operations show progress | Toast or progress bar for actions > 2 seconds | ☐ PASS ☐ FAIL |

---

## 11. Error States

| # | Check | Pass Criteria | Result |
|---|---|---|---|
| 11.1 | API errors show a user-friendly message | Not a raw JSON error dump | ☐ PASS ☐ FAIL |
| 11.2 | 404 pages have a helpful message | "Page not found" with a link back to the dashboard | ☐ PASS ☐ FAIL |
| 11.3 | 403 pages explain access is denied | "You don't have permission" with contact information | ☐ PASS ☐ FAIL |
| 11.4 | Form submission errors are highlighted | Failed field is red, error message is visible | ☐ PASS ☐ FAIL |

---

## 12. Restricted Data States

| # | Check | Pass Criteria | Result |
|---|---|---|---|
| 12.1 | Group Control sections show lock icon for unauthorized users | Visible padlock or "Access Restricted" message | ☐ PASS ☐ FAIL |
| 12.2 | Sensitive fields masked for unauthorized users | Bank account numbers show **** for non-Group Control users | ☐ PASS ☐ FAIL |

---

## 13. Mobile Responsiveness

Test at the following viewport widths: **320px** (small phone), **768px** (tablet), **1024px** (laptop).

| # | Check | 320px | 768px | 1024px |
|---|---|---|---|---|
| 13.1 | Dashboard is usable | ☐ | ☐ | ☐ |
| 13.2 | Sidebar is accessible | ☐ | ☐ | ☐ |
| 13.3 | Forms are usable without horizontal scroll | ☐ | ☐ | ☐ |
| 13.4 | DataTables are scrollable | ☐ | ☐ | ☐ |
| 13.5 | Modals don't overflow the screen | ☐ | ☐ | ☐ |
| 13.6 | Navigation is accessible via hamburger menu | ☐ | ☐ | N/A |

---

## 14. Accessibility

| # | Check | Pass Criteria | Result |
|---|---|---|---|
| 14.1 | Focus states visible on all interactive elements | Clear focus ring when tabbing through UI | ☐ PASS ☐ FAIL |
| 14.2 | Body text contrast ratio ≥ 4.5:1 | Verified with browser accessibility tools | ☐ PASS ☐ FAIL |
| 14.3 | Large text contrast ratio ≥ 3:1 | Headings and large text meet minimum threshold | ☐ PASS ☐ FAIL |
| 14.4 | Images have alt text | All informational images have descriptive alt text | ☐ PASS ☐ FAIL |
| 14.5 | Form inputs are associated with labels | `for`/`id` pairing or `aria-label` | ☐ PASS ☐ FAIL |

---

## 15. Keyboard Navigation

| # | Check | Pass Criteria | Result |
|---|---|---|---|
| 15.1 | All interactive elements reachable by Tab | No interactive element skipped in tab order | ☐ PASS ☐ FAIL |
| 15.2 | Dropdowns navigable by arrow keys | Up/down arrow navigates dropdown options | ☐ PASS ☐ FAIL |
| 15.3 | Forms submittable via Enter key | Enter in the last field submits the form | ☐ PASS ☐ FAIL |
| 15.4 | Modals opened and closed by keyboard | Enter to confirm, Escape to close | ☐ PASS ☐ FAIL |
