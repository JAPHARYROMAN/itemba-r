# Public website page guide

The website introduces Itemba Group and routes customers, suppliers and partners to the right operating company. Use an editorial photographic layout: warm paper surfaces, charcoal chapters, group gold and the established company accents.

## Page composition

- Route pages are server components. Export page metadata, render relevant structured data, compose sections, and finish with FooterTrail.
- Keep business copy in typed src/content modules. Contact literals live only in src/content/contact.ts.
- Use shared UI primitives and semantic design tokens. PageHero aligns left by default; use split heroes for small or portrait photographs.
- Use one h1 per page, h2 for sections and h3 for cards. Each named section must have a real heading.
- Alternate text, operational evidence and photographs. Give each section a distinct purpose; avoid repeating centred headings and oversized cards.
- Company pages progress through introduction, capabilities, facts, actual sites/routes, a selected gallery, profile download and contextual enquiry.
- General enquiry actions lead to /contact. Company and service actions lead to their existing #enquire forms.

## Photography and facts

- Reference photographs by media registry ID through Media or LeadPhoto. Preserve intrinsic dimensions, appropriate sizes, credits and provenance.
- Only landscape masters at least 2000 pixels wide belong in large frames. Smaller and portrait photographs stay in bounded columns.
- Use an image once within a page. Reusing an owned photograph on different routes is allowed where the existing library is limited.
- A photograph must not imply a customer relationship, project ownership, depot location or other unsupported fact.
- Unverified legal identifiers, leadership names, chronology and hospitality images remain unpublished. Do not turn on a flag without evidence.
- Where suitable verified images are unavailable, use factual typography and icons.
- A hero or LCP image must be visible immediately, eager where appropriate and free of entrance animation.

## Interactions and accessibility

- Client interactions live in src/islands. Preserve the small shared bundle and static readable HTML.
- Keep visible keyboard focus, menu focus containment/restoration, Escape behaviour and reduced-motion support.
- Maintain accessible contact alternatives without JavaScript. Never show successful enquiry delivery unless the API confirms email acceptance or durable storage.
- Failed enquiry submissions retain the visitor's message.
- Preserve public URLs, intentional anchors, company-routing intents and analytics event contracts.

## Release checks

Run the existing typecheck, lint, unit, production build, asset budgets and browser suites. Keep all 25 sitemap routes, downloads, social cards, redirects and metadata working.

Regenerate all four profile PDFs after their content, printing or dependency inputs change; inspect every page, then refresh pdf-inputs.lock. Publication decisions apply equally to screen content, metadata, structured data and downloads.

Keep the website release independent of the ERP. Stage a production deployment without domain assignment, verify it and promote that same build. Record the previous deployment for rollback.
