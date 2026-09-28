# Phase 2 — Content Templates

What was added during Phase 2.

## Backend

1. `api/migrations/002_add_content_templates.sql` — new `content_templates` table (id, name, description, brand_id nullable = global, category, campaign, pillar, platform, format, caption, hashtags, image_prompt, video_script, created_by, created_at, updated_at; FKs to brands/users; indexes) — created **and applied** to the live DB.
2. `api/templates.php` — full CRUD API:
   - GET (visible-brand scoping + global templates, `?brand_id` / `?category` filters)
   - POST / PUT / DELETE (auth required, super-admin gated, brand-access checks)
   - Audit logging (`templates.created` / `templates.updated` / `templates.deleted`)
   - Rate limit (130 req/min/user)
   - `resolve_brand()` helper, `template_shape()` response mapper

## Frontend — `src/api.ts`

3. `TemplateDTO` type
4. `apiListTemplates`, `apiCreateTemplate`, `apiUpdateTemplate`, `apiDeleteTemplate` wrappers

## Frontend — `src/App.tsx`

5. `ContentTemplate` interface
6. `TEMPLATE_CATEGORIES` constant
7. `templateVars()` / `fillTemplateVars()` — `{{var}}` extraction + substitution helpers
8. `TemplatesView` — filterable template card grid (search, category/brand filters, hover Edit/Delete, click Use)
9. `TemplateFormPanel` — create/edit SlidePanel (brand picker with "Global", category, platform/format, caption/hashtags/image/video templates, live variable preview)
10. `TemplateUseModal` — variable-fill dialog before creating a post
11. `EMPTY_TEMPLATE` factory
12. Nav: added **Templates** to `NAV_ITEMS` (🧩)
13. App wiring: `templates` state (+ localStorage cache), load-on-mount sync, `handleSaveTemplate`, `handleDeleteTemplate`, `handleUseTemplate`
14. "Use template" → pre-fills `ContentFormPanel` (added `prefill` prop + `emptyForm()` / `initForm()` refactor), switches to Content view
15. `ConfirmModal` extended to handle template deletions

## Verification

- `tsc --noEmit` clean
- `npm run build` OK
- 49/49 tests pass
- Live API round-trip (login → create → list → update → delete) confirmed
- Audit entries (created/updated/deleted) confirmed in `audit_logs`
- PHP synced to `C:\laragon\www\ContentOS\api\templates.php`