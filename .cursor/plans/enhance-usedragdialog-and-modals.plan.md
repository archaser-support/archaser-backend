---
name: ""
overview: ""
todos: []
isProject: false
---

# One shared dialog with optional drag, align, slide, resize

## Overview

Provide **one shared module** (hook + dialog component) that implements **all** modal behaviors: **drag**, **align**, **slide**, and **resize**. Each modal uses this shared component and turns on only the options it needs (e.g. drag + align + slide, or drag + align + slide + resize). No duplicated Dialog/Paper/Title/transition logic in individual modals.

## Current state

- **Hook:** [shared/hooks/useAppDialog.ts](shared/hooks/useAppDialog.ts) (to be renamed from useDragDialog.ts) — currently drag only; no options, no resize, no shared alignment/slide.
- **Modals:** ~20 files duplicate the same pattern (PaperProps position/transition, DialogTitle + DragHandle, Slide, onExited). Two modals duplicate full resize logic.
- **Shared modal folder:** Only [DeleteDialog.tsx](shared/layout-components/modal/DeleteDialog.tsx) and [ConfirmResolutionDialog.tsx](shared/layout-components/modal/ConfirmResolutionDialog.tsx); no reusable wrapper.
- **Duplicate:** [app/[locale]/app/customers/components/hooks/useDragDialog.ts](app/[locale]/app/customers/components/hooks/useDragDialog.ts) — remove.

## Option model: drag | align | slide | resize

Each modal chooses which behavior to use via props on the shared component:


| Option     | Effect                                                                                                                                                   |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **drag**   | Dialog is draggable by title; uses hook position, `dialogRef`, `handleDragStart`; title shows DragHandle and grab cursor.                                |
| **align**  | Paper uses edge alignment: `position.x === 0` → right (LTR) / left (RTL), `position.y === 0` → bottom. When false, dialog can be centered (e.g. Fade).   |
| **slide**  | Use Slide transition with RTL direction; when false, use Fade (and typically no drag/align).                                                             |
| **resize** | Show resize handles (width, height from bottom, height from top); hook manages dimensions and topPosition; top-resize uses rect.top when bottom-aligned. |


**Examples:**

- DeleteDialog: `drag align slide` (no resize).
- ExportDialog: `drag align slide`.
- UpsertContactModal / MassSendEmailModal: `drag align slide resize`.
- A future centered Fade dialog: `slide={false}` (and no drag/align), or a second preset.

All four behaviors live in the **same shared file**; the component and hook accept options and apply only what’s enabled.

## 1. Shared hook with all behavior (one file)

**File:** [shared/hooks/useAppDialog.ts](shared/hooks/useAppDialog.ts) (or co-locate in the same module as the shared dialog)

- **Options:** `drag?: boolean`, `align?: boolean`, `slide?: boolean`, `resize?: boolean` (or a single `features: { drag?, align?, slide?, resize? }`), plus `isRTL`, and when `resize`: `initialWidth`, `initialHeight`/`heightFraction`, `minWidth`, `maxWidth`, `minHeight`, `maxHeight`.
- **When `drag`:** Current behavior (position, isDragging, dialogRef, handleDragStart, resetPosition, setPosition).
- **When `resize`:** Add state (width, height, topPosition, resizeType, isExiting), refs, three resize handlers (top-resize uses **rect.top** when `position.y === 0`), one mousemove/mouseup effect; return resize state, handlers, `resetOnExited`.
- **When `align` or `slide`:** Return `getPaperPositionSx(theme, options?)` that applies **align** (right/left/top/bottom from position) and optional resize dimensions; return `slideDirection` when `slide` + `isRTL` are relevant.
- **Backward compatibility:** `useAppDialog()` with no args → same as today (drag only); new options are opt-in.

## 2. One shared dialog component (same module or single entry)

**New file:** `shared/layout-components/modal/AppDialog.tsx` (or `SharedDialog.tsx`)

**Single component** that implements all four features and wires the hook based on options:

- **Props for behavior:** `drag?: boolean`, `align?: boolean`, `slide?: boolean`, `resize?: boolean` (defaults: e.g. drag/align/slide true when used as side panel, resize false). Plus `isRTL`, and when resize: `resizeOptions` (initialWidth, etc.).
- **Transition:** If `slide` → Slide + `slideDirection`; else Fade (centered).
- **Paper:** If `align` (and hook position) → use `getPaperPositionSx(theme, { isRTL, width?, height?, topPosition? })` for position/size; else use centered layout. Base sx: flex column, overflow, title/content/actions flex rules. Merge optional `paperSx` from props.
- **Title:** If `drag` → `onMouseDown={handleDragStart}`, DragHandle, gradient, grab cursor; else plain title (no drag handle).
- **Resize:** If `resize` → render resize handles **inlined** in AppDialog (width, height-bottom, height-top with 8–48px skip for top so drag still works).
- **Content:** `children`, `actions?`, `title`, `titleIcon?`, `ariaLabelledBy`, `ariaDescribedBy`, and any Dialog props to forward.

So: **one shared file** holds **all** of drag, align, slide, resize; each modal passes only the options it needs. (DialogResizeHandles was inlined into AppDialog; no separate file.)

## 3. Migrate all modals: each uses shared component with only the options it needs

**Shared component usage:** Every modal imports the **one shared dialog** and passes only the features it needs: `drag`, `align`, `slide`, `resize` (and when resize: `resizeOptions`).

**Target files:**

- **drag + align + slide (no resize):** ~~[DeleteDialog.tsx](shared/layout-components/modal/DeleteDialog.tsx)~~ ✅, ~~[ConfirmResolutionDialog.tsx](shared/layout-components/modal/ConfirmResolutionDialog.tsx)~~ ✅, ~~[ExportDialog.tsx](shared/layout-components/grid/ExportDialog.tsx)~~ ✅, [ShareReportModal.tsx](components/reports/ShareReportModal.tsx), [ChangePasswordModal.tsx](app/[locale]/app/settings/users/[userId]/components/ChangePasswordModal.tsx), [UpsertBankModal.tsx](app/[locale]/app/settings/UpsertBankModal.tsx), [UpdateResolutionModal.tsx](app/[locale]/app/customers/[customerId]/UpdateResolutionModal.tsx), [LogActivity.tsx](app/[locale]/app/customers/[customerId]/LogActivity.tsx), [ChangeCollectionCategoryModal.tsx](app/[locale]/app/customers/[customerId]/ChangeCollectionCategoryModal.tsx), [AssignUserModel.tsx](app/[locale]/app/customers/[customerId]/AssignUserModel.tsx), [AddBankToCustomerModal.tsx](app/[locale]/app/customers/[customerId]/AddBankToCustomerModal.tsx), [MassUpdateCategoryModal.tsx](app/[locale]/app/customers/components/MassUpdateCategoryModal.tsx), [SMSVendors.tsx](app/[locale]/app/admin/sms/components/SMSVendors.tsx), [SMSCountryMappings.tsx](app/[locale]/app/admin/sms/components/SMSCountryMappings.tsx), [UpsertBusinessUnitModal.tsx](app/[locale]/app/admin/accounts/[AccountId]/details/components/UpsertBusinessUnitModal.tsx), [AccountDetails.tsx](app/[locale]/app/admin/accounts/[AccountId]/details/AccountDetails.tsx), [SequenceSelector.tsx](app/[locale]/app/activitySequences/components/SequenceSelector.tsx), [SequenceDetailsModal.tsx](app/[locale]/app/activitySequences/components/SequenceDetailsModal.tsx), [ActivitySequenceStepModal.tsx](app/[locale]/app/activitySequences/components/ActivitySequenceStepModal.tsx).
- **drag + align + slide + resize:** [MassSendEmailModal.tsx](app/[locale]/app/customers/components/MassSendEmailModal.tsx), [UpsertContactModal.tsx](app/[locale]/app/customers/[customerId]/UpsertContactModal.tsx) — pass `resize` and `resizeOptions`; remove local resize state/handlers/handles.

**Out of scope for this pass:** Centered Fade dialogs (DeleteBusinessUnitDialog, InvoicesWithoutCustomerList, ContactAvailabilityConfig, etc.) can later use the same shared component with `slide={false}` (and no drag/align) if desired.

## Migration checklist (AppDialog)

**Done (11)**  

- DeleteDialog  
- ConfirmResolutionDialog  
- ExportDialog  
- VariableInsertionDialog  
- AssignUserModel  
- AddBankToCustomerModal  
- ChangeCollectionCategoryModal  
- ShareReportModal  
- UpsertGenericFieldModal  
- UpsertContactModal *(resize)*  
- MassSendEmailModal *(resize)*  

**drag + align + slide (no resize) — remaining**  

- ChangePasswordModal *(in .cursorignore; migrate when accessible)*  
- ~~UpsertBankModal~~ ✅  
- ~~UpdateResolutionModal~~ ✅ (already AppDialog)  
- ~~LogActivity~~ ✅  
- ~~MassUpdateCategoryModal~~ ✅  
- ~~SMSVendors~~ ✅  
- ~~SMSCountryMappings~~ ✅  
- ~~UpsertBusinessUnitModal~~ ✅  
- ~~AccountDetails (provider dialog)~~ ✅  
- ~~SequenceSelector~~ ✅  
- ~~SequenceDetailsModal~~ ✅ (already AppDialog)  
- ~~ActivitySequenceStepModal~~ ✅  
- ~~EmailEditor (2 dialogs)~~ ✅

**drag + align + slide + resize — done**  

- ~~MassSendEmailModal~~ ✅  
- ~~UpsertContactModal~~ ✅

## 4. Cleanup and docs

- **Remove:** [app/[locale]/app/customers/components/hooks/useDragDialog.ts](app/[locale]/app/customers/components/hooks/useDragDialog.ts).
- **Update** [.cursor/rules/frontend-modals.mdc](.cursor/rules/frontend-modals.mdc):
  - **One shared dialog:** Use `AppDialog` (or chosen name) from `shared/layout-components/modal/`. Document the four options: `drag`, `align`, `slide`, `resize`; document `resizeOptions` when `resize` is true.
  - **Pattern:** Each modal implements only its content; behavior is selected via options (drag, align, slide, resize). Document rect.top for top-resize and 8–48px top-handle skip.

## Implementation order

1. ~~Rename [shared/hooks/useDragDialog.ts](shared/hooks/useDragDialog.ts) to **useAppDialog.ts** and enhance it~~ ✅ — [useAppDialog.ts](shared/hooks/useAppDialog.ts) created; [useDragDialog.ts](shared/hooks/useDragDialog.ts) re-exports for backward compat.
2. ~~DialogResizeHandles~~ — Resize handles inlined in AppDialog (no separate file).
3. ~~Add **one shared dialog component** [AppDialog.tsx~~](shared/layout-components/modal/AppDialog.tsx) ✅ — Accepts `drag`, `align`, `slide`, `resize`, `resizeOptions`; uses `useAppDialog`; resize handles inlined.
4. ~~Migrate resizable modals (UpsertContactModal, MassSendEmailModal) to AppDialog with `resize` + `resizeOptions`.~~ ✅
5. Migrate remaining Slide + draggable modals to AppDialog with `drag align slide` (ShareReportModal, UpsertGenericFieldModal done; ~11 remaining).
6. Remove duplicate [app/.../customers/components/hooks/useDragDialog.ts](app/[locale]/app/customers/components/hooks/useDragDialog.ts); update [frontend-modals.mdc](.cursor/rules/frontend-modals.mdc) to reference useAppDialog and AppDialog.

## Testing

- **Drag-only:** Open ExportDialog, DeleteDialog, one form modal; drag and close; position resets, alignment correct.
- **Resizable:** UpsertContactModal, MassSendEmailModal — drag, resize width/bottom/top; no jump on top-resize when bottom-aligned.
- **Shared component:** Each migrated modal opens, closes, and preserves behavior (title, content, actions, scroll).
- **Static:** `npx tsc --noEmit`, `npm run lint`.

